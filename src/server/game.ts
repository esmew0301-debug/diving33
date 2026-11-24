import "server-only";
import crypto from "node:crypto";
import { QUESTIONS } from "@/content/questions";
import {
  FINAL_SECONDS,
  INTERMISSION_SECONDS,
  MAX_ANSWER_LENGTH,
  MAX_NAME_LENGTH,
  NORMAL_SECONDS,
  READY_SECONDS,
  SUBMIT_GRACE_MS,
  WINDOW_SECONDS,
  depthForElapsed,
} from "@/lib/config";
import { isAcceptedAnswer, normalizeAnswer } from "@/lib/normalize";
import type { HistoryEntry, HostState, LeaderboardRow, PublicState, RoundClock, SubmitResult } from "@/lib/types";
import { getDb, type Db, type Queryable } from "./db";
import { devRevealStartedGroups, settings } from "./settings";

/**
 * OCEAN DIVE game engine.
 *
 *  - One current game ("session"). Students can join only after the HOST has opened it.
 *  - Students pick a group (1–4) and enter a name. Any member can start their group with ≥ 1 player;
 *    starting locks the group's roster.
 *  - Each GROUP plays the seven questions on one server clock: 30 s + a 3 s final countdown.
 *    Every diver answers independently and may retry after wrong answers. Their FIRST correct answer
 *    earns 30 / 20 / 10 m depending on server-measured time. A question closes when every roster
 *    member has answered correctly or the 33 s window expires; the next opens after a short pause.
 *  - Overdue questions are closed lazily on any request (`tick`), so groups never get stuck.
 *  - The final leaderboard (total team depth) is revealed automatically once ALL groups have started
 *    and finished. Until then no response contains another group's depth.
 */

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type TS = Date | string | null;

interface SessionRow {
  id: string;
  group_count: number;
  group_capacity: number;
  created_at: TS;
  opened_at: TS;
  revealed_at: TS;
}

interface GroupRow {
  id: string;
  session_id: string;
  group_number: number;
  capacity: number;
  started_at: TS;
  current_index: number;
  question_started_at: TS;
  finished_at: TS;
}

interface ParticipantRow {
  id: string;
  session_id: string;
  group_id: string;
  group_number: number;
  diver_number: number;
  display_name: string | null;
}

const TOTAL = QUESTIONS.length;
const NORMAL_MS = NORMAL_SECONDS * 1000;
const WINDOW_MS = WINDOW_SECONDS * 1000;
const INTER_MS = INTERMISSION_SECONDS * 1000;
const READY_MS = READY_SECONDS * 1000;
const ms = (v: TS | undefined): number | null => (v == null ? null : new Date(v).getTime());
const iso = (n: number) => new Date(n).toISOString();

/* ------------------------------------------------------------------ clock */

