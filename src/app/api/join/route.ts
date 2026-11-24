import type { NextRequest } from "next/server";
import { joinGroup } from "@/server/game";
import { diverToken, handleError, json, rateLimit, readJson, tooMany } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "join", 200)) return tooMany();
  try {
    const body = await readJson(req);
    return json(await joinGroup({ groupNumber: body.groupNumber, name: body.name, token: diverToken(req) }));
  } catch (e) {
    return handleError(e);
  }
}
