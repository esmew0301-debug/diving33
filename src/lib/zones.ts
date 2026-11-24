/**
 * Ocean depth zones, in REAL meters (the player's dive depth). A perfect run is 7 × 30 = 210 m,
 * so every zone is reachable. The water reaches its darkest deep-navy shade at FULL_DARK_M and stays there.
 */
export interface DepthZone {
  id: "shallow" | "mid" | "deep" | "abyss";
  name: string;
  /** Zone starts at this depth (m). */
  from: number;
  /** Accent color for the gauge band / labels. */
  color: string;
}

export const ZONES: DepthZone[] = [
  { id: "shallow", name: "Shallow Water", from: 0, color: "#7fd4ff" },
  { id: "mid", name: "Mid Water", from: 40, color: "#4f9cf0" },
  { id: "deep", name: "Deep Water", from: 90, color: "#4ff0e0" },
  { id: "abyss", name: "Deep Sea", from: 140, color: "#c39bff" },
];

/** Depth (m) at which the water reaches its darkest navy (constant below; never black). */
export const FULL_DARK_M = 170;

export function zoneIndexAt(meters: number): number {
  let i = 0;
  for (let k = 0; k < ZONES.length; k++) if (meters >= ZONES[k].from) i = k;
  return i;
}
export const zoneAt = (meters: number) => ZONES[zoneIndexAt(meters)];
