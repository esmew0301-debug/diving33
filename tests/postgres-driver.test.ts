import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { QUESTIONS } from "@/content/questions";

// Exercises the PRODUCTION driver (postgres.js over the Postgres wire protocol, as used with Supabase).
let server: PGLiteSocketServer;
let g: typeof import("@/server/game");

beforeAll(async () => {
  const pg = await PGlite.create();
  const port = 55000 + Math.floor(Math.random() * 5000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 1 });
  await server.start();
  vi.resetModules();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.DB_POOL_MAX = "1";
  const db = await import("@/server/db");
  db.__setDbForTests(undefined);
  g = await import("@/server/game");
});

afterAll(async () => {
  delete process.env.DATABASE_URL;
  vi.useRealTimers();
  await server?.stop();
});

describe("postgres.js driver (production path)", () => {
  it("runs join → start → answer → timeout → reveal → history", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let T = Date.now();
    const at = (d: number) => vi.setSystemTime((T += d));
    await g.newGame({ groupCount: 1, groupCapacity: 2 });
    const a = await g.joinGroup({ groupNumber: 1, name: "Ana <b>" });
    const b = await g.joinGroup({ groupNumber: "1" });
    await g.startGame(a.token);
    await g.startGame(b.token);
    at(3000);
    const r1 = await g.submitAnswer(a.token, QUESTIONS[0].id, "CO₂");
    expect(r1).toMatchObject({ isCorrect: true, groupCredits: 1, personalDepthAfter: 100 });
    expect((await g.submitAnswer(a.token, QUESTIONS[0].id, "CO₂")).duplicate).toBe(true);
    expect(await g.submitAnswer(b.token, QUESTIONS[0].id, "oxygen")).toMatchObject({ isCorrect: false, personalDepthAfter: 0 });
    at(20 * 60 * 1000); // everything else times out
    const st = await g.getPublicState(a.token);
    expect(st.session.status).toBe("revealed");
    expect(st.me?.displayName).toBe("Ana b");
    expect(st.leaderboard?.[0]).toMatchObject({ groupNumber: 1, credits: 1, members: 2, rank: 1 });
    const h = await g.getHistory(b.token);
    expect(h.entries[0]).toMatchObject({ myAnswer: "oxygen", isCorrect: false });
    expect(h.entries[1]).toMatchObject({ myAnswer: null, status: "timeout" });
  });
});
