"use client";

import { useEffect, useRef } from "react";
import {
  BOAT,
  CLOUD_A,
  CLOUD_B,
  CORAL,
  createSpriteCache,
  FISH_A,
  FISH_B,
  FISH_TINY,
  HOUSE_A,
  HOUSE_B,
  JELLY_A,
  JELLY_B,
  PROP_A,
  PROP_B,
  SHELL,
  SUB,
  type Sprite,
} from "./sprites";

/**
 * OceanScene — the living pixel-art ocean behind every student-facing screen.
 *
 * Rendering: a low-resolution canvas (1 art pixel = 3–4 CSS px) upscaled with
 * `image-rendering: pixelated`, redrawn every frame via requestAnimationFrame.
 * React only re-renders on prop changes; the loop reads everything from refs.
 *
 * Game meaning of motion:
 *  - camera depth follows the player's PERSONAL depth only. It changes when `depth` changes
 *    (a server-confirmed correct answer). Wrong/timeout feedback never moves the camera.
 *  - feedback "correct": eased dive + bubble trail + "+100 M" popup.
 *  - feedback "wrong"/"timeout": small horizontal shake / dim pulse, same depth.
 */

export type SceneMode = "landing" | "game";
export type SceneFeedback = { kind: "correct" | "wrong" | "timeout"; key: number } | null;

export interface OceanSceneProps {
  mode: SceneMode;
  depth: number;
  feedback?: SceneFeedback;
  showGauge?: boolean;
  maxGauge?: number;
  metersPerCorrect?: number;
}

const SEABED_M = 770;
const SUB_OFFSET_M = 10;
const LANDING_CAM_M = -18;
const ANCHOR = 0.3; // sub's vertical position as a fraction of the viewport
const DIVE_MS = 900;
const MODE_MS = 1500;

// depth color stops (meters -> rgb)
const STOPS: [number, [number, number, number]][] = [
  [0, [42, 157, 230]],
  [60, [31, 134, 209]],
  [180, [22, 107, 184]],
  [320, [15, 79, 151]],
  [480, [10, 54, 114]],
  [640, [6, 34, 79]],
  [820, [3, 20, 54]],
];

