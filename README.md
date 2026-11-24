# OCEAN DIVE — *How deep does your ocean knowledge go?*

A classroom quiz game for UC San Diego SYN 2, Project 3 (carbon emissions, ocean acidification, coastal communities, environmental justice, and responses). There is **one link and no teacher interface**: students open it on their own phones and do everything themselves.

1. **Join a group (1–4).** Each group holds 4 players, and everyone sees "Group 1 — 3 of 4 players joined" update live.
2. **Start game.** It unlocks when the group has all 4 players. Each student presses Start on their own device and plays the 7 typed questions at their own pace, with 25 seconds per question. A correct answer gives +1 group credit and the sub dives 100 m. A wrong answer gives 0, the sub stays put, and the student keeps playing.
3. **Wait for the reveal.** Other groups' scores are never shown while the game is running. When **every expected student** (4 groups × 4 by default) has finished, the final leaderboard and winner appear on every phone automatically.
4. **Review answers.** Each student's Dive Log shows every question, their answer, the correct answer, an explanation and a source.

---

## 1. Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Without `DATABASE_URL`, the app uses an **embedded Postgres (PGlite)** stored in `./.data/`, so phones on the same Wi-Fi play against your laptop for real. Open `http://<your-laptop-LAN-IP>:3000` on the phones (find the IP with `ipconfig getifaddr en0`). For a fresh game, stop the server, run `npm run reset`, and start it again.

**Practising with fewer people:** the reveal waits for exactly `GROUP_COUNT × GROUP_CAPACITY` students. To rehearse with 2 friends, for example:

```bash
npm run reset
GROUP_COUNT=1 GROUP_CAPACITY=3 npm run dev
```

---

## 2. Deploy for class (Supabase + Vercel, free tiers)

**Supabase (the database)**
1. Create a project at <https://supabase.com>.
2. Go to **Project Settings → Database → Connection string → Transaction pooler** and copy the URI (port `6543`), with your DB password filled in. This is `DATABASE_URL`.
3. Optional: run `db/migrations/001_init.sql` in the **SQL Editor**. The app also creates and upgrades the tables automatically.

**Vercel (the website)**
1. Push this folder to GitHub and import it at <https://vercel.com/new>, or run `npx vercel`.
2. Set **Environment Variables**: `DATABASE_URL` (required). Optional: `GROUP_COUNT` (default 4), `GROUP_CAPACITY` (default 4) and the others in `.env.example`.
3. Deploy, and put the link or a QR code on your slide.

On Vercel, the app refuses to start without `DATABASE_URL`, so it can never fake a backend. Supabase free projects pause after about a week of inactivity, so open the site the day before class.

---

## 3. Settings (environment variables, no dashboard)

| Variable | Default | Meaning |
|---|---|---|
| `GROUP_COUNT` | 4 | Groups expected |
| `GROUP_CAPACITY` | 4 | Players per group. A group can start once full. **Expected roster = count × capacity.** |
| `QUESTION_SECONDS` | 25 | Time per question; unanswered questions score 0 |
| `AUTO_START_SECONDS` | 300 | If a member of a full group never presses Start, their timer starts anyway after 5 minutes, so one idle phone can't block the reveal forever. 0 = off. |
| `RESET_AFTER_REVEAL_MINUTES` | 60 | A finished game is replaced by a fresh one after an hour |
| `IDLE_RESET_MINUTES` | 180 | An unfinished game with no activity for 3 hours is replaced (for example, last week's rehearsal) |

Settings are copied into a game when it is created. After changing them, run `npm run reset` so they take effect. In production: `DATABASE_URL="postgresql://..." npm run reset`.

> **Important for the reveal:** if only 15 students show up while the roster expects 16, the leaderboard will wait for the missing player forever, because one group can never fill. Before class, set `GROUP_COUNT` / `GROUP_CAPACITY` to match the students who are actually present, then run `npm run reset`.

---

## 4. Classroom runbook

1. Before class: run `npm run reset` (against the production `DATABASE_URL`) and check the roster settings.
2. Show the QR or link. Students tap their group number and **Join group**.
3. Each group's Start button unlocks when the group has 4 players. Students start whenever they like, and groups don't wait for each other.
4. Students who finish see "Great job! … Waiting for everyone to finish" with a progress bar (for example "11 of 16 divers finished").
5. When the last student finishes, every phone shows the reveal animation, the winner, and the rankings. Then students tap **View answer history**.

---

## 5. Editing questions

Questions, accepted aliases, explanations and sources are all in one file: [`src/content/questions.ts`](src/content/questions.ts). It is server-only, so answers never reach browsers before the reveal. Matching is exact after normalization: case, spaces, punctuation and accents are ignored, `CO₂` = `CO2`, and `O.A.E.` = `OAE`. **"environmental justice"** is accepted for Q5; remove it if your group disagrees.

---

## 6. How it works

```
phone ──poll /api/state every 1.2 s──▶ Next.js route handlers ──SQL──▶ Postgres (Supabase)
phone ──POST /api/join · /api/start · /api/answer (diver token)──┘
```

* **Each student has their own timer.** Every student has their own question index and server-side deadline. After an answer or timeout, the next question opens 3 s later. Overdue questions are closed lazily on any request, so a phone that went to sleep still progresses. When the student reconnects, they continue from where they actually are.
* **Automatic reveal.** The server reveals the leaderboard in the same transaction where it sees that `joined = finished = expected roster`. Before that, `/api/state` returns only the student's **own** group's credits, plus head-counts. Leaderboard data does not exist in any response until the reveal.
* **No double scoring.** Each answer is one row with `UNIQUE(session, participant, question)`, written while holding the participant's row lock. Credits and depth are computed from those rows, so retries and replays can't add points.
* **Identity and no group switching.** Joining returns a random 256-bit token; the server stores only its hash. Joining again with that token always returns the same slot in the same group, so refreshing never duplicates a student and nobody can hop groups.

## 7. Tests

```bash
npm test             # 52 unit/integration tests (real SQL): joining, starting, scoring, timeouts,
                     # privacy, the 4×4 automatic reveal, safety nets, and the production postgres.js driver
npm run test:e2e     # Playwright (installed Chrome): 5 browsers + 11 API students play a full 16-student class
PGLITE_DIR=memory NEXT_DIST_DIR=.next-qa npx next dev -p 3200 &   # fresh server, then:
node scripts/qa-screens.mjs http://localhost:3200 qa/screenshots
```

## 8. Real multi-device test before class

1. Deploy, or run locally with phones on the same Wi-Fi.
2. For a quick check, use `GROUP_COUNT=2 GROUP_CAPACITY=2` and `npm run reset`.
3. Have two phones join Group 1: the Start button unlocks only when the second phone joins. A third phone trying Group 1 is refused.
4. One phone starts and plays; the other waits, then starts later. Check that wrong answers keep the sub at its depth, and that the Group 2 phones never see Group 1's credits.
5. Refresh a phone mid-game: it comes back to the same slot and question.
6. When the last phone finishes, all phones show the reveal and the same rankings.
7. Reset with the real roster (4 × 4) before the presentation.
