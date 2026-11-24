import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS } from "@/content/questions";
import { depthForElapsed } from "@/lib/config";

// Each test gets a fresh in-memory Postgres (PGlite) running the real schema + SQL, with a fake clock.
type G = typeof import("@/server/game");
let g: G;
let T = 0;
const at = (ms: number) => {
  T += ms;
  vi.setSystemTime(T);
};

beforeEach(async () => {
  vi.resetModules();
  process.env.PGLITE_DIR = "memory";
  process.env.HOST_PASSWORD = "test-host-pw";
  delete process.env.DATABASE_URL;
  delete process.env.GROUP_COUNT;
  delete process.env.GROUP_CAPACITY;
  delete process.env.DEV_REVEAL_STARTED_GROUPS;
  const db = await import("@/server/db");
  db.__setDbForTests(undefined);
  g = await import("@/server/game");
  vi.useFakeTimers({ toFake: ["Date"] });
  T = Date.now();
  vi.setSystemTime(T);
});
afterEach(() => vi.useRealTimers());

let nameN = 0;
const join = (n: number | string, token?: string | null, name: unknown = `Diver${++nameN}`) => g.joinGroup({ groupNumber: n, token, name });
const state = (token: string | null) => g.getPublicState(token);
const open = () => g.openGame();

async function fillGroup(n: number, size = 4) {
  const out: string[] = [];
  for (let i = 0; i < size; i++) out.push((await join(n)).token!);
  return out;
}

/** Move the fake clock to `sec` seconds after the group's current question opened. */
async function toSecond(token: string, sec: number) {
  const st = await state(token);
  const target = st.group!.round.questionStartedAt! + sec * 1000;
  if (target > Date.now()) at(target - Date.now());
}
const qid = async (token: string) => QUESTIONS[(await state(token)).group!.round.index].id;
const right = async (token: string) => {
  const i = (await state(token)).group!.round.index;
  return g.submitAnswer(token, QUESTIONS[i].id, QUESTIONS[i].aliases[0]);
};
const wrong = async (token: string) => g.submitAnswer(token, await qid(token), "definitely wrong");

/** Play a whole group: `pattern[i]` = second at which every member answers correctly (null = never). */
async function playGroup(tokens: string[], pattern: (number | null)[]) {
  await g.startGame(tokens[0]);
  for (const sec of pattern) {
    const idx = (await state(tokens[0])).group!.round.index;
    if (sec != null) {
      await toSecond(tokens[0], sec);
      for (const t of tokens) await right(t);
    }
    // finish the round (early close or timeout)
    const st = await state(tokens[0]);
    if (st.group!.round.index === idx) await toSecond(tokens[0], 34);
  }
}

describe("depth brackets", () => {
  it("maps first-correct time to 30 / 20 / 10 m with consistent boundaries", () => {
    expect([0, 6000, 10_000].map(depthForElapsed)).toEqual([30, 30, 30]);
    expect([10_001, 17_000, 20_000].map(depthForElapsed)).toEqual([20, 20, 20]);
    expect([20_001, 26_000, 30_000].map(depthForElapsed)).toEqual([10, 10, 10]);
    expect([30_001, 32_999].map(depthForElapsed)).toEqual([10, 10]);
  });
});

describe("host", () => {
  it("rejects a wrong password, accepts only the exact configured password, and opens the game", async () => {
    const host = await import("@/server/host");
    await expect(host.hostLogin("TEST-HOST-PW")).rejects.toThrow("Incorrect host password.");
    await expect(host.hostLogin("SYL02")).rejects.toThrow("Incorrect host password.");
    await expect(host.hostLogin("")).rejects.toThrow();
    expect((await state(null)).session.opened).toBe(false);
    const token = await host.hostLogin("test-host-pw");
    expect(token.length).toBeGreaterThan(20);
    expect((await state(null)).session.opened).toBe(true);
  });

  it("students cannot join before the host opens the game", async () => {
    await expect(join(1)).rejects.toThrow("Waiting for the host to open the game.");
    await open();
    await expect(join(1)).resolves.toMatchObject({ groupNumber: 1 });
  });

  it("host state never contains depth before the reveal", async () => {
    await open();
    const [a] = await fillGroup(1, 1);
    await g.startGame(a);
    await toSecond(a, 3);
    await right(a);
    const hs = await g.getHostState();
    expect(hs.leaderboard).toBeNull();
    expect(JSON.stringify(hs)).not.toMatch(/depth/i);
  });
});

