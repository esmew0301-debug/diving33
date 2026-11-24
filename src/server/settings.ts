import "server-only";

const int = (v: string | undefined, dflt: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};

/**
 * Classroom settings, from environment variables (no settings dashboard).
 * They are copied into each new game when it is created.
 */
export function settings() {
  return {
    /** Number of groups expected (default 4). The final reveal waits for ALL of them. */
    groupCount: int(process.env.GROUP_COUNT, 4, 1, 12),
    /** Maximum divers per group (default 4). A group can start with just one. */
    groupCapacity: int(process.env.GROUP_CAPACITY, 4, 1, 12),
    /** An unfinished, unrevealed game with no student activity for this many minutes is replaced (default 180, 0 = never). */
    idleResetMinutes: int(process.env.IDLE_RESET_MINUTES, 180, 0, 100000),
  };
}

/** True only for local development / automated tests — never in a production build. */
export const isDevBuild = () => process.env.NODE_ENV !== "production";

/**
 * DEVELOPMENT-ONLY test switch: reveal the leaderboard once every group that STARTED has finished
 * (so one person can test the reveal end to end). Ignored in production builds.
 */
export const devRevealStartedGroups = () => isDevBuild() && process.env.DEV_REVEAL_STARTED_GROUPS === "1";

/** DEVELOPMENT-ONLY: enables /api/dev/clock so tests can fast-forward the server clock. */
export const devTestHooks = () => isDevBuild() && process.env.ENABLE_TEST_HOOKS === "1";