declare global {
  var __oceanClockOffset: number | undefined;
}
/** Server-authoritative time. (Tests may shift it through the dev-only clock hook.) */
export const now = () => Date.now() + (globalThis.__oceanClockOffset ?? 0);
export function advanceClock(msToAdd: number) {
  globalThis.__oceanClockOffset = (globalThis.__oceanClockOffset ?? 0) + msToAdd;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/* ------------------------------------------------------------------ sessions */

const SESSION_COLS = "id, group_count, group_capacity, created_at, opened_at, revealed_at";
const GROUP_COLS = "id, session_id, group_number, capacity, started_at, current_index, question_started_at, finished_at";

async function loadCurrent(q: Queryable, lock = false): Promise<SessionRow | null> {
  const rows = await q.query<SessionRow & Record<string, unknown>>(
    `select ${SESSION_COLS} from sessions where is_current order by created_at desc limit 1${lock ? " for update" : ""}`,
  );
  return rows[0] ?? null;
}

export interface NewGameConfig {
  groupCount?: number;
  groupCapacity?: number;
  /** Open immediately (used when the host starts a new game). */
  open?: boolean;
}

async function createSessionRow(q: Queryable, cfg: NewGameConfig = {}): Promise<SessionRow> {
  const st = settings();
  const groupCount = cfg.groupCount ?? st.groupCount;
  const capacity = cfg.groupCapacity ?? st.groupCapacity;
  await q.query(`update sessions set is_current = false where is_current`);
  const [s] = await q.query<SessionRow & Record<string, unknown>>(
    `insert into sessions (group_count, group_capacity, question_seconds, opened_at) values ($1, $2, $3, $4::timestamptz) returning ${SESSION_COLS}`,
    [groupCount, capacity, WINDOW_SECONDS, cfg.open ? iso(now()) : null],
  );
  for (let n = 1; n <= groupCount; n++) {
    await q.query(`insert into groups (session_id, group_number, capacity) values ($1, $2, $3)`, [s.id, n, capacity]);
  }
  return s;
}

/** An unrevealed game with no student activity for a long time (e.g. last night's rehearsal) is replaced. */
async function isStale(q: Queryable, s: SessionRow, t: number): Promise<boolean> {
  const st = settings();
  if (s.revealed_at || st.idleResetMinutes <= 0) return false;
  const [{ last }] = await q.query<{ last: TS }>(
    `select greatest((select max(last_seen_at) from participants where session_id = $1), $2::timestamptz) as last`,
    [s.id, iso(ms(s.opened_at) ?? ms(s.created_at)!)],
  );
  return t - ms(last)! > st.idleResetMinutes * 60000;
}

async function ensureSession(db: Db, t = now()): Promise<SessionRow> {
  const s = await loadCurrent(db);
  if (s && !(await isStale(db, s, t))) return s;
  return db.tx(async (q) => {
    await q.query("select pg_advisory_xact_lock(777001)");
    const cur = await loadCurrent(q, true);
    if (cur && !(await isStale(q, cur, t))) return cur;
    return createSessionRow(q, { open: !!cur?.opened_at && !cur.revealed_at });
  });
}

/** Start a brand-new game (host "New game", `npm run reset`, tests). */
export async function newGame(cfg: NewGameConfig = {}) {
  const db = await getDb();
  return db.tx(async (q) => {
    await q.query("select pg_advisory_xact_lock(777001)");
    return createSessionRow(q, cfg);
  });
}

/** Host logged in / host screen open: make sure the current game is open for students. */
export async function openGame(): Promise<SessionRow> {
  const db = await getDb();
  const s = await ensureSession(db);
  if (s.opened_at) return s;
  await db.query(`update sessions set opened_at = $2::timestamptz, version = version + 1 where id = $1 and opened_at is null`, [s.id, iso(now())]);
  return (await loadCurrent(db))!;
}

/* ------------------------------------------------------------------ round progression */

function roundClock(g: GroupRow): RoundClock {
  const qs = ms(g.question_started_at);
  const finished = ms(g.finished_at);
  const playing = qs != null && finished == null && g.current_index < TOTAL;
  return {
    started: !!g.started_at,
    index: g.current_index,
    questionStartedAt: qs,
    normalEndsAt: playing ? qs! + NORMAL_MS : null,
    deadline: playing ? qs! + WINDOW_MS : null,
    finishedAt: finished,
  };
}

/** Close question `g.current_index` at `closeAt`: unanswered roster members score 0, group advances. */
async function closeQuestion(q: Queryable, g: GroupRow, closeAt: number): Promise<GroupRow> {
  const i = g.current_index;
  await q.query(
    `insert into dive_results (session_id, participant_id, group_id, question_id, question_index, is_correct, depth_awarded)
     select p.session_id, p.id, p.group_id, $2, $3, false, 0 from participants p where p.group_id = $1
     on conflict (participant_id, question_id) do nothing`,
    [g.id, QUESTIONS[i].id, i],
  );
  const next = i + 1;
  const done = next >= TOTAL;
  const nextQs = done ? ms(g.question_started_at)! : closeAt + INTER_MS;
  await q.query(
    `update groups set current_index = $2, question_started_at = $3::timestamptz, finished_at = $4::timestamptz where id = $1`,
    [g.id, next, iso(nextQs), done ? iso(closeAt) : null],
  );
  return { ...g, current_index: next, question_started_at: iso(nextQs), finished_at: done ? iso(closeAt) : null };
}

const isOverdue = (g: GroupRow, t: number) => {
  const qs = ms(g.question_started_at);
  return !!g.started_at && !g.finished_at && g.current_index < TOTAL && qs != null && t >= qs + WINDOW_MS + SUBMIT_GRACE_MS;
};

async function advanceOverdue(q: Queryable, g: GroupRow, t: number): Promise<GroupRow> {
  let cur = g;
  while (isOverdue(cur, t)) cur = await closeQuestion(q, cur, ms(cur.question_started_at)! + WINDOW_MS);
  return cur;
}

async function revealIfDone(q: Queryable, s: SessionRow, t: number) {
  if (s.revealed_at) return;
  const groups = await q.query<{ started_at: TS; finished_at: TS; members: number }>(
    `select g.started_at, g.finished_at, (select count(*)::int from participants p where p.group_id = g.id) as members
     from groups g where g.session_id = $1`,
    [s.id],
  );
  const required = devRevealStartedGroups() ? groups.filter((g) => g.started_at) : groups;
  const ready = required.length > 0 && required.every((g) => g.started_at && g.finished_at && Number(g.members) > 0);
  if (!ready) return;
  await q.query(
    `update sessions set status = 'completed', revealed_at = $2::timestamptz, completed_at = $2::timestamptz, version = version + 1
     where id = $1 and revealed_at is null`,
    [s.id, iso(t)],
  );
}

/** Lazily close overdue questions for every group. Cheap read first; locks only when work is due. */
export async function tick(db: Db, t = now()): Promise<void> {
  const s = await loadCurrent(db);
  if (!s || s.revealed_at) return;
  const groups = await db.query<GroupRow & Record<string, unknown>>(`select ${GROUP_COLS} from groups where session_id = $1`, [s.id]);
  const due = groups.some((g) => isOverdue(g, t));
  const anyStarted = groups.some((g) => g.started_at);
  const allStartedDone = anyStarted && groups.filter((g) => g.started_at).every((g) => g.finished_at);
  if (!due && !allStartedDone) return;
  await db.tx(async (q) => {
    const cur = await loadCurrent(q, true);
    if (!cur || cur.id !== s.id || cur.revealed_at) return;
    const rows = await q.query<GroupRow & Record<string, unknown>>(
      `select ${GROUP_COLS} from groups where session_id = $1 order by group_number for update`,
      [s.id],
    );
    for (const g of rows) await advanceOverdue(q, g, t);
    await revealIfDone(q, cur, t);
  });
}

/* ------------------------------------------------------------------ participants */

const P_COLS = `p.id, p.session_id, p.group_id, g.group_number, p.diver_number, p.display_name`;

async function participantByToken(q: Queryable, token: string | null, sessionId: string): Promise<ParticipantRow | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const rows = await q.query<ParticipantRow & Record<string, unknown>>(
    `select ${P_COLS} from participants p join groups g on g.id = p.group_id where p.token_hash = $1 and p.session_id = $2`,
    [hashToken(token), sessionId],
  );
  return rows[0] ?? null;
}

