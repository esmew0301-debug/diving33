// Start a brand-new Ocean Dive game (clears the current roster; old data is kept but archived).
//   Production / Supabase:  DATABASE_URL="postgresql://..." npm run reset
//   Local dev:              stop `npm run dev`, then `npm run reset` (deletes the local ./.data database)
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (url) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, prepare: false });
  const r = await sql`update sessions set is_current = false where is_current returning id`;
  await sql.end();
  console.log(r.length ? "Archived the current game. A fresh game opens when the host logs in." : "No current game — a fresh one opens on the next visit.");
} else {
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Deleted the local database at ${dir}. Start the app again (npm run dev); the game opens when the host logs in.`);
}
