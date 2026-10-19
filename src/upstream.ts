/**
 * freeflow-omniroute — Upstream Proxy
 *
 * Routes requests to the appropriate upstream:
 * - OpenCode Zen (opencode.ai) with client fingerprinting + tool injection + SSE conversion + relay pool
 * - KiloCode Gateway (api.kilo.ai) keyless or with custom Kilo API token
 * - OVHcloud AI Endpoints (kepler.ai.cloud.ovh.net) keyless
 * - Cline (api.cline.bot) with multi-login rotation
 */

import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  UPSTREAM_OPENCODE,
  KILO_CHAT_URL,
  KILO_RESPONSES_URL,
  OVH_CHAT_URL,
  UPSTREAM_HEADER_TIMEOUT_MS,
  opencodeHeaders,
} from "./config.ts";
import {
  getModelDef,
  isKiloModel,
  isOvhModel,
  isClineModel,
  ovhUpstreamModelId,
  resolveCanonicalModelId,
} from "./models.ts";
import { relayFetch } from "./relay.ts";
import { rollClineChat } from "./cline.ts";
import { log, isDebugEnabled } from "./logger.ts";

function upstreamTimeoutError(): DOMException {
  return new DOMException("Upstream header timeout", "AbortError");
}

// ── OpenCode Fingerprint Schemas ─────────────────────────────────

const COMPAT_FINGERPRINT_SCHEMAS: Record<string, Record<string, unknown>> = {
  bash: { type: "object", properties: { command: { type: "string", description: "Shell command to run." } }, required: ["command"] },
  read: { type: "object", properties: { path: { type: "string", description: "File path to read." } }, required: ["path"] },
  glob: { type: "object", properties: { path: { type: "string", description: "Search path." } } },
  grep: { type: "object", properties: { pattern: { type: "string", description: "Search pattern." } }, required: ["pattern"] },
  edit: { type: "object", properties: { path: { type: "string", description: "File path to edit." } }, required: ["path"] },
  write: { type: "object", properties: { path: { type: "string", description: "File path to write." } }, required: ["path"] },
};

const FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read", "edit", "write"] as const;

function prepareOpenCodeBody(body: Record<string, unknown>): {
  addedPlaceholders: string[];
  callerHadTools: boolean;
} {
  const tools = (Array.isArray(body.tools) ? [...body.tools] : []) as Record<string, unknown>[];
  const callerHadTools = tools.length > 0;
  const existingNames = new Set<string>();

  for (const t of tools) {
    const fn = t.function as Record<string, unknown> | undefined;
    const rawName = typeof t.name === "string" ? t.name : typeof fn?.name === "string" ? fn.name : "";
    if (rawName) existingNames.add(rawName.trim().toLowerCase());
  }

  const addedPlaceholders: string[] = [];
  for (const req of FINGERPRINT_TOOLS) {
    if (!existingNames.has(req)) {
      tools.push({
        type: "function",
        function: {
          name: req,
          description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
          parameters: COMPAT_FINGERPRINT_SCHEMAS[req],
        },
      });
      existingNames.add(req);
      addedPlaceholders.push(req);
    }
  }

  body.tools = tools;

  if (body.tool_choice && typeof body.tool_choice === "string" && body.tool_choice.toLowerCase() !== "auto") {
    delete body.tool_choice;
  }

  body.stream = true;

  return { addedPlaceholders, callerHadTools };
}

// ── SSE Parser & Aggregator ──────────────────────────────────────

interface SseEvent {
  event?: string;
  data: string;
}

function parseSseEvents(text: string): SseEvent[] {
  const result: SseEvent[] = [];
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length > 0) {
      result.push({ event: eventName, data: dataLines.join("\n") });
    }
  }
  return result;
}

