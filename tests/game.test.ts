import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS } from "@/content/questions";

// Each test gets a fresh in-memory Postgres (PGlite) running the real schema + SQL.
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
  delete process.env.DATABASE_URL;
  delete process.env.GROUP_COUNT;
  delete process.env.GROUP_CAPACITY;
  delete process.env.AUTO_START_SECONDS;
  const db = await import("@/server/db");
  db.__setDbForTests(undefined);
  g = await import("@/server/game");
  vi.useFakeTimers({ toFake: ["Date"] });
  T = Date.now();
  vi.setSystemTime(T);
});
afterEach(() => vi.useRealTimers());

const join = (n: number | string, token?: string | null) => g.joinGroup({ groupNumber: n, token });
const state = (token: string | null) => g.getPublicState(token);

async function fillGroup(n: number, size = 4) {
  const out = [];
  for (let i = 0; i < size; i++) out.push((await join(n)).token!);
  return out;
}

/** Answer the diver's current question (after waiting for it to open). */
async function answer(token: string, correct: boolean) {
  const st = await state(token);
  if (st.me!.questionStartedAt! > Date.now()) at(st.me!.questionStartedAt! - Date.now());
  const q = QUESTIONS[st.me!.index];
  return g.submitAnswer(token, q.id, correct ? q.aliases[0] : "definitely wrong");
}

async function playAll(token: string, pattern: boolean[]) {
  await g.startGame(token);
  for (const c of pattern) await answer(token, c);
}

describe("joining groups", () => {
  it("puts four divers in group 1, refuses a fifth, places another in group 2", async () => {
    const a = await Promise.all([join(1), join("1"), join(1), join(1)]);
    expect(a.map((x) => x.diverNumber).sort()).toEqual([1, 2, 3, 4]);
    await expect(join(1)).rejects.toThrow("Group 1 is full. Please confirm your group number.");
    const b = await join(2);
    expect(b).toMatchObject({ groupNumber: 2, diverNumber: 1 });
    const st = await state(a[0].token);
    expect(st.group).toMatchObject({ ready: true, capacity: 4 });
    expect(st.group!.members).toHaveLength(4);
  });

  it("validates group numbers", async () => {
    for (const bad of [0, 5, "abc", "", "1.5", -1, null]) await expect(join(bad as never)).rejects.toThrow(/group number from 1 to 4/);
  });

  it("returns the same slot on refresh and never lets a diver switch groups", async () => {
    const a = await join(3);
    const again = await join(1, a.token);
    expect(again).toMatchObject({ rejoined: true, groupNumber: 3, diverNumber: a.diverNumber });
    const st = await state(a.token);
    expect(st.session.joined).toBe(1);
  });
});

describe("starting", () => {
  it("cannot start until the group is full; then each diver starts independently", async () => {
    const [t1, t2, t3] = await fillGroup(1, 3);
    await expect(g.startGame(t1)).rejects.toThrow(/needs 4 divers/);
    expect((await state(t1)).group!.ready).toBe(false);
    const t4 = (await join(1)).token!;
    await g.startGame(t1);
    await g.startGame(t1); // idempotent
    const s1 = await state(t1);
    const s2 = await state(t2);
    expect(s1.me!.started).toBe(true);
    expect(s2.me!.started).toBe(false);
    expect(s2.group!.members.find((m) => m.diverNumber === 1)!.started).toBe(true);
    void t3;
    void t4;
  });
});

