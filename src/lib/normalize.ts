/**
 * Deterministic answer normalization. Pure, no I/O, unit-tested in tests/normalize.test.ts.
 *
 *  - Unicode NFKC (CO₂ → CO2, CO₃²⁻ → CO32−, full-width letters → ASCII)
 *  - strip accents (NFD + remove combining marks)
 *  - lower-case, trim, collapse Unicode whitespace
 *  - harmless punctuation → space, "&" → "and"
 *  - drop a leading article ("the", "a", "an")
 *
 * `compactKey` additionally removes all spaces so "O A E", "sea grass" and "CO 2"
 * match "oae", "seagrass", "co2". Matching is always against an explicit alias list;
 * there is no substring or semantic matching.
 */

const MAX_INPUT = 200;

export function normalizeAnswer(raw: string): string {
  let s = String(raw ?? "").slice(0, MAX_INPUT);
  s = s.normalize("NFKC");
  s = s.normalize("NFD").replace(/\p{M}+/gu, "");
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  // anything that is not a latin letter or digit becomes a space (punctuation, dashes, quotes, symbols)
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(the|a|an) /, "");
  return s;
}

export function compactKey(raw: string): string {
  return normalizeAnswer(raw).replace(/ /g, "");
}

export function levenshtein(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface MatchPolicy {
  maxEditDistance: number;
  minLengthForTypos: number;
}

export function isAcceptedAnswer(
  input: string,
  accepted: string[],
  policy: MatchPolicy = { maxEditDistance: 0, minLengthForTypos: 99 },
): boolean {
  const key = compactKey(input);
  if (!key) return false;
  const keys = accepted.map(compactKey).filter(Boolean);
  if (keys.includes(key)) return true;
  if (policy.maxEditDistance > 0) {
    return keys.some(
      (k) => k.length >= policy.minLengthForTypos && levenshtein(key, k, policy.maxEditDistance) <= policy.maxEditDistance,
    );
  }
  return false;
}
