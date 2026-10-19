/**
 * freeflow-omniroute — Relay Pool & Egress Dispatcher
 *
 * Implements multi-cloud relay rotation and egress proxying for OpenCode Zen.
 * Supports:
 * - WARP relay pool, Cloudflare Workers, Deno Deploy, and Vercel Edge relays
 * - HTTP/HTTPS/SOCKS5 forward proxies
 * - Auto-rotation on 429 (rate-limit), 502/503/504, or connection drop
 * - Fallback to direct upstream when all relays are cooling down
 */

import { randomUUID } from "node:crypto";
import { RELAY_URLS, RELAY_MODE, UPSTREAM_HEADER_TIMEOUT_MS } from "./config.ts";
import { log, logWarn, logInfo, isDebugEnabled } from "./logger.ts";

export interface RelayInfo {
  url: string;
  label?: string;
  auth?: string;
  failures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  coolingUntil: number;
}

// In-memory relay pool initialized from environment variables
const relays: RelayInfo[] = RELAY_URLS.map((url, idx) => ({
  url: url.trim(),
  label: `relay-${idx + 1}`,
  failures: 0,
  lastFailureAt: 0,
  lastSuccessAt: 0,
  coolingUntil: 0,
}));

let activeRelayIndex = 0;

export function getRelays(): RelayInfo[] {
  return [...relays];
}

export function addRelay(url: string, label?: string, auth?: string): RelayInfo {
  const cleanUrl = url.trim();
  const existing = relays.find(r => r.url === cleanUrl);
  if (existing) {
    if (label) existing.label = label;
    if (auth) existing.auth = auth;
    return existing;
  }
  const newRelay: RelayInfo = {
    url: cleanUrl,
    label: label || `relay-${relays.length + 1}`,
    auth,
    failures: 0,
    lastFailureAt: 0,
    lastSuccessAt: 0,
    coolingUntil: 0,
  };
  relays.push(newRelay);
  logInfo(`Relay added: ${newRelay.label} -> ${newRelay.url}`);
  return newRelay;
}

export function removeRelay(urlOrIndex: string | number): boolean {
  let idx = -1;
  if (typeof urlOrIndex === "number") {
    idx = urlOrIndex;
  } else {
    idx = relays.findIndex(r => r.url === urlOrIndex || r.label === urlOrIndex);
  }
  if (idx >= 0 && idx < relays.length) {
    const [removed] = relays.splice(idx, 1);
    logInfo(`Relay removed: ${removed.label} (${removed.url})`);
    return true;
  }
  return false;
}

const COOLDOWN_BASE_MS = 60_000; // 1 minute base cooldown on 429
const COOLDOWN_MAX_MS = 15 * 60_000; // 15 minutes max cooldown

export function markRelayFailure(url: string, status: number, reason?: string): void {
  const r = relays.find(x => x.url === url);
  if (!r) return;
  r.failures++;
  r.lastFailureAt = Date.now();
  const cooldown = Math.min(COOLDOWN_BASE_MS * Math.pow(2, Math.max(0, r.failures - 1)), COOLDOWN_MAX_MS);
  r.coolingUntil = Date.now() + cooldown;
  logWarn(`Relay ${r.label} cooled down for ${Math.round(cooldown / 1000)}s (status ${status}${reason ? `: ${reason}` : ""})`);
}

export function markRelaySuccess(url: string): void {
  const r = relays.find(x => x.url === url);
  if (!r) return;
  r.failures = 0;
  r.coolingUntil = 0;
  r.lastSuccessAt = Date.now();
}

export function isRelayHealthy(r: RelayInfo): boolean {
  return Date.now() >= r.coolingUntil;
}

export function getCandidates(): RelayInfo[] {
  if (relays.length === 0) return [];
  const now = Date.now();
  const healthy = relays.filter(r => r.coolingUntil <= now);
  const cooling = relays.filter(r => r.coolingUntil > now);

  if (RELAY_MODE === "spread") {
    // In spread mode, rotate starting offset
    activeRelayIndex = (activeRelayIndex + 1) % Math.max(1, healthy.length);
    const rotated = [...healthy.slice(activeRelayIndex), ...healthy.slice(0, activeRelayIndex)];
    return [...rotated, ...cooling];
  }

  return [...healthy, ...cooling];
}

/**
 * Dispatch an HTTP request through the relay pool with rolling failover.
 * Supports x-relay-target and x-relay-path headers for edge workers.
 */
export async function relayFetch(
  targetUrl: string,
  init: RequestInit,
  reqId: string,
): Promise<{ response: Response; relayUsed: string | null }> {
  const candidates = getCandidates();

  if (candidates.length === 0) {
    // No relays configured: talk direct to upstream
    const directRes = await fetch(targetUrl, init);
    return { response: directRes, relayUsed: null };
  }

  const u = new URL(targetUrl);
  const relayTarget = `${u.protocol}//${u.host}`;
  const relayPath = `${u.pathname}${u.search}`;

  let lastRes: Response | null = null;

  for (const candidate of candidates) {
    if (!isRelayHealthy(candidate) && candidates.some(isRelayHealthy)) {
      continue; // Skip cooling relay if healthy ones exist
    }

    const headers = new Headers(init.headers);
    headers.set("x-relay-target", relayTarget);
    headers.set("x-relay-path", relayPath);
    if (candidate.auth) {
      headers.set("x-relay-auth", candidate.auth);
    }
    headers.set("x-request-id", reqId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_HEADER_TIMEOUT_MS);

    try {
      if (isDebugEnabled()) {
        log("debug", `Attempting relay ${candidate.label} (${candidate.url})`, { targetUrl }, reqId);
      }

      const res = await fetch(candidate.url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Status codes that indicate relay/IP rate limits or transient errors
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408) {
        markRelayFailure(candidate.url, res.status, `HTTP ${res.status}`);
        try { await res.body?.cancel(); } catch { }
        lastRes = res;
        continue; // Roll to next relay
      }

      // Success
      markRelaySuccess(candidate.url);
      return { response: res, relayUsed: candidate.url };
    } catch (err) {
      clearTimeout(timeoutId);
      markRelayFailure(candidate.url, 0, String(err));
      logWarn(`Relay ${candidate.label} error: ${err}`, undefined, reqId);
      continue;
    }
  }

  // Fallback to direct upstream if all relays failed or rate-limited
  logWarn("All relays exhausted or cooling down — falling back to direct upstream", undefined, reqId);
  try {
    const directRes = await fetch(targetUrl, init);
    return { response: directRes, relayUsed: null };
  } catch (err) {
    if (lastRes) return { response: lastRes, relayUsed: null };
    throw err;
  }
}