function sseToChatCompletion(
  sseText: string,
  modelName: string,
  addedPlaceholders: string[],
  callerHadTools: boolean,
): Record<string, unknown> {
  const events = parseSseEvents(sseText);
  let id = `chatcmpl-${Date.now()}`;
  let model = modelName;
  let created = Math.floor(Date.now() / 1000);
  let finishReason: string | null = "stop";
  let content = "";
  let reasoningContent = "";
  let role = "assistant";
  let usage: unknown = undefined;

  const toolCallsMap = new Map<string, { id: string; type: string; function: { name: string; arguments: string } }>();
  const keyByIndex = new Map<number, string>();

  for (const ev of events) {
    if (ev.data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(ev.data);
      if (parsed.id) id = parsed.id;
      if (parsed.model) model = parsed.model;
      if (parsed.created) created = parsed.created;
      if (parsed.usage) usage = parsed.usage;

      if (Array.isArray(parsed.choices)) {
        for (const c of parsed.choices) {
          if (c.finish_reason) finishReason = c.finish_reason;
          const delta = c.delta;
          if (delta) {
            if (delta.role) role = delta.role;
            if (typeof delta.content === "string") content += delta.content;
            if (typeof delta.reasoning_content === "string") {
              reasoningContent += delta.reasoning_content;
            } else if (typeof delta.reasoning === "string") {
              reasoningContent += delta.reasoning;
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = typeof tc.index === "number" ? tc.index : 0;
                const hasId = typeof tc.id === "string" && tc.id !== "";
                let key = hasId ? `id:${tc.id}` : keyByIndex.get(idx);
                if (key === undefined) key = `idx:${idx}`;
                if (hasId) keyByIndex.set(idx, key);

                const existing = toolCallsMap.get(key) ?? {
                  id: tc.id || "",
                  type: tc.type || "function",
                  function: { name: "", arguments: "" },
                };
                if (tc.id) existing.id = tc.id;
                if (tc.type) existing.type = tc.type;
                if (tc.function?.name) existing.function.name += tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                toolCallsMap.set(key, existing);
              }
            }
          }
        }
      }
    } catch {
      // ignore partial / non-JSON event lines
    }
  }

  const rawToolCalls = Array.from(toolCallsMap.values());
  const keptToolCalls = rawToolCalls.filter((tc) => {
    const name = tc.function.name.toLowerCase();
    return !addedPlaceholders.includes(name);
  });

  const message: Record<string, unknown> = {
    role,
    content: content || null,
  };

  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }

  if (callerHadTools && keptToolCalls.length > 0) {
    message.tool_calls = keptToolCalls;
    finishReason = "tool_calls";
  }

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

// ── Stream Pipe Helper ──────────────────────────────────────────

function pipeStream(
  upstreamBody: ReadableStream<Uint8Array>,
  res: ServerResponse,
  req: IncomingMessage,
  reqId: string,
): void {
  const readable = Readable.fromWeb(upstreamBody as unknown as WebReadableStream);

  readable.on("data", (chunk: Buffer) => {
    if (!res.writableEnded) {
      res.write(chunk);
    }
  });

  readable.on("end", () => {
    if (!res.writableEnded) {
      res.end();
    }
  });

  readable.on("error", (err) => {
    log("error", "upstream stream error", { error: String(err) }, reqId);
    if (!res.writableEnded) {
      res.end();
    }
  });

  req.on("close", () => {
    if (!req.complete) {
      readable.destroy();
    }
  });
}

// ── OpenCode Zen Handler (Relay-backed) ──────────────────────────

