/**
 * Original pixel-art sprites for OCEAN DIVE, drawn as character grids.
 * Each character maps to a palette color; "." is transparent.
 */

export const PALETTE: Record<string, string> = {
  k: "#0b1a3d", // outline navy
  y: "#ffd23f", // submarine yellow
  Y: "#ffe98a", // highlight yellow
  o: "#f59e2b", // orange shade
  w: "#e8f8ff", // white / glass rim
  b: "#4ff0e0", // cyan glass
  B: "#1fb5c9", // glass shade
  g: "#8a93b8", // steel
  r: "#ff4f6d", // red accent
  p: "#ff9ec7", // pink
  P: "#ff6f91", // coral
  c: "#7fd4ff", // light blue
  C: "#3aa7e8", // blue
  n: "#1b3f7a", // navy mid
  s: "#f2e2b6", // sand
  S: "#d2b98a", // sand shade
  h: "#ffffff", // pure white
  l: "#c8f1ff", // light
  e: "#0b1a3d", // eye
  t: "#f7f0dc", // hull white
  T: "#c9c2ae", // hull shade
  m: "#6b4a2b", // wood
  G: "#2fbf71", // green
  D: "#1d7f4f", // dark green
};

export type Sprite = string[];

// Submarine, facing right. 24 x 13
export const SUB: Sprite = [
  "..........kkk...........",
  "..........kgk...........",
  "........kkkykk..........",
  ".......kYyyyyyk.........",
  "...kkkkkyyyyyyykkkkk....",
  "..kYYyyyyyyyyyyyyyyyk...",
  ".kYyyyyyyywwwwyyyyyyyk..",
  "kYyyyyyyywbbbBwyyyyyyyk.",
  "kyyyyyyyywbbbBwyyyyyyykk",
  "kyyrryyyyywwwwyyyyyyyykg",
  ".kyyyyyyyyyyyyyyyyyyyk.k",
  "..koooooooooooooooook...",
  "...kkkkkkkkkkkkkkkkk....",
];

// Propeller frames (drawn at the back of the sub), 3 x 5
export const PROP_A: Sprite = [".k.", "kgk", ".g.", "kgk", ".k."];
export const PROP_B: Sprite = ["...", "kgk", "ggg", "kgk", "..."];

// Support boat with a coral flag. 30 x 14
export const BOAT: Sprite = [
  "...........k..................",
  "...........kPPPP..............",
  "...........kPPPPPP............",
  "...........kPPPP..............",
  "...........k..................",
  "........kkkkkkkkkk............",
  "........kwwcwwcwwk............",
  "........kwwwwwwwwk.....k......",
  "....kkkkkkkkkkkkkkkkkkkkk.....",
  "kkkktttttttttttttttttttttkkkkk",
  ".kttttttttttttttttttttttttttk.",
  "..kTTrrTTTTTTTTTTTTTTTTTTTk...",
  "...kTTTTTTTTTTTTTTTTTTTTTk....",
  "....kkkkkkkkkkkkkkkkkkkkk.....",
];

export const CLOUD_A: Sprite = [
  ".........hhhhh..........",
  ".......hhhhhhhhh........",
  "...hhhhhhhhhhhhhhh......",
  "..hhhhhhhhhhhhhhhhhhh...",
  "hhhhhhhhhhhhhhhhhhhhhhh.",
  "hlllllllhhhhhhhhllllllhh",
  ".llllllllllllllllllllll.",
];

export const CLOUD_B: Sprite = [
  "......hhhh......",
  "...hhhhhhhhh....",
  ".hhhhhhhhhhhhh..",
  "hhhhhhhhhhhhhhhh",
  ".llllllllllllll.",
];

// Fish facing left (eye on the left). Recolored per species via `tint`.
export const FISH_A: Sprite = [
  "..aaaa...a",
  ".aaaaaa.aa",
  "aeaaaaaaa.",
  ".dddddd.aa",
  "..dddd...a",
];

export const FISH_B: Sprite = [
  "...aa....",
  ".aaaaa..a",
  "aeaaaaaaa",
  ".aaaaa..a",
  "...dd....",
];

export const FISH_TINY: Sprite = ["aa.a", "eaaa", "aa.a"];

export const JELLY_A: Sprite = [
  "..ppp..",
  ".ppppp.",
  "pphpphp",
  "PPPPPPP",
  ".p.p.p.",
  "p..p..p",
  ".p..p..",
];
export const JELLY_B: Sprite = [
  "..ppp..",
  ".ppppp.",
  "pphpphp",
  "PPPPPPP",
  "p.p.p.p",
  ".p..p.p",
  "p..p...",
];

export const CORAL: Sprite = [
  "..P...P..P..",
  ".PP..PP.PP..",
  "..PP.P.PP...",
  "...PPPPP..P.",
  ".P..PPP..PP.",
  ".PP.PPP.PP..",
  "..PPPPPPP...",
  "....PPP.....",
];

