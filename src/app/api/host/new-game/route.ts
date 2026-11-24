import type { NextRequest } from "next/server";
import { newGame } from "@/server/game";
import { handleError, json, rateLimit, readJson, tooMany } from "@/server/http";
import { isHost, requireHostError } from "@/server/host";
import { devTestHooks } from "@/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Host-only: archive the current game and open a fresh one (e.g. after a solo rehearsal). */
export async function POST(req: NextRequest) {
  if (!rateLimit(req, "host-new", 10)) return tooMany();
  try {
    if (!(await isHost(req))) throw requireHostError();
    const body = await readJson(req);
    // tests only: create the new game closed (as if the host had not opened it yet)
    await newGame({ open: !(devTestHooks() && body.closed === true) });
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
