import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// End-to-end tests against a real Next.js dev server + Postgres (PGlite), real browser contexts.
// Timing cases use the DEV-ONLY clock hook (/api/dev/clock, enabled by ENABLE_TEST_HOOKS=1 in
// playwright.config.ts) to fast-forward the server clock instead of waiting 33 s per question.
const ANSWERS = ["co2", "ocean acidification", "carbonate ions", "aquaculture", "environmental injustice", "kelp", "OAE"];
const PW = process.env.E2E_HOST_PASSWORD || "e2e-host-pw";

test.describe.configure({ mode: "serial" });

async function hostApi(request: APIRequestContext) {
  expect((await request.post("/api/host/login", { data: { password: PW } })).ok()).toBe(true);
}
async function freshGame(request: APIRequestContext, closed = false) {
  await hostApi(request);
  expect((await request.post("/api/host/new-game", { data: { closed } })).ok()).toBe(true);
}
const clock = (request: APIRequestContext, ms: number) => request.post("/api/dev/clock", { data: { advanceMs: Math.max(1, Math.round(ms)) } });

async function newPage(browser: Browser, mobile = false): Promise<Page> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
  return ctx.newPage();
}

async function player(browser: Browser, group: number, name: string, mobile = false): Promise<Page> {
  const page = await newPage(browser, mobile);
  await page.goto("/");
  await page.getByRole("button", { name: /PLAYER/ }).click();
  await page.locator(".tile", { hasText: String(group) }).first().click();
  await page.getByRole("button", { name: "Join group" }).click();
  await expect(page.getByText("Set up your profile")).toBeVisible();
  await page.fill("#name", name);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: `Group ${group}` })).toBeVisible();
  return page;
}

const stateOf = (p: Page) =>
  p.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem("oceandive.diver.v1")!).token;
    return (await fetch("/api/state", { headers: { "x-diver-token": t } })).json();
  });

/** Fast-forward the server so the group's current question has been open for `sec` seconds. */
async function toSecond(request: APIRequestContext, p: Page, sec: number) {
  const st = await stateOf(p);
  const target = st.group.round.questionStartedAt + sec * 1000;
  if (target > st.serverNow) await clock(request, target - st.serverNow);
}

async function waitOpen(p: Page) {
  await expect(p.locator("#answer")).toBeEnabled({ timeout: 15000 });
}
async function answerUI(p: Page, text: string) {
  await waitOpen(p);
  await p.fill("#answer", text);
  await p.press("#answer", "Enter");
}
const myDepth = (p: Page) => p.getByTestId("my-depth");
const qIndex = async (p: Page) => (await stateOf(p)).group.round.index as number;

/** HTTP bot student (its own token) for filling the other groups. */
async function bot(request: APIRequestContext, group: number, name: string) {
  const r = await (await request.post("/api/join", { data: { groupNumber: group, name } })).json();
  const h = { "x-diver-token": r.token };
  return {
    token: r.token as string,
    start: () => request.post("/api/start", { headers: h }),
    state: async () => (await request.get("/api/state", { headers: h })).json(),
    answer: (questionId: string, answer: string) => request.post("/api/answer", { headers: h, data: { questionId, answer } }),
  };
}

