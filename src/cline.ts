/**
 * freeflow-omniroute — Cline Authentication & Account Pool
 *
 * Implements:
 * - WorkOS Device Authorization flow (start, poll, register, refresh)
 * - Multi-account rotation pool across saved Cline logins
 * - Automatic failover when one account hits its daily free limit (429)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir } from "./config.ts";
import { logWarn, logInfo } from "./logger.ts";

const WORKOS_BASE = "https://api.workos.com";
const CLINE_API_BASE = "https://api.cline.bot";
const WORKOS_CLIENT_ID = process.env.CLINE_WORKOS_CLIENT_ID || "client_01K3A541FN8TA3EPPHTD2325AR";

export const CLINE_CHAT_URL = `${CLINE_API_BASE}/api/v1/chat/completions`;

export interface ClineAccount {
  slot: string;
  token: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  addedAt: string;
}

const POOL_FILE = path.join(DATA_DIR, "cline-pool.json");

let accounts: ClineAccount[] = [];

export function loadClinePool(): ClineAccount[] {
  try {
    ensureDataDir();
    if (!existsSync(POOL_FILE)) {
      accounts = [];
      return accounts;
    }
    const raw = readFileSync(POOL_FILE, "utf8");
    const parsed = JSON.parse(raw);
    accounts = Array.isArray(parsed) ? parsed : parsed.accounts || [];
    return accounts;
  } catch {
    accounts = [];
    return accounts;
  }
}

export function saveClinePool(): void {
  try {
    ensureDataDir();
    writeFileSync(POOL_FILE, JSON.stringify({ accounts }, null, 2), "utf8");
  } catch (err) {
    logWarn("Failed to save Cline account pool", { error: String(err) });
  }
}

// Initialize on load
loadClinePool();

export function getClineAccounts(): Omit<ClineAccount, "token" | "refreshToken">[] {
  return accounts.map(a => ({
    slot: a.slot,
    email: a.email,
    expiresAt: a.expiresAt,
    addedAt: a.addedAt,
  }));
}

export function addClineToken(token: string, email?: string, slot?: string): ClineAccount {
  const cleanToken = token.trim();
  const tokenWithPrefix = cleanToken.startsWith("workos:") || cleanToken.startsWith("clp_")
    ? cleanToken
    : `workos:${cleanToken}`;

  const slotName = slot || `slot-${accounts.length + 1}`;
  const existingIdx = accounts.findIndex(a => a.slot === slotName);

  const acc: ClineAccount = {
    slot: slotName,
    token: tokenWithPrefix,
    email,
    addedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    accounts[existingIdx] = acc;
  } else {
    accounts.push(acc);
  }

  saveClinePool();
  logInfo(`Cline account saved: ${slotName}${email ? ` (${email})` : ""}`);
  return acc;
}

export function removeClineAccount(slot: string): boolean {
  const idx = accounts.findIndex(a => a.slot === slot);
  if (idx >= 0) {
    accounts.splice(idx, 1);
    saveClinePool();
    logInfo(`Cline account removed: ${slot}`);
    return true;
  }
  return false;
}

// ── WorkOS Device Code Flow ──────────────────────────────────────

export interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export async function startClineDeviceAuth(): Promise<DeviceAuthResponse> {
  const res = await fetch(`${WORKOS_BASE}/user_management/authorize/device`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: WORKOS_CLIENT_ID }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Device auth failed (${res.status}): ${errText}`);
  }

  return res.json() as Promise<DeviceAuthResponse>;
}

export async function pollClineDeviceToken(deviceCode: string): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  const res = await fetch(`${WORKOS_BASE}/user_management/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: WORKOS_CLIENT_ID,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (res.ok && typeof data.access_token === "string") {
    return {
      access_token: data.access_token,
      refresh_token: (data.refresh_token as string) || "",
    };
  }

  throw new Error((data.error_description as string) || (data.error as string) || `HTTP ${res.status}`);
}

export async function registerClineToken(accessToken: string, refreshToken: string): Promise<{
  token: string;
  refreshToken: string;
  email?: string;
  expiresAt?: number;
}> {
  const res = await fetch(`${CLINE_API_BASE}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, refreshToken }),
  });

  if (!res.ok) {
    throw new Error(`Token register failed: ${res.status}`);
  }

  const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown> };
  const d = json.data || {};
  return {
    token: `workos:${(d.accessToken as string) || accessToken}`,
    refreshToken: (d.refreshToken as string) || refreshToken,
    email: (d.userInfo as Record<string, unknown>)?.email as string | undefined,
    expiresAt: d.expiresAt ? new Date(d.expiresAt as string).getTime() : undefined,
  };
}

// ── Rolling Execution across accounts ────────────────────────────

const CLINE_CLIENT_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://cline.bot",
  "X-Title": "Cline",
  "X-IS-MULTIROOT": "false",
  "X-CLIENT-TYPE": "cline-desktop",
  "X-CLIENT-VERSION": "3.5.54",
  "User-Agent": "Cline/3.5.54",
};

export async function rollClineChat(
  bodyJson: Record<string, unknown>,
  isStream: boolean,
  reqId: string,
): Promise<{ response: Response; slotUsed: string | null }> {
  loadClinePool();

  if (accounts.length === 0) {
    return {
      response: new Response(
        JSON.stringify({
          error: {
            message: "No Cline logins found. Add one with POST /v1/auth/cline/device or POST /v1/auth/cline/token",
            code: "cline_no_accounts",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
      slotUsed: null,
    };
  }

  let lastRes: Response | null = null;

  for (const acc of accounts) {
    try {
      const headers = {
        "Content-Type": "application/json",
        ...CLINE_CLIENT_HEADERS,
        Authorization: `Bearer ${acc.token}`,
      };

      const res = await fetch(CLINE_CHAT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyJson),
      });

      if (res.status === 429) {
        logWarn(`Cline slot ${acc.slot} hit daily free limit — rolling to next slot`, undefined, reqId);
        try { await res.body?.cancel(); } catch { }
        lastRes = res;
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        logWarn(`Cline slot ${acc.slot} auth failed (${res.status}) — trying next slot`, undefined, reqId);
        try { await res.body?.cancel(); } catch { }
        lastRes = res;
        continue;
      }

      return { response: res, slotUsed: acc.slot };
    } catch (err) {
      logWarn(`Cline slot ${acc.slot} connection error: ${err}`, undefined, reqId);
      continue;
    }
  }

  if (lastRes) {
    return { response: lastRes, slotUsed: null };
  }

  return {
    response: new Response(
      JSON.stringify({ error: { message: "All Cline logins failed", code: "cline_pool_exhausted" } }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    ),
    slotUsed: null,
  };
}
