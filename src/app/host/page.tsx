"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Leaderboard, winnerBanner } from "@/components/Game";
import OceanScene from "@/components/OceanScene";
import { SubIcon } from "@/components/PixelBits";
import { POLL_MS } from "@/lib/config";
import type { HostState } from "@/lib/types";

type Auth = "checking" | "login" | "in";

async function hostFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok, status: res.status, data: data as T & { error?: string } };
}

export default function HostPage() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [state, setState] = useState<HostState | null>(null);
  const [offline, setOffline] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await hostFetch<HostState & { code?: string }>("/api/host/state");
      setProblem(r.data.code === "db_not_configured" || r.data.code === "db_unreachable" ? (r.data.error ?? null) : null);
      if (r.status === 401) {
        setAuth("login");
        setState(null);
      } else if (r.ok) {
        setAuth("in");
        setState(r.data);
      }
      setOffline(!r.ok && r.status !== 401);
    } catch {
      setOffline(true);
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(() => {
      if (auth !== "login" && !document.hidden) refresh();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh, auth]);

  const revealed = state?.status === "revealed" && !!state.leaderboard;

  return (
    <>
      <OceanScene mode="landing" depth={0} />
      <main className="app">
        {offline && (
          <div role="status" className="hud-chip" style={{ position: "fixed", bottom: 12, right: 12, zIndex: 40, flexDirection: "row" }}>
            <span className="label" style={{ color: "var(--coral)" }}>
              Reconnecting<span className="dots" />
            </span>
          </div>
        )}
        {auth === "checking" && (
          <div style={{ margin: "auto", textAlign: "center" }}>
            <p className="display" style={{ fontSize: 12, color: "var(--navy-800)" }}>
              Loading the ocean<span className="dots" />
            </p>
            {problem && (
              <div className="px-box" role="alert" style={{ padding: "16px 16px 12px", marginTop: 18, textAlign: "left", maxWidth: 560 }}>
                <p className="display" style={{ fontSize: 10, color: "var(--coral)", margin: "0 0 10px", lineHeight: 1.6 }}>
                  The game server isn&apos;t ready
                </p>
                <p className="body-text" style={{ margin: 0 }}>
                  {problem}
                </p>
              </div>
            )}
          </div>
        )}
        {auth === "login" && <Login onIn={refresh} />}
        {auth === "in" && state && !revealed && <HostWaiting state={state} onNewGame={refresh} />}
        {auth === "in" && state && revealed && <HostResults state={state} onNewGame={refresh} />}
      </main>
    </>
  );
}

