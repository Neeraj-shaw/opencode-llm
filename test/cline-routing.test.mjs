import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "opencode-cline-regression-"));
process.env.FREEFLOW_DATA_DIR = dataDir;
await mkdir(dataDir, { recursive: true });
const { routeRequest } = await import("../src/upstream.ts");

const clinePool = [{
  slot: "test-slot",
  token: "workos:test-token",
  addedAt: "2026-01-01T00:00:00.000Z",
}];

beforeEach(async () => {
  await writeFile(path.join(dataDir, "cline-pool.json"), JSON.stringify(clinePool));
});
after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

class MockResponse extends EventEmitter {
  headersSent = false;
  writableEnded = false;
  statusCode;
  headers;
  body = "";

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }

  write(chunk) {
    this.body += String(chunk);
    return true;
  }

  end(chunk = "") {
    this.body += String(chunk);
    this.writableEnded = true;
    return this;
  }
}

async function route(model, fetchImpl, extraBody = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const req = new EventEmitter();
  req.complete = true;
  req.headers = {};
  const res = new MockResponse();
  try {
    await routeRequest({ model, messages: [{ role: "user", content: "ping" }], ...extraBody }, "/v1/chat/completions", req, res, "test-request");
  } finally {
    globalThis.fetch = originalFetch;
  }
  return res;
}

test("Cline Muse alias routes to Cline using the canonical meta model and can succeed", async () => {
  let requestUrl;
  let requestBody;
  const res = await route("cline-free/muse-spark-1.3-contributor", async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "cline-ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.equal(requestUrl, "https://api.cline.bot/api/v1/chat/completions");
  assert.equal(requestBody.model, "meta/muse-spark-1.3-contributor");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { id: "cline-ok" });
});

for (const status of [401, 403, 402]) {
  test(`Cline ${status} becomes a model-specific 424 configuration error`, async () => {
    const res = await route("cline-free/muse-spark-1.3-contributor", async () => new Response(
      JSON.stringify({ error: "Cline authorization failed" }),
      { status, headers: { "content-type": "application/json" } },
    ));

    assert.equal(res.statusCode, 424);
    assert.equal(res.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(res.body), {
      error: {
        message: status === 402
          ? "The connected Cline account cannot use this model because Cline reported a payment or credit issue. Check the Cline account in /dashboard/freeflow."
          : "Connect a Cline account in /dashboard/freeflow before using this Cline model.",
        type: "model_configuration_error",
        code: status === 402 ? "cline_credits_unavailable" : "cline_connection_required",
        upstream_status: status,
      },
    });
  });
}

test("DeepSeek remains on OpenCode and its upstream authentication error is unchanged", async () => {
  let requestUrl;
  const upstreamBody = JSON.stringify({ error: { message: "upstream auth rejected" } });
  const res = await route("deepseek-v4.1-flash-free", async (url) => {
    requestUrl = String(url);
    return new Response(upstreamBody, { status: 401, headers: { "content-type": "application/json" } });
  });

  assert.equal(requestUrl, "https://opencode.ai/inference/v1/chat/completions");
  assert.equal(res.statusCode, 401);
  assert.equal(res.body, upstreamBody);
});

test("non-Cline Kilo authentication errors retain their upstream status and body", async () => {
  const upstreamBody = JSON.stringify({ error: { message: "Kilo key rejected" } });
  const res = await route("dots-studio/dots-3-note-preview:free", async () => new Response(
    upstreamBody,
    { status: 403, headers: { "content-type": "application/json" } },
  ));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body, upstreamBody);
});

test("DeepSeek non-Cline successful request remains successful", async () => {
  let requestUrl;
  const sse = 'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const res = await route("deepseek-v4.1-flash-free", async (url) => {
    requestUrl = String(url);
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  });

  assert.equal(requestUrl, "https://opencode.ai/inference/v1/chat/completions");
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).choices[0].message.content, "hello");
});