export const SHELL: Sprite = ["..www..", ".wpwpw.", "wpwpwpw", "kkkkkkk"];

export const HOUSE_A: Sprite = [
  "...rr...",
  "..rrrr..",
  ".rrrrrr.",
  "rrrrrrrr",
  ".tttttt.",
  ".tcttct.",
  ".tttttt.",
  ".ttmmtt.",
];
export const HOUSE_B: Sprite = [
  "..CC..",
  ".CCCC.",
  "CCCCCC",
  ".tttt.",
  ".tctt.",
  ".tmmt.",
];

/* ---------------------------------------------------------------- depth-zone creatures
 * Cute, round, retro: never scary. "L" marks a light organ (drawn bright, then haloed in code).
 */

// Shallow: tiny shrimp, facing left. a = antenna, p/P = body shades.
export const SHRIMP: Sprite = [
  "aa.......",
  "..apppp..",
  ".epppppp.",
  "..ppppPPP",
  "...p.p..P",
];

// Shallow: starfish (tint y).
export const STARFISH: Sprite = [
  "...y...",
  "..yyy..",
  "yyyyyyy",
  ".yyYyy.",
  "..yyy..",
  ".yy.yy.",
  "yy...yy",
];

// Mid: small squid, two jet frames (tint q / Q).
export const SQUID_A: Sprite = [
  "...q...",
  "..qqq..",
  ".qqqqq.",
  ".qqqqq.",
  "qqqqqqq",
  "qeqqqeq",
  ".QQQQQ.",
  ".Q.Q.Q.",
  ".Q.Q.Q.",
  "Q..Q..Q",
];
export const SQUID_B: Sprite = [
  "...q...",
  "..qqq..",
  ".qqqqq.",
  ".qqqqq.",
  "qqqqqqq",
  "qeqqqeq",
  ".QQQQQ.",
  "..QQQ..",
  "..QQQ..",
  "..Q.Q..",
];

// Deep: dark fish with a glowing eye spot, facing left.
export const DEEPFISH: Sprite = [
  "...dd.....",
  ".dddddd..d",
  "Lddddddddd",
  ".dddddd..d",
  "...dd.....",
];

// Deep sea: lanternfish with a row of photophores (L), facing left.
export const LANTERN: Sprite = [
  "..aaaa.....",
  ".aaaaaaa..a",
  "ahaaaaaaaaa",
  ".LaLaLaLa.a",
  "..aaaa.....",
];

// Deep sea: round, friendly anglerfish with its glowing lure (L), facing left.
export const ANGLER: Sprite = [
  "L...............",
  ".s..............",
  "..s.............",
  "...ss...........",
  ".....oooooo.....",
  "...oooooooooo..O",
  "..ohhoooooooooOO",
  ".oohkoooooooooO.",
  "ooooooooooooooOO",
  "ow.w.ooooooooo.O",
  ".oooooooooooo...",
  "...ooooooo......",
];

// Deep sea (rare): dumbo octopus, two ear-fin frames. m body, f fins, P blush.
export const DUMBO_A: Sprite = [
  "ff..mmmm..ff",
  "fffmmmmmmfff",
  ".fmmmmmmmmf.",
  "..mkmmmmkm..",
  "..PmmmmmmP..",
  "..mmmmmmmm..",
  "..m.m..m.m..",
  ".m..m..m..m.",
  "m...m..m...m",
];
export const DUMBO_B: Sprite = [
  "....mmmm....",
  "...mmmmmm...",
  "ffmmmmmmmmff",
  "ffmkmmmmkmff",
  ".fPmmmmmmPf.",
  "..mmmmmmmm..",
  "..m.m..m.m..",
  "..m.m..m.m..",
  ".m..m..m..m.",
];

export interface SpriteCache {
  get(sprite: Sprite, tint?: Record<string, string>, flip?: boolean): HTMLCanvasElement;
}

/** Pre-render sprites to tiny offscreen canvases so each frame is just drawImage calls. */
export function createSpriteCache(): SpriteCache {
  const cache = new Map<string, HTMLCanvasElement>();
  const ids = new WeakMap<Sprite, number>();
  let next = 1;
  return {
    get(sprite, tint, flip) {
      let id = ids.get(sprite);
      if (!id) {
        id = next++;
        ids.set(sprite, id);
      }
      const key = `${id}|${flip ? 1 : 0}|${tint ? JSON.stringify(tint) : ""}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const w = sprite[0].length;
      const h = sprite.length;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ch = sprite[y][flip ? w - 1 - x : x];
          if (ch === ".") continue;
          const col = tint?.[ch] ?? PALETTE[ch];
          if (!col) continue;
          ctx.fillStyle = col;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      cache.set(key, c);
      return c;
    },
  };
}
