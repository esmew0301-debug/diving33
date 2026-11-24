import type { NextRequest } from "next/server";
import { getHistory } from "@/server/game";
import { diverToken, handleError, json } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    return json(await getHistory(diverToken(req)));
  } catch (e) {
    return handleError(e);
  }
}
