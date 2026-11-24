import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// Full 4 × 4 classroom: 5 real browser contexts + 11 HTTP "bot" students. No teacher anywhere.
const ANSWERS = ["co2", "ocean acidification", "carbonate ions", "aquaculture", "environmental injustice", "kelp", "OAE"];

async function diver(browser: Browser, group: string, mobile = false): Promise<Page> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.locator(".tile", { hasText: group }).first().click();
  await page.click("text=Join group");
  await expect(page.getByText(new RegExp(`Group ${group} — \\d of 4 players joined`))).toBeVisible();
  return page;
}

const tokenOf = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem("oceandive.diver.v1")!).token as string);
const stateOf = (p: Page) =>
  p.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem("oceandive.diver.v1")!).token;
    return (await fetch("/api/state", { headers: { "x-diver-token": t } })).json();
  });

/** A bot student that joins and plays through the HTTP API. */
async function bot(request: APIRequestContext, group: number) {
  const r = await (await request.post("/api/join", { data: { groupNumber: group } })).json();
  const h = { "x-diver-token": r.token };
  return {
    token: r.token as string,
    async play(pattern: boolean[]) {
      expect((await request.post("/api/start", { headers: h })).ok()).toBe(true);
      for (let i = 0; i < 7; i++) {
        let st = await (await request.get("/api/state", { headers: h })).json();
        const wait = st.me.questionStartedAt - st.serverNow;
        if (wait > 0) await new Promise((res) => setTimeout(res, wait + 150));
        st = await (await request.get("/api/state", { headers: h })).json();
        const res = await request.post("/api/answer", { headers: h, data: { questionId: st.question.id, answer: pattern[i] ? ANSWERS[i] : "nope" } });
        expect(res.ok()).toBe(true);
      }
    },
  };
}

/** Answer the visible question through the real UI. */
async function answerUI(p: Page, text: string) {
  const input = p.locator("#answer");
  await expect(input).toBeEnabled({ timeout: 10000 });
  await input.fill(text);
  await input.press("Enter");
}

