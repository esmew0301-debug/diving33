"use client";

import { useEffect, useRef, useState } from "react";
import { FULL_DARK_M, ZONES, zoneIndexAt } from "@/lib/zones";
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
  SHRIMP,
  STARFISH,
  SQUID_A,
  SQUID_B,
  DEEPFISH,
  LANTERN,
  ANGLER,
  DUMBO_A,
  DUMBO_B,
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
 *  - feedback "correct": eased dive + bubble trail + "+30 M" popup (bigger rewards dive further,
 *    a little longer, and with more bubbles).
 *  - `visualScale` maps real meters to scene meters (gauge labels always show real meters).
 *  - feedback "wrong"/"timeout": small horizontal shake / dim pulse, same depth.
 */

export type SceneMode = "landing" | "game";
export type SceneFeedback = { kind: "correct" | "wrong" | "timeout"; key: number; meters?: number } | null;

export interface OceanSceneProps {
  mode: SceneMode;
  depth: number;
  feedback?: SceneFeedback;
  showGauge?: boolean;
  maxGauge?: number;
  /** Scene meters per real meter (default 1). */
  visualScale?: number;
}

/** Sea floor, REAL meters (glimpsed only at the very bottom of a perfect run). */
const SEABED_REAL_M = 232;
const SUB_OFFSET_M = 10;
const LANDING_CAM_M = -18;
const ANCHOR = 0.3; // sub's vertical position as a fraction of the viewport
const DIVE_MS = 900;
const MODE_MS = 1500;

