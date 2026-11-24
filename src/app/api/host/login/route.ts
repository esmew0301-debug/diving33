import type { NextRequest } from "next/server";
import { handleError, json, rateLimit, readJson, tooMany } from "@/server/http";
import { hostLogin, setHostCookie } from "@/server/host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "host-login", 12)) return tooMany();
  try {
    const body = await readJson(req);
    const token = await hostLogin(body.password);
    const res = json({ ok: true });
    setHostCookie(req, res, token);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
