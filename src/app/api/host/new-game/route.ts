import type { NextRequest } from "next/server";
import { newGame } from "@/server/game";
import { handleError, json, rateLimit, tooMany } from "@/server/http";
import { isHost, requireHostError } from "@/server/host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Host-only: archive the current game and open a fresh one (e.g. after a solo rehearsal). */
export async function POST(req: NextRequest) {
  if (!rateLimit(req, "host-new", 10)) return tooMany();
  try {
    if (!(await isHost(req))) throw requireHostError();
    await newGame({ open: true });
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
