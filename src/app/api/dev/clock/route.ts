import type { NextRequest } from "next/server";
import { advanceClock, now } from "@/server/game";
import { json, readJson } from "@/server/http";
import { devTestHooks } from "@/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DEVELOPMENT/TEST ONLY: fast-forward the server clock. 404 in production or without ENABLE_TEST_HOOKS=1. */
export async function POST(req: NextRequest) {
  if (!devTestHooks()) return json({ error: "Not found" }, 404);
  const body = await readJson(req);
  const add = Number(body.advanceMs);
  if (Number.isFinite(add) && add > 0 && add <= 3600_000) advanceClock(add);
  return json({ now: now() });
}