describe("scoring", () => {
  it("+1 personal/+1 group for correct, 0 for wrong, idempotent under replays", async () => {
    const [a, b] = await fillGroup(1);
    await g.startGame(a);
    await g.startGame(b);
    at(3000);
    const q1 = QUESTIONS[0].id;
    const burst = await Promise.all(Array.from({ length: 5 }, () => g.submitAnswer(a, q1, "CO2")));
    expect(burst.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(burst.every((r) => r.isCorrect && r.groupCredits === 1 && r.personalDepthAfter === 100)).toBe(true);
    const wrong = await g.submitAnswer(b, q1, "methane");
    expect(wrong).toMatchObject({ isCorrect: false, awardedCredit: 0, personalDepthAfter: 0, groupCredits: 1 });
    const retry = await g.submitAnswer(b, q1, "carbon dioxide");
    expect(retry).toMatchObject({ isCorrect: false, duplicate: true, groupCredits: 1 });
    expect(JSON.stringify(wrong)).not.toMatch(/carbon dioxide/i);
    const st = await state(b);
    expect(st.me).toMatchObject({ personalDepth: 0, index: 1, finished: false });
    expect(JSON.stringify(st)).not.toMatch(/canonical|alias/i);
  });

  it("enforces the per-diver question window", async () => {
    const [a] = await fillGroup(1);
    await expect(g.submitAnswer(a, QUESTIONS[0].id, "co2")).rejects.toThrow(/Start Game/);
    await g.startGame(a);
    await expect(g.submitAnswer(a, QUESTIONS[0].id, "co2")).rejects.toThrow(/Get ready/);
    at(3000);
    await expect(g.submitAnswer(a, QUESTIONS[1].id, "ocean acidification")).rejects.toThrow(/no longer open/);
    await expect(g.submitAnswer(a, QUESTIONS[0].id, "  ")).rejects.toThrow(/type an answer/);
    await g.submitAnswer(a, QUESTIONS[0].id, "co2");
    // the next question opens after the 3 s result pause
    await expect(g.submitAnswer(a, QUESTIONS[1].id, "ocean acidification")).rejects.toThrow(/Get ready/);
    at(3000);
    expect((await g.submitAnswer(a, QUESTIONS[1].id, "ocean acidification")).isCorrect).toBe(true);
    await expect(g.submitAnswer("x".repeat(43), QUESTIONS[0].id, "co2")).rejects.toThrow(/join your group/);
  });

  it("times out unanswered questions server-side, even if the phone is asleep", async () => {
    const [a] = await fillGroup(1);
    await g.startGame(a);
    at(3000 + 25000 + 700); // Q1 deadline + grace passed
    const st = await state(a);
    expect(st.me!.index).toBe(1);
    expect(st.me!.answers[0]).toMatchObject({ status: "timeout", isCorrect: false });
    at(10 * 60 * 1000); // long sleep → the remaining questions all time out
    const done = await state(a);
    expect(done.me).toMatchObject({ finished: true, index: 7, personalDepth: 0 });
    expect(done.me!.answers).toHaveLength(7);
  });

  it("a diver who is mid-game is never marked finished", async () => {
    const [a] = await fillGroup(1);
    await playAll(a, [true, false, true, true, false, true]);
    const st = await state(a);
    expect(st.me).toMatchObject({ finished: false, index: 6, personalCorrect: 4, personalDepth: 400 });
    expect(st.session.finished).toBe(0);
  });
});

describe("privacy and automatic reveal (4 groups × 4)", () => {
  it("hides other groups' scores until every expected diver finishes, then reveals to everyone", async () => {
    const groups = [await fillGroup(1), await fillGroup(2), await fillGroup(3), await fillGroup(4)];
    const patterns = [
      [true, true, true, true, true, true, true],
      [true, false, true, false, true, false, true],
      [false, false, false, false, false, false, false],
      [true, true, true, false, false, false, false],
    ];
    // Group 1 plays fast and finishes completely while the others haven't started.
    for (const t of groups[0]) await playAll(t, patterns[0]);
    let st = await state(groups[0][0]);
    expect(st.me!.finished).toBe(true);
    expect(st.session).toMatchObject({ status: "open", finished: 4, expected: 16 });
    expect(st.leaderboard).toBeNull();
    expect(st.group!.credits).toBe(28);
    await expect(g.getHistory(groups[0][0])).rejects.toThrow(/unlocks/);

    // Group 2's view: its own credits only — nothing about group 1's 28.
    await playAll(groups[1][0], patterns[1]);
    const g2 = await state(groups[1][0]);
    expect(g2.group).toMatchObject({ groupNumber: 2, credits: 4 });
    const g2json = JSON.stringify(g2);
    expect(g2json).not.toContain('"credits":28');
    expect(g2.leaderboard).toBeNull();
    expect(Object.keys(g2.groupsOverview[0]).sort()).toEqual(["capacity", "groupNumber", "members"]);

    for (const t of groups[1].slice(1)) await playAll(t, patterns[1]);
    for (const t of groups[2]) await playAll(t, patterns[2]);
    for (const t of groups[3].slice(0, 3)) await playAll(t, patterns[3]);
    st = await state(groups[3][3]);
    expect(st.session).toMatchObject({ status: "open", finished: 15 });
    expect(st.leaderboard).toBeNull();

    // The very last diver finishes → automatic reveal, identical for everyone.
    await playAll(groups[3][3], patterns[3]);
    const views = await Promise.all(groups.flat().map((t) => state(t)));
    for (const v of views) expect(v.session.status).toBe("revealed");
    const lb = views[0].leaderboard!;
    expect(views.every((v) => JSON.stringify(v.leaderboard) === JSON.stringify(lb))).toBe(true);
    expect(lb.map((r) => [r.groupNumber, r.credits, r.rank])).toEqual([
      [1, 28, 1],
      [2, 16, 2],
      [4, 12, 3],
      [3, 0, 4],
    ]);
    const h = await g.getHistory(groups[2][0]);
    expect(h.entries).toHaveLength(7);
    expect(h.entries[0]).toMatchObject({ myAnswer: "definitely wrong", isCorrect: false, depthAfter: 0 });
    expect(h.entries[0].canonicalAnswer).toBe("Carbon dioxide (CO₂)");
  });

  it("does not reveal early when fewer than the expected divers have joined", async () => {
    for (const t of await fillGroup(1)) await playAll(t, [true, true, true, true, true, true, true]);
    for (const t of await fillGroup(2)) await playAll(t, [true, true, true, true, true, true, true]);
    for (const t of await fillGroup(3)) await playAll(t, [true, true, true, true, true, true, true]);
    const st = await state(null);
    expect(st.session).toMatchObject({ status: "open", joined: 12, finished: 12, expected: 16 });
    expect(st.leaderboard).toBeNull();
  });

  it("respects GROUP_COUNT / GROUP_CAPACITY for smaller classes, and handles ties", async () => {
    await g.newGame({ groupCount: 2, groupCapacity: 2 });
    const [a1, a2] = await fillGroup(1, 2);
    const [b1, b2] = await fillGroup(2, 2);
    await playAll(a1, [true, true, false, false, false, false, false]);
    await playAll(a2, [false, false, false, false, false, false, false]);
    await playAll(b1, [true, false, false, false, false, false, false]);
    await playAll(b2, [true, false, false, false, false, false, false]);
    const st = await state(a1);
    expect(st.session.status).toBe("revealed");
    expect(st.leaderboard!.map((r) => r.rank)).toEqual([1, 1]);
  });
});

describe("safety nets without a teacher", () => {
  it("auto-starts an idle member of a full group so the reveal cannot be blocked forever", async () => {
    await g.newGame({ groupCount: 1, groupCapacity: 2 });
    const [a, idle] = await fillGroup(1, 2);
    await playAll(a, [true, true, true, true, true, true, true]);
    expect((await state(a)).session.status).toBe("open");
    at(5 * 60 * 1000 + 7 * 29 * 1000);
    const st = await state(a);
    expect(st.session.status).toBe("revealed");
    expect((await state(idle)).me).toMatchObject({ started: true, finished: true, personalCorrect: 0 });
  });

  it("opens a fresh game an hour after the reveal, and after long inactivity", async () => {
    await g.newGame({ groupCount: 1, groupCapacity: 1 });
    const [a] = await fillGroup(1, 1);
    await playAll(a, [true, true, true, true, true, true, true]);
    const revealed = await state(a);
    expect(revealed.session.status).toBe("revealed");
    at(61 * 60 * 1000);
    const fresh = await state(a);
    expect(fresh.session.id).not.toBe(revealed.session.id);
    expect(fresh.me).toBeNull();
    expect(fresh.session).toMatchObject({ groupCount: 4, groupCapacity: 4, status: "open" });
    await join(2);
    at(181 * 60 * 1000);
    const fresh2 = await state(null);
    expect(fresh2.session.id).not.toBe(fresh.session.id);
  });
});
