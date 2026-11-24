"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, setToken, useLiveState, useTicker } from "@/lib/client";
import { MAX_ANSWER_LENGTH, MAX_NAME_LENGTH } from "@/lib/config";
import type { PublicState, SubmitResult } from "@/lib/types";
import OceanScene, { type SceneFeedback } from "./OceanScene";
import { HowToPlay, SubIcon } from "./PixelBits";

type View = "loading" | "landing" | "lobby" | "play" | "waiting" | "results";

function viewOf(state: PublicState | null, now: number): View {
  if (!state) return "loading";
  const me = state.me;
  if (!me) return "landing";
  if (!me.started) return "lobby";
  const inFinalFeedback = me.questionStartedAt != null && now < me.questionStartedAt;
  if (me.finished && !inFinalFeedback) return state.session.status === "revealed" ? "results" : "waiting";
  return "play";
}

export default function Game() {
  const { state, setState, refresh, offline, serverNow } = useLiveState();
  const [feedback, setFeedback] = useState<SceneFeedback>(null);
  const [howTo, setHowTo] = useState(false);
  // Personal depth can only increase within a game; ignore stale polls that arrive late.
  const [floor, setFloor] = useState({ sid: "", d: 0 });
  // Trigger dive / stay-put feedback when a NEW answer (or timeout) appears — not on page load.
  const [seen, setSeen] = useState<{ sid: string; n: number } | null>(null);

  const s = state?.session;
  const me = state?.me ?? null;
  let depth = me?.personalDepth ?? 0;
  if (s && me) {
    depth = Math.max(depth, floor.sid === s.id ? floor.d : 0);
    if (floor.sid !== s.id || floor.d !== depth) setFloor({ sid: s.id, d: depth });
  }
  if (s && me) {
    const n = me.answers.length;
    if (!seen || seen.sid !== s.id) setSeen({ sid: s.id, n });
    else if (n > seen.n) {
      const last = me.answers[n - 1];
      setSeen({ sid: s.id, n });
      setFeedback({ kind: last.isCorrect ? "correct" : last.status === "timeout" ? "timeout" : "wrong", key: Date.now() });
    }
  }

  useTicker(!!me?.started, 200);
  const view = viewOf(state, serverNow());
  const inGame = view !== "landing" && view !== "loading";

  return (
    <>
      <OceanScene mode={inGame ? "game" : "landing"} depth={depth} feedback={feedback} showGauge={inGame} metersPerCorrect={s?.metersPerCorrect ?? 100} />
      <main className={`app ${inGame ? "with-gauge" : ""}`}>
        {offline && (
          <div role="status" className="hud-chip" style={{ position: "fixed", bottom: 12, right: 12, zIndex: 40, flexDirection: "row" }}>
            <span className="label" style={{ color: "var(--coral)" }}>
              Reconnecting<span className="dots" />
            </span>
          </div>
        )}
        {view === "loading" && <Loading />}
        {view === "landing" && state && <Landing state={state} onJoined={refresh} onHowTo={() => setHowTo(true)} />}
        {view === "lobby" && state && <Lobby state={state} onStarted={refresh} onHowTo={() => setHowTo(true)} />}
        {view === "play" && state && (
          <Play
            state={state}
            depth={depth}
            serverNow={serverNow}
            onResult={(r) => {
              // Optimistically apply the server's answer result; the next poll confirms it.
              setState((prev) => {
                if (!prev?.me || !prev.group) return prev;
                const idx = prev.me.index;
                const next = idx + 1;
                const answers = prev.me.answers.some((a) => a.questionIndex === idx)
                  ? prev.me.answers
                  : [...prev.me.answers, { questionIndex: idx, status: r.status, isCorrect: r.isCorrect, depthAfter: r.personalDepthAfter }];
                return {
                  ...prev,
                  me: {
                    ...prev.me,
                    answers,
                    index: next,
                    finished: next >= prev.session.total,
                    questionStartedAt: serverNow() + prev.session.feedbackSeconds * 1000,
                    deadline: null,
                    personalCorrect: r.personalCorrect,
                    personalDepth: r.personalDepthAfter,
                  },
                  group: { ...prev.group, credits: Math.max(prev.group.credits, r.groupCredits) },
                };
              });
              refresh();
            }}
            onHowTo={() => setHowTo(true)}
          />
        )}
        {view === "waiting" && state && <Waiting state={state} />}
        {view === "results" && state && <Results state={state} />}
      </main>
      {howTo && <HowToPlay onClose={() => setHowTo(false)} />}
    </>
  );
}

