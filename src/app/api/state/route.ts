import type { NextRequest } from "next/server";
import { getPublicState } from "@/server/game";
import { diverToken, handleError, json, rateLimit, tooMany } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "state", 150, 3000)) return tooMany();
  try {
    return json(await getPublicState(diverToken(req)));
  } catch (e) {
    return handleError(e);
  }
}