describe("joining groups", () => {
  beforeEach(open);

  it("requires a name, caps a group at 4, validates group numbers", async () => {
    await expect(join(1, null, "")).rejects.toThrow("Please enter your name.");
    await expect(join(1, null, "   ")).rejects.toThrow("Please enter your name.");
    const a = await Promise.all([join(1), join("1"), join(1), join(1)]);
    expect(a.map((x) => x.diverNumber).sort()).toEqual([1, 2, 3, 4]);
    await expect(join(1)).rejects.toThrow(/Group 1 is full/);
    for (const bad of [0, 5, "abc", "", "1.5", -1, null]) await expect(join(bad as never)).rejects.toThrow(/group number from 1 to 4/);
  });

  it("returns the same slot on refresh and never lets a diver switch groups", async () => {
    const a = await join(3, null, "Alex");
    const again = await join(1, a.token, "Other");
    expect(again).toMatchObject({ rejoined: true, groupNumber: 3, diverNumber: a.diverNumber });
    const st = await state(a.token);
    expect(st.group!.members).toHaveLength(1);
    expect(st.me!.displayName).toBe("Alex");
  });

  it("shows teammates' names in real time", async () => {
    const a = await join(2, null, "Alex");
    await join(2, null, "Jamie");
    const st = await state(a.token);
    expect(st.group!.members.map((m) => m.displayName)).toEqual(["Alex", "Jamie"]);
  });
});

describe("starting", () => {
  beforeEach(open);

  it("a solo player can start (Test B)", async () => {
    const [a] = await fillGroup(1, 1);
    await g.startGame(a);
    const st = await state(a);
    expect(st.group!.round).toMatchObject({ started: true, index: 0 });
  });

  it("one press starts the whole group on one clock, locks the roster, others are independent (Test C)", async () => {
    const t = await fillGroup(2, 4);
    await g.startGame(t[2]);
    const states = await Promise.all(t.map(state));
    const clocks = new Set(states.map((s) => s.group!.round.questionStartedAt));
    expect(clocks.size).toBe(1);
    expect(states.every((s) => s.group!.round.started)).toBe(true);
    await expect(join(2)).rejects.toThrow(/already started/);
    // existing member reconnecting is still fine
    await expect(join(2, t[0])).resolves.toMatchObject({ rejoined: true });
    // group 1 is unaffected
    const [solo] = await fillGroup(1, 1);
    expect((await state(solo)).group!.round.started).toBe(false);
    expect((await state(solo)).groupsOverview.find((x) => x.groupNumber === 2)!.started).toBe(true);
  });

  it("start is idempotent (second press does not reset the clock)", async () => {
    const [a, b] = await fillGroup(1, 2);
    await g.startGame(a);
    const qs = (await state(a)).group!.round.questionStartedAt;
    at(2000);
    await g.startGame(b);
    expect((await state(a)).group!.round.questionStartedAt).toBe(qs);
  });
});