function Loading() {
  return (
    <div style={{ margin: "auto", textAlign: "center" }}>
      <p className="display" style={{ fontSize: 12, color: "var(--navy-800)" }}>
        Loading the ocean<span className="dots" />
      </p>
    </div>
  );
}

/* =================================================================== LANDING */

function Landing({ state, onJoined, onHowTo }: { state: PublicState; onJoined: () => Promise<void>; onHowTo: () => void }) {
  const s = state.session;
  const [group, setGroup] = useState("");
  const [name, setName] = useState("");
  const [showName, setShowName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const overview = new Map(state.groupsOverview.map((g) => [g.groupNumber, g]));
  const closed = s.status === "revealed";

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const n = Number(group.trim());
    if (!/^\d{1,2}$/.test(group.trim()) || n < 1 || n > s.groupCount) {
      setError(`Please choose a group number from 1 to ${s.groupCount}.`);
      return;
    }
    const g = overview.get(n);
    if (g && g.members >= g.capacity) {
      setError(`Group ${n} is full. Please confirm your group number.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ token: string | null; sessionId: string }>("/api/join", {
        method: "POST",
        body: { groupNumber: n, name: name.trim() || undefined },
      });
      if (r.token) setToken({ sessionId: r.sessionId, token: r.token });
      await onJoined();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Check your Wi-Fi and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center" }}>
      <header style={{ minHeight: "36dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 14, paddingTop: 8 }}>
        <span className="kicker">The coastal knowledge dive</span>
        <h1 className="title landing-title">
          <span>OCEAN</span> <span className="alt">DIVE</span>
        </h1>
        <p className="subtitle">How deep does your ocean knowledge go?</p>
      </header>

      <form onSubmit={join} className="px-box" style={{ width: "min(520px, 100%)", padding: "18px 16px 10px", marginTop: "max(12px, calc(14dvh - 16px))" }} noValidate>
        <label htmlFor="group" className="display" style={{ display: "block", fontSize: "clamp(10px, 2.8vw, 12px)", marginBottom: 14, color: "var(--yellow)", lineHeight: 1.5 }}>
          Choose your group <span style={{ whiteSpace: "nowrap" }}>(1–{s.groupCount})</span>
        </label>
        <div className="tiles" style={{ ["--cols" as string]: Math.min(4, s.groupCount) }} role="group" aria-label="Choose your group">
          {Array.from({ length: s.groupCount }, (_, i) => i + 1).map((n) => {
            const g = overview.get(n);
            const full = !!g && g.members >= g.capacity;
            return (
              <button
                key={n}
                type="button"
                className={`tile ${full ? "full" : ""}`}
                aria-pressed={group === String(n)}
                aria-label={`Group ${n}${g ? `, ${g.members} of ${g.capacity} players` : ""}${full ? ", full" : ""}`}
                onClick={() => {
                  setGroup(String(n));
                  setError(full ? `Group ${n} is full. Please confirm your group number.` : null);
                }}
              >
                {n}
                <small>{full ? "FULL" : g ? `${g.members}/${g.capacity}` : ""}</small>
              </button>
            );
          })}
        </div>
        <div className="join-fields">
          <input
            id="group"
            className="px-input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            placeholder={`Or type it: 1–${s.groupCount}`}
            value={group}
            onChange={(e) => {
              setGroup(e.target.value.replace(/[^\d]/g, ""));
              setError(null);
            }}
            aria-invalid={!!error}
            aria-describedby="join-msg"
          />
          {showName ? (
            <input
              id="name"
              className="px-input"
              autoComplete="off"
              maxLength={MAX_NAME_LENGTH}
              placeholder="Diver name (optional)"
              aria-label="Diver name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          ) : (
            <button type="button" className="link-btn" style={{ justifySelf: "start", color: "var(--sea-300)" }} onClick={() => setShowName(true)}>
              + Add a diver name (optional)
            </button>
          )}
        </div>
        <p id="join-msg" role="alert" className="body-text" style={{ minHeight: 22, margin: "8px 4px 4px", color: "var(--coral)", fontSize: 17 }}>
          {error ?? (closed ? "This game has finished. A new game will open soon." : "")}
        </p>
        <button className="px-btn coral block" type="submit" disabled={busy || closed} style={{ fontSize: 15, minHeight: 56 }}>
          {busy ? "Joining…" : "Join group"}
        </button>
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <button type="button" className="link-btn" onClick={onHowTo}>
            How to play
          </button>
        </div>
      </form>
    </div>
  );
}

/* =================================================================== LOBBY (group waiting room) */

function Roster({ state, mode }: { state: PublicState; mode: "lobby" | "play" }) {
  const g = state.group!;
  const total = state.session.total;
  return (
    <div className="roster" style={{ ["--cols" as string]: Math.min(4, g.capacity) }}>
      {Array.from({ length: g.capacity }, (_, i) => i + 1).map((n) => {
        const m = g.members.find((x) => x.diverNumber === n);
        let sub = "empty";
        if (m) {
          if (m.isMe) sub = "YOU";
          else if (m.finished) sub = "finished";
          else if (m.started) sub = mode === "play" ? `Q${Math.min(m.progress + 1, total)}/${total}` : "diving";
          else sub = m.displayName || "ready";
        }
        return (
          <div key={n} className={`slot ${m ? "filled" : ""} ${m?.isMe ? "me" : ""} ${m?.finished && !m.isMe ? "answered" : ""}`}>
            <SubIcon dim={!m} color={m?.isMe ? "#ffd23f" : "#7fd4ff"} />
            <span>DIVER {n}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 13, minHeight: 16, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", whiteSpace: "nowrap" }}>{sub}</span>
          </div>
        );
      })}
    </div>
  );
}

function Lobby({ state, onStarted, onHowTo }: { state: PublicState; onStarted: () => Promise<void>; onHowTo: () => void }) {
  const g = state.group!;
  const me = state.me!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = g.capacity - g.members.length;

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
        <p className="label" style={{ margin: 0 }}>
          You are Diver {me.diverNumber}
          {me.displayName ? ` · ${me.displayName}` : ""}
        </p>
        <p className="display" aria-live="polite" style={{ margin: "10px 0 16px", fontSize: "clamp(13px, 3.4vw, 16px)", color: "var(--yellow)", lineHeight: 1.5 }}>
          Group {g.groupNumber} — {g.members.length} of {g.capacity} players joined
        </p>
        <Roster state={state} mode="lobby" />
        <div style={{ marginTop: 18 }}>
          <button className="px-btn coral block" disabled={!g.ready || busy} onClick={start} style={{ fontSize: 15, minHeight: 56 }}>
            {busy ? "Starting…" : "Start game"}
          </button>
        </div>
        <p className={`display ${g.ready ? "" : "bob"}`} style={{ fontSize: 10, margin: "10px 0 4px", textAlign: "center", color: g.ready ? "var(--cyan)" : "var(--sea-300)", lineHeight: 1.6 }}>
          {g.ready ? (
            "Your group is ready! Start when you are."
          ) : (
            <>
              Waiting for {missing} more diver{missing === 1 ? "" : "s"}
              <span className="dots" />
            </>
          )}
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
  const byIdx = new Map(me.answers.map((a) => [a.questionIndex, a]));
  const current = Math.min(me.index, s.total - 1);
  return (
    <div className="hud px-box" role="region" aria-label="Game status">
      <div className="hud-sec q">
        <span className="label">
          Question {current + 1}/{s.total}
        </span>
        <div className="pips" aria-hidden="true">
          {Array.from({ length: s.total }, (_, i) => {
            const a = byIdx.get(i);
            const cls = a ? (a.isCorrect ? "done-correct" : "done-wrong") : i === me.index ? "current" : "";
            return <i key={i} className={`pip ${cls}`} />;
          })}
        </div>
      </div>
      <div className="hud-sec g">
        <span className="label">
          Group {g.groupNumber} • Diver {me.diverNumber}
        </span>
        <span className="v yellow" aria-live="polite">
          Group credits: {g.credits}
        </span>
      </div>
      <div className="hud-sec right">
        <span className="label">My depth</span>
        <span className="v">{depth} M</span>
      </div>
      <button className="px-btn ghost small-btn help" onClick={onHowTo} aria-label="How to play">
        ?
      </button>
    </div>
  );
}

function ResultLine({ status, isCorrect }: { status: "answered" | "timeout"; isCorrect: boolean }) {
  if (status === "timeout") return <p className="fb timeout">Time&apos;s up. +0 credit</p>;
  return isCorrect ? <p className="fb correct">Correct! +1 group credit</p> : <p className="fb wrong">Not quite. +0 credit</p>;
}

function Play({
  state,
  depth,
  serverNow,
  onResult,
  onHowTo,
}: {
  state: PublicState;
  depth: number;
  serverNow: () => number;
  onResult: (r: SubmitResult) => void;
  onHowTo: () => void;
}) {
  const s = state.session;
  const me = state.me!;
  const q = state.question;
  const now = serverNow();
  const qs = me.questionStartedAt ?? now;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Remember the prompt that was answered, to keep it on screen during the result pause.
  const [shown, setShown] = useState<{ id: string; prompt: string; categoryLabel: string; order: number } | null>(null);

  const phase: "ready" | "feedback" | "answer" | "timeup" =
    now < qs ? (me.index === 0 && me.answers.length === 0 ? "ready" : "feedback") : me.deadline != null && now < me.deadline ? "answer" : "timeup";
  const questionMatches = !!q && q.order === me.index + 1;
  const canAnswer = phase === "answer" && questionMatches && !busy;

  if (phase === "answer" && q && questionMatches && shown?.id !== q.id) {
    setShown({ id: q.id, prompt: q.prompt, categoryLabel: q.categoryLabel, order: q.order });
    setText("");
    setError(null);
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
      onResult(await api<SubmitResult>("/api/answer", { method: "POST", body: { questionId: q.id, answer: value } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const last = me.answers.find((a) => a.questionIndex === me.index - 1) ?? null;
  const secsLeft = me.deadline ? Math.max(0, Math.ceil((me.deadline - now) / 1000)) : null;
  const untilNext = Math.max(0, Math.ceil((qs - now) / 1000));
  const frac = phase === "answer" && me.deadline ? Math.max(0, Math.min(1, (me.deadline - now) / (s.questionSeconds * 1000))) : phase === "ready" ? 1 : 0;
  const card = phase === "answer" ? q : phase === "feedback" || phase === "timeup" ? shown : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <Hud state={state} depth={depth} onHowTo={onHowTo} />
      <div className="play-spacer" />
      <section key={phase === "ready" ? "ready" : card?.id ?? "x"} className="px-box screen-in" style={{ width: "min(680px, 100%)", alignSelf: "center", padding: "18px 18px 14px" }} aria-labelledby="qtext">
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
            <div className={`timer ${secsLeft != null && secsLeft <= 5 && phase === "answer" ? "low" : ""}`} aria-hidden="true">
              <i style={{ width: `${frac * 100}%` }} />
            </div>
            <div aria-live="polite" style={{ minHeight: 30, margin: "12px 0 6px" }}>
              {phase === "answer" && (
                <p className="label" style={{ margin: 0, color: secsLeft != null && secsLeft <= 5 ? "var(--coral)" : "var(--sea-300)" }}>
                  {secsLeft}s left
                </p>
              )}
              {phase === "feedback" && last && <ResultLine status={last.status} isCorrect={last.isCorrect} />}
              {phase === "timeup" && <p className="fb timeout">Time&apos;s up. +0 credit</p>}
            </div>
            {phase === "answer" && (
              <form onSubmit={submit} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <label htmlFor="answer" className="sr-only">
                  Your answer
                </label>
                <input
                  ref={inputRef}
                  id="answer"
                  className="px-input"
                  style={{ flex: "1 1 160px", width: "auto", minWidth: 0 }}
                  placeholder="Type your answer"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="send"
                  maxLength={MAX_ANSWER_LENGTH}
                  value={text}
                  disabled={!canAnswer}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-describedby="answer-err"
                />
                <button className="px-btn" type="submit" disabled={!canAnswer} style={{ flex: "0 0 auto" }}>
                  {busy ? "…" : "Submit"}
                </button>
              </form>
            )}
            <p id="answer-err" role="alert" className="body-text" style={{ color: "var(--coral)", margin: "6px 4px 0", minHeight: error ? 24 : 0 }}>
              {error}
            </p>
            {phase !== "answer" && (
              <p className="display" style={{ fontSize: 10, color: "var(--sea-300)", margin: "8px 0 12px", lineHeight: 1.7 }}>
                {me.finished ? "Surfacing" : phase === "timeup" ? "Loading the next question" : `Next question in ${untilNext}`}
                <span className="dots" />
              </p>
            )}
          </>
        )}
        <p className="label" style={{ margin: "8px 0 10px" }}>
          Your team
        </p>
        <Roster state={state} mode="play" />
      </section>
      <div style={{ height: 8 }} />
    </div>
  );
}

/* =================================================================== WAITING (finished, results still hidden) */

function MyStats({ state }: { state: PublicState }) {
  const me = state.me!;
  const g = state.group!;
  const s = state.session;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
      {[
        ["Correct", `${me.personalCorrect}/${s.total}`],
        ["My depth", `${me.personalDepth} M`],
        [`Group ${g.groupNumber} credits`, `${g.credits}`],
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

function Waiting({ state }: { state: PublicState }) {
  const s = state.session;
  const notJoined = Math.max(0, s.expected - s.joined);
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: "30dvh", paddingBottom: 24 }}>
      <section className="px-box" style={{ width: "min(640px, 100%)", padding: "22px 18px" }}>
        <h1 className="display" style={{ fontSize: "clamp(16px, 4.4vw, 24px)", margin: 0, color: "var(--yellow)", textShadow: "3px 3px 0 var(--navy-900)", lineHeight: 1.4 }}>
          Great job!
        </h1>
        <p className="body-text" style={{ margin: "10px 0 18px" }}>
          You&apos;ve completed the Ocean Dive Challenge.
        </p>
        <MyStats state={state} />
        <p className="display bob" style={{ fontSize: 10, margin: "22px 0 12px", color: "var(--cyan)", lineHeight: 1.7, textAlign: "center" }}>
          Waiting for everyone to finish before revealing the final results<span className="dots" />
        </p>
        <div className="lb-bar" style={{ height: 14 }} aria-hidden="true">
          <i style={{ width: `${(s.finished / Math.max(1, s.expected)) * 100}%`, background: "var(--yellow)" }} />
        </div>
        <p className="label" style={{ margin: "10px 0 0", textAlign: "center" }} aria-live="polite">
          {s.finished} of {s.expected} divers finished
          {notJoined > 0 ? ` · ${notJoined} still to join` : ""}
        </p>
        <p className="small" style={{ margin: "14px 0 0", textAlign: "center" }}>
          The leaderboard appears here automatically. Keep this page open.
        </p>
      </section>
    </div>
  );
}

/* =================================================================== RESULTS (automatic reveal) */

export function Leaderboard({ state, animate = false }: { state: PublicState; animate?: boolean }) {
  const rows = state.leaderboard ?? [];
  const top = Math.max(1, ...rows.map((r) => r.maxCredits));
  const n = rows.length;
  return (
    <div>
      {rows.map((r, i) => {
        const delay = (n - 1 - i) * 0.7;
        return (
          <div
            key={r.groupNumber}
            className={`lb-row ${state.me?.groupNumber === r.groupNumber ? "mine" : ""} ${r.rank === 1 ? "first" : ""} ${r.members === 0 ? "empty" : ""} ${animate ? "reveal-row" : ""}`}
            style={animate ? { animationDelay: `${delay}s` } : undefined}
          >
            <span className="lb-rank">{r.rank ?? "–"}</span>
            <div>
              <div className="display" style={{ fontSize: 12 }}>
                Group {r.groupNumber}
                {state.me?.groupNumber === r.groupNumber && <span style={{ color: "var(--yellow)" }}> (you)</span>}
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {r.members > 0 ? `${r.members} diver${r.members === 1 ? "" : "s"} · ${Math.round(r.accuracy * 100)}% correct` : "No divers joined"}
              </div>
              {r.members > 0 && (
                <div className="lb-bar" aria-hidden="true">
                  <i className={animate ? "grow" : ""} style={{ width: `${(r.credits / top) * 100}%`, animationDelay: animate ? `${delay + 0.2}s` : undefined }} />
                </div>
              )}
            </div>
            <span className="display" style={{ fontSize: 13, textAlign: "right" }}>
              {r.members > 0 ? `${r.credits}/${r.maxCredits}` : "—"}
              <br />
              <span style={{ fontSize: 8, color: "var(--sea-300)" }}>credits</span>
            </span>
          </div>
        );
      })}
      <p className="small" style={{ margin: "4px 4px 0" }}>
        Ranked by total group credits (every diver&apos;s correct answers added together). Equal totals share a rank.
      </p>
    </div>
  );
}

function Results({ state }: { state: PublicState }) {
  const rows = state.leaderboard ?? [];
  const winners = rows.filter((r) => r.rank === 1);
  const n = rows.length;
  const mineWon = winners.some((w) => w.groupNumber === state.me?.groupNumber);
  const banner =
    winners.length === 0
      ? "Final results"
      : winners.length === 1
        ? `Group ${winners[0].groupNumber} wins!`
        : `It's a tie! Groups ${winners.map((w) => w.groupNumber).join(" & ")}`;
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, paddingTop: "24dvh", paddingBottom: 24 }}>
      <section className="px-box" style={{ width: "min(640px, 100%)", padding: "22px 16px 18px", overflow: "hidden" }} aria-labelledby="lb-h">
        <p className="label" style={{ margin: 0 }}>
          Dive complete • final group leaderboard
        </p>
        <h1 id="lb-h" className="display winner-banner" style={{ animationDelay: `${n * 0.7}s` }}>
          {banner}
        </h1>
        {mineWon && (
          <p className="display winner-banner sub" style={{ animationDelay: `${n * 0.7 + 0.3}s` }}>
            That&apos;s your team. Brilliant diving!
          </p>
        )}
        <Leaderboard state={state} animate />
      </section>
      <section className="px-box" style={{ width: "min(640px, 100%)", padding: "20px 18px" }}>
        <p className="label" style={{ margin: "0 0 12px" }}>
          Group {state.me!.groupNumber} • Diver {state.me!.diverNumber}
        </p>
        <MyStats state={state} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
          <Link className="px-btn coral" href="/history" style={{ flex: "1 1 240px" }}>
            View answer history
          </Link>
        </div>
      </section>
    </div>
  );
}
