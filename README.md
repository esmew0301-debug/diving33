# OCEAN DIVE — *How deep does your ocean knowledge go?*

A classroom quiz game for UC San Diego SYN 2, Project 3 (carbon emissions, ocean acidification, coastal communities, environmental justice, and responses). One website, two entry modes:

* **HOST** (the presenter): password login → opens the game → shows a waiting screen → **automatically shows the final ranking** when all four groups have finished. No question editing, no grading, no manual controls.
* **PLAYER** (students, on their own phones/laptops): choose Group 1–4 → **Join group** → "Set up your profile" (name only) → group waiting room → any member presses **Start game** (works with just 1 player) → 7 questions together with the group.

### Rules

| | |
|---|---|
| Timer | Each question: **30 s**, then a dramatic **3 · 2 · 1** final countdown (33 s total). Same server clock for the whole group. |
| Retries | Wrong answers: red flash + bounce, **+0 m**, sub stays put, try again while time remains. The timer never resets. |
| Depth | First correct answer at **0–10 s → +30 m**, **>10–20 s → +20 m**, **>20–30 s → +10 m**, **final countdown → +10 m**, never → **0 m**. Awarded once per player per question, measured on the server. |
| Rounds | A question ends when every group member has answered correctly or the 33 s run out; the group then moves on together (4 s pause for the animations). |
| Team score | **Total team depth** = sum of every member's depth. Ties share a place. |
| Privacy | During play, players see only their own depth and their own group. Other groups' depths/rankings are never sent to any browser until the reveal. |
| Reveal | The host screen switches to the leaderboard automatically once **all four groups have started and finished** (not when the first group finishes). |
| History | Each player's **Answer history** (attempts, accepted answer, depth, explanation, source) unlocks when *their group* has finished. |

---

## 1. Run it locally

```bash
npm install
npm run dev        # http://localhost:3000   (host page: /host)
```

Create `.env.local` with `HOST_PASSWORD=<your host password>` (this file is git-ignored, never commit the password). Without `DATABASE_URL`, the app uses an **embedded Postgres (PGlite)** stored in `./.data/`, so phones on the same Wi-Fi play against your laptop for real (open `http://<laptop-LAN-IP>:3000`; find the IP with `ipconfig getifaddr en0`).

### Testing it by yourself

1. Open `http://localhost:3000/host` → enter your host password. This opens the game.
2. In a second browser (or a private window), open `http://localhost:3000` → **PLAYER** → Group 1 → Join → enter a name → **Start game**.
3. Play all 7 questions (try wrong answers, slow answers, and letting the timer run out), then open **View answer history**.

The host leaderboard deliberately waits for all four groups. To see the reveal with only one group, use the **development-only** switch (ignored in production builds):

```bash
DEV_REVEAL_STARTED_GROUPS=1 npm run dev
```

After a rehearsal, start a clean game with the small **"Reset: start a new game"** link on the host screen (asks for confirmation), or stop the server and run `npm run reset`.

---

## 2. Deploy for class (Supabase + Vercel, free tiers)

**Supabase (the database)**
1. Create a project at <https://supabase.com>.
2. Go to **Project Settings → Database → Connection string → Transaction pooler** and copy the URI (port `6543`), with your DB password filled in. This is `DATABASE_URL`.
3. Optional: run `db/migrations/001_init.sql` in the **SQL Editor**. The app also creates and upgrades the tables automatically.

**Vercel (the website)**
1. Push this folder to GitHub and import it at <https://vercel.com/new>, or run `npx vercel`.
2. Set **Environment Variables**: `DATABASE_URL` (required) and **`HOST_PASSWORD`** = your host password (required; server-side only; keep it out of the repo). Optional: `GROUP_COUNT` (default 4), `GROUP_CAPACITY` (default 4).
3. Deploy, and put the link or a QR code on your slide.

On Vercel, the app refuses to start without `DATABASE_URL`, and host login is disabled without `HOST_PASSWORD`. Supabase free projects pause after about a week of inactivity, so open the site the day before class.

---

## 3. Classroom runbook

1. Before class: open `/host`, log in, and press **Reset: start a new game** to clear rehearsal data. Keep the host tab open and share that screen.
2. Show the QR/link. Students tap **PLAYER**, pick their group, enter their name.
3. Tell each group to wait until all teammates appear in the waiting room, then one person presses **Start game** (late students can't join a started group).
4. The host screen shows "THE CHALLENGE IS IN PROGRESS" and "N of 4 teams finished" (no scores).
5. When the fourth group finishes, the host screen plays the reveal: 4th → 1st, then the winner banner.

> All four groups must start. If only three groups are in class, set `GROUP_COUNT=3` in Vercel and redeploy (then reset) before class, otherwise the reveal will wait for the missing group.

---

## 4. Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `HOST_PASSWORD` | — | Host login password (exact match). **Required.** |
| `GROUP_COUNT` | 4 | Groups expected; the reveal waits for all of them |
| `GROUP_CAPACITY` | 4 | Maximum players per group (a group can start with 1) |
| `IDLE_RESET_MINUTES` | 180 | An unfinished game with no student activity for 3 hours is replaced (e.g. last night's rehearsal) |
| `DEV_REVEAL_STARTED_GROUPS` | — | Dev only: reveal when every *started* group finishes |
| `ENABLE_TEST_HOOKS` | — | Dev only: `/api/dev/clock` for automated timing tests |

The timer (30 s + 3 s) and depth brackets are fixed in `src/lib/config.ts`.

---

## 5. Editing questions

Questions, accepted aliases, explanations and sources are all in one file: [`src/content/questions.ts`](src/content/questions.ts). It is server-only, so answers never reach browsers. Matching is exact after normalization: case, spaces, punctuation and accents are ignored, `CO₂` = `CO2`, and `O.A.E.` = `OAE`.

---

## 6. How it works

```
browser ──poll /api/state every 1 s──▶ Next.js route handlers ──SQL──▶ Postgres (Supabase)
browser ──POST /api/join · /api/start · /api/answer (player token)──┘
host    ──/api/host/login (password → HttpOnly cookie) · /api/host/state──┘
```

* **Group clock on the server.** Each group row stores its current question and when it opened. Deadlines (30 s + 3 s) and depth brackets are computed from server time when the answer arrives, never from the browser. Overdue questions are closed lazily on any request, so no group can get stuck.
* **No double scoring.** Every attempt is logged in `dive_attempts`; each player's scored result per question is one row in `dive_results` with `UNIQUE(participant, question)`. All scoring for a group runs while holding that group's row lock, so simultaneous answers can't overwrite each other. Depths are sums over those rows.
* **Identity.** Joining returns a random 256-bit token (stored only as a hash). Refreshing or reconnecting restores the same player, group, depth, question and timer. Nobody can switch groups, and starting a group locks its roster.
* **Host security.** The password is compared on the server (constant-time) against the `HOST_PASSWORD` env var. A successful login sets an `HttpOnly`, `SameSite=Strict` session cookie (Secure over HTTPS); only its hash is stored.

## 7. Tests

```bash
npm test             # 62 unit/integration tests with real SQL + fake clock (brackets, retries, timeouts,
                     # sync, privacy, reveal, ties, history, reconnection, host login, prod driver)
npm run test:e2e     # Playwright (installed Chrome), tests A–P in real browser contexts
PGLITE_DIR=memory NEXT_DIST_DIR=.next-qa HOST_PASSWORD=qa-host-pw ENABLE_TEST_HOOKS=1 npx next dev -p 3200 &
node scripts/qa-screens.mjs http://localhost:3200 qa/screenshots   # screenshot QA of every screen
```