test("A — host authentication: wrong passwords rejected, the configured password opens the game, waiting students continue automatically", async ({ browser, request }) => {
  await freshGame(request, true); // a new game that the host has NOT opened yet
  const student = await newPage(browser, true);
  await student.goto("/");
  await student.getByRole("button", { name: /PLAYER/ }).click();
  await expect(student.getByText("Waiting for the host to open the game")).toBeVisible();
  expect((await request.post("/api/join", { data: { groupNumber: 1, name: "Early" } })).status()).toBe(409);
  const host = await newPage(browser);
  await host.goto("/host");
  for (const bad of ["E2E-HOST-PW", "e2e-host", "wrong"]) {
    await host.fill("#host-pw", bad);
    await host.press("#host-pw", "Enter");
    await expect(host.getByText("Incorrect host password.")).toBeVisible();
  }
  // the password never appears in any browser-visible asset
  const html = await (await request.get("/host")).text();
  const scripts = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
  for (const src of scripts) expect(await (await request.get(src)).text()).not.toContain(PW);
  expect(html).not.toContain(PW);
  // host API is protected
  const anon = await browser.newContext();
  expect((await anon.request.get("/api/host/state")).status()).toBe(401);
  expect((await anon.request.post("/api/host/new-game")).status()).toBe(401);

  await host.fill("#host-pw", PW);
  await host.press("#host-pw", "Enter");
  await expect(host.getByText("The game is open")).toBeVisible();
  // the waiting student proceeds without refreshing
  await expect(student.getByText("Choose your group")).toBeVisible({ timeout: 8000 });
});

