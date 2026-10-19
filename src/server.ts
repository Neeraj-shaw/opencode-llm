/**
 * freeflow-omniroute — Standalone OpenAI-compatible API Server
 *
 * Exposes pi-freeflow's 35 free models (OpenCode Zen, KiloCode Gateway,
 * OVHcloud AI Endpoints, Cline) as a standard OpenAI-compatible API that
 * OmniRoute can consume as a self-hosted provider on EC2.
 *
 * Includes:
 * - Multi-proxy relay management (GET/POST/DELETE /v1/relays)
 * - Cline account rotation & WorkOS device login (POST /v1/auth/cline/*)
 * - KiloCode keyless gateway & custom API key support
 */

import * as http from "node:http";
import { randomUUID } from "node:crypto";
import {
  SERVER_PORT,
  SERVER_HOST,
  API_TOKEN,
  REQUIRE_AUTH,
  MAX_BODY_BYTES,
  ensureDataDir,
} from "./config.ts";
import { ALL_MODELS, getModelDef, resolveCanonicalModelId } from "./models.ts";
import { routeRequest } from "./upstream.ts";
import { getRelays, addRelay, removeRelay } from "./relay.ts";
import {
  getClineAccounts,
  addClineToken,
  removeClineAccount,
  startClineDeviceAuth,
  pollClineDeviceToken,
  registerClineToken,
} from "./cline.ts";
import { renderDashboardHtml } from "./ui.ts";
import { log, logInfo, logWarn, logError } from "./logger.ts";

ensureDataDir();

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!REQUIRE_AUTH) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === API_TOKEN;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function handleModels(res: http.ServerResponse): void {
  const models = ALL_MODELS.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: m.source === "kilo" ? "kilocode" : m.source === "ovh" ? "ovhcloud" : m.source === "cline" ? "cline" : "opencode",
    permission: [{
      id: `modelperm-${m.id}`,
      object: "model_permission",
      created: Math.floor(Date.now() / 1000),
      allow_create_engine: false,
      allow_sampling: true,
      allow_logprobs: false,
      allow_search_indices: false,
      allow_view: true,
      allow_fine_tuning: false,
      organization: "*",
      group: null,
      is_blocking: false,
    }],
    ...(m.contextWindow ? { context_window: m.contextWindow } : {}),
    ...(m.maxTokens ? { max_tokens: m.maxTokens } : {}),
  }));

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ object: "list", data: models }));
}

function handleHealth(res: http.ServerResponse): void {
  const relays = getRelays();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    version: "1.1.0",
    models: ALL_MODELS.length,
    upstreams: {
      opencode: ALL_MODELS.filter(m => m.source === "opencode").length,
      kilo: ALL_MODELS.filter(m => m.source === "kilo").length,
      ovh: ALL_MODELS.filter(m => m.source === "ovh").length,
      cline: ALL_MODELS.filter(m => m.source === "cline").length,
    },
    relays: {
      total: relays.length,
      healthy: relays.filter(r => Date.now() >= r.coolingUntil).length,
      list: relays.map(r => ({ label: r.label, url: r.url, healthy: Date.now() >= r.coolingUntil })),
    },
    cline: {
      accountsCount: getClineAccounts().length,
    },
    timestamp: new Date().toISOString(),
  }));
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type, Authorization, X-Kilo-Key");
  res.setHeader("access-control-max-age", "86400");
}

