import type { NextRequest } from "next/server";
import { handleError, json } from "@/server/http";
import { hostLogout, setHostCookie } from "@/server/host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await hostLogout(req);
    const res = json({ ok: true });
    setHostCookie(res, null);
    return res;
  } catch (e) {
    return handleError(e);
  }
}
