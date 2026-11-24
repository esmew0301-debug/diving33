"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, setToken, useLiveState, useTicker } from "@/lib/client";
import { MAX_ANSWER_LENGTH, MAX_NAME_LENGTH } from "@/lib/config";
import type { LeaderboardRow, PublicState, SubmitResult } from "@/lib/types";
import OceanScene, { type SceneFeedback } from "./OceanScene";
import { HowToPlay, Modal, SubIcon } from "./PixelBits";

/** Real meters → scene meters, so a 7 × 30 m dive still travels down through the whole ocean. */
export const VISUAL_SCALE = 3;

type View = "loading" | "entry" | "await-host" | "groups" | "lobby" | "play" | "complete" | "results";

function viewOf(state: PublicState | null, chosePlayer: boolean, now: number): View {
  if (!state) return "loading";
  const me = state.me;
  if (!me) {
    if (!chosePlayer) return "entry";
    return state.session.opened ? "groups" : "await-host";
  }
  const r = state.group!.round;
  if (!r.started) return "lobby";
  if (r.finishedAt != null && now >= r.finishedAt + state.session.intermissionSeconds * 1000) {
    return state.session.status === "revealed" ? "results" : "complete";
  }
  return "play";
}

export default function Game() {
  const { state, setState, refresh, offline, serverNow, problem } = useLiveState();
  const [feedback, setFeedback] = useState<SceneFeedback>(null);
  const [howTo, setHowTo] = useState(false);
  const [chosePlayer, setChosePlayer] = useState(false);
  // Personal depth can only increase within a game; ignore stale polls that arrive late.
  const [floor, setFloor] = useState({ sid: "", d: 0 });

  const s = state?.session;
  const me = state?.me ?? null;
  let depth = me?.personalDepth ?? 0;
  if (s && me) {
    depth = Math.max(depth, floor.sid === s.id ? floor.d : 0);
    if (floor.sid !== s.id || floor.d !== depth) setFloor({ sid: s.id, d: depth });
  }

  useTicker(!!state?.group?.round.started || (chosePlayer && !state?.session.opened), 200);
  const view = viewOf(state, chosePlayer, serverNow());
  const inGame = view === "lobby" || view === "play" || view === "complete" || view === "results";

  return (
    <>
      <OceanScene mode={inGame ? "game" : "landing"} depth={depth} feedback={feedback} showGauge={inGame} visualScale={VISUAL_SCALE} />
      <main className={`app ${inGame ? "with-gauge" : ""}`}>
        {offline && (
          <div role="status" className="hud-chip" style={{ position: "fixed", bottom: 12, right: 12, zIndex: 40, flexDirection: "row" }}>
            <span className="label" style={{ color: "var(--coral)" }}>
              Reconnecting<span className="dots" />
            </span>
          </div>
        )}
        {view === "loading" && <Loading problem={problem} />}
        {view === "entry" && <Entry onPlayer={() => setChosePlayer(true)} onHowTo={() => setHowTo(true)} />}
        {view === "await-host" && <AwaitHost onBack={() => setChosePlayer(false)} />}
        {view === "groups" && state && <Groups state={state} onJoined={refresh} onBack={() => setChosePlayer(false)} onHowTo={() => setHowTo(true)} />}
        {view === "lobby" && state && <Lobby state={state} onStarted={refresh} onHowTo={() => setHowTo(true)} />}
        {view === "play" && state && (
          <Play
            state={state}
            depth={depth}
            serverNow={serverNow}
            onWrong={() => setFeedback({ kind: "wrong", key: Date.now() })}
            onResult={(r) => {
              if (r.isCorrect && !r.duplicate) setFeedback({ kind: "correct", key: Date.now(), meters: r.depthAwarded });
              // Apply the server's result right away; the next poll confirms it.
              setState((prev) => {
                if (!prev?.me) return prev;
                return {
                  ...prev,
                  me: {
                    ...prev.me,
                    personalDepth: Math.max(prev.me.personalDepth, r.personalDepth),
                    currentWrongAttempts: r.wrongAttempts,
                    currentCorrect: r.isCorrect ? { depthAwarded: r.depthAwarded } : prev.me.currentCorrect,
                  },
                };
              });
              refresh();
            }}
            onHowTo={() => setHowTo(true)}
          />
        )}
        {view === "complete" && state && <Complete state={state} depth={depth} />}
        {view === "results" && state && <Results state={state} depth={depth} />}
      </main>
      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </>
  );
}

