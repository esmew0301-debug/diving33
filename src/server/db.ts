import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal database adapter with one interface and two drivers:
 *  - Production: real Postgres (Supabase) through DATABASE_URL (postgres.js).
 *  - Local development: embedded PGlite (real Postgres compiled to WASM) persisted in ./.data.
 * Both run the same SQL, including the transactions used for joining and scoring.
 */

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  driver: "postgres" | "pglite";
}

const MIGRATION_FILE = path.join(process.cwd(), "db", "migrations", "001_init.sql");

declare global {
  var __oceanDb: Promise<Db> | undefined;
}

async function createPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // prepare:false keeps us compatible with the Supabase transaction pooler (port 6543).
  const sql = postgres(url, { max: Number(process.env.DB_POOL_MAX) || 5, prepare: false, idle_timeout: 20, connect_timeout: 15 });
  const run = async <T extends Row>(s: { unsafe: typeof sql.unsafe }, text: string, params: unknown[] = []) =>
    (await s.unsafe(text, params as never[])) as unknown as T[];
  return {
    driver: "postgres",
    query: (text, params) => run(sql, text, params),
    tx: (fn) =>
      sql.begin((t) => fn({ query: (text, params) => run(t as unknown as typeof sql, text, params) })) as Promise<never>,
  };
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR === "memory" ? undefined : process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  // PGlite is a single connection; serialize transactions so concurrent requests cannot interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const serialize = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    driver: "pglite",
    query: (text, params) => serialize(async () => (await pg.query(text, params ?? [])).rows as never[]),
    tx: (fn) =>
      serialize(() =>
        pg.transaction((t) => fn({ query: async (text, params) => (await t.query(text, params ?? [])).rows as never[] })),
      ),
  };
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    db = await createPostgres(url);
  } else {
    if (process.env.VERCEL || process.env.REQUIRE_DATABASE_URL === "1") {
      throw new Error(
        "DATABASE_URL is not set. Production needs a real Postgres database (e.g. Supabase). See README.md.",
      );
    }
    db = await createPglite();
  }
  const ddl = fs.readFileSync(MIGRATION_FILE, "utf8");
  // Idempotent DDL. Run inside one transaction guarded by a transaction-scoped advisory lock so two
  // cold-starting serverless instances cannot race each other.
  await db.tx(async (q) => {
    await q.query("select pg_advisory_xact_lock(424242)");
    for (const stmt of splitSql(ddl)) await q.query(stmt);
  });
  return db;
}

export function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getDb(): Promise<Db> {
  if (!globalThis.__oceanDb) {
    globalThis.__oceanDb = init().catch((e) => {
      globalThis.__oceanDb = undefined;
      throw e;
    });
  }
  return globalThis.__oceanDb;
}

/** Test helper: inject a database instance. */
export function __setDbForTests(db: Promise<Db> | undefined) {
  globalThis.__oceanDb = db;
}