export function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return n || null;
}

export interface JoinInput {
  groupNumber: unknown;
  name?: unknown;
  token?: string | null;
}

export interface JoinResult {
  token: string | null;
  sessionId: string;
  groupNumber: number;
  diverNumber: number;
  rejoined: boolean;
}

export async function joinGroup(input: JoinInput): Promise<JoinResult> {
  const db = await getDb();
  await ensureSession(db);
  return db.tx(async (q) => {
    const s = await loadCurrent(q, true);
    if (!s) throw new GameError("no_session", "The game is not open yet.", 409);

    // A diver who already has a slot always gets that slot back — no group switching, no duplicates.
    const existing = await participantByToken(q, input.token ?? null, s.id);
    if (existing) {
      await q.query(`update participants set last_seen_at = now() where id = $1`, [existing.id]);
      return { token: null, sessionId: s.id, groupNumber: existing.group_number, diverNumber: existing.diver_number, rejoined: true };
    }
    if (!s.opened_at) throw new GameError("not_open", "Waiting for the host to open the game.", 409);

    const raw = typeof input.groupNumber === "string" ? input.groupNumber.trim() : input.groupNumber;
    const n = typeof raw === "number" ? raw : /^\d{1,2}$/.test(String(raw)) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > s.group_count) {
      throw new GameError("invalid_group", `Please choose a group number from 1 to ${s.group_count}.`);
    }
    if (s.revealed_at) throw new GameError("session_completed", "This game has already finished.", 409);
    const name = cleanName(input.name);
    if (!name) throw new GameError("name_required", "Please enter your name.");

    const [g] = await q.query<{ id: string; capacity: number; started_at: TS }>(
      `select id, capacity, started_at from groups where session_id = $1 and group_number = $2 for update`,
      [s.id, n],
    );
    if (!g) throw new GameError("invalid_group", `Please choose a group number from 1 to ${s.group_count}.`);
    if (g.started_at) {
      throw new GameError("group_started", `Group ${n} has already started its dive. New players can't join mid-game.`, 409);
    }
    const taken = (await q.query<{ diver_number: number }>(`select diver_number from participants where group_id = $1`, [g.id])).map(
      (r) => Number(r.diver_number),
    );
    if (taken.length >= g.capacity) throw new GameError("group_full", `Group ${n} is full. Please check your group number.`, 409);
    let diver = 1;
    while (taken.includes(diver)) diver++;
    const token = crypto.randomBytes(32).toString("base64url");
    await q.query(
      `insert into participants (session_id, group_id, token_hash, diver_number, display_name) values ($1, $2, $3, $4, $5)`,
      [s.id, g.id, hashToken(token), diver, name],
    );
    await q.query(`update sessions set version = version + 1 where id = $1`, [s.id]);
    return { token, sessionId: s.id, groupNumber: n, diverNumber: diver, rejoined: false };
  });
}

