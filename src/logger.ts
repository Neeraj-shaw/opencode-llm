/**
 * freeflow-omniroute — Logger
 */

import { appendFileSync, existsSync, renameSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LOG_FILE, LOG_MAX_BYTES, ensureDataDir } from "./config.ts";

let debugEnabled = process.env.FREEFLOW_DEBUG === "1";
export function isDebugEnabled(): boolean { return debugEnabled; }
export function setDebugEnabled(v: boolean): void { debugEnabled = v; }

function rotateLogs(): void {
  try {
    if (!existsSync(LOG_FILE)) return;
    const stat = statSync(LOG_FILE);
    if (stat.size < LOG_MAX_BYTES) return;
    const rotated = `${LOG_FILE}.1`;
    renameSync(LOG_FILE, rotated);
  } catch { /* swallow */ }
}

export function log(level: string, msg: string, meta?: Record<string, unknown>, reqId?: string): void {
  if (level === "debug" && !debugEnabled) return;
  const ts = new Date().toISOString();
  const prefix = reqId ? `[${ts}] [${level.toUpperCase()}] [${reqId}] ` : `[${ts}] [${level.toUpperCase()}] `;
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  const line = `${prefix}${msg}${metaStr}\n`;

  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else if (level !== "debug") {
    process.stdout.write(line);
  }

  try {
    ensureDataDir();
    rotateLogs();
    appendFileSync(LOG_FILE, line);
  } catch { /* swallow */ }
}

export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  log("info", msg, meta);
}

export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  log("warn", msg, meta);
}

export function logError(msg: string, meta?: Record<string, unknown>): void {
  log("error", msg, meta);
}