describe("answering and depth", () => {
  beforeEach(open);

  it("Test D/E/F/G: 6 s → +30, wrong-wrong-17 s → +20, 26 s → +10, final countdown → +10", async () => {
    const [a, b, c, d] = await fillGroup(1, 4);
    await g.startGame(a);
    await toSecond(a, 6);
    expect(await right(a)).toMatchObject({ isCorrect: true, depthAwarded: 30, personalDepth: 30 });
    await toSecond(a, 4 + 4); // (already past) no-op
    expect(await wrong(b)).toMatchObject({ isCorrect: false, depthAwarded: 0, wrongAttempts: 1 });
    await toSecond(a, 8.5);
    expect(await wrong(b)).toMatchObject({ isCorrect: false, wrongAttempts: 2 });
    await toSecond(a, 17);
    expect(await right(b)).toMatchObject({ isCorrect: true, depthAwarded: 20 });
    await toSecond(a, 26);
    expect(await right(c)).toMatchObject({ depthAwarded: 10 });
    await toSecond(a, 31.5);
    const st = await state(d);
    expect(st.group!.round.index).toBe(0); // still open during the final countdown
    expect(await right(d)).toMatchObject({ isCorrect: true, depthAwarded: 10 });
    // everyone answered → round closed early, next question queued
    const after = await state(a);
    expect(after.group!.round.index).toBe(1);
    expect(after.group!.teamDepth).toBe(70);
  });

  it("Test H/I: repeated wrong answers earn nothing and never reset the timer", async () => {
    const [a] = await fillGroup(1, 1);
    await g.startGame(a);
    const qs = (await state(a)).group!.round.questionStartedAt;
    for (let i = 1; i <= 5; i++) {
      await toSecond(a, i * 3);
      expect(await wrong(a)).toMatchObject({ isCorrect: false, depthAwarded: 0, personalDepth: 0, wrongAttempts: i });
    }
    const st = await state(a);
    expect(st.group!.round.questionStartedAt).toBe(qs);
    expect(st.me!.currentWrongAttempts).toBe(5);
    expect(st.me!.personalDepth).toBe(0);
    await toSecond(a, 18);
    expect(await right(a)).toMatchObject({ depthAwarded: 20 });
  });

  it("duplicate correct submissions add nothing", async () => {
    const [a, b] = await fillGroup(1, 2);
    await g.startGame(a);
    await toSecond(a, 2);
    const q = QUESTIONS[0];
    await g.submitAnswer(a, q.id, q.aliases[0]);
    for (let i = 0; i < 3; i++) expect(await g.submitAnswer(a, q.id, q.aliases[0])).toMatchObject({ duplicate: true, personalDepth: 30 });
    expect((await state(b)).group!.teamDepth).toBe(30);
  });

  it("Test J: timeout gives 0 m and the group advances automatically; closed questions reject answers", async () => {
    const [a] = await fillGroup(1, 1);
    await g.startGame(a);
    await toSecond(a, 20);
    await wrong(a);
    await toSecond(a, 33.2); // inside the in-flight grace: still accepted as final countdown
    await toSecond(a, 34);
    const st = await state(a);
    expect(st.group!.round.index).toBe(1);
    expect(st.me!.results[0]).toMatchObject({ questionIndex: 0, isCorrect: false, depthAwarded: 0 });
    await expect(g.submitAnswer(a, QUESTIONS[0].id, QUESTIONS[0].aliases[0])).rejects.toThrow("Time is up for this question.");
  });

  it("answers before the question opens or for the wrong question are refused", async () => {
    const [a] = await fillGroup(1, 1);
    await expect(g.submitAnswer(a, QUESTIONS[0].id, "co2")).rejects.toThrow(/hasn't started/);
    await g.startGame(a);
    await expect(g.submitAnswer(a, QUESTIONS[0].id, "co2")).rejects.toThrow(/Get ready/);
    await toSecond(a, 1);
    await expect(g.submitAnswer(a, QUESTIONS[1].id, "x")).rejects.toThrow(/Time is up/);
    await expect(g.submitAnswer(a, QUESTIONS[0].id, "  ")).rejects.toThrow(/type an answer/);
  });

  it("Test K: one correct answer does not advance the group; all correct or deadline does", async () => {
    const [a, b] = await fillGroup(1, 2);
    await g.startGame(a);
    await toSecond(a, 5);
    await right(a);
    let st = await state(b);
    expect(st.group!.round.index).toBe(0);
    expect(st.group!.members.find((m) => !m.isMe)!.doneThisRound).toBe(true);
    expect(st.me!.currentCorrect).toBeNull();
    await toSecond(a, 12);
    await right(b);
    st = await state(a);
    expect(st.group!.round.index).toBe(1);
    // next question opens after the intermission
    expect(st.group!.round.questionStartedAt).toBeGreaterThan(Date.now());
  });

  it("simultaneous correct answers from teammates don't overwrite each other", async () => {
    const t = await fillGroup(1, 4);
    await g.startGame(t[0]);
    await toSecond(t[0], 4);
    const q = QUESTIONS[0];
    const res = await Promise.all(t.map((x) => g.submitAnswer(x, q.id, q.aliases[0])));
    expect(res.every((r) => r.depthAwarded === 30)).toBe(true);
    expect((await state(t[0])).group!.teamDepth).toBe(120);
  });
});

describe("team depth, privacy and the final reveal", () => {
  beforeEach(open);

  it("Test L/M/N: totals add up, nothing leaks, reveal waits for all four groups", async () => {
    const G1 = await fillGroup(1, 4);
    const G2 = await fillGroup(2, 2);
    const G3 = await fillGroup(3, 1);
    const G4 = await fillGroup(4, 3);

    // Group 1: four players with different results on Q1, then timeouts.
    await g.startGame(G1[0]);
    await toSecond(G1[0], 5);
    await right(G1[0]); // 30
    await toSecond(G1[0], 15);
    await right(G1[1]); // 20
    await toSecond(G1[0], 25);
    await right(G1[2]); // 10
    await toSecond(G1[0], 34); // G1[3] gets 0
    // fast-forward the rest of group 1
    at(10 * 60 * 1000);
    let st1 = await state(G1[3]);
    expect(st1.group!.round.finishedAt).not.toBeNull();
    expect(st1.group!.teamDepth).toBe(60);
    expect(st1.leaderboard).toBeNull();

    // Group 2 & 3 finish; Group 4 still playing → no reveal
    await playGroup(G2, [3, 3, 3, 3, 3, 3, 3]); // 2 × 7 × 30 = 420
    await playGroup(G3, [12, null, 12, 12, 12, 12, 12]); // 6 × 20 = 120
    await g.startGame(G4[0]);
    await toSecond(G4[0], 25);
    for (const t of G4) await right(t);
    const mid = await state(G2[0]);
    expect(mid.leaderboard).toBeNull();
    expect(mid.session.status).toBe("open");
    expect(mid.session.groupsFinished).toBe(3);
    expect((await g.getHostState()).leaderboard).toBeNull();

    // Privacy: a group's state only contains its own depth.
    const raw = JSON.stringify(mid);
    expect(raw).not.toContain('"totalDepth"');
    expect(mid.group!.groupNumber).toBe(2);
    expect(mid.group!.members.every((m) => m.displayName?.startsWith("Diver"))).toBe(true);
    expect(mid.group!.members).toHaveLength(2);
    expect(mid.groupsOverview[0]).toEqual({ groupNumber: 1, capacity: 4, members: 4, started: true });

    // Group 4 finishes (Q1: 3 × 10, then timeouts) → automatic reveal
    at(10 * 60 * 1000);
    const end = await state(G1[0]);
    expect(end.session.status).toBe("revealed");
    const hs = await g.getHostState();
    expect(hs.leaderboard).toEqual(end.leaderboard);
    expect(hs.leaderboard).toEqual([
      { groupNumber: 2, members: 2, totalDepth: 420, rank: 1 },
      { groupNumber: 3, members: 1, totalDepth: 120, rank: 2 },
      { groupNumber: 1, members: 4, totalDepth: 60, rank: 3 },
      { groupNumber: 4, members: 3, totalDepth: 30, rank: 4 },
    ]);
    st1 = await state(G1[0]);
    expect(st1.me!.personalDepth).toBe(30);
  });

  it("never reveals while a group hasn't started, even if every started group finished", async () => {
    const [a] = await fillGroup(1, 1);
    await g.startGame(a);
    at(10 * 60 * 1000);
    const st = await state(a);
    expect(st.group!.round.finishedAt).not.toBeNull();
    expect(st.leaderboard).toBeNull();
  });

  it("dev test switch reveals once the started groups finish (never in production)", async () => {
    process.env.DEV_REVEAL_STARTED_GROUPS = "1";
    const [a] = await fillGroup(1, 1);
    await g.startGame(a);
    at(10 * 60 * 1000);
    const st = await state(a);
    expect(st.session.status).toBe("revealed");
    expect(st.leaderboard![0]).toMatchObject({ groupNumber: 1, rank: 1 });
    expect(st.leaderboard!.slice(1).every((r) => r.rank === null)).toBe(true);
  });

  it("ties share a rank", async () => {
    const { rankRows } = g;
    const rows = rankRows([
      { groupNumber: 1, members: 2, totalDepth: 100, rank: null },
      { groupNumber: 2, members: 2, totalDepth: 120, rank: null },
      { groupNumber: 3, members: 2, totalDepth: 120, rank: null },
      { groupNumber: 4, members: 2, totalDepth: 90, rank: null },
    ]);
    expect(rows.map((r) => [r.groupNumber, r.rank])).toEqual([
      [2, 1],
      [3, 1],
      [1, 3],
      [4, 4],
    ]);
  });
});

describe("history and reconnection", () => {
  beforeEach(open);

  it("history is locked until the diver's group finishes, then shows attempts and depth", async () => {
    const [a] = await fillGroup(1, 1);
    await g.startGame(a);
    await expect(g.getHistory(a)).rejects.toThrow(/unlocks when your group has finished/);
    await toSecond(a, 2);
    await wrong(a);
    await toSecond(a, 14);
    await right(a);
    at(10 * 60 * 1000);
    const h = await g.getHistory(a);
    expect(h.personalDepth).toBe(20);
    expect(h.entries[0]).toMatchObject({ isCorrect: true, depthAwarded: 20, depthAfter: 20, myAnswer: QUESTIONS[0].aliases[0] });
    expect(h.entries[0].attempts.map((x) => x.isCorrect)).toEqual([false, true]);
    expect(h.entries[1]).toMatchObject({ isCorrect: false, depthAwarded: 0, myAnswer: null });
  });

  it("Test O: refresh keeps identity, group, question, depth and clock", async () => {
    const [a, b] = await fillGroup(1, 2);
    await g.startGame(a);
    await toSecond(a, 3);
    await right(a);
    const before = await state(a);
    const again = await join(1, a);
    expect(again.rejoined).toBe(true);
    const after = await state(a);
    expect(after.me).toEqual(before.me);
    expect(after.group!.round).toEqual(before.group!.round);
    expect(after.group!.members).toHaveLength(2);
    expect(after.me!.currentCorrect).toEqual({ depthAwarded: 30 });
    void b;
  });
});
