import "server-only";
import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getDb } from "./db";
import { GameError, hashToken, now, openGame } from "./game";

/**
 * Host authentication. The password lives ONLY in the server-side HOST_PASSWORD environment
 * variable — it is never sent to browsers or returned by any API. A successful login creates a
 * random session token; the browser keeps it in an HttpOnly cookie and the database stores only
 * its SHA-256 hash.
 */

export const HOST_COOKIE = "od_host";
const SESSION_HOURS = 12;

function passwordMatches(input: unknown): boolean {
  const expected = process.env.HOST_PASSWORD;
  if (!expected) throw new GameError("host_not_configured", "Host login is not configured on the server (HOST_PASSWORD).", 500);
  if (typeof input !== "string" || input.length > 200) return false;
  // Constant-time comparison of fixed-length digests (exact, case-sensitive match).
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function hostLogin(password: unknown): Promise<string> {
  if (!passwordMatches(password)) throw new GameError("bad_password", "Incorrect host password.", 401);
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query(`delete from host_sessions where expires_at < $1::timestamptz`, [new Date(now()).toISOString()]);
  await db.query(`insert into host_sessions (token_hash, expires_at) values ($1, $2::timestamptz)`, [
    hashToken(token),
    new Date(now() + SESSION_HOURS * 3600_000).toISOString(),
  ]);
  await openGame(); // logging in opens the classroom game for students
  return token;
}

export async function isHost(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(HOST_COOKIE)?.value;
  if (!token || token.length < 20 || token.length > 200) return false;
  const db = await getDb();
  const rows = await db.query(`select 1 from host_sessions where token_hash = $1 and expires_at > $2::timestamptz`, [
    hashToken(token),
    new Date(now()).toISOString(),
  ]);
  return rows.length > 0;
}

export async function hostLogout(req: NextRequest) {
  const token = req.cookies.get(HOST_COOKIE)?.value;
  if (!token) return;
  const db = await getDb();
  await db.query(`delete from host_sessions where token_hash = $1`, [hashToken(token)]);
}

/** Secure flag whenever the request came over HTTPS (Vercel), so plain-HTTP LAN testing still works. */
export function setHostCookie(req: NextRequest, res: NextResponse, token: string | null) {
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  res.cookies.set(HOST_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "strict",
    secure: https,
    path: "/",
    maxAge: token ? SESSION_HOURS * 3600 : 0,
  });
}

export function requireHostError() {
  return new GameError("host_required", "Host login required.", 401);
}
