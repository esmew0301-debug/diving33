import type { NextRequest } from "next/server";
import { submitAnswer } from "@/server/game";
import { diverToken, handleError, json, rateLimit, readJson, tooMany } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "answer", 120, 3000)) return tooMany();
  try {
    const body = await readJson(req);
    return json(await submitAnswer(diverToken(req), body.questionId, body.answer));
  } catch (e) {
    return handleError(e);
  }
}
