// Visual QA for the host/player flow. Drives real browsers + HTTP bot students and saves screenshots.
// Usage: start a FRESH server with test hooks, e.g.
//   PGLITE_DIR=memory NEXT_DIST_DIR=.next-qa HOST_PASSWORD=qa-host-pw ENABLE_TEST_HOOKS=1 npx next dev -p 3200
//   node scripts/qa-screens.mjs http://localhost:3200 qa/screenshots
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3200";
const OUT = process.argv[3] || "qa/screenshots";
const PW = process.env.HOST_PASSWORD || "qa-host-pw";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const ANSWERS = ["co2", "ocean acidification", "carbonate ions", "aquaculture", "environmental injustice", "kelp", "OAE"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [];
const open = async (opts, tag, url = BASE) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !/401|409/.test(m.text()) && errors.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  await page.goto(url);
  return page;
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push(`${name}: horizontal overflow`);
  console.log("saved", name);
};
const clock = (ms) => fetch(`${BASE}/api/dev/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ advanceMs: ms }) });
const post = (p, body, token) =>
  fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-diver-token": token } : {}) }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());
const get = (p, token) => fetch(BASE + p, { headers: token ? { "x-diver-token": token } : {} }).then((r) => r.json());

const joinUI = async (page, g, name) => {
  await page.getByRole("button", { name: /PLAYER/ }).click();
  await page.locator(".tile", { hasText: String(g) }).first().click();
  await page.getByRole("button", { name: "Join group" }).click();
  await page.fill("#name", name);
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForSelector("text=Start game");
};
const answerUI = async (page, text) => {
  await page.waitForSelector("#answer:not([disabled])", { timeout: 20000 });
  await page.fill("#answer", text);
  await page.press("#answer", "Enter");
};

// 1. Entry + waiting for host
const deskP = await open(DESK, "desk-player");
await deskP.waitForSelector("text=PLAYER");
await wait(600);
await shot(deskP, "01-entry-desktop");
const phoneA = await open(PHONE, "phone-a");
await phoneA.waitForSelector("text=PLAYER");
await wait(400);
await shot(phoneA, "01-entry-mobile");
await deskP.getByRole("button", { name: /PLAYER/ }).click();
await deskP.waitForSelector("text=Waiting for the host");
await wait(700);
await shot(deskP, "02-await-host-desktop");

// 2. Host login
const host = await open(DESK, "host", `${BASE}/host`);
await host.waitForSelector("#host-pw");
await host.fill("#host-pw", "wrong");
await host.press("#host-pw", "Enter");
await host.waitForSelector("text=Incorrect host password");
await wait(150);
await shot(host, "03-host-login-wrong");
await host.fill("#host-pw", PW);
await host.press("#host-pw", "Enter");
await host.waitForSelector("text=The game is open");
await wait(600);
await shot(host, "04-host-open");

// 3. Player proceeds automatically, picks a group, profile popup
await deskP.waitForSelector("text=Choose your group", { timeout: 8000 });
await deskP.locator(".tile", { hasText: "1" }).first().click();
await shot(deskP, "05-groups-desktop");
await deskP.getByRole("button", { name: "Join group" }).click();
await deskP.fill("#name", "Alex");
await shot(deskP, "06-profile-popup-desktop");
await deskP.getByRole("button", { name: "Confirm" }).click();
await deskP.waitForSelector("text=Start game");
await wait(1700);
await shot(deskP, "07-lobby-solo-desktop");

await phoneA.reload();
await joinUI(phoneA, 1, "Jamie");
await deskP.waitForSelector("text=Jamie");
await shot(phoneA, "07-lobby-2-mobile");

// 4. Start (one press), get ready, Q1
await phoneA.getByRole("button", { name: "Start game" }).click();
await deskP.waitForSelector("text=Get ready", { timeout: 6000 });
await shot(deskP, "08-get-ready-desktop");
await deskP.waitForSelector("#answer:not([disabled])", { timeout: 8000 });
await wait(400);
await shot(deskP, "09-question1-desktop");
await shot(phoneA, "09-question1-mobile");

// wrong answer → red + bounce (mid-animation and settled)
await answerUI(deskP, "oxygen");
await deskP.waitForSelector("[data-testid=fb-wrong]");
await wait(120);
await shot(deskP, "10a-wrong-bounce-desktop");
await wait(700);
await shot(deskP, "10b-wrong-settled-desktop");
await answerUI(phoneA, "nitrogen");
await phoneA.waitForSelector("[data-testid=fb-wrong]");
await wait(500);
await shot(phoneA, "10c-wrong-mobile");

// correct → dive
await answerUI(deskP, ANSWERS[0]);
await deskP.waitForSelector("[data-testid=fb-correct]");
await wait(350);
await shot(deskP, "11a-correct-diving-desktop");
await wait(1500);
await shot(deskP, "11b-correct-waiting-team-desktop");

// final countdown on the phone player: jump to 30.6 s
const tokA = await phoneA.evaluate(() => JSON.parse(localStorage.getItem("oceandive.diver.v1")).token);
let st = await get("/api/state", tokA);
await clock(st.group.round.normalEndsAt - st.serverNow + 400);
await phoneA.waitForSelector(".final-count", { timeout: 6000 });
await wait(150);
await shot(phoneA, "12-final-countdown-mobile");
await answerUI(phoneA, ANSWERS[0]);
await phoneA.waitForSelector("[data-testid=fb-correct]", { timeout: 4000 });
await wait(400);
await shot(phoneA, "12b-final-correct-mobile");
// round closes early (both correct) → intermission
await deskP.waitForSelector("text=Next question in", { timeout: 6000 });
await shot(deskP, "13-intermission-desktop");

// 5. Q2..Q7 quickly: desktop answers fast, phone never answers (timeouts via clock)
for (let i = 1; i < 7; i++) {
  await answerUI(deskP, ANSWERS[i]);
  await deskP.waitForSelector("[data-testid=fb-correct]");
  if (i === 6) {
    await wait(1300);
    await shot(deskP, "14-deep-q7-desktop");
  }
  st = await get("/api/state", tokA);
  await clock(st.group.round.deadline - st.serverNow + 600);
  await wait(1300);
}

// complete screen (group finished; host still waiting on other groups)
await deskP.waitForSelector("text=Ocean Dive complete", { timeout: 15000 });
await wait(500);
await shot(deskP, "15-complete-desktop");
await phoneA.waitForSelector("text=Ocean Dive complete", { timeout: 15000 });
await shot(phoneA, "15-complete-mobile");
await host.waitForSelector("text=The challenge is in progress");
await wait(1200);
await shot(host, "16-host-waiting");

// history (unlocked because group 1 finished)
await deskP.getByRole("link", { name: "View answer history" }).click();
await deskP.waitForSelector("text=Dive log");
await wait(800);
await shot(deskP, "17-history-desktop");
await phoneA.getByRole("link", { name: "View answer history" }).click();
await phoneA.waitForSelector("text=Dive log");
await wait(600);
await shot(phoneA, "17-history-mobile");

// 6. Groups 2–4 via bots: join, start, answer some, then time out → reveal
for (const [g, n, depthSec] of [
  [2, 3, 4],
  [3, 2, 15],
  [4, 4, 25],
]) {
  const toks = [];
  for (let i = 0; i < n; i++) toks.push((await post("/api/join", { groupNumber: g, name: `Bot${g}-${i + 1}` })).token);
  await post("/api/start", {}, toks[0]);
  const s0 = await get("/api/state", toks[0]);
  await clock(s0.group.round.questionStartedAt - s0.serverNow + depthSec * 1000);
  for (const t of toks) await post("/api/answer", { questionId: s0.question.id, answer: ANSWERS[0] }, t);
}
await clock(15 * 60 * 1000);
await host.waitForSelector("text=final results", { timeout: 15000 });
await wait(900);
await shot(host, "18a-host-reveal-animating");
await wait(4000);
await shot(host, "18b-host-final-results");
const hostPhone = await open(PHONE, "host-phone", `${BASE}/host`);
await hostPhone.fill("#host-pw", PW);
await hostPhone.press("#host-pw", "Enter");
await hostPhone.waitForSelector("text=final results");
await wait(4500);
await shot(hostPhone, "18c-host-results-mobile");

await deskP.goto(BASE);
await deskP.waitForSelector("text=View answer history");
await wait(4000);
await shot(deskP, "19-player-results-desktop");

// group-started message
const late = await open(PHONE, "late");
await late.getByRole("button", { name: /PLAYER/ }).click();
await late.waitForSelector("text=Choose your group");
await wait(700);
await late.locator(".tile", { hasText: "2" }).first().click();
await wait(200);
await shot(late, "20-group-started-mobile");

console.log(errors.length ? `\nISSUES:\n${errors.join("\n")}` : "\nNo console errors, no horizontal overflow.");
await browser.close();