test("B/D/H/I/O — solo start, fast correct dive (+30 m), red bounce on wrong answers, refresh keeps everything", async ({ browser, request }) => {
  await freshGame(request);
  const p = await player(browser, 1, "Solo");
  const start = p.getByRole("button", { name: "Start game" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(p.getByText("Get ready")).toBeVisible();
  await waitOpen(p);

  // H/I: two wrong answers → red input + bounce, no depth, timer keeps running
  const qsBefore = (await stateOf(p)).group.round.questionStartedAt;
  for (const wrongText of ["oxygen", "methane"]) {
    await answerUI(p, wrongText);
    await expect(p.getByTestId("fb-wrong")).toBeVisible();
    await expect(p.locator("#answer")).toHaveClass(/wrong/);
    await expect(p.locator("form.bounce")).toHaveCount(1);
    await expect(myDepth(p)).toHaveText("0 M");
    await expect(p.locator(".dive-popup")).toHaveCount(0);
  }
  await expect(p.locator("#answer")).not.toHaveClass(/wrong/, { timeout: 3000 }); // the red flash is brief
  const st = await stateOf(p);
  expect(st.group.round.questionStartedAt).toBe(qsBefore);
  expect(st.me.currentWrongAttempts).toBe(2);
  expect(st.me.personalDepth).toBe(0);

  // D: correct within 10 s → +30 m, success state, dive popup, gauge moves
  await answerUI(p, ANSWERS[0]);
  await expect(p.getByTestId("fb-correct")).toHaveText("Correct! +30 M");
  await expect(p.locator(".dive-popup")).toHaveText("+30 M");
  await expect(myDepth(p)).toHaveText("30 M");
  await expect(p.locator(".gauge-marker")).toHaveText("30 M", { timeout: 3000 });
  await expect(p.locator("#answer")).toHaveCount(0); // no more submissions for this question

  // duplicate submission through the API adds nothing
  const dup = await p.evaluate(async (qid) => {
    const t = JSON.parse(localStorage.getItem("oceandive.diver.v1")!).token;
    return (await fetch("/api/answer", { method: "POST", headers: { "x-diver-token": t, "content-type": "application/json" }, body: JSON.stringify({ questionId: qid, answer: "co2" }) })).json();
  }, st.question.id);
  expect(dup).toMatchObject({ duplicate: true, personalDepth: 30 });

  // solo player answered → round closes, Q2 opens after the intermission
  await expect(p.getByText("Question 2/7")).toBeVisible({ timeout: 8000 });

  // O: refresh — same identity, group, question, depth; no new participant
  const before = await stateOf(p);
  await p.reload();
  await expect(myDepth(p)).toHaveText("30 M");
  await expect(p.getByText("Group 1 • Solo")).toBeVisible();
  const after = await stateOf(p);
  expect(after.me).toEqual(before.me);
  expect(after.group.round).toEqual(before.group.round);
  expect(after.group.members).toHaveLength(1);
});

test("C/K — four players on separate browsers: live roster, one press starts everyone, same question & clock, round waits for all", async ({ browser, request }) => {
  await freshGame(request);
  const names = ["Alex", "Jamie", "Taylor", "Morgan"];
  const ps: Page[] = [];
  for (let i = 0; i < 4; i++) ps.push(await player(browser, 2, names[i], i % 2 === 1));
  for (const p of ps) for (const n of names) await expect(p.locator(".slot-name", { hasText: n })).toBeVisible({ timeout: 6000 });
  await expect(ps[0].getByText("Players (4/4)")).toBeVisible();

  await ps[2].getByRole("button", { name: "Start game" }).click();
  for (const p of ps) await waitOpen(p);
  const sts = await Promise.all(ps.map(stateOf));
  expect(new Set(sts.map((s) => s.question.id)).size).toBe(1);
  expect(new Set(sts.map((s) => s.group.round.deadline)).size).toBe(1);
  const timers = await Promise.all(ps.map(async (p) => parseInt((await p.getByTestId("timer").textContent())!, 10)));
  expect(Math.max(...timers) - Math.min(...timers)).toBeLessThanOrEqual(1);

  // a 5th student cannot join a started group
  const late = await newPage(browser, true);
  await late.goto("/");
  await late.getByRole("button", { name: /PLAYER/ }).click();
  await expect(late.locator(".tile", { hasText: "2" }).first()).toContainText("STARTED");

  // K: one correct answer does not advance the group
  await answerUI(ps[0], ANSWERS[0]);
  await expect(ps[0].getByText("Waiting for your teammates")).toBeVisible();
  await expect(ps[1].locator(".slot", { hasText: "Alex" })).toContainText("got it", { timeout: 5000 });
  for (const p of ps.slice(1)) await expect(p.locator("#answer")).toBeEnabled();
  expect(await qIndex(ps[1])).toBe(0);
  for (const p of ps.slice(1)) await answerUI(p, ANSWERS[0]);
  for (const p of ps) await expect(p.getByText("Question 2/7")).toBeVisible({ timeout: 8000 });
});

test("E/F/G/J — 12 s → +20 m, 24 s → +10 m, final countdown → +10 m, timeout → 0 m and auto-advance", async ({ browser, request }) => {
  await freshGame(request);
  const p = await player(browser, 3, "Timer");
  await p.getByRole("button", { name: "Start game" }).click();

  // E
  await waitOpen(p);
  await toSecond(request, p, 12);
  await expect(p.getByText("Worth +20 M")).toBeVisible({ timeout: 4000 });
  await answerUI(p, ANSWERS[0]);
  await expect(p.getByTestId("fb-correct")).toHaveText("Correct! +20 M");
  await expect(myDepth(p)).toHaveText("20 M");

  // F
  await expect(p.getByText("Question 2/7")).toBeVisible({ timeout: 8000 });
  await waitOpen(p);
  await toSecond(request, p, 24);
  await expect(p.getByText("Worth +10 M")).toBeVisible({ timeout: 4000 });
  await answerUI(p, ANSWERS[1]);
  await expect(p.getByTestId("fb-correct")).toHaveText("Correct! +10 M");
  await expect(myDepth(p)).toHaveText("30 M");

  // G: final countdown appears, answers still accepted, +10 m
  await expect(p.getByText("Question 3/7")).toBeVisible({ timeout: 8000 });
  await waitOpen(p);
  await toSecond(request, p, 27);
  await answerUI(p, "wrong guess");
  await expect(p.getByTestId("fb-wrong")).toBeVisible();
  await p.fill("#answer", ANSWERS[2]);
  await toSecond(request, p, 30.2); // server is now inside the final 3-2-1 countdown
  await p.press("#answer", "Enter");
  await expect(p.getByTestId("fb-correct")).toHaveText("Correct! +10 M");
  await expect(myDepth(p)).toHaveText("40 M");

  // J: no correct answer → after 30 + 3 s the question closes with 0 m and the group advances
  await expect(p.getByText("Question 4/7")).toBeVisible({ timeout: 8000 });
  await waitOpen(p);
  await answerUI(p, "nope");
  await toSecond(request, p, 30.1);
  await expect(p.locator(".final-count")).toBeVisible({ timeout: 2500 });
  await expect(p.getByText("Final countdown!")).toBeVisible();
  await expect(p.locator(".final-vignette")).toHaveCount(1);
  await expect(p.locator("#answer")).toBeEnabled(); // still accepting answers
  // no more jumps: the real 3-second final countdown expires on its own
  await expect(p.getByText(/Time's up/)).toBeVisible({ timeout: 6000 });
  await expect(p.getByText("Question 5/7")).toBeVisible({ timeout: 8000 });
  const st = await stateOf(p);
  expect(st.me.results.find((r: { questionIndex: number }) => r.questionIndex === 3)).toMatchObject({ isCorrect: false, depthAwarded: 0 });
  expect(st.me.personalDepth).toBe(40);
  // answering the closed question is refused server-side
  const late = await p.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem("oceandive.diver.v1")!).token;
    return (await fetch("/api/answer", { method: "POST", headers: { "x-diver-token": t, "content-type": "application/json" }, body: JSON.stringify({ questionId: "q4-aquaculture", answer: "aquaculture" }) })).status;
  });
  expect([409, 400]).toContain(late);
});

test("L/M/N/P — team totals, privacy during play, host waits for all four groups, then reveals the correct ranking", async ({ browser, request }) => {
  await freshGame(request);
  const host = await newPage(browser);
  await host.goto("/host");
  await host.fill("#host-pw", PW);
  await host.press("#host-pw", "Enter");
  await expect(host.getByText("The game is open")).toBeVisible();

  // Group 1: four players (two real browsers + two API players) earning different depths on Q1.
  // (Four simultaneous browsers are covered by test C; fewer here keeps the shared test machine responsive.)
  const g1 = [await player(browser, 1, "Ana"), await player(browser, 1, "Ben", true)];
  const cy = await bot(request, 1, "Cy");
  const dee = await bot(request, 1, "Dee");
  await expect(g1[0].locator(".slot-name", { hasText: "Dee" })).toBeVisible({ timeout: 5000 });
  await g1[0].getByRole("button", { name: "Start game" }).click();
  for (const p of g1) await waitOpen(p);
  const q1 = (await stateOf(g1[0])).question.id;
  await g1[0].fill("#answer", ANSWERS[0]);
  await toSecond(request, g1[0], 4);
  await g1[0].press("#answer", "Enter"); // +30
  await expect(g1[0].getByTestId("fb-correct")).toHaveText("Correct! +30 M");
  await g1[1].fill("#answer", ANSWERS[0]);
  await toSecond(request, g1[0], 15);
  await g1[1].press("#answer", "Enter"); // +20
  await expect(g1[1].getByTestId("fb-correct")).toHaveText("Correct! +20 M");
  await toSecond(request, g1[0], 22);
  expect(await (await cy.answer(q1, ANSWERS[0])).json()).toMatchObject({ depthAwarded: 10 }); // +10
  expect(await (await dee.answer(q1, "wrong")).json()).toMatchObject({ depthAwarded: 0 }); // 0
  await expect(g1[0].getByText("Team depth: 60 M")).toBeVisible({ timeout: 5000 });
  await expect(g1[1].locator(".slot", { hasText: "Cy" })).toContainText("got it");

  // M: privacy — group state and responses never contain other groups' depth or rankings
  const b2 = await bot(request, 2, "Bot2");
  const s2 = await b2.state();
  expect(s2.leaderboard).toBeNull();
  expect(s2.group.teamDepth).toBe(0);
  expect(JSON.stringify(await stateOf(g1[0]))).not.toContain("totalDepth");
  expect((await (await request.get("/api/host/state")).json()).leaderboard).toBeNull();

  // Group 1 finishes (remaining questions time out)
  await clock(request, 10 * 60 * 1000);
  for (const p of g1) await expect(p.getByText("Ocean Dive complete!")).toBeVisible({ timeout: 10000 });
  await expect(g1[0].getByText("Your depth: 30 M")).toBeVisible();
  await expect(host.getByText("1 of 4 teams finished")).toBeVisible({ timeout: 5000 });
  await expect(host.getByText("Waiting for all teams to finish")).toBeVisible();

  // Groups 2 & 3 finish, group 4 still on question 1 → still waiting
  await b2.start();
  let st = await b2.state();
  await clock(request, st.group.round.questionStartedAt - st.serverNow + 3000);
  expect((await b2.answer(st.question.id, ANSWERS[0])).ok()).toBe(true); // +30 → group 2 = 30 + 30 more below
  st = await b2.state();
  await clock(request, st.group.round.questionStartedAt - st.serverNow + 3000);
  expect((await b2.answer(st.question.id, ANSWERS[1])).ok()).toBe(true); // group 2 = 60
  const b3a = await bot(request, 3, "Bot3a");
  const b3b = await bot(request, 3, "Bot3b");
  await b3a.start();
  st = await b3a.state();
  await clock(request, st.group.round.questionStartedAt - st.serverNow + 12_000);
  await b3a.answer(st.question.id, ANSWERS[0]); // 20
  await b3b.answer(st.question.id, ANSWERS[0]); // 20 → closes early; group 3 = 40
  await clock(request, 10 * 60 * 1000); // groups 2 & 3 finish
  const b4 = await bot(request, 4, "Bot4");
  await b4.start();
  st = await b4.state();
  await clock(request, st.group.round.questionStartedAt - st.serverNow + 1000);
  await expect(host.getByText("3 of 4 teams finished")).toBeVisible({ timeout: 5000 });
  await expect(host.locator("[data-testid=lb-row]")).toHaveCount(0);
  expect((await b4.state()).leaderboard).toBeNull();

  // Group 4 answers once (+30) then times out → automatic reveal on the host screen
  await b4.answer(st.question.id, ANSWERS[0]);
  await clock(request, 10 * 60 * 1000);
  await expect(host.getByText("Ocean Dive — final results")).toBeVisible({ timeout: 10000 });
  const rows = host.locator("[data-testid=lb-row]");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText(/1ST PLACE — GROUP 1/i);
  await expect(rows.nth(0)).toContainText("60 M");
  await expect(rows.nth(1)).toContainText(/Group 2/i);
  await expect(rows.nth(1)).toContainText("60 M"); // tie → shared 1st place
  await expect(rows.nth(1)).toContainText(/1ST PLACE/i);
  await expect(rows.nth(2)).toContainText(/3RD PLACE — GROUP 3/i);
  await expect(rows.nth(2)).toContainText("40 M");
  await expect(rows.nth(3)).toContainText(/4TH PLACE — GROUP 4/i);
  await expect(rows.nth(3)).toContainText("30 M");
  await expect(host.getByText("It's a tie! Groups 1 & 2")).toBeVisible({ timeout: 8000 });

  // history (after the group finished) shows attempts & sources, no other groups
  await g1[1].goto("/history");
  await expect(g1[1].getByRole("heading", { name: "Dive log" })).toBeVisible();
  await expect(g1[1].locator(".log-entry")).toHaveCount(7);
  await expect(g1[1].locator(".log-entry").first()).toContainText("+20 m");
  await expect(g1[1].locator(".log-entry").first()).toContainText("Carbon dioxide");
  const deeHist = await (await request.get("/api/history", { headers: { "x-diver-token": dee.token } })).json();
  expect(deeHist.entries[0]).toMatchObject({ isCorrect: false, depthAwarded: 0, myAnswer: "wrong" });

  // P: visual system preserved — pixel fonts, panel style, ocean canvas on every screen
  for (const p of [host, g1[0]]) {
    await expect(p.locator("canvas.ocean-canvas")).toHaveCount(1);
    const font = await p.locator(".label").first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toContain("press");
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(31, 134, 209)");
  }
});