async function handleOpenCodeRequest(
  body: Record<string, unknown>,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  reqId: string,
  clientRequestedStream: boolean,
): Promise<void> {
  const modelName = String(body.model || "");
  const { addedPlaceholders, callerHadTools } = prepareOpenCodeBody(body);

  const upstreamUrl = `${UPSTREAM_OPENCODE}${pathname}`;
  const headers: Record<string, string> = {
    ...opencodeHeaders(),
    "Content-Type": "application/json",
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(upstreamTimeoutError()),
    UPSTREAM_HEADER_TIMEOUT_MS,
  );
  const onClientGone = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", onClientGone);

  try {
    if (isDebugEnabled()) {
      log("debug", `OpenCode upstream → ${upstreamUrl}`, { model: modelName, clientRequestedStream }, reqId);
    }

    // Dispatches through the multi-relay pool with automatic rotation on 429
    const { response: upstreamRes, relayUsed } = await relayFetch(
      upstreamUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      },
      reqId,
    );

    clearTimeout(timeoutId);
    res.off("close", onClientGone);

    if (relayUsed) {
      log("info", `OpenCode request served via relay: ${relayUsed}`, { model: modelName }, reqId);
    }

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text().catch(() => "");
      log("warn", `OpenCode upstream ${upstreamRes.status}`, { status: upstreamRes.status, model: modelName }, reqId);
      if (!res.headersSent) {
        res.writeHead(upstreamRes.status, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        res.end(errorText);
      }
      return;
    }

    if (clientRequestedStream && upstreamRes.body) {
      const ct = upstreamRes.headers.get("content-type") || "text/event-stream";
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": ct,
          "cache-control": "no-cache, no-transform",
          "connection": "keep-alive",
          "x-accel-buffering": "no",
        });
      }
      pipeStream(upstreamRes.body, res, req, reqId);
    } else {
      const sseText = await upstreamRes.text();
      const completionJson = sseToChatCompletion(sseText, modelName, addedPlaceholders, callerHadTools);
      if (!res.headersSent) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(completionJson));
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    res.off("close", onClientGone);
    log("error", "OpenCode proxy error", { error: String(err) }, reqId);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream error", type: "proxy_error" } }));
    }
  }
}

// ── KiloCode Gateway Handler ────────────────────────────────────

async function handleKiloRequest(
  body: Record<string, unknown>,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  reqId: string,
  clientRequestedStream: boolean,
): Promise<void> {
  const kiloUrl = pathname.endsWith("/responses") ? KILO_RESPONSES_URL : KILO_CHAT_URL;
  const modelName = String(body.model || "");

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(upstreamTimeoutError()),
    UPSTREAM_HEADER_TIMEOUT_MS,
  );
  const onClientGone = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", onClientGone);

  try {
    if (isDebugEnabled()) {
      log("debug", `Kilo upstream → ${kiloUrl}`, { model: modelName }, reqId);
    }

    // Support optional Kilo API key via env or header
    const kiloHeaders: Record<string, string> = { "Content-Type": "application/json" };
    const customKey = process.env.KILO_API_KEY || (req.headers["x-kilo-key"] as string);
    if (customKey) {
      kiloHeaders["Authorization"] = `Bearer ${customKey}`;
    }

    const upstreamRes = await fetch(kiloUrl, {
      method: "POST",
      headers: kiloHeaders,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    res.off("close", onClientGone);

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text().catch(() => "");
      log("warn", `Kilo upstream ${upstreamRes.status}`, { status: upstreamRes.status, model: modelName }, reqId);
      if (!res.headersSent) {
        res.writeHead(upstreamRes.status, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        res.end(errorText);
      }
      return;
    }

    if (clientRequestedStream && upstreamRes.body) {
      const ct = upstreamRes.headers.get("content-type") || "text/event-stream";
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": ct,
          "cache-control": "no-cache, no-transform",
          "connection": "keep-alive",
          "x-accel-buffering": "no",
        });
      }
      pipeStream(upstreamRes.body, res, req, reqId);
    } else {
      const text = await upstreamRes.text();
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        res.end(text);
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    res.off("close", onClientGone);
    log("error", "Kilo proxy error", { error: String(err) }, reqId);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream error", type: "proxy_error" } }));
    }
  }
}

// ── OVHcloud AI Endpoints Handler ───────────────────────────────

