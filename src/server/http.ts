import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { DatabaseNotConfiguredError } from "./db";
import { GameError } from "./game";

const buckets = new Map<string, { tokens: number; at: number }>();

/**
 * Best-effort in-memory token bucket (per server instance). Keyed by diver token when present,
 * otherwise by IP — a whole classroom often shares ONE public IP behind campus Wi-Fi, so
 * IP-only limits must stay generous.
 */
export function rateLimit(req: NextRequest, key: string, perMinute: number, perIpMinute = perMinute * 20): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const token = diverToken(req);
  if (token && !take(`${key}:t:${token.slice(0, 16)}`, perMinute)) return false;
  return take(`${key}:ip:${ip}`, token ? perIpMinute : perMinute);
}

function take(id: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(id, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(id, b);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

export function diverToken(req: NextRequest): string | null {
  const t = req.headers.get("x-diver-token");
  return t && /^[A-Za-z0-9_-]{20,200}$/.test(t) ? t : null;
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function handleError(e: unknown) {
  if (e instanceof GameError) return json({ error: e.message, code: e.code }, e.status);
  if (e instanceof DatabaseNotConfiguredError) {
    console.error(e.message);
    return json({ error: e.message, code: "db_not_configured" }, 503);
  }
  console.error(e);
  if (isConnectionError(e)) {
    return json(
      { error: "The game server can't reach its database. Check DATABASE_URL (Supabase transaction pooler URI with the password filled in).", code: "db_unreachable" },
      503,
    );
  }
  return json({ error: "Something went wrong on the server. Please try again.", code: "server_error" }, 500);
}

/** Network / auth failures talking to Postgres (details stay in the server log, never in the response). */
export function isConnectionError(e: unknown): boolean {
  const code = String((e as { code?: unknown })?.code ?? "");
  return (
    ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"].includes(code) ||
    code === "28P01" || // invalid password
    code === "28000" || // invalid authorization
    code === "3D000" || // database does not exist
    code.startsWith("08") // connection exceptions
  );
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length > 4000) return {};
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function tooMany() {
  return json({ error: "Too many requests — please slow down a little.", code: "rate_limited" }, 429);
}