const server = http.createServer(async (req, res) => {
  const reqId = randomUUID().slice(0, 8);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase() || "GET";

  setCorsHeaders(res);
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Embedded Web Control Panel
  if (pathname === "/dashboard" || (pathname === "/" && req.headers.accept?.includes("text/html"))) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDashboardHtml());
    return;
  }

  // Health check
  if (pathname === "/health" || pathname === "/") {
    handleHealth(res);
    return;
  }

  // Auth check for /v1/* routes
  if (pathname.startsWith("/v1/") && !isAuthorized(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: {
        message: "Invalid or missing API key. Set FREEFLOW_API_TOKEN on the server and send Authorization: Bearer <token>.",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    }));
    return;
  }

  // ── Relay Pool Management ─────────────────────────────────────
  if (pathname === "/v1/relays") {
    if (method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: getRelays() }));
      return;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const parsed = JSON.parse(body.toString("utf8") || "{}");
      if (!parsed.url) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'url' field" }));
        return;
      }
      const created = addRelay(parsed.url, parsed.label, parsed.auth);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(created));
      return;
    }
    if (method === "DELETE") {
      const body = await readBody(req);
      const parsed = JSON.parse(body.toString("utf8") || "{}");
      const target = parsed.url || parsed.label || url.searchParams.get("url") || url.searchParams.get("label");
      if (!target) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'url' or 'label' parameter" }));
        return;
      }
      const removed = removeRelay(target);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: removed }));
      return;
    }
  }

  // ── Cline Account Management ──────────────────────────────────
  if (pathname === "/v1/auth/cline/accounts" && method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ accounts: getClineAccounts() }));
    return;
  }

  if (pathname === "/v1/auth/cline/device" && method === "POST") {
    try {
      const authData = await startClineDeviceAuth();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(authData));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (pathname === "/v1/auth/cline/poll" && method === "POST") {
    try {
      const body = await readBody(req);
      const { device_code, slot } = JSON.parse(body.toString("utf8") || "{}");
      if (!device_code) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'device_code'" }));
        return;
      }
      const tokens = await pollClineDeviceToken(device_code);
      const reg = await registerClineToken(tokens.access_token, tokens.refresh_token);
      const acc = addClineToken(reg.token, reg.email, slot);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, slot: acc.slot, email: acc.email }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (pathname === "/v1/auth/cline/token" && method === "POST") {
    try {
      const body = await readBody(req);
      const { token, email, slot } = JSON.parse(body.toString("utf8") || "{}");
      if (!token) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'token'" }));
        return;
      }
      const acc = addClineToken(token, email, slot);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, slot: acc.slot }));
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (pathname.startsWith("/v1/auth/cline/") && method === "DELETE") {
    const slot = decodeURIComponent(pathname.slice("/v1/auth/cline/".length));
    const removed = removeClineAccount(slot);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: removed }));
    return;
  }

  // ── Standard Model Endpoints ──────────────────────────────────
  if (pathname === "/v1/models" && method === "GET") {
    handleModels(res);
    return;
  }

  if (pathname.startsWith("/v1/models/") && method === "GET") {
    const modelId = decodeURIComponent(pathname.slice("/v1/models/".length));
    const model = getModelDef(modelId);
    if (!model) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Model '${modelId}' not found`, type: "invalid_request_error" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: model.id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: model.source === "kilo" ? "kilocode" : model.source === "ovh" ? "ovhcloud" : model.source === "cline" ? "cline" : "opencode",
      context_window: model.contextWindow,
      max_tokens: model.maxTokens,
    }));
    return;
  }

  // POST /v1/chat/completions
  if (pathname === "/v1/chat/completions" && method === "POST") {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Request body too large", type: "invalid_request_error" } }));
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }));
      return;
    }

    if (!parsed.model) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Missing 'model' field", type: "invalid_request_error" } }));
      return;
    }

    log("info", `chat/completions → ${parsed.model}${parsed.stream ? " (stream)" : ""}`, { model: parsed.model }, reqId);
    await routeRequest(parsed, "/v1/chat/completions", req, res, reqId);
    return;
  }

  // POST /v1/responses
  if (pathname === "/v1/responses" && method === "POST") {
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Request body too large", type: "invalid_request_error" } }));
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }));
      return;
    }

    if (!parsed.model) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Missing 'model' field", type: "invalid_request_error" } }));
      return;
    }

    log("info", `responses → ${parsed.model}${parsed.stream ? " (stream)" : ""}`, { model: parsed.model }, reqId);
    await routeRequest(parsed, "/v1/responses", req, res, reqId);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({
    error: {
      message: `Not found: ${method} ${pathname}.`,
      type: "invalid_request_error",
    },
  }));
});

server.listen(SERVER_PORT, SERVER_HOST, () => {
  const authMode = REQUIRE_AUTH ? "token-gated" : "open (no auth)";
  logInfo("═══════════════════════════════════════════════════════════");
  logInfo("  opencode-llm (freeflow-omniroute) started");
  logInfo(`  Listening on http://${SERVER_HOST}:${SERVER_PORT}`);
  logInfo(`  Models: ${ALL_MODELS.length} free models (OpenCode Zen, KiloCode, OVH, Cline)`);
  logInfo(`  Relays: ${getRelays().length} active egress relays`);
  logInfo(`  Auth: ${authMode}`);
  logInfo("═══════════════════════════════════════════════════════════");
});

server.on("error", (err) => {
  logError("Server error", { error: String(err) });
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
