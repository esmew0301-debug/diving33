import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "@/server/db";

describe("resolveDatabaseUrl (production database config)", () => {
  it("returns null when nothing is configured", () => {
    expect(resolveDatabaseUrl({})).toBeNull();
    expect(resolveDatabaseUrl({ DATABASE_URL: "  " })).toBeNull();
  });

  it("uses DATABASE_URL with SSL for remote hosts", () => {
    const r = resolveDatabaseUrl({ DATABASE_URL: "postgresql://postgres.abc:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres" });
    expect(r).toEqual({ url: "postgresql://postgres.abc:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres", ssl: "require", source: "DATABASE_URL" });
  });

  it("accepts Vercel integration variables and strips flags Postgres would reject", () => {
    const r = resolveDatabaseUrl({
      POSTGRES_URL: "postgres://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x",
      POSTGRES_PRISMA_URL: "postgres://x:y@other:6543/postgres?pgbouncer=true",
    });
    expect(r).toEqual({ url: "postgres://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres", ssl: "require", source: "POSTGRES_URL" });
    expect(resolveDatabaseUrl({ POSTGRES_PRISMA_URL: "postgres://x:y@db.example.com:6543/postgres?pgbouncer=true&connect_timeout=15" })!.url).toBe(
      "postgres://x:y@db.example.com:6543/postgres",
    );
  });

  it("DATABASE_URL wins; sslmode=disable and localhost turn SSL off", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a:b@h1/db", POSTGRES_URL: "postgres://a:b@h2/db" })!.source).toBe("DATABASE_URL");
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a:b@db.example.com/db?sslmode=disable" })!.ssl).toBe(false);
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgres://a:b@127.0.0.1:5432/db" })!.ssl).toBe(false);
  });
});
