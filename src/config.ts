/**
 * freeflow-omniroute — Configuration
 *
 * Standalone server configuration for the OmniRoute-compatible freeflow adapter.
 * Unlike pi-freeflow (loopback-only), this binds to 0.0.0.0 by default for EC2
 * deployment, with token-gated access for security.
 */

import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// ── Server config ───────────────────────────────────────────────────
export const SERVER_PORT = Number(process.env.FREEFLOW_PORT) || 28280;
export const SERVER_HOST = process.env.FREEFLOW_HOST || "0.0.0.0";

// ── Auth ────────────────────────────────────────────────────────────
// When set, all /v1/* requests require `Authorization: Bearer <token>`
export const API_TOKEN = process.env.FREEFLOW_API_TOKEN || "";
export const REQUIRE_AUTH = process.env.FREEFLOW_REQUIRE_AUTH === "true" || !!API_TOKEN;

// ── Upstream endpoints ──────────────────────────────────────────────
export const UPSTREAM_OPENCODE = "https://opencode.ai/inference";
export const OPENCODE_API_URL = `${UPSTREAM_OPENCODE}/v1`;
export const KILO_CHAT_URL = "https://api.kilo.ai/api/gateway/chat/completions";
export const KILO_RESPONSES_URL = "https://api.kilo.ai/api/gateway/responses";
export const OVH_API_BASE = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1";
export const OVH_CHAT_URL = `${OVH_API_BASE}/chat/completions`;

// ── OpenCode fingerprint ────────────────────────────────────────────
export const OPENCODE_VERSION_FLOOR = "1.17.0";
export const OPENCODE_VERSION_FALLBACK = "1.19.0";
export const OPENCODE_VERSION = OPENCODE_VERSION_FALLBACK;
export const OPENCODE_USER_AGENT = `opencode/${OPENCODE_VERSION}`;
export const OPENCODE_CLIENT = "cli";

export const OPENCODE_PROJECT = createHash("sha1")
  .update("git-remote:github.com/anomalyco/opencode")
  .digest("hex");

const ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let idTimestamp = 0;
let idCounter = 0;

export function createOpenCodeId(descending: boolean, timestamp = Date.now()): string {
  if (timestamp !== idTimestamp) {
    idTimestamp = timestamp;
    idCounter = 0;
  }
  idCounter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(idCounter);
  const value = descending ? ~current : current;
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
  const bytes = randomBytes(14);
  return time + Array.from(bytes, (byte) => ID_CHARS[byte % 62]).join("");
}

export function createOpenCodeSessionId(): string {
  return `ses_${createOpenCodeId(true)}`;
}

export const OPENCODE_SESSION = createOpenCodeSessionId();

export function opencodeHeaders(): Record<string, string> {
  const sessionId = OPENCODE_SESSION;
  return {
    Authorization: "Bearer public",
    "User-Agent": OPENCODE_USER_AGENT,
    "x-opencode-client": OPENCODE_CLIENT,
    "x-opencode-project": OPENCODE_PROJECT,
    "x-opencode-session": sessionId,
    "x-opencode-session-id": sessionId,
    "x-session-affinity": sessionId,
    "x-session-id": sessionId,
  };
}

// ── Timeouts & limits ───────────────────────────────────────────────
export const UPSTREAM_HEADER_TIMEOUT_MS = 300_000;
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

// ── Data directory ──────────────────────────────────────────────────
export const DATA_DIR = process.env.FREEFLOW_DATA_DIR ||
  path.join(homedir(), ".freeflow-omniroute");

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export const LOG_FILE = path.join(DATA_DIR, "freeflow-omniroute.log");
export const LOG_MAX_BYTES = 10 * 1024 * 1024;

// ── Relay config (optional) ─────────────────────────────────────────
// Users can configure relays via FREEFLOW_RELAYS env var (comma-separated URLs)
export const RELAY_URLS: string[] = (process.env.FREEFLOW_RELAYS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
export const RELAY_MODE = process.env.FREEFLOW_RELAY_MODE || "auto"; // auto | spread | off