function depthRgb(d: number): [number, number, number] {
  if (d <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (d <= STOPS[i][0]) {
      const [d0, c0] = STOPS[i - 1];
      const [d1, c1] = STOPS[i];
      const k = (d - d0) / (d1 - d0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const rgb = (c: [number, number, number], mul = 1) =>
  `rgb(${Math.round(c[0] * mul)},${Math.round(c[1] * mul)},${Math.round(c[2] * mul)})`;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

interface Tween {
  from: number;
  to: number;
  start: number;
  dur: number;
}
const tweenValue = (tw: Tween, now: number) => {
  if (tw.dur <= 0) return tw.to;
  const k = Math.min(1, Math.max(0, (now - tw.start) / tw.dur));
  return tw.from + (tw.to - tw.from) * easeInOut(k);
};

interface Fish {
  d: number;
  x0: number;
  v: number;
  sprite: Sprite;
  tint: Record<string, string>;
  phase: number;
  par: number;
}

function buildWorld() {
  const rnd = mulberry32(20261123);
  const fish: Fish[] = [];
  const sunlit = [
    { a: "#ffd23f", d: "#f59e2b" },
    { a: "#ff9ec7", d: "#ff6f91" },
    { a: "#7fe8ff", d: "#3aa7e8" },
    { a: "#ffffff", d: "#a9d8f5" },
  ];
  for (let i = 0; i < 60; i++) {
    const d = 6 + rnd() * 720;
    const zone = d < 260 ? 0 : d < 520 ? 1 : 2;
    const col = zone === 0 ? sunlit[i % sunlit.length] : zone === 1 ? { a: "#8fb7ff", d: "#5c7fd6" } : { a: "#4ff0e0", d: "#1fb5c9" };
    fish.push({
      d,
      x0: rnd() * 2000,
      v: (rnd() < 0.5 ? -1 : 1) * (5 + rnd() * 9),
      sprite: zone === 2 ? FISH_TINY : rnd() < 0.55 ? FISH_A : FISH_B,
      tint: { a: col.a, d: col.d, e: "#0b1a3d" },
      phase: rnd() * 6.28,
      par: 1,
    });
  }
  // distant silhouettes (parallax)
  const far: Fish[] = [];
  for (let i = 0; i < 40; i++) {
    far.push({
      d: rnd() * 1300,
      x0: rnd() * 2000,
      v: (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 4),
      sprite: rnd() < 0.5 ? FISH_TINY : FISH_B,
      tint: {},
      phase: rnd() * 6.28,
      par: 0.55,
    });
  }
  const jellies = Array.from({ length: 12 }, () => ({ d: 220 + rnd() * 360, x0: rnd() * 2000, phase: rnd() * 6.28, v: 1 + rnd() * 2 }));
  const bubbles = Array.from({ length: 34 }, () => ({ d: rnd() * 120, x: rnd(), r: rnd() < 0.2 ? 2 : 1, v: 7 + rnd() * 8, wob: rnd() * 6.28 }));
  const snow = Array.from({ length: 70 }, () => ({ d: rnd() * 900, x: rnd(), v: 0.6 + rnd() * 1.2 }));
  const kelp = Array.from({ length: 16 }, () => ({ x: rnd(), h: 18 + rnd() * 34, phase: rnd() * 6.28 }));
  const corals = Array.from({ length: 6 }, () => ({ x: rnd(), hue: rnd() < 0.5 ? 0 : 1 }));
  const rocks = Array.from({ length: 9 }, () => ({ x: rnd(), w: 6 + rnd() * 14, h: 3 + rnd() * 6 }));
  const clouds = Array.from({ length: 6 }, (_, i) => ({ x0: rnd() * 1.4, alt: 12 + rnd() * 34, big: i % 2 === 0, v: 1 + rnd() * 2 }));
  const sparkles = Array.from({ length: 22 }, () => ({ x: rnd(), dy: 2 + rnd() * 10, phase: rnd() * 6.28 }));
  return { fish, far, jellies, bubbles, snow, kelp, corals, rocks, clouds, sparkles, rnd };
}

function makeWhale(): HTMLCanvasElement {
  const w = 46;
  const h = 14;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const bx = (x - 18) / 17;
      const by = (y - 7) / 5.2;
      const body = bx * bx + by * by < 1;
      const tail = x > 33 && x < 46 && Math.abs(y - 7 + (x - 33) * 0.35) < 1.2 + (x - 33) * 0.12;
      const fin = x > 12 && x < 18 && y > 9 && y < 13 && y - 9 < (x - 12) * 0.8;
      if (body || tail || fin) ctx.fillRect(x, y, 1, 1);
    }
  return c;
}

export default function OceanScene({ mode, depth, feedback = null, showGauge = false, maxGauge = 800, metersPerCorrect = 100 }: OceanSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const depthLabelRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const live = useRef({
    mode,
    cam: { from: mode === "landing" ? LANDING_CAM_M : depth + SUB_OFFSET_M, to: mode === "landing" ? LANDING_CAM_M : depth + SUB_OFFSET_M, start: 0, dur: 0 } as Tween,
    blend: { from: mode === "landing" ? 0 : 1, to: mode === "landing" ? 0 : 1, start: 0, dur: 0 } as Tween,
    depth,
    shakeUntil: 0,
    pulseUntil: 0,
    diveUntil: 0,
    reduced: false,
    burst: [] as { d: number; x: number; v: number; born: number }[],
  });

  // React to mode/depth/feedback changes by setting tween targets (no re-render of the loop).
  useEffect(() => {
    const L = live.current;
    const now = performance.now();
    const target = mode === "landing" ? LANDING_CAM_M : depth + SUB_OFFSET_M;
    const modeChanged = L.mode !== mode;
    const cur = tweenValue(L.cam, now);
    if (Math.abs(target - L.cam.to) > 0.01) {
      const dur = L.reduced ? 0 : modeChanged ? MODE_MS : DIVE_MS;
      L.cam = { from: cur, to: target, start: now, dur };
      if (!modeChanged && target > cur) L.diveUntil = now + dur;
    }
    if (modeChanged) {
      const b = tweenValue(L.blend, now);
      L.blend = { from: b, to: mode === "landing" ? 0 : 1, start: now, dur: L.reduced ? 0 : MODE_MS };
    }
    L.mode = mode;
    L.depth = depth;
  }, [mode, depth]);

  useEffect(() => {
    if (!feedback) return;
    const L = live.current;
    const now = performance.now();
    if (feedback.kind === "correct") {
      for (let i = 0; i < 26; i++) L.burst.push({ d: 0, x: (Math.random() - 0.5) * 18, v: 6 + Math.random() * 14, born: now + i * 18 });
      return;
    }
    L.shakeUntil = now + (L.reduced ? 0 : 420);
    L.pulseUntil = now + 700;
  }, [feedback]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const sprites = createSpriteCache();
    const world = buildWorld();
    const whale = makeWhale();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const L = live.current;
    L.reduced = mq.matches;
    const onMq = () => (L.reduced = mq.matches);
    mq.addEventListener("change", onMq);

    let P = 4;
    let cw = 0;
    let ch = 0;
    let lastW = 0;
    let lastH = 0;
    const resize = () => {
      const W = window.innerWidth;
      let H = window.innerHeight;
      // Phone keyboards shrink innerHeight: keep the taller height so the scene does not jump.
      if (W === lastW && H < lastH) H = lastH;
      lastW = W;
      lastH = H;
      P = W >= 900 ? 4 : 3;
      cw = Math.ceil(W / P);
      ch = Math.ceil(H / P);
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${cw * P}px`;
      canvas.style.height = `${ch * P}px`;
      ctx.imageSmoothingEnabled = false;
      const M = (ch * 0.9) / 100;
      wrapRef.current?.style.setProperty("--mpx", `${M * P}px`);
      wrapRef.current?.style.setProperty("--anchor", `${ANCHOR * ch * P}px`);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let running = true;
    const t0 = performance.now();
    let lastFrame = t0;

    const draw = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(draw);
      // ~30fps on reduced motion / hidden, full rate otherwise
      if (L.reduced && now - lastFrame < 66) return;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const t = L.reduced ? 0 : (now - t0) / 1000;
      const M = (ch * 0.9) / 100;
      const anchor = ANCHOR * ch;
      const cam = tweenValue(L.cam, now);
      const blend = tweenValue(L.blend, now);
      const sy = (d: number) => anchor + (d - cam) * M;
      const wl = sy(0);
      const wli = Math.round(wl);

      // ---------- sky
      if (wli + 4 > 0) {
        const top: [number, number, number] = [103, 184, 242];
        const hor: [number, number, number] = [200, 236, 255];
        const skyH = Math.max(1, wli + 4);
        for (let y = 0; y < Math.min(ch, wli + 4); y += 3) {
          const k = Math.min(1, Math.max(0, (y + (skyH - Math.min(skyH, ch * 0.7))) / skyH));
          const kq = Math.round(k * 10) / 10;
          ctx.fillStyle = rgb([top[0] + (hor[0] - top[0]) * kq, top[1] + (hor[1] - top[1]) * kq, top[2] + (hor[2] - top[2]) * kq]);
          ctx.fillRect(0, y, cw, 3);
        }
        // sun
        const sunX = Math.round(cw * 0.9);
        const sunY = Math.round(wl - ch * 0.38);
        if (sunY > -20) {
          ctx.fillStyle = "#fff6c2";
          ctx.fillRect(sunX - 6, sunY - 4, 12, 8);
          ctx.fillRect(sunX - 4, sunY - 6, 8, 12);
          ctx.fillStyle = "#ffe98a";
          ctx.fillRect(sunX - 4, sunY - 4, 8, 8);
        }
        // clouds
        for (const c of world.clouds) {
          const spr = sprites.get(c.big ? CLOUD_A : CLOUD_B);
          const span = cw + 60;
          const x = Math.round((((c.x0 * span + t * c.v) % span) + span) % span) - 30;
          const y = Math.round(wl - c.alt * M * 0.55 - 8);
          if (y < wl - 6) ctx.drawImage(spr, x, y);
        }
        // coastal town on the left horizon
        const baseY = wli - 1;
        ctx.fillStyle = "#4d8c6e";
        ctx.fillRect(0, baseY - 5, Math.round(cw * 0.2), 6);
        ctx.fillRect(0, baseY - 8, Math.round(cw * 0.12), 4);
        ctx.fillStyle = "#3f7a5e";
        ctx.fillRect(0, baseY - 2, Math.round(cw * 0.22), 3);
        const houses = [HOUSE_A, HOUSE_B, HOUSE_A, HOUSE_B];
        houses.forEach((h, i) => {
          const spr = sprites.get(h);
          const hx = 2 + i * 9;
          if (hx < cw * 0.2) ctx.drawImage(spr, hx, baseY - (i % 2 ? 8 : 12) - spr.height + 4);
        });
        // pier
        ctx.fillStyle = "#6b4a2b";
        ctx.fillRect(Math.round(cw * 0.2), baseY - 1, 14, 2);
        ctx.fillRect(Math.round(cw * 0.2) + 3, baseY, 1, 4);
        ctx.fillRect(Math.round(cw * 0.2) + 11, baseY, 1, 4);
      }

      // ---------- water body (banded by depth)
      const startY = Math.max(0, wli + 3);
      for (let y = startY - (startY % 2); y < ch; y += 2) {
        const d = cam + (y - anchor) / M;
        const dq = Math.floor(d / 9) * 9;
        ctx.fillStyle = rgb(depthRgb(dq));
        ctx.fillRect(0, y, cw, 2);
      }

      // ---------- light rays near the surface
      const rayStrength = Math.max(0, 1 - Math.max(0, cam) / 280);
      if (rayStrength > 0.02) {
        ctx.save();
        ctx.globalAlpha = 0.07 * rayStrength;
        ctx.fillStyle = "#e8f8ff";
        for (let i = 0; i < 6; i++) {
          const x = (i / 6) * cw + Math.sin(t * 0.3 + i) * 8;
          const top = Math.max(wl + 3, 0);
          const len = 260 * M;
          ctx.beginPath();
          ctx.moveTo(Math.round(x), top);
          ctx.lineTo(Math.round(x + 10), top);
          ctx.lineTo(Math.round(x + 10 + len * 0.35), top + len);
          ctx.lineTo(Math.round(x + len * 0.35 - 6), top + len);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      const span = cw + 40;
      const wrapX = (x0: number, v: number) => Math.round((((x0 + v * t) % span) + span) % span) - 20;

      // ---------- far silhouettes (parallax)
      for (const f of world.far) {
        const y = Math.round(anchor + (f.d - cam * f.par) * M * f.par + Math.sin(t + f.phase) * 1.5);
        if (y < wl + 6 || y > ch + 10 || y < -10) continue;
        const dd = cam + (y - anchor) / M;
        const c = depthRgb(dd);
        const spr = sprites.get(f.sprite, { a: rgb(c, 0.72), d: rgb(c, 0.72), e: rgb(c, 0.72) }, f.v > 0);
        ctx.drawImage(spr, wrapX(f.x0, f.v), y);
      }
      // whale (between 120 and 340 m, slow)
      {
        const wd = 230;
        const y = Math.round(anchor + (wd - cam * 0.5) * M * 0.5);
        if (y > wl + 10 && y < ch + 20) {
          ctx.save();
          ctx.globalAlpha = 0.22;
          const wx = Math.round((((cw + 80 - t * 3) % (cw + 120)) + cw + 120) % (cw + 120)) - 60;
          ctx.drawImage(whale, wx, y);
          ctx.restore();
        }
      }

      // ---------- marine snow / glow (visible deeper)
      for (const s of world.snow) {
        s.d += s.v * dt;
        const viewTop = cam - anchor / M;
        const viewBot = cam + (ch - anchor) / M;
        if (s.d > viewBot + 5) s.d = viewTop - 2;
        if (s.d < viewTop - 5) s.d = viewBot;
        if (s.d < 40) continue;
        const y = Math.round(sy(s.d));
        const alpha = Math.min(0.85, (s.d - 40) / 400);
        ctx.fillStyle = s.d > 450 ? `rgba(79,240,224,${alpha * 0.8})` : `rgba(232,248,255,${alpha * 0.5})`;
        ctx.fillRect(Math.round(s.x * cw + Math.sin(t * 0.5 + s.d) * 2), y, 1, 1);
      }

      // ---------- seabed
      const bedY = Math.round(sy(SEABED_M));
      if (bedY < ch + 60) {
        for (const k of world.kelp) {
          const kx = Math.round(k.x * cw);
          for (let i = 0; i < k.h; i++) {
            const sway = Math.round(Math.sin(t * 1.2 + k.phase + i * 0.15) * (i / k.h) * 4);
            ctx.fillStyle = i % 6 < 3 ? "#1d7f63" : "#239a74";
            ctx.fillRect(kx + sway, bedY - i, 2, 1);
            if (i % 7 === 3) ctx.fillRect(kx + sway + (i % 14 === 3 ? 2 : -2), bedY - i, 2, 1);
          }
        }
        ctx.fillStyle = "#3b3f74";
        ctx.fillRect(0, bedY, cw, ch);
        for (let x = 0; x < cw; x += 2) {
          const bump = Math.round(Math.sin(x * 0.07) * 2 + Math.sin(x * 0.19) * 1);
          ctx.fillStyle = "#4b4f87";
          ctx.fillRect(x, bedY - 2 + bump, 2, 3);
          ctx.fillStyle = "#5c5f99";
          ctx.fillRect(x, bedY - 2 + bump, 2, 1);
        }
        for (const r of world.rocks) {
          ctx.fillStyle = "#262b52";
          ctx.fillRect(Math.round(r.x * cw), bedY - r.h, Math.round(r.w), Math.round(r.h) + 1);
          ctx.fillStyle = "#33386a";
          ctx.fillRect(Math.round(r.x * cw) + 1, bedY - r.h, Math.round(r.w) - 2, 1);
        }
        for (const c of world.corals) {
          const spr = sprites.get(CORAL, c.hue ? { P: "#ff9ec7" } : undefined);
          ctx.drawImage(spr, Math.round(c.x * cw), bedY - spr.height + 1);
        }
        const shell = sprites.get(SHELL);
        ctx.drawImage(shell, Math.round(cw * 0.62), bedY - 2);
        ctx.drawImage(shell, Math.round(cw * 0.18), bedY);
      }

      // ---------- jellyfish
      for (const j of world.jellies) {
        const y = Math.round(sy(j.d + Math.sin(t * 0.8 + j.phase) * 4));
        if (y < wl + 8 || y > ch + 10 || y < -10) continue;
        const spr = sprites.get(Math.floor(t * 2 + j.phase) % 2 ? JELLY_A : JELLY_B);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(spr, wrapX(j.x0, j.v * 0.6), y);
        ctx.restore();
      }

      // ---------- fish
      for (const f of world.fish) {
        const y = Math.round(sy(f.d) + Math.sin(t * 1.6 + f.phase) * 1.2);
        if (y < wl + 5 || y > ch + 8 || y < -8) continue;
        ctx.drawImage(sprites.get(f.sprite, f.tint, f.v > 0), wrapX(f.x0, f.v), y);
      }

      // ---------- ambient bubbles (world-space so they scroll with the dive)
      const viewTop = cam - anchor / M;
      const viewBot = cam + (ch - anchor) / M;
      for (const b of world.bubbles) {
        b.d -= b.v * dt;
        if (b.d < Math.max(1, viewTop) || b.d > viewBot + 20) {
          b.d = viewBot + world.rnd() * 25;
          b.x = world.rnd();
        }
        const y = Math.round(sy(b.d));
        if (y < wl + 4) continue;
        const x = Math.round(b.x * cw + Math.sin(t * 2 + b.wob) * 1.5);
        ctx.fillStyle = "rgba(200,241,255,0.75)";
        if (b.r === 1) ctx.fillRect(x, y, 1, 1);
        else {
          ctx.fillRect(x, y - 1, 2, 1);
          ctx.fillRect(x - 1, y, 1, 2);
          ctx.fillRect(x + 2, y, 1, 2);
          ctx.fillRect(x, y + 2, 2, 1);
        }
      }

      // ---------- submarine
      // darkness of the deep is applied to the world, not to the player's sub
      const dark = Math.min(0.32, Math.max(0, cam - 60) / 2000);
      if (dark > 0) {
        ctx.fillStyle = `rgba(2,10,30,${dark})`;
        ctx.fillRect(0, 0, cw, ch);
      }
      const subSpr = sprites.get(SUB);
      const bob = Math.round(Math.sin(t * 1.8) * (blend > 0.5 ? 1.2 : 0.8));
      let shakeX = 0;
      if (now < L.shakeUntil) shakeX = Math.round(Math.sin(now / 22) * 2);
      const subXLanding = cw * (cw < 160 ? 0.6 : 0.7);
      const subXGame = cw * 0.5 - subSpr.width / 2;
      const subX = Math.round(subXLanding + (subXGame - subXLanding) * blend) + shakeX;
      const subYLanding = wl - subSpr.height + 5;
      const subYGame = anchor - subSpr.height / 2;
      const subY = Math.round(subYLanding + (subYGame - subYLanding) * blend) + bob;
      const diving = now < L.diveUntil;
      // propeller + bubble trail
      const propSpr = sprites.get(Math.floor(t * (diving ? 24 : 8)) % 2 ? PROP_A : PROP_B);
      ctx.drawImage(propSpr, subX - 3, subY + 5);
      if (diving || Math.floor(t * 3) % 5 === 0) {
        ctx.fillStyle = "rgba(200,241,255,0.8)";
        const n = diving ? 6 : 1;
        for (let i = 0; i < n; i++) {
          const by = subY + 6 - ((t * 60 + i * 7) % 30);
          if (by > wl + 3) ctx.fillRect(subX - 5 - (i % 3), Math.round(by), 1, 1);
        }
      }
      ctx.drawImage(subSpr, subX, subY);
      // nose lamp blinks in the deep
      if (cam > 250 && blend > 0.9 && Math.floor(t * 2) % 2 === 0) {
        ctx.fillStyle = "#fff6c2";
        ctx.fillRect(subX + subSpr.width, subY + 8, 1, 1);
        ctx.fillStyle = "rgba(255,246,194,0.35)";
        ctx.fillRect(subX + subSpr.width + 1, subY + 7, 2, 3);
      }
      // correct-answer bubble burst (rises from the sub)
      if (L.burst.length) {
        ctx.fillStyle = "rgba(232,248,255,0.9)";
        L.burst = L.burst.filter((b) => now - b.born < 1300);
        for (const b of L.burst) {
          if (now < b.born) continue;
          const age = (now - b.born) / 1000;
          const y = Math.round(subY + 6 - age * b.v * 4);
          const x = Math.round(subX + subSpr.width / 2 + b.x + Math.sin(age * 8 + b.x) * 2);
          if (y > wl + 3) ctx.fillRect(x, y, age < 0.5 ? 2 : 1, age < 0.5 ? 2 : 1);
        }
      }

      // ---------- surface waves
      if (wli > -6 && wli < ch + 6) {
        for (let x = 0; x < cw; x++) {
          const h = Math.round(1.6 * Math.sin(x * 0.16 + t * 1.7) + 1.2 * Math.sin(x * 0.043 - t * 0.9));
          const yTop = wli + h - 1;
          ctx.fillStyle = "#3fb0f0";
          ctx.fillRect(x, yTop, 1, wli + 4 - yTop);
          ctx.fillStyle = Math.sin(x * 0.16 + t * 1.7) > 0.55 ? "#e8f8ff" : "#8fdcff";
          ctx.fillRect(x, yTop, 1, 1);
        }
        ctx.fillStyle = "#e8f8ff";
        for (const s of world.sparkles) {
          if (Math.sin(t * 2.5 + s.phase) > 0.6) ctx.fillRect(Math.round(s.x * cw), wli + 4 + Math.round(s.dy), 2, 1);
        }
        // support boat
        const boat = sprites.get(BOAT);
        const bx = Math.round(cw * (cw < 160 ? 0.72 : 0.79));
        const bh = Math.round(1.6 * Math.sin(bx * 0.16 + t * 1.7));
        ctx.drawImage(boat, bx, wli - boat.height + 4 + bh);
        // translucent water in front of floating objects
        ctx.fillStyle = "rgba(42,157,230,0.55)";
        ctx.fillRect(0, wli + 2, cw, 3);
      }

      // ---------- depth darkness + vignette, wrong-answer dim pulse
      if (now < L.pulseUntil) {
        const k = (L.pulseUntil - now) / 700;
        ctx.fillStyle = `rgba(255,111,145,${0.12 * Math.sin(k * Math.PI)})`;
        ctx.fillRect(0, 0, cw, ch);
      }

      // ---------- gauge (DOM)
      if (rulerRef.current) rulerRef.current.style.transform = `translate3d(0, ${Math.round((wl + SUB_OFFSET_M * M) * P)}px, 0)`;
      if (depthLabelRef.current) {
        const shown = Math.max(0, Math.round(cam - SUB_OFFSET_M));
        const txt = `${blend < 0.5 ? 0 : shown} M`;
        if (depthLabelRef.current.textContent !== txt) depthLabelRef.current.textContent = txt;
      }
    };
    raf = requestAnimationFrame(draw);

    const onVis = () => {
      running = !document.hidden;
      if (running) {
        lastFrame = performance.now();
        raf = requestAnimationFrame(draw);
      } else cancelAnimationFrame(raf);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  const ticks: number[] = [];
  for (let d = 0; d <= maxGauge; d += 10) ticks.push(d);

  return (
    <div ref={wrapRef} className="ocean-scene" aria-hidden="true">
      <canvas ref={canvasRef} className="ocean-canvas" />
      {showGauge && (
        <div className="gauge">
          <div ref={rulerRef} className="gauge-ruler">
            {ticks.map((d) => (
              <div key={d} className={`gauge-tick ${d % 50 === 0 ? "major" : ""}`} style={{ top: `calc(var(--mpx) * ${d})` }}>
                {d % 50 === 0 && <span>{d}</span>}
              </div>
            ))}
          </div>
          <div className="gauge-marker">
            <span ref={depthLabelRef}>0 M</span>
          </div>
        </div>
      )}
      {feedback?.kind === "correct" && (
        <div key={feedback.key} className="dive-popup">
          +{metersPerCorrect} M
        </div>
      )}
    </div>
  );
}
