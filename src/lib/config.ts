/**
 * Game constants shared by client and server.
 * The classroom roster (groups × max divers per group) is read on the SERVER from the
 * GROUP_COUNT / GROUP_CAPACITY environment variables (default 4 × 4) — see src/server/settings.ts.
 */

/** Normal answering period per question (seconds). */
export const NORMAL_SECONDS = 30;
/** Dramatic "3… 2… 1…" final countdown after the normal period (seconds). */
export const FINAL_SECONDS = 3;
/** Total answering window = 33 s. */
export const WINDOW_SECONDS = NORMAL_SECONDS + FINAL_SECONDS;
/** Pause between questions so dive / result animations can finish (seconds). */
export const INTERMISSION_SECONDS = 4;
/** "Get ready" countdown after a group presses Start Game (seconds). */
export const READY_SECONDS = 3;
/** Server-side grace for answers already in flight when the final countdown hits zero (ms). */
export const SUBMIT_GRACE_MS = 400;

/**
 * Depth earned by the time of a diver's FIRST correct answer (server-measured, ms since the
 * question opened). 0–10 s → 30 m, >10–20 s → 20 m, >20–30 s → 10 m, final countdown → 10 m.
 */
export function depthForElapsed(elapsedMs: number): number {
  if (elapsedMs <= 10_000) return 30;
  if (elapsedMs <= 20_000) return 20;
  if (elapsedMs <= NORMAL_SECONDS * 1000) return 10;
  return 10;
}
export const MAX_DEPTH_PER_QUESTION = 30;

export const MAX_ANSWER_LENGTH = 120;
export const MAX_NAME_LENGTH = 16;
/** Client polling interval for authoritative state (ms). */
export const POLL_MS = 1000;