function Header({ kicker, subtitle }: { kicker: string; subtitle?: string }) {
  return (
    <header style={{ minHeight: "30dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 14, paddingTop: 8 }}>
      <span className="kicker">{kicker}</span>
      <h1 className="title landing-title">
        <span>OCEAN</span> <span className="alt">DIVE</span>
      </h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </header>
  );
}

function Login({ onIn }: { onIn: () => Promise<void> }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw) {
      setError("Please enter the host password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await hostFetch<{ ok: boolean }>("/api/host/login", { method: "POST", body: { password: pw } });
      if (r.ok) {
        setPw("");
        await onIn();
      } else {
        setError(r.data.error || "Incorrect host password.");
        setShakeKey((k) => k + 1);
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center" }}>
      <Header kicker="Host" subtitle="Present the final results" />
      <form onSubmit={submit} className="px-box" style={{ width: "min(520px, 100%)", padding: "18px 16px 10px", marginTop: "max(12px, calc(14dvh - 16px))" }} noValidate>
        <label htmlFor="host-pw" className="display" style={{ display: "block", fontSize: "clamp(10px, 2.8vw, 12px)", marginBottom: 14, color: "var(--yellow)", lineHeight: 1.5 }}>
          Host password
        </label>
        <div key={shakeKey} className={shakeKey ? "bounce" : ""}>
          <input
            id="host-pw"
            type="password"
            className={`px-input ${error && shakeKey ? "wrong" : ""}`}
            autoComplete="current-password"
            placeholder="Enter password"
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setError(null);
            }}
            autoFocus
            aria-invalid={!!error}
            aria-describedby="host-msg"
          />
        </div>
        <p id="host-msg" role="alert" className="body-text" style={{ minHeight: 22, margin: "8px 4px 4px", color: "var(--coral)", fontSize: 17 }}>
          {error}
        </p>
        <button className="px-btn coral block" type="submit" disabled={busy} style={{ fontSize: 15, minHeight: 56 }}>
          {busy ? "Checking…" : "Enter"}
        </button>
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <Link href="/" className="link-btn">
            Back
          </Link>
        </div>
      </form>
    </div>
  );
}

function NewGameLink({ onDone }: { onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="link-btn"
      style={{ color: "var(--sea-300)", fontSize: 8 }}
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Start a NEW game? All groups, players and depths of the current game will be cleared.")) return;
        setBusy(true);
        try {
          await hostFetch("/api/host/new-game", { method: "POST" });
          await onDone();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Opening…" : "Reset: start a new game"}
    </button>
  );
}

function HostWaiting({ state, onNewGame }: { state: HostState; onNewGame: () => Promise<void> }) {
  const anyStarted = state.groups.some((g) => g.started);
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "center" }}>
      <Header kicker="The coastal knowledge dive" />
      <section className="px-box" style={{ width: "min(760px, 100%)", padding: "22px 18px 12px", marginTop: "max(12px, calc(12dvh - 16px))", textAlign: "center" }}>
        <p className="display" style={{ fontSize: "clamp(13px, 2.2vw, 20px)", margin: "0 0 14px", color: "var(--yellow)", textShadow: "3px 3px 0 var(--navy-900)", lineHeight: 1.5 }}>
          {anyStarted ? "The challenge is in progress" : "The game is open!"}
        </p>
        <p className="display bob" role="status" style={{ fontSize: "clamp(10px, 1.5vw, 14px)", margin: "0 0 20px", color: "var(--cyan)", lineHeight: 1.7 }}>
          {anyStarted ? "Waiting for all teams to finish" : "Players: choose PLAYER, pick your group and join"}
          <span className="dots" />
        </p>
        <div className="host-groups" style={{ ["--cols" as string]: Math.min(4, state.groupCount) }}>
          {state.groups.map((g) => (
            <div key={g.groupNumber} className={`slot ${g.members ? "filled" : ""} ${g.finished ? "done" : ""}`} data-testid="host-group">
              <SubIcon dim={!g.members} color={g.finished ? "#4ff0e0" : "#ffd23f"} />
              <span>GROUP {g.groupNumber}</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: "clamp(13px, 1.4vw, 17px)" }}>
                {g.finished ? "Finished ✓" : g.started ? "Diving…" : g.members ? `${g.members} joined` : "Waiting"}
              </span>
            </div>
          ))}
        </div>
        <p className="label" style={{ margin: "18px 0 6px" }} aria-live="polite">
          {state.groupsFinished} of {state.groupCount} teams finished
        </p>
        {state.devRevealStartedGroups && (
          <p className="small" style={{ margin: "4px 0", color: "var(--pink)" }}>
            Dev test mode: results reveal when every started group finishes.
          </p>
        )}
        <p className="small" style={{ margin: "6px 0 2px" }}>
          The final leaderboard appears here automatically.
        </p>
        <NewGameLink onDone={onNewGame} />
      </section>
    </div>
  );
}

function HostResults({ state, onNewGame }: { state: HostState; onNewGame: () => Promise<void> }) {
  const rows = state.leaderboard!;
  const n = rows.length;
  return (
    <div className="screen-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: "max(10px, 3dvh)", paddingBottom: 24 }}>
      <section className="px-box" style={{ width: "min(980px, 100%)", padding: "22px 22px 14px", overflow: "hidden" }} aria-labelledby="host-lb">
        <p className="label" style={{ margin: 0, fontSize: "clamp(10px, 1.2vw, 14px)" }}>
          Ocean Dive — final results
        </p>
        <h1 id="host-lb" className="display winner-banner" style={{ animationDelay: `${n * 0.7}s`, fontSize: "clamp(22px, 4vw, 44px)" }}>
          {winnerBanner(rows)}
        </h1>
        <Leaderboard rows={rows} animate big />
        <div style={{ textAlign: "center" }}>
          <NewGameLink onDone={onNewGame} />
        </div>
      </section>
    </div>
  );
}