/** Any member presses Start Game: the whole group starts together and its roster locks. Idempotent. */
export async function startGame(token: string | null): Promise<{ ok: true }> {
  const db = await getDb();
  const t = now();
  return db.tx(async (q) => {
    const s = await loadCurrent(q);
    if (!s) throw new GameError("no_session", "The game is not open.", 409);
    const p = await participantByToken(q, token, s.id);
    if (!p) throw new GameError("not_joined", "Your diver slot was not found. Please join your group again.", 401);
    const [g] = await q.query<GroupRow & Record<string, unknown>>(`select ${GROUP_COLS} from groups where id = $1 for update`, [p.group_id]);
    if (g.started_at) return { ok: true };
    const [{ members }] = await q.query<{ members: number }>(`select count(*)::int as members from participants where group_id = $1`, [g.id]);
    if (Number(members) < 1) throw new GameError("group_empty", "Your group needs at least one diver.", 409);
    await q.query(
      `update groups set started_at = $2::timestamptz, current_index = 0, question_started_at = $3::timestamptz, roster_size = $4
       where id = $1 and started_at is null`,
      [g.id, iso(t), iso(t + READY_MS), Number(members)],
    );
    await q.query(`update sessions set version = version + 1 where id = $1`, [s.id]);
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ answers */

async function personalDepth(q: Queryable, participantId: string): Promise<number> {
  const [{ d }] = await q.query<{ d: number }>(`select coalesce(sum(depth_awarded), 0)::int as d from dive_results where participant_id = $1`, [
    participantId,
  ]);
  return Number(d);
}

export async function submitAnswer(token: string | null, questionId: unknown, answer: unknown): Promise<SubmitResult> {
  const db = await getDb();
  await tick(db);
  const t = now();
  return db.tx(async (q) => {
    const s = await loadCurrent(q);
    if (!s) throw new GameError("no_session", "The game is not open.", 409);
    const p = await participantByToken(q, token, s.id);
    if (!p) throw new GameError("not_joined", "Your diver slot was not found. Please join your group again.", 401);
    if (typeof questionId !== "string") throw new GameError("bad_request", "Missing question.");
    const qIndex = QUESTIONS.findIndex((x) => x.id === questionId);
    if (qIndex < 0) throw new GameError("bad_request", "Unknown question.");

    // The group row lock serializes all scoring for this group (simultaneous answers can't collide).
    const [g0] = await q.query<GroupRow & Record<string, unknown>>(`select ${GROUP_COLS} from groups where id = $1 for update`, [p.group_id]);
    const g = await advanceOverdue(q, g0, t);

    const wrongCount = async () =>
      Number(
        (
          await q.query<{ n: number }>(
            `select count(*)::int as n from dive_attempts where participant_id = $1 and question_id = $2 and not is_correct`,
            [p.id, questionId],
          )
        )[0].n,
      );

    const [prior] = await q.query<{ is_correct: boolean; depth_awarded: number; elapsed_ms: number | null }>(
      `select is_correct, depth_awarded, elapsed_ms from dive_results where participant_id = $1 and question_id = $2`,
      [p.id, questionId],
    );
    if (prior?.is_correct) {
      return {
        isCorrect: true,
        depthAwarded: Number(prior.depth_awarded),
        personalDepth: await personalDepth(q, p.id),
        elapsedMs: Number(prior.elapsed_ms ?? 0),
        wrongAttempts: await wrongCount(),
        duplicate: true,
      };
    }

    if (!g.started_at) throw new GameError("not_started", "Your group hasn't started yet.", 409);
    if (g.finished_at || g.current_index !== qIndex || prior) throw new GameError("time_up", "Time is up for this question.", 409);
    const qs = ms(g.question_started_at)!;
    if (t < qs) throw new GameError("too_early", "Get ready — the question opens in a moment.", 409);
    const elapsed = t - qs;
    if (elapsed > WINDOW_MS + SUBMIT_GRACE_MS) throw new GameError("time_up", "Time is up for this question.", 409);

    const text = typeof answer === "string" ? answer.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
    if (!text) throw new GameError("empty", "Please type an answer before submitting.");
    if (text.length > MAX_ANSWER_LENGTH) throw new GameError("too_long", `Answers can be at most ${MAX_ANSWER_LENGTH} characters.`);

    const def = QUESTIONS[qIndex];
    const correct = isAcceptedAnswer(text, [def.canonicalAnswer, ...def.aliases], def.acceptedAnswerPolicy);
    await q.query(
      `insert into dive_attempts (session_id, participant_id, group_id, question_id, question_index, raw_answer, normalized_answer, is_correct, elapsed_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [s.id, p.id, p.group_id, def.id, qIndex, text, normalizeAnswer(text), correct, elapsed],
    );

    let depthAwarded = 0;
    if (correct) {
      depthAwarded = depthForElapsed(elapsed);
      await q.query(
        `insert into dive_results (session_id, participant_id, group_id, question_id, question_index, is_correct, depth_awarded, elapsed_ms, raw_answer)
         values ($1, $2, $3, $4, $5, true, $6, $7, $8) on conflict (participant_id, question_id) do nothing`,
        [s.id, p.id, p.group_id, def.id, qIndex, depthAwarded, elapsed, text],
      );
      // Everyone in the roster has it right → close the question early.
      const [{ members, done }] = await q.query<{ members: number; done: number }>(
        `select (select count(*)::int from participants where group_id = $1) as members,
                (select count(*)::int from dive_results where group_id = $1 and question_id = $2 and is_correct) as done`,
        [p.group_id, def.id],
      );
      if (Number(done) >= Number(members)) {
        const after = await closeQuestion(q, g, t);
        if (after.finished_at) await revealIfDone(q, s, t);
      }
    }
    await q.query(`update participants set last_seen_at = now() where id = $1`, [p.id]);
    return {
      isCorrect: correct,
      depthAwarded,
      personalDepth: await personalDepth(q, p.id),
      elapsedMs: elapsed,
      wrongAttempts: await wrongCount(),
      duplicate: false,
    };
  });
}

/* ------------------------------------------------------------------ leaderboard (only after reveal) */

async function leaderboard(q: Queryable, s: SessionRow): Promise<LeaderboardRow[]> {
  const rows = await q.query<{ group_number: number; members: number; total: number }>(
    `select g.group_number,
            (select count(*)::int from participants p where p.group_id = g.id) as members,
            (select coalesce(sum(r.depth_awarded), 0)::int from dive_results r where r.group_id = g.id) as total
     from groups g where g.session_id = $1 order by g.group_number`,
    [s.id],
  );
  const list: LeaderboardRow[] = rows.map((r) => ({
    groupNumber: Number(r.group_number),
    members: Number(r.members),
    totalDepth: Number(r.total),
    rank: null,
  }));
  return rankRows(list);
}

/** Highest total depth first; equal totals share a rank (1, 1, 3 …). Empty groups go last, unranked. */
export function rankRows(list: LeaderboardRow[]): LeaderboardRow[] {
  const ranked = list.filter((r) => r.members > 0).sort((a, b) => b.totalDepth - a.totalDepth || a.groupNumber - b.groupNumber);
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1];
    r.rank = prev && prev.totalDepth === r.totalDepth ? prev.rank : i + 1;
  });
  return [...ranked, ...list.filter((r) => r.members === 0)];
}

/* ------------------------------------------------------------------ public (student) state */

export async function getPublicState(token: string | null): Promise<PublicState> {
  const db = await getDb();
  await ensureSession(db);
  await tick(db);
  const t = now();
  const s = (await loadCurrent(db))!;
  const revealed = !!s.revealed_at;
  const p = await participantByToken(db, token, s.id);

  const groups = await db.query<GroupRow & { members: number } & Record<string, unknown>>(
    `select ${GROUP_COLS}, (select count(*)::int from participants p where p.group_id = groups.id) as members
     from groups where session_id = $1 order by group_number`,
    [s.id],
  );
  const groupsOverview = groups.map((g) => ({
    groupNumber: Number(g.group_number),
    capacity: Number(g.capacity),
    members: Number(g.members),
    started: !!g.started_at,
  }));

  let me: PublicState["me"] = null;
  let group: PublicState["group"] = null;
  let question: PublicState["question"] = null;
  if (p) {
    await db.query(`update participants set last_seen_at = now() where id = $1 and last_seen_at < now() - interval '10 seconds'`, [p.id]);
    const g = groups.find((x) => x.id === p.group_id)!;
    const round = roundClock(g);
    const results = await db.query<{ question_index: number; is_correct: boolean; depth_awarded: number }>(
      `select question_index, is_correct, depth_awarded from dive_results where participant_id = $1 order by question_index`,
      [p.id],
    );
    const playing = round.started && round.finishedAt == null && g.current_index < TOTAL;
    const cur = playing ? results.find((r) => Number(r.question_index) === g.current_index) : undefined;
    let currentWrongAttempts = 0;
    if (playing) {
      const [{ n }] = await db.query<{ n: number }>(
        `select count(*)::int as n from dive_attempts where participant_id = $1 and question_index = $2 and not is_correct`,
        [p.id, g.current_index],
      );
      currentWrongAttempts = Number(n);
      const def = QUESTIONS[g.current_index];
      question = { id: def.id, order: def.order, prompt: def.prompt, categoryLabel: def.categoryLabel };
    }
    me = {
      groupNumber: p.group_number,
      diverNumber: p.diver_number,
      displayName: p.display_name,
      personalDepth: results.reduce((a, r) => a + Number(r.depth_awarded), 0),
      results: results.map((r) => ({ questionIndex: Number(r.question_index), isCorrect: !!r.is_correct, depthAwarded: Number(r.depth_awarded) })),
      currentWrongAttempts,
      currentCorrect: cur?.is_correct ? { depthAwarded: Number(cur.depth_awarded) } : null,
    };
    const members = await db.query<{ id: string; diver_number: number; display_name: string | null; done: boolean }>(
      `select p.id, p.diver_number, p.display_name,
              exists(select 1 from dive_results r where r.participant_id = p.id and r.question_index = $2 and r.is_correct) as done
       from participants p where p.group_id = $1 order by p.diver_number`,
      [p.group_id, g.current_index],
    );
    const [{ team }] = await db.query<{ team: number }>(
      `select coalesce(sum(depth_awarded), 0)::int as team from dive_results where group_id = $1`,
      [p.group_id],
    );
    group = {
      groupNumber: p.group_number,
      capacity: Number(g.capacity),
      teamDepth: Number(team),
      round,
      members: members.map((m) => ({
        diverNumber: Number(m.diver_number),
        displayName: m.display_name,
        isMe: m.id === p.id,
        doneThisRound: playing && !!m.done,
      })),
    };
  }

  return {
    serverNow: t,
    session: {
      id: s.id,
      opened: !!s.opened_at,
      status: revealed ? "revealed" : "open",
      groupCount: s.group_count,
      groupCapacity: s.group_capacity,
      total: TOTAL,
      normalSeconds: NORMAL_SECONDS,
      finalSeconds: FINAL_SECONDS,
      intermissionSeconds: INTERMISSION_SECONDS,
      groupsFinished: groups.filter((g) => g.finished_at).length,
    },
    question,
    me,
    group,
    groupsOverview,
    leaderboard: revealed ? await leaderboard(db, s) : null,
  };
}

/* ------------------------------------------------------------------ host state */

export async function getHostState(): Promise<HostState> {
  const db = await getDb();
  await openGame();
  await tick(db);
  const s = (await loadCurrent(db))!;
  const groups = await db.query<{ group_number: number; members: number; started_at: TS; finished_at: TS }>(
    `select group_number, started_at, finished_at, (select count(*)::int from participants p where p.group_id = groups.id) as members
     from groups where session_id = $1 order by group_number`,
    [s.id],
  );
  return {
    serverNow: now(),
    sessionId: s.id,
    opened: !!s.opened_at,
    status: s.revealed_at ? "revealed" : "open",
    groupCount: s.group_count,
    groups: groups.map((g) => ({ groupNumber: Number(g.group_number), members: Number(g.members), started: !!g.started_at, finished: !!g.finished_at })),
    groupsFinished: groups.filter((g) => g.finished_at).length,
    leaderboard: s.revealed_at ? await leaderboard(db, s) : null,
    devRevealStartedGroups: devRevealStartedGroups(),
  };
}

/* ------------------------------------------------------------------ history (after the diver's group finishes) */

export async function getHistory(
  token: string | null,
): Promise<{ entries: HistoryEntry[]; personalDepth: number; correctCount: number; groupNumber: number; displayName: string | null }> {
  const db = await getDb();
  await tick(db);
  const s = await loadCurrent(db);
  if (!s) throw new GameError("no_session", "No game found.", 404);
  const p = await participantByToken(db, token, s.id);
  if (!p) throw new GameError("not_joined", "Your diver slot was not found on this device.", 401);
  const [g] = await db.query<{ finished_at: TS }>(`select finished_at from groups where id = $1`, [p.group_id]);
  if (!g.finished_at) throw new GameError("locked", "Answer history unlocks when your group has finished all seven questions.", 403);
  const results = await db.query<{ question_id: string; is_correct: boolean; depth_awarded: number; raw_answer: string | null }>(
    `select question_id, is_correct, depth_awarded, raw_answer from dive_results where participant_id = $1`,
    [p.id],
  );
  const attempts = await db.query<{ question_id: string; raw_answer: string; is_correct: boolean; elapsed_ms: number }>(
    `select question_id, raw_answer, is_correct, elapsed_ms from dive_attempts where participant_id = $1 order by submitted_at, elapsed_ms`,
    [p.id],
  );
  const byId = new Map(results.map((r) => [String(r.question_id), r]));
  let depth = 0;
  let correctCount = 0;
  const entries = QUESTIONS.map((def, i): HistoryEntry => {
    const r = byId.get(def.id);
    const mine = attempts.filter((a) => a.question_id === def.id);
    if (r?.is_correct) correctCount++;
    const awarded = r ? Number(r.depth_awarded) : 0;
    depth += awarded;
    return {
      index: i,
      order: def.order,
      categoryLabel: def.categoryLabel,
      prompt: def.prompt,
      myAnswer: r?.is_correct ? String(r.raw_answer ?? "") : (mine.at(-1)?.raw_answer ?? null),
      attempts: mine.map((a) => ({ answer: a.raw_answer, isCorrect: !!a.is_correct, seconds: Math.round(Number(a.elapsed_ms) / 100) / 10 })),
      isCorrect: !!r?.is_correct,
      depthAwarded: awarded,
      depthAfter: depth,
      canonicalAnswer: def.canonicalAnswer,
      acceptedExamples: def.aliases,
      explanation: def.explanation,
      referenceLabel: def.referenceLabel,
      referenceUrl: def.referenceUrl,
    };
  });
  return { entries, personalDepth: depth, correctCount, groupNumber: p.group_number, displayName: p.display_name };
}
