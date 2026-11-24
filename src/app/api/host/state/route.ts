import type { NextRequest } from "next/server";
import { getHostState } from "@/server/game";
import { handleError, json, rateLimit, tooMany } from "@/server/http";
import { isHost, requireHostError } from "@/server/host";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "host-state", 150)) return tooMany();
  try {
    if (!(await isHost(req))) throw requireHostError();
    return json(await getHostState());
  } catch (e) {
    return handleError(e);
  }
}