function Loading({ problem }: { problem?: string | null }) {
  return (
    <div style={{ margin: "auto", textAlign: "center", width: "min(560px, 100%)" }}>
      <p className="display" style={{ fontSize: 12, color: "var(--navy-800)" }}>
        Loading the ocean<span className="dots" />
      </p>
      {problem && (
        <div className="px-box" role="alert" style={{ padding: "16px 16px 12px", marginTop: 18, textAlign: "left" }}>
          <p className="display" style={{ fontSize: 10, color: "var(--coral)", margin: "0 0 10px", lineHeight: 1.6 }}>
            The game server isn&apos;t ready
          </p>
          <p className="body-text" style={{ margin: 0 }}>
            {problem}
          </p>
          <p className="small" style={{ margin: "10px 0 0" }}>
            This page keeps retrying and continues automatically once the server is fixed.
          </p>
        </div>
      )}
    </div>
  );
}

function TitleHeader({ subtitle = "How deep does your ocean knowledge go?" }: { subtitle?: string }) {
  return (
    <header style={{ minHeight: "36dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 14, paddingTop: 8 }}>
      <span className="kicker">The coastal knowledge dive</span>
      <h1 className="title landing-title">
        <span>OCEAN</span> <span className="alt">DIVE</span>
      </h1>
      <p className="subtitle">{subtitle}</p>
    </header>
  );
}

const panelStyle = { width: "min(520px, 100%)", padding: "18px 16px 10px", marginTop: "max(12px, calc(14dvh - 16px))" } as const;

/* =================================================================== ENTRY: HOST or PLAYER */

function Entry({ onPlayer, onHowTo }: { onPlayer: () => void; onHowTo: () => void }) {
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center" }}>
      <TitleHeader />
      <div className="px-box" style={panelStyle}>
        <p className="display" style={{ fontSize: "clamp(10px, 2.8vw, 12px)", margin: "0 0 14px", color: "var(--yellow)", lineHeight: 1.5 }}>
          Who is diving in?
        </p>
        <div className="role-grid">
          <Link href="/host" className="role-card">
            <SubIcon color="#ff9ec7" />
            <b>HOST</b>
            <small>Present the results</small>
          </Link>
          <button type="button" className="role-card player" onClick={onPlayer}>
            <SubIcon />
            <b>PLAYER</b>
            <small>Join your group</small>
          </button>
        </div>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button type="button" className="link-btn" onClick={onHowTo}>
            How to play
          </button>
        </div>
      </div>
    </div>
  );
}

function AwaitHost({ onBack }: { onBack: () => void }) {
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center" }}>
      <TitleHeader />
      <div className="px-box await-host" style={{ ...panelStyle, padding: "26px 18px 12px", textAlign: "center" }}>
        <SubIcon />
        <p className="display bob" role="status" style={{ fontSize: "clamp(11px, 3vw, 14px)", margin: "18px 0 14px", color: "var(--yellow)", lineHeight: 1.8 }}>
          Waiting for the host to open the game<span className="dots" />
        </p>
        <p className="small" style={{ margin: "0 0 8px" }}>
          This page continues automatically. No need to refresh.
        </p>
        <button type="button" className="link-btn" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/* =================================================================== GROUP SELECTION + PROFILE POPUP */

function Groups({ state, onJoined, onBack, onHowTo }: { state: PublicState; onJoined: () => Promise<void>; onBack: () => void; onHowTo: () => void }) {
  const s = state.session;
  const [group, setGroup] = useState<number | null>(null);
  const [profile, setProfile] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const overview = new Map(state.groupsOverview.map((g) => [g.groupNumber, g]));
  const closed = s.status === "revealed";

  const blocker = (n: number | null) => {
    if (n == null) return "Please choose your group.";
    const g = overview.get(n);
    if (g?.started) return `Group ${n} has already started its dive. New players can't join mid-game.`;
    if (g && g.members >= g.capacity) return `Group ${n} is full. Please check your group number.`;
    return null;
  };

  const openProfile = (e: FormEvent) => {
    e.preventDefault();
    const b = blocker(group);
    setError(b);
    if (!b) setProfile(true);
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Please enter your name.");
      return;
    }
    setBusy(true);
    setNameError(null);
    try {
      const r = await api<{ token: string | null; sessionId: string }>("/api/join", { method: "POST", body: { groupNumber: group, name: name.trim() } });
      if (r.token) setToken({ sessionId: r.sessionId, token: r.token });
      await onJoined();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Could not reach the server. Check your Wi-Fi and try again.";
      if (err instanceof ApiError && err.code === "name_required") setNameError(msg);
      else {
        setProfile(false);
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center" }}>
      <TitleHeader />
      <form onSubmit={openProfile} className="px-box" style={panelStyle} noValidate>
        <p className="display" style={{ display: "block", fontSize: "clamp(10px, 2.8vw, 12px)", margin: "0 0 14px", color: "var(--yellow)", lineHeight: 1.5 }}>
          Choose your group
        </p>
        <div className="tiles" style={{ ["--cols" as string]: Math.min(4, s.groupCount) }} role="group" aria-label="Choose your group">
          {Array.from({ length: s.groupCount }, (_, i) => i + 1).map((n) => {
            const g = overview.get(n);
            const full = !!g && g.members >= g.capacity;
            const locked = !!g?.started || full;
            return (
              <button
                key={n}
                type="button"
                className={`tile ${locked ? "full" : ""}`}
                aria-pressed={group === n}
                aria-label={`Group ${n}${g ? `, ${g.members} of ${g.capacity} players` : ""}${g?.started ? ", already started" : full ? ", full" : ""}`}
                onClick={() => {
                  setGroup(n);
                  setError(blocker(n));
                }}
              >
                <span className="tile-label">GROUP</span>
                {n}
                <small>{g?.started ? "STARTED" : full ? "FULL" : g ? `${g.members}/${g.capacity}` : ""}</small>
              </button>
            );
          })}
        </div>
        <p id="join-msg" role="alert" className="body-text" style={{ minHeight: 22, margin: "10px 4px 4px", color: "var(--coral)", fontSize: 17 }}>
          {error ?? (closed ? "This game has finished." : "")}
        </p>
        <button className="px-btn coral block" type="submit" disabled={busy || closed} style={{ fontSize: 15, minHeight: 56 }}>
          Join group
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <button type="button" className="link-btn" onClick={onBack}>
            Back
          </button>
          <button type="button" className="link-btn" onClick={onHowTo}>
            How to play
          </button>
        </div>
      </form>

      {profile && (
        <Modal title="Set up your profile" onClose={() => !busy && setProfile(false)} hideClose>
          <form onSubmit={confirm} noValidate>
            <p className="label" style={{ margin: "0 0 12px" }}>
              Group {group}
            </p>
            <label htmlFor="name" className="display" style={{ display: "block", fontSize: 11, color: "var(--foam)", margin: "0 0 10px" }}>
              Enter your name
            </label>
            <input
              id="name"
              className={`px-input ${nameError ? "wrong" : ""}`}
              autoComplete="off"
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              autoFocus
              required
              aria-invalid={!!nameError}
            />
            <p role="alert" className="body-text" style={{ minHeight: 22, margin: "8px 4px 6px", color: "var(--coral)", fontSize: 17 }}>
              {nameError}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="px-btn ghost small-btn" onClick={() => setProfile(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="px-btn coral" disabled={busy}>
                {busy ? "Joining…" : "Confirm"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* =================================================================== LOBBY (group waiting room) */

function Roster({ state, mode, live = true }: { state: PublicState; mode: "lobby" | "play"; live?: boolean }) {
  const g = state.group!;
  const slots = mode === "lobby" ? g.capacity : g.members.length;
  return (
    <div className="roster" style={{ ["--cols" as string]: Math.min(4, Math.max(slots, mode === "lobby" ? 4 : 1)) }}>
      {Array.from({ length: slots }, (_, i) => {
        const m = g.members[i];
        let sub = mode === "lobby" ? "open slot" : "";
        if (m) sub = m.isMe ? "YOU" : mode === "play" ? (!live ? "" : m.doneThisRound ? "✓ got it" : "diving…") : "joined";
        return (
          <div key={m?.diverNumber ?? `e${i}`} className={`slot ${m ? "filled" : ""} ${m?.isMe ? "me" : ""} ${m?.doneThisRound && !m.isMe ? "answered" : ""}`}>
            <SubIcon dim={!m} color={m?.isMe ? "#ffd23f" : "#7fd4ff"} />
            <span className="slot-name">{m ? m.displayName || `Diver ${m.diverNumber}` : "—"}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 13, minHeight: 16, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", whiteSpace: "nowrap" }}>{sub}</span>
          </div>
        );
      })}
    </div>
  );
}

function Lobby({ state, onStarted, onHowTo }: { state: PublicState; onStarted: () => Promise<void>; onHowTo: () => void }) {
  const g = state.group!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/start", { method: "POST" });
      await onStarted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center", justifyContent: "flex-end", paddingBottom: "4dvh" }}>
      <div className="px-box" style={{ width: "min(560px, 100%)", padding: "22px 18px 16px", marginTop: "40dvh" }}>
        <h1 className="display" style={{ margin: 0, fontSize: "clamp(18px, 5vw, 26px)", color: "var(--yellow)", textShadow: "3px 3px 0 var(--navy-900)" }}>
          Group {g.groupNumber}
        </h1>
        <p className="label" aria-live="polite" style={{ margin: "14px 0 12px" }}>
          Players ({g.members.length}/{g.capacity})
        </p>
        <Roster state={state} mode="lobby" />
        <div style={{ marginTop: 18 }}>
          <button className="px-btn coral block" disabled={busy || g.members.length < 1} onClick={start} style={{ fontSize: 15, minHeight: 56 }}>
            {busy ? "Starting…" : "Start game"}
          </button>
        </div>
        <p className="display" style={{ fontSize: 10, margin: "10px 0 4px", textAlign: "center", color: "var(--cyan)", lineHeight: 1.6 }}>
          One press starts the dive for the whole group.
        </p>
        <p className="small" style={{ margin: "0 0 4px", textAlign: "center" }}>
          New players can&apos;t join after the start, so wait for your teammates first.
        </p>
        {error && (
          <p role="alert" className="body-text" style={{ color: "var(--coral)", margin: "6px 4px 0" }}>
            {error}
          </p>
        )}
        <div style={{ textAlign: "center" }}>
          <button type="button" className="link-btn" onClick={onHowTo}>
            How to play
          </button>
        </div>
      </div>
    </div>
  );
}

/* =================================================================== PLAY */

function Hud({ state, depth, onHowTo }: { state: PublicState; depth: number; onHowTo: () => void }) {
  const s = state.session;
  const me = state.me!;
  const g = state.group!;
  const byIdx = new Map(me.results.map((a) => [a.questionIndex, a]));
  const current = Math.min(g.round.index, s.total - 1);
  return (
    <div className="hud px-box" role="region" aria-label="Game status">
      <div className="hud-sec q">
        <span className="label">
          Question {current + 1}/{s.total}
        </span>
        <div className="pips" aria-hidden="true">
          {Array.from({ length: s.total }, (_, i) => {
            const a = byIdx.get(i);
            const cls = a ? (a.isCorrect ? "done-correct" : "done-wrong") : i === g.round.index ? "current" : "";
            return <i key={i} className={`pip ${cls}`} />;
          })}
        </div>
      </div>
      <div className="hud-sec g">
        <span className="label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Group {g.groupNumber} • {me.displayName || `Diver ${me.diverNumber}`}
        </span>
        <span className="v yellow" aria-live="polite">
          Team depth: {g.teamDepth} M
        </span>
      </div>
      <div className="hud-sec right">
        <span className="label">My depth</span>
        <span className="v" data-testid="my-depth">
          {depth} M
        </span>
      </div>
      <button className="px-btn ghost small-btn help" onClick={onHowTo} aria-label="How to play">
        ?
      </button>
    </div>
  );
}

type Phase = "ready" | "intermission" | "answer" | "final" | "closing";

function Play({
  state,
  depth,
  serverNow,
  onResult,
  onWrong,
  onHowTo,
}: {
  state: PublicState;
  depth: number;
  serverNow: () => number;
  onResult: (r: SubmitResult) => void;
  onWrong: () => void;
  onHowTo: () => void;
}) {
  const s = state.session;
  const me = state.me!;
  const r = state.group!.round;
  const q = state.question;
  const now = serverNow();
  const qs = r.questionStartedAt ?? now;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongKey, setWrongKey] = useState(0);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 1100);
    return () => clearTimeout(id);
  }, [flash, wrongKey]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Remember the prompt on screen, to keep it visible while the round closes.
  const [shown, setShown] = useState<{ id: string; prompt: string; categoryLabel: string; order: number; index: number } | null>(null);

  const finished = r.finishedAt != null;
  let phase: Phase;
  if (finished) phase = "intermission";
  else if (now < qs) phase = r.index === 0 && me.results.length === 0 ? "ready" : "intermission";
  else if (r.normalEndsAt != null && now < r.normalEndsAt) phase = "answer";
  else if (r.deadline != null && now < r.deadline) phase = "final";
  else phase = "closing";

  const questionMatches = !!q && q.order === r.index + 1;
  const open = (phase === "answer" || phase === "final") && questionMatches;
  const solved = !!me.currentCorrect && open;
  const canAnswer = open && !solved && !busy;

  if (open && q && shown?.id !== q.id) {
    setShown({ id: q.id, prompt: q.prompt, categoryLabel: q.categoryLabel, order: q.order, index: r.index });
    setText("");
    setError(null);
    setWrongKey(0);
  }

  useEffect(() => {
    if (canAnswer) inputRef.current?.focus({ preventScroll: true });
  }, [canAnswer, q?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!q || !canAnswer) return;
    const value = text.trim();
    if (!value) {
      setError("Please type an answer before submitting.");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<SubmitResult>("/api/answer", { method: "POST", body: { questionId: q.id, answer: value } });
      if (!res.isCorrect) {
        setWrongKey((k) => k + 1);
        setFlash(true);
        onWrong();
      }
      onResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  };

  const lastIdx = finished ? s.total - 1 : r.index - 1;
  const last = me.results.find((a) => a.questionIndex === lastIdx) ?? null;
  const secsLeft = r.normalEndsAt ? Math.max(0, Math.ceil((r.normalEndsAt - now) / 1000)) : null;
  const finalLeft = r.deadline ? Math.max(1, Math.ceil((r.deadline - now) / 1000)) : null;
  const untilNext = Math.max(0, Math.ceil((qs - now) / 1000));
  const frac =
    phase === "answer" && r.normalEndsAt ? Math.max(0, Math.min(1, (r.normalEndsAt - now) / (s.normalSeconds * 1000))) : phase === "final" && r.deadline ? Math.max(0, Math.min(1, (r.deadline - now) / (s.finalSeconds * 1000))) : phase === "ready" ? 1 : 0;
  const card = open ? q : phase === "intermission" || phase === "closing" ? shown : null;
  const wrongNow = wrongKey > 0 && !solved && open && me.currentWrongAttempts > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <Hud state={state} depth={depth} onHowTo={onHowTo} />
      {phase === "final" && !solved && <div className="final-vignette" aria-hidden="true" />}
      <div className="play-spacer" />
      <section
        key={phase === "ready" ? "ready" : card?.id ?? "x"}
        className={`px-box screen-in ${phase === "final" && !solved ? "final-box" : ""}`}
        style={{ width: "min(680px, 100%)", alignSelf: "center", padding: "18px 18px 14px" }}
        aria-labelledby="qtext"
      >
        {phase === "ready" ? (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <p className="label">Question 1 is coming up</p>
            <p className="fb" style={{ color: "var(--yellow)", fontSize: 28, margin: "14px 0" }}>
              Get ready… {untilNext}
            </p>
          </div>
        ) : (
          <>
            {card && (
              <>
                <span className="label" style={{ color: "var(--pink)" }}>
                  {card.categoryLabel}
                </span>
                <h2 id="qtext" style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "clamp(22px, 4.6vw, 30px)", lineHeight: 1.25, margin: "12px 0 16px", color: "var(--white)" }}>
                  {card.prompt}
                </h2>
              </>
            )}
            <div className={`timer ${phase === "final" ? "final" : secsLeft != null && secsLeft <= 5 && phase === "answer" ? "low" : ""}`} aria-hidden="true">
              <i style={{ width: `${frac * 100}%` }} />
            </div>
            <div aria-live="polite" style={{ minHeight: 30, margin: "12px 0 6px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              {phase === "answer" && (
                <p className="label" data-testid="timer" style={{ margin: 0, color: secsLeft != null && secsLeft <= 5 ? "var(--coral)" : "var(--sea-300)" }}>
                  {secsLeft}s left
                </p>
              )}
              {phase === "final" && (
                <p className="label" data-testid="timer" style={{ margin: 0, color: "var(--coral)", display: "flex", alignItems: "center", gap: 14 }}>
                  <span className="final-count" key={finalLeft} aria-live="assertive">
                    {finalLeft}
                  </span>
                  Final countdown!
                </p>
              )}
              {open && !solved && (
                <p className="label" style={{ margin: 0, color: "var(--yellow)", alignSelf: "center" }}>
                  Worth +{phase === "final" ? 10 : now - qs <= 10_000 ? 30 : now - qs <= 20_000 ? 20 : 10} M
                </p>
              )}
            </div>
            {solved && (
              <p className="fb correct" data-testid="fb-correct">
                Correct! +{me.currentCorrect!.depthAwarded} M
              </p>
            )}
            {wrongNow && (
              <p key={wrongKey} className="fb wrong" data-testid="fb-wrong">
                Not quite! Try again. +0 M
              </p>
            )}
            {phase === "intermission" && last && (
              <p className={`fb ${last.isCorrect ? "correct" : "timeout"}`} data-testid={last.isCorrect ? "fb-correct" : "fb-timeout"}>
                {last.isCorrect ? `Correct! +${last.depthAwarded} M` : "Time's up. +0 M"}
              </p>
            )}
            {phase === "closing" && <p className="fb timeout">{me.currentCorrect ? `Correct! +${me.currentCorrect.depthAwarded} M` : "Time's up!"}</p>}
            {open && !solved && (
              <form key={`f${wrongKey}`} onSubmit={submit} className={wrongKey > 0 ? "bounce" : ""} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                <label htmlFor="answer" className="sr-only">
                  Your answer
                </label>
                <input
                  ref={inputRef}
                  id="answer"
                  className={`px-input ${wrongNow && flash ? "wrong" : ""}`}
                  style={{ flex: "1 1 160px", width: "auto", minWidth: 0 }}
                  placeholder="Type your answer"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="send"
                  maxLength={MAX_ANSWER_LENGTH}
                  value={text}
                  disabled={!open || solved}
                  readOnly={busy}
                  autoFocus
                  onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-describedby="answer-err"
                  aria-invalid={wrongNow}
                />
                <button className="px-btn" type="submit" disabled={!canAnswer} style={{ flex: "0 0 auto" }}>
                  {busy ? "…" : "Submit"}
                </button>
              </form>
            )}
            <p id="answer-err" role="alert" className="body-text" style={{ color: "var(--coral)", margin: "6px 4px 0", minHeight: error ? 24 : 0 }}>
              {error}
            </p>
            {(solved || phase === "intermission" || phase === "closing") && (
              <p className="display" style={{ fontSize: 10, color: "var(--sea-300)", margin: "8px 0 12px", lineHeight: 1.7 }}>
                {finished ? "Surfacing" : solved ? "Waiting for your teammates" : phase === "closing" ? "Loading the next question" : `Next question in ${untilNext}`}
                <span className="dots" />
              </p>
            )}
          </>
        )}
        <p className="label" style={{ margin: "8px 0 10px" }}>
          Your team
        </p>
        <Roster state={state} mode="play" live={open} />
      </section>
      <div style={{ height: 8 }} />
    </div>
  );
}

/* =================================================================== COMPLETE (group finished, results still hidden) */

function MyStats({ state, depth }: { state: PublicState; depth: number }) {
  const me = state.me!;
  const g = state.group!;
  const s = state.session;
  const correct = me.results.filter((x) => x.isCorrect).length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
      {[
        ["Correct", `${correct}/${s.total}`],
        ["My depth", `${depth} M`],
        [`Group ${g.groupNumber} depth`, `${g.teamDepth} M`],
      ].map(([k, v]) => (
        <div key={k} className="slot filled" style={{ padding: "14px 6px" }}>
          <span className="label" style={{ fontSize: 8 }}>
            {k}
          </span>
          <span className="display" style={{ fontSize: "clamp(13px, 3.4vw, 18px)", color: "var(--white)" }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

function Complete({ state, depth }: { state: PublicState; depth: number }) {
  const s = state.session;
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: "30dvh", paddingBottom: 24 }}>
      <section className="px-box" style={{ width: "min(640px, 100%)", padding: "22px 18px" }}>
        <h1 className="display" style={{ fontSize: "clamp(16px, 4.4vw, 24px)", margin: 0, color: "var(--yellow)", textShadow: "3px 3px 0 var(--navy-900)", lineHeight: 1.4 }}>
          Ocean Dive complete!
        </h1>
        <p className="display" style={{ fontSize: "clamp(12px, 3.2vw, 16px)", margin: "14px 0 18px", color: "var(--cyan)" }}>
          Your depth: {depth} M
        </p>
        <MyStats state={state} depth={depth} />
        <p className="display bob" style={{ fontSize: 10, margin: "22px 0 12px", color: "var(--cyan)", lineHeight: 1.7, textAlign: "center" }}>
          Waiting for all teams to finish<span className="dots" />
        </p>
        <div className="lb-bar" style={{ height: 14 }} aria-hidden="true">
          <i style={{ width: `${(s.groupsFinished / Math.max(1, s.groupCount)) * 100}%`, background: "var(--yellow)" }} />
        </div>
        <p className="label" style={{ margin: "10px 0 0", textAlign: "center" }} aria-live="polite">
          {s.groupsFinished} of {s.groupCount} teams finished
        </p>
        <p className="small" style={{ margin: "14px 0 0", textAlign: "center" }}>
          The final results appear on the host&apos;s screen. Other teams&apos; depths stay secret until then.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          <Link className="px-btn coral" href="/history" style={{ flex: "1 1 240px" }}>
            View answer history
          </Link>
        </div>
      </section>
    </div>
  );
}

/* =================================================================== RESULTS (automatic reveal) */

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "ST" : n % 10 === 2 && n % 100 !== 12 ? "ND" : n % 10 === 3 && n % 100 !== 13 ? "RD" : "TH"}`;

export function Leaderboard({ rows, myGroup, animate = false, big = false }: { rows: LeaderboardRow[]; myGroup?: number; animate?: boolean; big?: boolean }) {
  const top = Math.max(1, ...rows.map((r) => r.totalDepth));
  const n = rows.length;
  return (
    <div className={big ? "lb-big" : ""}>
      {rows.map((r, i) => {
        const delay = (n - 1 - i) * 0.7;
        return (
          <div
            key={r.groupNumber}
            className={`lb-row ${myGroup === r.groupNumber ? "mine" : ""} ${r.rank === 1 ? "first" : ""} ${r.members === 0 ? "empty" : ""} ${animate ? "reveal-row" : ""}`}
            style={animate ? { animationDelay: `${delay}s` } : undefined}
            data-testid="lb-row"
          >
            <span className="lb-rank">{r.rank ?? "–"}</span>
            <div>
              <div className="display lb-name">
                {r.rank ? `${ordinal(r.rank)} place — ` : ""}Group {r.groupNumber}
                {myGroup === r.groupNumber && <span style={{ color: "var(--yellow)" }}> (you)</span>}
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {r.members > 0 ? `${r.members} diver${r.members === 1 ? "" : "s"}` : "No divers joined"}
              </div>
              {r.members > 0 && (
                <div className="lb-bar" aria-hidden="true">
                  <i className={animate ? "grow" : ""} style={{ width: `${(r.totalDepth / top) * 100}%`, animationDelay: animate ? `${delay + 0.2}s` : undefined }} />
                </div>
              )}
            </div>
            <span className="display lb-depth" style={{ textAlign: "right" }}>
              {r.members > 0 ? `${r.totalDepth} M` : "—"}
              <br />
              <span style={{ fontSize: 8, color: "var(--sea-300)" }}>total depth</span>
            </span>
          </div>
        );
      })}
      <p className="small" style={{ margin: "4px 4px 0" }}>
        Ranked by total group depth (every diver&apos;s meters added together). Equal totals share a place.
      </p>
    </div>
  );
}

export function winnerBanner(rows: LeaderboardRow[]) {
  const winners = rows.filter((r) => r.rank === 1);
  return winners.length === 0
    ? "Final results"
    : winners.length === 1
      ? `Group ${winners[0].groupNumber} wins!`
      : `It's a tie! Groups ${winners.map((w) => w.groupNumber).join(" & ")}`;
}

function Results({ state, depth }: { state: PublicState; depth: number }) {
  const rows = state.leaderboard ?? [];
  const n = rows.length;
  const mineWon = rows.some((w) => w.rank === 1 && w.groupNumber === state.me?.groupNumber);
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: "24dvh", paddingBottom: 24 }}>
      <section className="px-box" style={{ width: "min(640px, 100%)", padding: "22px 16px 18px", overflow: "hidden" }} aria-labelledby="lb-h">
        <p className="label" style={{ margin: 0 }}>
          Ocean Dive • final results
        </p>
        <h1 id="lb-h" className="display winner-banner" style={{ animationDelay: `${n * 0.7}s` }}>
          {winnerBanner(rows)}
        </h1>
        {mineWon && (
          <p className="display winner-banner sub" style={{ animationDelay: `${n * 0.7 + 0.3}s` }}>
            That&apos;s your team. Brilliant diving!
          </p>
        )}
        <Leaderboard rows={rows} myGroup={state.me?.groupNumber} animate />
      </section>
      <section className="px-box" style={{ width: "min(640px, 100%)", padding: "20px 18px" }}>
        <p className="label" style={{ margin: "0 0 12px" }}>
          Group {state.me!.groupNumber} • {state.me!.displayName || `Diver ${state.me!.diverNumber}`}
        </p>
        <MyStats state={state} depth={depth} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
          <Link className="px-btn coral" href="/history" style={{ flex: "1 1 240px" }}>
            View answer history
          </Link>
        </div>
      </section>
    </div>
  );
}
