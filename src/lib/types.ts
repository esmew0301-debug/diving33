export interface PublicSession {
  id: string;
  /** false until the host logs in and opens the game. */
  opened: boolean;
  /** "open" while groups are joining/playing; "revealed" once every group has finished. */
  status: "open" | "revealed";
  groupCount: number;
  groupCapacity: number;
  total: number;
  normalSeconds: number;
  finalSeconds: number;
  intermissionSeconds: number;
  /** Non-competitive completion count (how many groups have finished all seven questions). */
  groupsFinished: number;
}

export interface LeaderboardRow {
  groupNumber: number;
  members: number;
  /** Sum of every member's earned depth (meters). The ranking metric. */
  totalDepth: number;
  rank: number | null;
}

export interface MyResult {
  questionIndex: number;
  isCorrect: boolean;
  depthAwarded: number;
}

/** The group's synchronized round clock (server time, ms). */
export interface RoundClock {
  started: boolean;
  /** 0..total-1 while playing; total once finished. */
  index: number;
  /** When the current question opens (before this: "get ready" or the intermission). */
  questionStartedAt: number | null;
  /** End of the normal 30 s period; the 3-2-1 final countdown runs after it. */
  normalEndsAt: number | null;
  /** Hard deadline (normal + final countdown). */
  deadline: number | null;
  /** When the last question closed. */
  finishedAt: number | null;
}

export interface PublicState {
  serverNow: number;
  session: PublicSession;
  /** The group's current (or upcoming) question. Never includes answers. */
  question: { id: string; order: number; prompt: string; categoryLabel: string } | null;
  me: {
    groupNumber: number;
    diverNumber: number;
    displayName: string | null;
    personalDepth: number;
    results: MyResult[];
    /** Wrong attempts on the current question. */
    currentWrongAttempts: number;
    /** Set once this diver has answered the current question correctly. */
    currentCorrect: { depthAwarded: number } | null;
  } | null;
  /** Only the diver's OWN group. Other groups' depth is never sent before the reveal. */
  group: {
    groupNumber: number;
    capacity: number;
    /** Sum of this group's members' depth (private to this group). */
    teamDepth: number;
    round: RoundClock;
    members: { diverNumber: number; displayName: string | null; isMe: boolean; doneThisRound: boolean }[];
  } | null;
  /** Head-counts only (for the join screen). No scores. */
  groupsOverview: { groupNumber: number; capacity: number; members: number; started: boolean }[];
  /** null until every group has finished. */
  leaderboard: LeaderboardRow[] | null;
}

export interface HostState {
  serverNow: number;
  sessionId: string;
  opened: boolean;
  status: "open" | "revealed";
  groupCount: number;
  /** Non-competitive status only — no depth or scores until the reveal. */
  groups: { groupNumber: number; members: number; started: boolean; finished: boolean }[];
  groupsFinished: number;
  leaderboard: LeaderboardRow[] | null;
  /** Development-only: the reveal waits only for groups that started. */
  devRevealStartedGroups: boolean;
}

export interface SubmitResult {
  isCorrect: boolean;
  depthAwarded: number;
  personalDepth: number;
  elapsedMs: number;
  wrongAttempts: number;
  /** The diver had already answered this question correctly (nothing was added). */
  duplicate: boolean;
}

export interface HistoryAttempt {
  answer: string;
  isCorrect: boolean;
  seconds: number;
}

export interface HistoryEntry {
  index: number;
  order: number;
  categoryLabel: string;
  prompt: string;
  /** The answer that scored (first correct), otherwise the last attempt. */
  myAnswer: string | null;
  attempts: HistoryAttempt[];
  isCorrect: boolean;
  depthAwarded: number;
  depthAfter: number;
  canonicalAnswer: string;
  acceptedExamples: string[];
  explanation: string;
  referenceLabel: string;
  referenceUrl: string;
}
