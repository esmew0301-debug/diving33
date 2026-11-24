"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { POLL_MS } from "./config";
import type { PublicState } from "./types";

const KEY = "oceandive.diver.v1";

interface Stored {
  sessionId: string;
  token: string;
}

export function readStored(): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && typeof v.token === "string" && typeof v.sessionId === "string" ? v : null;
  } catch {
    return null;
  }
}

export function writeStored(v: Stored | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode) — the slot then only lives for this tab */
  }
}

let memoryToken: Stored | null = null;
export function getToken(): string | null {
  return (readStored() ?? memoryToken)?.token ?? null;
}
export function setToken(v: Stored | null) {
  memoryToken = v;
  writeStored(v);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "x-diver-token": token } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(d.error || "Connection problem. Retrying…", d.code || "network", res.status);
  }
  return data as T;
}

/** Polls authoritative server state. Refetches immediately on focus/online/visibility. */
export function useLiveState() {
  const [state, setState] = useState<PublicState | null>(null);
  const [offline, setOffline] = useState(false);
  const offsetRef = useRef(0);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    const sent = Date.now();
    try {
      const s = await api<PublicState>("/api/state");
      const recv = Date.now();
      offsetRef.current = s.serverNow - (sent + recv) / 2;
      // The stored token belongs to an older session: forget it.
      const stored = readStored();
      if (stored && stored.sessionId !== s.session.id) setToken(null);
      setState(s);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    const wake = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
    };
  }, [refresh]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  return { state, setState, refresh, offline, serverNow };
}

/** Re-render every `ms` while `active`. */
export function useTicker(active: boolean, ms = 250) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
