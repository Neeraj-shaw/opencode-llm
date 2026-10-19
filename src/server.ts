/**
 * freeflow-omniroute — Standalone OpenAI-compatible API Server
 *
 * Exposes pi-freeflow's 33 free models (OpenCode Zen, KiloCode Gateway,
 * OVHcloud AI Endpoints) as a standard OpenAI-compatible API that OmniRoute
 * can consume as a self-hosted provider on EC2.
 *
 * Run:   node --experimental-strip-types src/server.ts
 * Test:  curl http://localhost:28280/v1/models
 *
 * OmniRoute integration:
 *   OMNIROUTE_SELF_HOSTED_PROVIDERS='
 *     providers:
 *       - id: freeflow
 *         kind: openai
 *         baseUrl: http://localhost:28280/v1
 *         model: deepseek-v4.1-flash-free
 *   '
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
import { log, logInfo, logWarn, logError } from "./logger.ts";

// ── Ensure data directory exists ────────────────────────────────
ensureDataDir();

// ── Auth check ──────────────────────────────────────────────────

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!REQUIRE_AUTH) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token === API_TOKEN;
}

// ── Body parser ─────────────────────────────────────────────────

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

// ── /v1/models endpoint ─────────────────────────────────────────

function handleModels(res: http.ServerResponse): void {
  const models = ALL_MODELS.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: m.source === "kilo" ? "kilocode" : m.source === "ovh" ? "ovhcloud" : "opencode",
    // Extra metadata for OmniRoute's model catalog
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
    // Extended info useful for OmniRoute's UI/catalog
    ...(m.contextWindow ? { context_window: m.contextWindow } : {}),
    ...(m.maxTokens ? { max_tokens: m.maxTokens } : {}),
  }));

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ object: "list", data: models }));
}

// ── /health endpoint ────────────────────────────────────────────

function handleHealth(res: http.ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    version: "1.0.0",
    models: ALL_MODELS.length,
    upstreams: {
      opencode: ALL_MODELS.filter(m => m.source === "opencode").length,
      kilo: ALL_MODELS.filter(m => m.source === "kilo").length,
      ovh: ALL_MODELS.filter(m => m.source === "ovh").length,
    },
    timestamp: new Date().toISOString(),
  }));
}

// ── CORS headers ────────────────────────────────────────────────

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type, Authorization");
  res.setHeader("access-control-max-age", "86400");
}

// ── Main request handler ────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const reqId = randomUUID().slice(0, 8);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  const method = req.method?.toUpperCase() || "GET";

  // CORS preflight
  setCorsHeaders(res);
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check (no auth required)
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

  // GET /v1/models
  if (pathname === "/v1/models" && method === "GET") {
    handleModels(res);
    return;
  }

  // GET /v1/models/:id
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
      owned_by: model.source === "kilo" ? "kilocode" : model.source === "ovh" ? "ovhcloud" : "opencode",
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
    } catch (err) {
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

  // POST /v1/responses (OpenAI Responses API)
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

  // 404 fallback
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({
    error: {
      message: `Not found: ${method} ${pathname}. Supported: GET /v1/models, POST /v1/chat/completions, POST /v1/responses`,
      type: "invalid_request_error",
    },
  }));
});

// ── Start server ────────────────────────────────────────────────

server.listen(SERVER_PORT, SERVER_HOST, () => {
  const authMode = REQUIRE_AUTH ? "token-gated" : "open (no auth)";
  logInfo("═══════════════════════════════════════════════════════════");
  logInfo("  freeflow-omniroute server started");
  logInfo(`  Listening on http://${SERVER_HOST}:${SERVER_PORT}`);
  logInfo(`  Models: ${ALL_MODELS.length} free models`);
  logInfo(`  Auth: ${authMode}`);
  logInfo("");
  logInfo("  Endpoints:");
  logInfo(`    GET  /health              — Health check`);
  logInfo(`    GET  /v1/models           — List all models`);
  logInfo(`    POST /v1/chat/completions — Chat completions`);
  logInfo(`    POST /v1/responses        — Responses API`);
  logInfo("");
  logInfo("  OmniRoute integration:");
  logInfo("    Add to .env:");
  logInfo(`    OMNIROUTE_SELF_HOSTED_PROVIDERS='`);
  logInfo(`      providers:`);
  logInfo(`        - id: freeflow`);
  logInfo(`          kind: openai`);
  logInfo(`          baseUrl: http://<EC2_IP>:${SERVER_PORT}/v1`);
  logInfo(`          model: deepseek-v4.1-flash-free`);
  logInfo(`    '`);
  logInfo("═══════════════════════════════════════════════════════════");
});

server.on("error", (err) => {
  logError("Server error", { error: String(err) });
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logInfo("SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  logInfo("SIGINT received, shutting down...");
  server.close(() => process.exit(0));
});