test("student-driven classroom: join, start, play at own pace, hidden scores, automatic reveal", async ({ browser, request }) => {
  // 1–2. Four students join group 1; Start unlocks only at 4/4.
  const g1: Page[] = [];
  for (let i = 0; i < 3; i++) g1.push(await diver(browser, "1", i % 2 === 1));
  await expect(g1[0].getByText("Group 1 — 3 of 4 players joined")).toBeVisible({ timeout: 6000 });
  await expect(g1[0].getByRole("button", { name: "Start game" })).toBeDisabled();
  await expect(g1[0].getByText("Waiting for 1 more diver")).toBeVisible();
  g1.push(await diver(browser, "1", true));
  for (const p of g1) {
    await expect(p.getByText("Group 1 — 4 of 4 players joined")).toBeVisible({ timeout: 6000 });
    await expect(p.getByRole("button", { name: "Start game" })).toBeEnabled();
  }
  // a fifth is refused
  const fifthCtx = await browser.newContext();
  const fifth = await fifthCtx.newPage();
  await fifth.goto("/");
  await fifth.locator(".tile", { hasText: "1" }).first().click();
  await expect(fifth.getByText("Group 1 is full. Please confirm your group number.")).toBeVisible();

  // Group 2: one real student + (later) three bots. Group 2 is still waiting while group 1 plays.
  const g2 = await diver(browser, "2");
  await expect(g2.getByRole("button", { name: "Start game" })).toBeDisabled();

  // 3. Each group-1 student starts on their own, at different times.
  await g1[0].click("text=Start game");
  await expect(g1[0].getByText("Get ready")).toBeVisible();
  await expect(g1[1].getByRole("button", { name: "Start game" })).toBeVisible(); // not started for them
  // 5–6. correct dives / wrong stays put
  await answerUI(g1[0], "carbon dioxide");
  await expect(g1[0].getByText("Correct! +1 group credit")).toBeVisible();
  await expect(g1[0].locator(".hud").getByText("100 M")).toBeVisible();
  await g1[1].click("text=Start game");
  await answerUI(g1[1], "methane");
  await expect(g1[1].getByText("Not quite. +0 credit")).toBeVisible();
  await expect(g1[1].locator(".hud").getByText("0 M")).toBeVisible();
  await expect(g1[1].locator(".hud").getByText("Group credits: 1")).toBeVisible({ timeout: 6000 });
  await expect(g1[1].getByText(/carbon dioxide/i)).toHaveCount(0);
  // replays never add credit
  const tA = await tokenOf(g1[0]);
  const replays = await Promise.all(
    Array.from({ length: 4 }, () => request.post("/api/answer", { headers: { "x-diver-token": tA }, data: { questionId: "q1-co2", answer: "co2" } }).then((r) => r.json())),
  );
  expect(replays.map((r) => r.groupCredits)).toEqual([1, 1, 1, 1]);

  // 4. group 1 races ahead at different speeds; 11. a refresh keeps progress
  await g1[2].click("text=Start game");
  await g1[3].click("text=Start game");
  const g1Patterns = [
    [true, true, true, true, true, true, true],
    [false, true, false, true, false, true, false],
    [true, true, true, true, true, true, true],
    [true, false, true, false, true, false, true],
  ];
  await Promise.all(
    g1.map(async (p, k) => {
      for (let i = k <= 1 ? 1 : 0; i < 7; i++) {
        if (k === 2 && i === 2) {
          await p.reload();
          await expect(p.locator(".hud").getByText("200 M")).toBeVisible({ timeout: 8000 });
        }
        await answerUI(p, g1Patterns[k][i] ? ANSWERS[i] : "nope");
        await expect(p.getByText(/Correct! \+1 group credit|Not quite\. \+0 credit/)).toBeVisible();
      }
    }),
  );

  // 7. finished students see the waiting screen; 8. scores of other groups stay hidden
  for (const p of g1) await expect(p.getByText("Great job!")).toBeVisible({ timeout: 10000 });
  await expect(g1[0].getByText("Waiting for everyone to finish before revealing the final results")).toBeVisible();
  await expect(g1[0].getByText(/4 of 16 divers finished/)).toBeVisible({ timeout: 6000 });
  const g1credits = 7 + 3 + 7 + 4;
  const g2view = await stateOf(g2);
  expect(g2view.leaderboard).toBeNull();
  expect(JSON.stringify(g2view)).not.toContain(`"credits":${g1credits}`);
  expect(await g2.locator("body").innerText()).not.toContain(String(g1credits));
  const locked = await request.get("/api/history", { headers: { "x-diver-token": tA } });
  expect(locked.status()).toBe(403);

  // Other students: bots fill groups 2–4 and play at their own pace.
  const bots2 = [await bot(request, 2), await bot(request, 2), await bot(request, 2)];
  const bots3 = [await bot(request, 3), await bot(request, 3), await bot(request, 3), await bot(request, 3)];
  const bots4 = [await bot(request, 4), await bot(request, 4), await bot(request, 4), await bot(request, 4)];
  const half = [true, false, true, false, true, false, true];
  const none = [false, false, false, false, false, false, false];
  await Promise.all([...bots2.map((b) => b.play(half)), ...bots3.map((b) => b.play(none)), ...bots4.slice(1).map((b) => b.play(half))]);
  await bots4[0].play([true, true, false, false, false, false, false]);
  // 15 of 16 done: still no leaderboard
  await expect(g1[0].getByText(/15 of 16 divers finished/)).toBeVisible({ timeout: 6000 });
  expect((await stateOf(g1[0])).leaderboard).toBeNull();

  // The last real student (group 2) plays through the UI → automatic reveal on every device.
  await g2.getByRole("button", { name: "Start game" }).click();
  for (let i = 0; i < 7; i++) {
    await answerUI(g2, ANSWERS[i]);
    await expect(g2.getByText("Correct! +1 group credit")).toBeVisible();
  }
  for (const p of [...g1, g2]) await expect(p.getByText("Group 1 wins!")).toBeVisible({ timeout: 12000 });

  // 10. identical rankings everywhere
  const boards = await Promise.all([...g1, g2].map(async (p) => (await stateOf(p)).leaderboard));
  expect(new Set(boards.map((b) => JSON.stringify(b))).size).toBe(1);
  expect(boards[0].map((r: { groupNumber: number; credits: number }) => [r.groupNumber, r.credits])).toEqual([
    [1, 21],
    [2, 19],
    [4, 14],
    [3, 0],
  ]);
  await expect(g2.locator(".lb-row").first()).toContainText("21/28");

  // 12. answer history
  await g1[1].getByRole("link", { name: "View answer history" }).click();
  await expect(g1[1].getByRole("heading", { name: "Dive log" })).toBeVisible();
  await expect(g1[1].locator("article")).toHaveCount(7);
  await expect(g1[1].locator("article").first()).toContainText("methane");
  await expect(g1[1].locator("article").first()).toContainText("Carbon dioxide (CO₂)");
  const links = await g1[1].locator("article a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(links).toHaveLength(7);
});

test("English only, no language controls, answer key not shipped to the browser", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Join group")).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(/[぀-ヿ㐀-鿿가-힯]/.test(text)).toBe(false);
  await expect(page.getByText(/language|translate/i)).toHaveCount(0);
  const scripts = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter(Boolean));
  let all = "";
  for (const src of scripts) all += await (await page.request.get(src)).text();
  expect(all.length).toBeGreaterThan(1000);
  for (const secret of ["carbon dioxide gas", "ocean alkalinity addition", "unequal environmental burden", "shellfish aquaculture"]) {
    expect(all.includes(secret), secret).toBe(false);
  }
});

test("there is no teacher interface, and forged tokens cannot play", async ({ request }) => {
  expect((await request.get("/presenter")).status()).toBe(404);
  expect((await request.get("/api/presenter/state")).status()).toBe(404);
  const r = await request.post("/api/answer", { headers: { "x-diver-token": "A".repeat(43) }, data: { questionId: "q1-co2", answer: "co2" } });
  expect(r.status()).toBe(401);
  expect((await request.post("/api/start", { headers: { "x-diver-token": "A".repeat(43) } })).status()).toBe(401);
});
