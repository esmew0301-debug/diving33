import { describe, expect, it } from "vitest";
import { compactKey, isAcceptedAnswer, levenshtein, normalizeAnswer } from "@/lib/normalize";
import { QUESTIONS } from "@/content/questions";

const accepts = (id: string, input: string) => {
  const q = QUESTIONS.find((x) => x.id === id)!;
  return isAcceptedAnswer(input, [q.canonicalAnswer, ...q.aliases], q.acceptedAnswerPolicy);
};

describe("normalizeAnswer", () => {
  it("is deterministic and trims unicode whitespace", () => {
    expect(normalizeAnswer("   Carbon Dioxide \n")).toBe("carbon dioxide");
    expect(normalizeAnswer("Carbon Dioxide")).toBe(normalizeAnswer("carbon dioxide"));
  });
  it("normalizes subscripts and superscripts", () => {
    expect(compactKey("CO₂")).toBe("co2");
    expect(compactKey("CO₃²⁻")).toBe(compactKey("CO3 2-"));
  });
  it("strips accents, punctuation and leading articles", () => {
    expect(normalizeAnswer("The Ocean-Acidification!")).toBe("ocean acidification");
    expect(normalizeAnswer("Sêagrass")).toBe("seagrass");
    expect(normalizeAnswer("an  OAE.")).toBe("oae");
  });
  it("levenshtein caps work", () => {
    expect(levenshtein("kelp", "kelp")).toBe(0);
    expect(levenshtein("kelp", "help")).toBe(1);
  });
});

describe("question bank", () => {
  it("has exactly seven English questions with 5 problem + 2 solution", () => {
    expect(QUESTIONS).toHaveLength(7);
    expect(QUESTIONS.filter((q) => q.category === "problem")).toHaveLength(5);
    expect(QUESTIONS.filter((q) => q.category === "solution")).toHaveLength(2);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(7);
    QUESTIONS.forEach((q, i) => {
      expect(q.order).toBe(i + 1);
      expect(q.referenceUrl).toMatch(/^https:\/\//);
      expect(q.explanation.length).toBeGreaterThan(60);
    });
  });
  it("contains no CJK characters anywhere (English only)", () => {
    const text = JSON.stringify(QUESTIONS);
    expect(/[぀-ヿ㐀-鿿가-힯]/.test(text)).toBe(false);
  });
  it("accepts all canonical answers and aliases", () => {
    for (const q of QUESTIONS) for (const a of [q.canonicalAnswer, ...q.aliases]) expect(accepts(q.id, a), `${q.id}: ${a}`).toBe(true);
  });
});

describe("answer matching", () => {
  it.each([
    ["q1-co2", "CO2"], ["q1-co2", "co₂"], ["q1-co2", " Carbon dioxide "], ["q1-co2", "c o 2"], ["q1-co2", "carbon dioxide (CO2)"],
    ["q2-acidification", "Ocean Acidification"], ["q3-carbonate", "carbonate"], ["q3-carbonate", "CO3^2-"],
    ["q4-shellfish", "Aquaculture"], ["q4-shellfish", "oyster farming"], ["q5-justice", "environmental injustice"],
    ["q6-kelp-seagrass", "Sea-grass"], ["q6-kelp-seagrass", "KELP"], ["q7-oae", "O.A.E."], ["q7-oae", "ocean alkalinity enhancement"],
  ])("%s accepts %s", (id, input) => expect(accepts(id, input)).toBe(true));

  it.each([
    ["q1-co2", "carbon"], ["q1-co2", "methane"], ["q1-co2", "carbon monoxide"], ["q1-co2", "co"], ["q1-co2", ""],
    ["q2-acidification", "acid rain"], ["q2-acidification", "ocean"], ["q3-carbonate", "calcium"], ["q3-carbonate", "bicarbonate"],
    ["q4-shellfish", "fishing"], ["q4-shellfish", "tourism"], ["q5-justice", "justice"], ["q6-kelp-seagrass", "coral"],
    ["q6-kelp-seagrass", "kelp and coral"], ["q7-oae", "ocean acidification"], ["q7-oae", "alkalinity"],
  ])("%s rejects %s", (id, input) => expect(accepts(id, input)).toBe(false));
});
