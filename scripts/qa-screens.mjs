// Visual QA for the student-driven flow. Drives real browsers + HTTP bot students and saves screenshots.
// Usage: start a FRESH server, e.g.  PGLITE_DIR=memory NEXT_DIST_DIR=.next-qa npx next dev -p 3200
//        node scripts/qa-screens.mjs http://localhost:3200 qa/screenshots
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3200";
const OUT = process.argv[3] || "qa/screenshots";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const ANSWERS = ["co2", "ocean acidification", "carbonate ions", "aquaculture", "environmental injustice", "kelp", "OAE"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || "chrome" });
const DESK = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const errors = [];
const open = async (opts, tag) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  await page.goto(BASE);
  return page;
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
};
const join = async (page, g) => {
  await page.locator(".tile", { hasText: String(g) }).first().click();
  await page.click("text=Join group");
  await page.waitForSelector("text=players joined");
};
const answerUI = async (page, text) => {
  await page.waitForSelector("#answer:not([disabled])", { timeout: 15000 });
  await page.fill("#answer", text);
  await page.press("#answer", "Enter");
};
async function bot(group) {
  const r = await (await fetch(`${BASE}/api/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupNumber: group }) })).json();
  const h = { "x-diver-token": r.token, "Content-Type": "application/json" };
  return {
    async play(pattern) {
      await fetch(`${BASE}/api/start`, { method: "POST", headers: h });
      for (let i = 0; i < 7; i++) {
        let st = await (await fetch(`${BASE}/api/state`, { headers: h })).json();
        const w = st.me.questionStartedAt - st.serverNow;
        if (w > 0) await wait(w + 150);
        st = await (await fetch(`${BASE}/api/state`, { headers: h })).json();
        await fetch(`${BASE}/api/answer`, { method: "POST", headers: h, body: JSON.stringify({ questionId: st.question.id, answer: pattern[i] ? ANSWERS[i] : "nope" }) });
      }
    },
  };
}

const a = await open(DESK, "deskA");
const b = await open(PHONE, "phoneB");
await wait(1800);
await shot(a, "01-landing-desktop");
await shot(b, "01-landing-mobile");
await b.fill("#group", "7");
await b.click("text=Join group");
await wait(300);
await shot(b, "02-invalid-group-mobile");
await b.fill("#group", "");

await join(a, 1);
await join(b, 1);
const botsG1 = [await bot(1)];
await wait(1800);
await shot(a, "03-lobby-3of4-desktop");
await shot(b, "03-lobby-3of4-mobile");
botsG1.push(await bot(1));
await wait(1800);
await shot(a, "04-lobby-ready-desktop");
await shot(b, "04-lobby-ready-mobile");
const fifth = await open(PHONE, "fifth");
await wait(1500);
await fifth.locator(".tile", { hasText: "1" }).first().click();
await wait(300);
await shot(fifth, "05-group-full-mobile");

// A starts first (independently)
await a.click("text=Start game");
await wait(700);
await shot(a, "06-get-ready-desktop");
await wait(2800);
await shot(a, "07-question1-desktop");
await a.fill("#answer", "Carbon Dioxide");
await a.press("#answer", "Enter");
await wait(420);
await shot(a, "08a-correct-diving-desktop");
await wait(1300);
await shot(a, "08-correct-after-desktop");
await b.click("text=Start game");
await wait(3600);
await shot(b, "09-question1-mobile");
await b.fill("#answer", "methane");
await b.press("#answer", "Enter");
await wait(1200);
await shot(b, "10-incorrect-stay-mobile");
await wait(2400);
await shot(b, "11-question2-mobile");

// bots in group 1 play; A finishes all correct; B mixes
const g1bots = botsG1.map((x) => x.play([true, true, false, true, false, true, true]));
for (let i = 1; i < 7; i++) await answerUI(a, ANSWERS[i]);
await wait(600);
await shot(a, "12-deep-last-feedback-desktop");
for (let i = 1; i < 7; i++) await answerUI(b, i % 2 ? ANSWERS[i] : "nope");
await Promise.all(g1bots);
await wait(4500);
await shot(a, "13-waiting-desktop");
await shot(b, "13-waiting-mobile");

// the rest of the class (bots), groups 2–4
const rest = [];
for (const g of [2, 3, 4]) for (let i = 0; i < 4; i++) rest.push(await bot(g));
await Promise.all(rest.map((x, i) => x.play(i < 4 ? [true, true, true, false, true, false, true] : i < 8 ? [false, true, false, false, true, false, false] : [true, false, true, false, true, false, false])));
await wait(2500);
await shot(a, "14a-reveal-animating-desktop");
await wait(4500);
await shot(a, "14-results-desktop");
await shot(b, "14-results-mobile");
await b.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await wait(300);
await shot(b, "15-results-scrolled-mobile");
await a.click("text=View answer history");
await a.waitForSelector("text=Dive log");
await wait(1200);
await shot(a, "16-history-desktop");
await b.click("text=View answer history");
await b.waitForSelector("text=Dive log");
await wait(1200);
await shot(b, "16-history-mobile");

for (const [p, tag] of [[a, "deskA"], [b, "phoneB"]]) {
  const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (o > 0) errors.push(`${tag}: horizontal overflow ${o}px`);
}
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors / overflow");
await browser.close();