async function handleOvhRequest(
  body: Record<string, unknown>,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  reqId: string,
  clientRequestedStream: boolean,
): Promise<void> {
  const modelName = String(body.model || "");
  const ovhBody = { ...body, model: ovhUpstreamModelId(modelName) };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(upstreamTimeoutError()),
    UPSTREAM_HEADER_TIMEOUT_MS,
  );
  const onClientGone = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", onClientGone);

  try {
    if (isDebugEnabled()) {
      log("debug", `OVH upstream → ${OVH_CHAT_URL}`, { model: ovhBody.model }, reqId);
    }

    const upstreamRes = await fetch(OVH_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ovhBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    res.off("close", onClientGone);

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text().catch(() => "");
      log("warn", `OVH upstream ${upstreamRes.status}`, { status: upstreamRes.status, model: modelName }, reqId);
      if (!res.headersSent) {
        res.writeHead(upstreamRes.status, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        res.end(errorText);
      }
      return;
    }

    if (clientRequestedStream && upstreamRes.body) {
      const ct = upstreamRes.headers.get("content-type") || "text/event-stream";
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": ct,
          "cache-control": "no-cache, no-transform",
          "connection": "keep-alive",
          "x-accel-buffering": "no",
        });
      }
      pipeStream(upstreamRes.body, res, req, reqId);
    } else {
      const text = await upstreamRes.text();
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        res.end(text);
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    res.off("close", onClientGone);
    log("error", "OVH proxy error", { error: String(err) }, reqId);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream error", type: "proxy_error" } }));
    }
  }
}

// ── Cline Handler (Multi-account pool) ───────────────────────────

async function handleClineRequest(
  body: Record<string, unknown>,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  reqId: string,
  clientRequestedStream: boolean,
): Promise<void> {
  const modelName = String(body.model || "");

  try {
    if (isDebugEnabled()) {
      log("debug", `Cline roll → ${modelName}`, undefined, reqId);
    }

    const { response: upstreamRes, slotUsed } = await rollClineChat(body, clientRequestedStream, reqId);

    if (slotUsed) {
      log("info", `Cline served by slot [${slotUsed}]`, { model: modelName }, reqId);
    }

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text().catch(() => "");
      log("warn", `Cline upstream ${upstreamRes.status}`, { status: upstreamRes.status, model: modelName }, reqId);
      if (!res.headersSent) {
        res.writeHead(upstreamRes.status, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        res.end(errorText);
      }
      return;
    }

    if (clientRequestedStream && upstreamRes.body) {
      const ct = upstreamRes.headers.get("content-type") || "text/event-stream";
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": ct,
          "cache-control": "no-cache, no-transform",
          "connection": "keep-alive",
          "x-accel-buffering": "no",
        });
      }
      pipeStream(upstreamRes.body, res, req, reqId);
    } else {
      const text = await upstreamRes.text();
      if (!res.headersSent) {
        res.writeHead(200, {
          "content-type": upstreamRes.headers.get("content-type") || "application/json",
        });
        res.end(text);
      }
    }
  } catch (err) {
    log("error", "Cline proxy error", { error: String(err) }, reqId);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream error", type: "proxy_error" } }));
    }
  }
}

// ── Main Routing Entry Point ────────────────────────────────────

export async function routeRequest(
  body: Record<string, unknown>,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  reqId: string,
): Promise<void> {
  const modelId = String(body.model || "");
  const canonical = resolveCanonicalModelId(modelId);
  const modelDef = getModelDef(modelId);

  if (!modelDef) {
    log("warn", `unknown model: ${modelId}`, undefined, reqId);
    if (!res.headersSent) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: `Model '${modelId}' not found in freeflow catalog. Use GET /v1/models to see available models.`,
          type: "invalid_request_error",
          code: "model_not_found",
        },
      }));
    }
    return;
  }

  // Normalize model ID to canonical in body
  if (canonical !== modelId) {
    body.model = canonical;
  }

  const clientRequestedStream = body.stream === true;

  if (isClineModel(modelId)) {
    await handleClineRequest(body, pathname, req, res, reqId, clientRequestedStream);
  } else if (isOvhModel(modelId)) {
    await handleOvhRequest(body, pathname, req, res, reqId, clientRequestedStream);
  } else if (isKiloModel(modelId)) {
    await handleKiloRequest(body, pathname, req, res, reqId, clientRequestedStream);
  } else {
    // OpenCode Zen models
    await handleOpenCodeRequest(body, pathname, req, res, reqId, clientRequestedStream);
  }
}
