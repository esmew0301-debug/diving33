import type { NextRequest } from "next/server";
import { startGame } from "@/server/game";
import { diverToken, handleError, json, rateLimit, tooMany } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "start", 30)) return tooMany();
  try {
    return json(await startGame(diverToken(req)));
  } catch (e) {
    return handleError(e);
  }
}