// Water color by REAL depth (meters): bright blue → blue → dark blue → indigo → a rich deep navy at 170 m,
// which then stays constant (never black).
const STOPS: [number, [number, number, number]][] = [
  [0, [42, 157, 230]],
  [20, [31, 134, 209]],
  [45, [23, 110, 188]],
  [70, [18, 88, 163]],
  [95, [15, 66, 134]],
  [120, [13, 48, 108]],
  [145, [12, 33, 84]],
  [FULL_DARK_M, [9, 22, 62]],
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
  /** REAL meters */
  d: number;
  x0: number;
  v: number;
  sprite: Sprite;
  tint: Record<string, string>;
  phase: number;
  par: number;
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/**
 * The ocean's inhabitants, placed by REAL depth so each zone has its own fauna:
 *  shallow (0–40 m)  bright fish, shrimp, a reef ledge with starfish & shells
 *  mid     (40–90)   squid, medium fish, fish schools, jellyfish, a far whale
 *  deep    (90–140)  dark fish with glowing eyes, a giant shadow, glow jellies
 *  abyss   (140+)    anglerfish, lanternfish in green/blue/yellow/purple, a rare dumbo octopus
 * Counts are kept low so the scene stays readable.
 */
function buildWorld() {
  const rnd = mulberry32(20261123);
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const dir = () => (rnd() < 0.5 ? -1 : 1);
  const sunlit = [
    { a: "#ffd23f", d: "#f59e2b" },
    { a: "#ff9ec7", d: "#ff6f91" },
    { a: "#7fe8ff", d: "#3aa7e8" },
    { a: "#ffffff", d: "#a9d8f5" },
  ];
  // shallow: colorful small fish
  const fish: Fish[] = [];
  for (let i = 0; i < 14; i++) {
    const col = sunlit[i % sunlit.length];
    fish.push({ d: between(3, 38), x0: rnd() * 2000, v: dir() * between(6, 13), sprite: rnd() < 0.5 ? FISH_A : FISH_B, tint: { a: col.a, d: col.d, e: "#0b1a3d" }, phase: rnd() * 6.28, par: 1 });
  }
  // mid: medium blue/silver fish
  for (let i = 0; i < 8; i++) {
    const silver = i % 3 === 0;
    fish.push({ d: between(42, 88), x0: rnd() * 2000, v: dir() * between(4, 8), sprite: FISH_A, tint: silver ? { a: "#d6e4f5", d: "#8fa6c6", e: "#0b1a3d" } : { a: "#8fb7ff", d: "#5c7fd6", e: "#0b1a3d" }, phase: rnd() * 6.28, par: 1 });
  }
  const shrimp = Array.from({ length: 6 }, (_, i) => ({
    d: between(5, 34),
    x0: rnd() * 2000,
    v: dir() * between(3, 6),
    phase: rnd() * 6.28,
    tint: i % 2 ? { a: "#ffd6c9", p: "#ff9e7a", P: "#ff6f91", e: "#0b1a3d" } : { a: "#ffe3ef", p: "#ffb3c7", P: "#ff7fa3", e: "#0b1a3d" },
  }));
  // mid: schools of tiny fish that move together
  const schools = [55, 68, 82].map((d, si) => ({
    d,
    x0: rnd() * 2000,
    v: (si % 2 ? -1 : 1) * between(7, 10),
    phase: rnd() * 6.28,
    tint: si === 1 ? { a: "#ffe98a", e: "#0b1a3d" } : { a: "#b9e6ff", e: "#0b1a3d" },
    members: Array.from({ length: 7 }, (_, k) => ({ dx: (k % 4) * 6 + (k > 3 ? 3 : 0), dd: (k > 3 ? 1.6 : 0) + (k % 2) * 0.6 })),
  }));
  const squid = Array.from({ length: 4 }, () => ({ d: between(48, 88), x0: rnd() * 2000, v: dir() * between(2, 4), phase: rnd() * 6.28 }));
  const jellies = Array.from({ length: 4 }, () => ({ d: between(60, 102), x0: rnd() * 2000, phase: rnd() * 6.28, v: 1 + rnd() * 2 }));
  // deep: dark fish with glowing eyes + glowing jellies
  const deepfish = Array.from({ length: 6 }, (_, i) => ({
    d: between(92, 140),
    x0: rnd() * 2000,
    v: dir() * between(3, 6),
    phase: rnd() * 6.28,
    tint: { d: i % 2 ? "#1d4a63" : "#22405e", L: i % 3 ? "#9ffcf0" : "#fff2a8" },
  }));
  const glowJellies = Array.from({ length: 7 }, (_, i) => ({
    d: i < 2 ? between(118, 140) : between(146, 212),
    x0: rnd() * 2000,
    phase: rnd() * 6.28,
    v: 0.6 + rnd() * 1.2,
    tint: i % 2 ? { p: "#c39bff", P: "#8a5cf0", h: "#ffffff" } : { p: "#7ff7ee", P: "#2ec9c0", h: "#ffffff" },
    glow: i % 2 ? "195,155,255" : "127,247,238",
  }));
  // abyss: lanternfish in green / blue / yellow / purple, anglerfish, one rare dumbo octopus
  const lanternCols = [
    { a: "#3fbf7f", h: "#d9ffe9", L: "#b6ffd6", g: "120,255,180" },
    { a: "#3f7fe0", h: "#dce9ff", L: "#9fd0ff", g: "140,200,255" },
    { a: "#d8b23a", h: "#fff6cc", L: "#fff2a8", g: "255,236,140" },
    { a: "#8a5cd6", h: "#efe2ff", L: "#e0c8ff", g: "205,170,255" },
  ];
  const lanterns = Array.from({ length: 12 }, (_, i) => {
    const c = lanternCols[i % 4];
    return { d: between(142, 214), x0: rnd() * 2000, v: dir() * between(3, 7), phase: rnd() * 6.28, tint: { a: c.a, h: c.h, L: c.L }, glow: c.g };
  });
  const anglers = [152, 178, 203].map((d, i) => ({
    d,
    x0: rnd() * 2000,
    v: (i % 2 ? 1 : -1) * between(1.6, 2.6),
    phase: rnd() * 6.28,
    tint: i === 1 ? { o: "#4b5fae", O: "#33468a", s: "#6f7fc0", h: "#ffffff", k: "#0b1a3d", w: "#e8f8ff", L: "#fff7b0" } : { o: "#6a4fa8", O: "#4c3786", s: "#8a74c4", h: "#ffffff", k: "#0b1a3d", w: "#e8f8ff", L: "#fff7b0" },
  }));
  const dumbo = { d: 191, x0: rnd() * 2000, v: 1.4, phase: 0 };
  // distant silhouettes (parallax), only in the lit upper ocean
  const far: Fish[] = [];
  for (let i = 0; i < 18; i++) {
    far.push({ d: between(10, 120), x0: rnd() * 2000, v: dir() * between(2, 5), sprite: rnd() < 0.5 ? FISH_TINY : FISH_B, tint: {}, phase: rnd() * 6.28, par: 0.55 });
  }
  // shallow reef ledges on the screen edges (start/end depth, REAL m), with starfish, shells, seaweed
  const reefs = [
    { side: "left" as const, top: 6, bottom: 44, w: 18, seed: rnd() * 10 },
    { side: "right" as const, top: 17, bottom: 35, w: 11, seed: rnd() * 10 },
  ];
  const reefDeco = [
    { reef: 0, d: 12, kind: "star", tint: { y: "#ff9a3c", Y: "#ffd23f" } },
    { reef: 0, d: 24, kind: "shell" },
    { reef: 0, d: 31, kind: "star", tint: { y: "#ff7fa3", Y: "#ffd0e0" } },
    { reef: 0, d: 18, kind: "weed" },
    { reef: 0, d: 37, kind: "weed" },
    { reef: 1, d: 22, kind: "star", tint: { y: "#ffd23f", Y: "#fff6c2" } },
    { reef: 1, d: 29, kind: "weed" },
  ];
  const caustics = Array.from({ length: 28 }, () => ({ d: between(1, 26), x: rnd(), phase: rnd() * 6.28, w: rnd() < 0.5 ? 2 : 3 }));
  const bubbles = Array.from({ length: 30 }, () => ({ d: rnd() * 40, x: rnd(), r: rnd() < 0.2 ? 2 : 1, v: 7 + rnd() * 8, wob: rnd() * 6.28 }));
  const snow = Array.from({ length: 64 }, () => ({ d: rnd() * 240, x: rnd(), v: 0.25 + rnd() * 0.5, tw: rnd() * 6.28 }));
  const rocks = Array.from({ length: 9 }, () => ({ x: rnd(), w: 6 + rnd() * 14, h: 3 + rnd() * 6 }));
  const anemones = Array.from({ length: 10 }, (_, i) => ({ x: rnd(), h: 3 + Math.round(rnd() * 5), col: i % 2 ? "127,247,238" : "195,155,255", phase: rnd() * 6.28 }));
  const clouds = Array.from({ length: 6 }, (_, i) => ({ x0: rnd() * 1.4, alt: 12 + rnd() * 34, big: i % 2 === 0, v: 1 + rnd() * 2 }));
  const sparkles = Array.from({ length: 22 }, () => ({ x: rnd(), dy: 2 + rnd() * 10, phase: rnd() * 6.28 }));
  return { fish, far, shrimp, schools, squid, jellies, deepfish, glowJellies, lanterns, anglers, dumbo, reefs, reefDeco, caustics, bubbles, snow, rocks, anemones, clouds, sparkles, rnd };
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

export default function OceanScene({ mode, depth: realDepth, feedback = null, showGauge = false, maxGauge = 800, visualScale = 1 }: OceanSceneProps) {
  const depth = realDepth * visualScale;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const depthLabelRef = useRef<HTMLSpanElement>(null);
  const zoneChipRef = useRef<HTMLDivElement>(null);
  // "Entering Mid Water"-style banner when the player's dive crosses into a deeper zone
  const [zoneToast, setZoneToast] = useState<{ name: string; color: string; key: number } | null>(null);
  const zoneRef = useRef(zoneIndexAt(realDepth));
  useEffect(() => {
    const z = zoneIndexAt(realDepth);
    const prev = zoneRef.current;
    zoneRef.current = z;
    if (mode !== "game" || z <= prev) return;
    const zone = ZONES[z];
    const show = setTimeout(() => setZoneToast({ name: zone.name, color: zone.color, key: Date.now() }), 650);
    const hide = setTimeout(() => setZoneToast(null), 650 + 3000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [realDepth, mode]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(visualScale);
  useEffect(() => {
    scaleRef.current = visualScale;
  }, [visualScale]);

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
      // longer dives for bigger rewards: +10 m ≈ 0.75 s, +30 m ≈ 1.2 s (at visualScale 3)
      const dur = L.reduced ? 0 : modeChanged ? MODE_MS : Math.min(1400, DIVE_MS * 0.6 + Math.abs(target - cur) * 7);
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
      const n = Math.round(12 + (feedback.meters ?? 30) * 0.9);
      for (let i = 0; i < n; i++) L.burst.push({ d: 0, x: (Math.random() - 0.5) * 18, v: 6 + Math.random() * 14, born: now + i * 18 });
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

      // ---------- depth bookkeeping (REAL meters; the scene draws VISUAL_SCALE scene meters per real meter)
      const S = scaleRef.current;
      const syR = (r: number) => sy(r * S);
      const subR = Math.max(0, (cam - SUB_OFFSET_M) / S);
      const viewTopR = (cam - anchor / M) / S;
      const viewBotR = (cam + (ch - anchor) / M) / S;
      const span = cw + 40;
      const wrapP = (p: number) => Math.round(((p % span) + span) % span) - 20;
      const wrapX = (x0: number, v: number) => wrapP(x0 + v * t);
      const visible = (y: number, h = 12) => y > wl + 4 && y < ch + h && y > -h;
      const gaugeArt = blend > 0.5 ? (cw * P > 520 ? 54 : 46) / P : 0;
      /** soft pixel halo for bioluminescence: additive stepped discs, brighter toward the center */
      const glow = (x: number, y: number, col: string, r: number, a: number) => {
        const cx = Math.round(x);
        const cy = Math.round(y);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = r; i >= 1; i--) {
          ctx.fillStyle = `rgba(${col},${(a * 0.16 * (1 - (i - 1) / r)).toFixed(3)})`;
          for (let dy = -i; dy <= i; dy++) {
            const hw = Math.round(Math.sqrt(i * i - dy * dy));
            ctx.fillRect(cx - hw, cy + dy, 2 * hw + 1, 1);
          }
        }
        ctx.restore();
      };

      // ---------- water body (banded by real depth, quantized every 3 m)
      const startY = Math.max(0, wli + 3);
      for (let y = startY - (startY % 2); y < ch; y += 2) {
        const dr = (cam + (y - anchor) / M) / S;
        ctx.fillStyle = rgb(depthRgb(Math.floor(dr / 3) * 3));
        ctx.fillRect(0, y, cw, 2);
      }

      // ---------- shallow: shimmering wave-light (caustics)
      if (subR < 45) {
        for (const c of world.caustics) {
          const y = Math.round(syR(c.d));
          if (!visible(y, 4)) continue;
          const a = (1 - c.d / 28) * 0.22 * (0.5 + 0.5 * Math.sin(t * 2.2 + c.phase));
          if (a <= 0.02) continue;
          ctx.fillStyle = `rgba(232,248,255,${a.toFixed(3)})`;
          ctx.fillRect(Math.round(c.x * cw + Math.sin(t * 0.7 + c.phase) * 3), y, c.w, 1);
        }
      }

      // ---------- sunlight rays: strong at the surface, gone by ~70 m
      const rayStrength = 1 - smooth(0, 70, subR);
      if (rayStrength > 0.02) {
        ctx.save();
        ctx.globalAlpha = 0.07 * rayStrength;
        ctx.fillStyle = "#e8f8ff";
        for (let i = 0; i < 6; i++) {
          const x = (i / 6) * cw + Math.sin(t * 0.3 + i) * 8;
          const top = Math.max(wl + 3, 0);
          const len = 90 * S * M;
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

      // ---------- far silhouettes (parallax, lit upper ocean)
      for (const f of world.far) {
        const y = Math.round(anchor + (f.d * S - cam * f.par) * M * f.par + Math.sin(t + f.phase) * 1.5);
        if (!visible(y, 10)) continue;
        const c = depthRgb((cam + (y - anchor) / M) / S);
        const spr = sprites.get(f.sprite, { a: rgb(c, 0.72), d: rgb(c, 0.72), e: rgb(c, 0.72) }, f.v > 0);
        ctx.drawImage(spr, wrapX(f.x0, f.v), y);
      }
      // mid: whale far away (parallax 0.5)
      {
        const y = Math.round(anchor + (77 * S - cam * 0.5) * M * 0.5);
        if (y > wl + 10 && y < ch + 20) {
          ctx.save();
          ctx.globalAlpha = 0.2;
          const wx = Math.round((((cw + 80 - t * 3) % (cw + 120)) + cw + 120) % (cw + 120)) - 60;
          ctx.drawImage(whale, wx, y);
          ctx.restore();
        }
      }
      // deep: a giant slow shadow passing in the background
      {
        const y = Math.round(anchor + (126 * S - cam * 0.7) * M * 0.7);
        if (y > wl + 10 && y < ch + 40) {
          ctx.save();
          ctx.globalAlpha = 0.28;
          const W2 = whale.width * 2;
          const wx = Math.round((((t * 2.2) % (cw + W2 + 40)) + cw + W2 + 40) % (cw + W2 + 40)) - W2 - 20;
          ctx.translate(wx + W2, y);
          ctx.scale(-1, 1); // swims to the right
          ctx.drawImage(whale, 0, 0, W2, whale.height * 2);
          ctx.restore();
        }
      }

      // ---------- shallow reef ledges with starfish, shells and seaweed
      for (const r of world.reefs) {
        const yTop = Math.round(syR(r.top));
        const yBot = Math.round(syR(r.bottom));
        if (yBot < wl || yTop > ch) continue;
        for (let y = Math.max(yTop, Math.ceil(wl) + 3); y <= Math.min(yBot, ch); y += 2) {
          const k = (y - yTop) / Math.max(1, yBot - yTop);
          const bulge = Math.sin(k * Math.PI) * 0.8 + 0.2;
          const w = Math.round(gaugeArt + r.w * bulge + Math.sin(y * 0.35 + r.seed) * 2);
          const x = r.side === "left" ? 0 : cw - w;
          ctx.fillStyle = "#24557a";
          ctx.fillRect(x, y, w, 2);
          // rock texture: darker pits and a sunlit rim on the open-water edge
          const pit = Math.floor(Math.abs(Math.sin(y * 12.9898 + r.seed) * 43758.5453) % w);
          ctx.fillStyle = "#1b4466";
          if (w > 4) ctx.fillRect(x + pit, y, 3, 2);
          ctx.fillStyle = "#4a88b0";
          ctx.fillRect(r.side === "left" ? x + w - 2 : x, y, 2, 1);
        }
      }
      for (const dcor of world.reefDeco) {
        const r = world.reefs[dcor.reef];
        const y = Math.round(syR(dcor.d));
        if (!visible(y, 10)) continue;
        const k = (dcor.d - r.top) / (r.bottom - r.top);
        const w = Math.round(gaugeArt + r.w * (Math.sin(k * Math.PI) * 0.8 + 0.2) + Math.sin(y * 0.35 + r.seed) * 2);
        const edge = r.side === "left" ? w : cw - w;
        if (dcor.kind === "star") {
          const spr = sprites.get(STARFISH, dcor.tint);
          ctx.drawImage(spr, r.side === "left" ? edge - spr.width + 1 : edge - 1, y - 3);
        } else if (dcor.kind === "shell") {
          const spr = sprites.get(SHELL);
          ctx.drawImage(spr, r.side === "left" ? edge - spr.width : edge, y - 2);
        } else {
          for (let i = 0; i < 9; i++) {
            const sway = Math.round(Math.sin(t * 1.4 + dcor.d + i * 0.3) * (i / 9) * 3);
            ctx.fillStyle = i % 4 < 2 ? "#2fbf71" : "#1d9a5c";
            ctx.fillRect((r.side === "left" ? edge : edge - 2) + sway + (r.side === "left" ? 0 : 0), y - i, 2, 1);
          }
        }
      }

      // ---------- sea floor (only at the very bottom of a perfect run)
      const bedY = Math.round(syR(SEABED_REAL_M));
      if (bedY < ch + 60) {
        ctx.fillStyle = "#141a46";
        ctx.fillRect(0, bedY, cw, ch);
        for (let x = 0; x < cw; x += 2) {
          const bump = Math.round(Math.sin(x * 0.07) * 2 + Math.sin(x * 0.19) * 1);
          ctx.fillStyle = "#1d2560";
          ctx.fillRect(x, bedY - 2 + bump, 2, 3);
          ctx.fillStyle = "#2a3378";
          ctx.fillRect(x, bedY - 2 + bump, 2, 1);
        }
        for (const r of world.rocks) {
          ctx.fillStyle = "#10153a";
          ctx.fillRect(Math.round(r.x * cw), bedY - r.h, Math.round(r.w), Math.round(r.h) + 1);
          ctx.fillStyle = "#1b2252";
          ctx.fillRect(Math.round(r.x * cw) + 1, bedY - r.h, Math.round(r.w) - 2, 1);
        }
      }

      // ---------- sunlit & mid-water life (dims with depth via the overlay below)
      for (const f of world.fish) {
        const y = Math.round(syR(f.d) + Math.sin(t * 1.6 + f.phase) * 1.2);
        if (!visible(y, 8)) continue;
        ctx.drawImage(sprites.get(f.sprite, f.tint, f.v > 0), wrapX(f.x0, f.v), y);
      }
      for (const sh of world.shrimp) {
        const y = Math.round(syR(sh.d) + Math.abs(Math.sin(t * 2 + sh.phase)) * -1.5);
        if (!visible(y, 6)) continue;
        // little hops: speed pulses
        const x = wrapP(sh.x0 + sh.v * (t + 0.45 * Math.sin(t * 3 + sh.phase)));
        ctx.drawImage(sprites.get(SHRIMP, sh.tint, sh.v > 0), x, y);
      }
      for (const sc of world.schools) {
        const baseY = syR(sc.d);
        if (!visible(Math.round(baseY), 14)) continue;
        const bx = wrapX(sc.x0, sc.v);
        for (const m of sc.members) {
          const y = Math.round(baseY + m.dd * S * M + Math.sin(t * 2.4 + sc.phase + m.dx * 0.3) * 1);
          const x = bx + (sc.v > 0 ? -m.dx : m.dx);
          ctx.drawImage(sprites.get(FISH_TINY, sc.tint, sc.v > 0), x, y);
        }
      }
      for (const sq of world.squid) {
        const jet = Math.sin(t * 1.8 + sq.phase);
        const y = Math.round(syR(sq.d) - (jet > 0 ? jet * 2 : 0));
        if (!visible(y, 12)) continue;
        ctx.drawImage(sprites.get(jet > 0.3 ? SQUID_B : SQUID_A, { q: "#f0c2dc", Q: "#d68fb8", e: "#0b1a3d" }), wrapX(sq.x0, sq.v), y);
      }
      for (const j of world.jellies) {
        const y = Math.round(syR(j.d + Math.sin(t * 0.8 + j.phase) * 1.4));
        if (!visible(y, 10)) continue;
        const spr = sprites.get(Math.floor(t * 2 + j.phase) % 2 ? JELLY_A : JELLY_B);
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(spr, wrapX(j.x0, j.v * 0.6), y);
        ctx.restore();
      }

      // ---------- darkness tied to the player's depth. Dims the world, never to black (the sub and
      // the glowing creatures below are drawn after it, so they keep their contrast)
      const overlayA = 0.38 * smooth(25, FULL_DARK_M, subR);
      if (overlayA > 0.005) {
        ctx.fillStyle = `rgba(4,10,40,${overlayA.toFixed(3)})`;
        ctx.fillRect(0, 0, cw, ch);
      }

      // ---------- marine snow → glowing plankton deeper down
      for (const sn of world.snow) {
        sn.d += sn.v * dt;
        if (sn.d > viewBotR + 2) sn.d = viewTopR - 1;
        if (sn.d < viewTopR - 2) sn.d = viewBotR;
        if (sn.d < 15) continue;
        const y = Math.round(syR(sn.d));
        if (!visible(y, 2)) continue;
        const x = Math.round(sn.x * cw + Math.sin(t * 0.5 + sn.d) * 2);
        if (sn.d > 100) {
          const tw = 0.45 + 0.55 * Math.sin(t * 1.5 + sn.tw);
          const col = sn.tw > 4.2 ? "195,155,255" : sn.tw > 2.1 ? "127,247,238" : "160,210,255";
          ctx.fillStyle = `rgba(${col},${(0.35 + 0.5 * tw * smooth(100, 150, sn.d)).toFixed(3)})`;
        } else ctx.fillStyle = `rgba(232,248,255,${(0.12 + 0.35 * smooth(15, 100, sn.d)).toFixed(3)})`;
        ctx.fillRect(x, y, 1, 1);
      }

      // ---------- deep water: dark fish with glowing eyes
      for (const f of world.deepfish) {
        const y = Math.round(syR(f.d) + Math.sin(t * 1.2 + f.phase) * 1.2);
        if (!visible(y, 8)) continue;
        const flip = f.v > 0;
        const spr = sprites.get(DEEPFISH, f.tint, flip);
        const x = wrapX(f.x0, f.v);
        ctx.drawImage(spr, x, y);
        glow(x + (flip ? spr.width - 1 : 0), y + 2, f.tint.L === "#fff2a8" ? "255,236,140" : "127,247,238", 3, 0.8 + 0.2 * Math.sin(t * 3 + f.phase));
      }
      // glowing jellies
      for (const j of world.glowJellies) {
        const y = Math.round(syR(j.d + Math.sin(t * 0.7 + j.phase) * 1.2));
        if (!visible(y, 12)) continue;
        const spr = sprites.get(Math.floor(t * 1.6 + j.phase) % 2 ? JELLY_A : JELLY_B, j.tint);
        const x = wrapX(j.x0, j.v * 0.5);
        glow(x + 3, y + 3, j.glow, 6, 0.55 + 0.25 * Math.sin(t * 2 + j.phase));
        ctx.drawImage(spr, x, y);
      }
      // ---------- deep sea: lanternfish (green / blue / yellow / purple) with photophores
      for (const f of world.lanterns) {
        const y = Math.round(syR(f.d) + Math.sin(t * 1.5 + f.phase) * 1.2);
        if (!visible(y, 8)) continue;
        const flip = f.v > 0;
        const spr = sprites.get(LANTERN, f.tint, flip);
        const x = wrapX(f.x0, f.v);
        glow(x + spr.width / 2, y + 3, f.glow, 4, 0.35 + 0.15 * Math.sin(t * 2.5 + f.phase));
        ctx.drawImage(spr, x, y);
      }
      // anglerfish: the lure pulses and lights up the darkness around it
      for (const f of world.anglers) {
        const y = Math.round(syR(f.d) + Math.sin(t * 0.9 + f.phase) * 1.5);
        if (!visible(y, 16)) continue;
        const flip = f.v > 0;
        const spr = sprites.get(ANGLER, f.tint, flip);
        const x = wrapX(f.x0, f.v);
        const pulse = 0.75 + 0.25 * Math.sin(t * 3.2 + f.phase);
        glow(x + (flip ? spr.width - 1 : 0), y, "255,240,150", 7, pulse);
        ctx.drawImage(spr, x, y);
        glow(x + (flip ? spr.width - 1 : 0), y, "255,250,210", 2, 1);
      }
      // rare: a dumbo octopus gently flapping its ear fins
      {
        const dm = world.dumbo;
        const y = Math.round(syR(dm.d) + Math.sin(t * 1.1) * 2.5);
        if (visible(y, 12)) {
          const x = wrapX(dm.x0, dm.v);
          glow(x + 6, y + 4, "255,170,220", 6, 0.35);
          ctx.drawImage(sprites.get(Math.floor(t * 2.2) % 2 ? DUMBO_A : DUMBO_B, { m: "#f08fc0", f: "#d86aa8", P: "#ff5f9e", k: "#0b1a3d" }), x, y);
        }
      }
      // glowing anemones on the sea floor
      if (bedY < ch + 10) {
        for (const a of world.anemones) {
          const ax = Math.round(a.x * cw);
          for (let i = 0; i < a.h; i++) {
            const sway = Math.round(Math.sin(t * 1.3 + a.phase + i * 0.4) * (i / a.h) * 2);
            ctx.fillStyle = `rgba(${a.col},0.85)`;
            ctx.fillRect(ax + sway, bedY - 2 - i, 1, 1);
          }
          glow(ax, bedY - 2 - a.h, a.col, 3, 0.7 + 0.3 * Math.sin(t * 2 + a.phase));
        }
      }

      // ---------- ambient bubbles (world-space so they scroll with the dive)
      for (const b of world.bubbles) {
        b.d -= (b.v / S) * dt;
        if (b.d < Math.max(0.3, viewTopR) || b.d > viewBotR + 7) {
          b.d = viewBotR + world.rnd() * 8;
          b.x = world.rnd();
        }
        const y = Math.round(syR(b.d));
        if (y < wl + 4) continue;
        const x = Math.round(b.x * cw + Math.sin(t * 2 + b.wob) * 1.5);
        ctx.fillStyle = b.d > 120 ? "rgba(170,225,255,0.6)" : "rgba(200,241,255,0.75)";
        if (b.r === 1) ctx.fillRect(x, y, 1, 1);
        else {
          ctx.fillRect(x, y - 1, 2, 1);
          ctx.fillRect(x - 1, y, 1, 2);
          ctx.fillRect(x + 2, y, 1, 2);
          ctx.fillRect(x, y + 2, 2, 1);
        }
      }

      // ---------- soft navy vignette in the deep (stepped, pixel style)
      const vig = 0.3 * smooth(80, FULL_DARK_M, subR);
      if (vig > 0.01) {
        for (let i = 0; i < 4; i++) {
          const inset = Math.round((i + 1) * Math.min(cw, ch) * 0.035);
          ctx.fillStyle = `rgba(3,8,32,${(vig * (0.32 - i * 0.07)).toFixed(3)})`;
          ctx.fillRect(0, 0, cw, inset);
          ctx.fillRect(0, ch - inset, cw, inset);
          ctx.fillRect(0, 0, inset, ch);
          ctx.fillRect(cw - inset, 0, inset, ch);
        }
      }

      // ---------- submarine
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
      // headlight beam in the deep (soft additive cone in front of the sub)
      const beam = smooth(95, 160, subR);
      if (beam > 0.01 && blend > 0.9) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 34; i++) {
          const h = 3 + Math.round(i * 0.55);
          ctx.fillStyle = `rgba(210,236,255,${(beam * 0.075 * (1 - i / 34) ** 1.5).toFixed(3)})`;
          ctx.fillRect(subX + subSpr.width + 1 + i, subY + 8 - Math.floor(h / 2), 1, h);
        }
        ctx.restore();
      }
      ctx.drawImage(subSpr, subX, subY);
      // nose lamp blinks in the deep
      if (subR > 80 && blend > 0.9 && Math.floor(t * 2) % 2 === 0) {
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
        const shown = Math.max(0, Math.round((cam - SUB_OFFSET_M) / scaleRef.current));
        const txt = `${blend < 0.5 ? 0 : shown} M`;
        if (depthLabelRef.current.textContent !== txt) depthLabelRef.current.textContent = txt;
        // live zone name under the marker (changes as the sub passes each boundary)
        const chip = zoneChipRef.current;
        if (chip) {
          const zone = ZONES[zoneIndexAt(blend < 0.5 ? 0 : shown)];
          if (chip.dataset.zone !== zone.id) {
            chip.dataset.zone = zone.id;
            chip.textContent = zone.name;
            chip.style.setProperty("--zone", zone.color);
          }
        }
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

  // ticks every 10 real meters (labels every 50 m), placed at scene depth
  const ticks: number[] = [];
  for (let d = 0; d * visualScale <= maxGauge; d += 10) ticks.push(d);

  return (
    <div ref={wrapRef} className="ocean-scene" aria-hidden="true">
      <canvas ref={canvasRef} className="ocean-canvas" />
      {showGauge && (
        <div className="gauge">
          <div ref={rulerRef} className="gauge-ruler">
            {ZONES.map((z, i) => {
              const to = ZONES[i + 1]?.from ?? maxGauge / visualScale;
              return (
                <div
                  key={z.id}
                  className="gauge-zone"
                  style={{ top: `calc(var(--mpx) * ${z.from * visualScale})`, height: `calc(var(--mpx) * ${(to - z.from) * visualScale})`, ["--zone" as string]: z.color }}
                >
                  <span>{z.name}</span>
                </div>
              );
            })}
            {ticks.map((d) => (
              <div key={d} className={`gauge-tick ${d % 50 === 0 ? "major" : ""}`} style={{ top: `calc(var(--mpx) * ${d * visualScale})` }}>
                {d % 50 === 0 && <span>{d}</span>}
              </div>
            ))}
          </div>
          <div className="gauge-marker">
            <span ref={depthLabelRef}>0 M</span>
          </div>
          <div ref={zoneChipRef} className="zone-chip" aria-hidden="true" />
        </div>
      )}
      {zoneToast && mode === "game" && (
        <div key={zoneToast.key} className="zone-toast" style={{ ["--zone" as string]: zoneToast.color }}>
          <small>Entering</small>
          {zoneToast.name}
        </div>
      )}
      {feedback?.kind === "correct" && (
        <div key={feedback.key} className={`dive-popup ${(feedback.meters ?? 0) >= 30 ? "big" : ""}`}>
          +{feedback.meters ?? 0} M
        </div>
      )}
    </div>
  );
}
