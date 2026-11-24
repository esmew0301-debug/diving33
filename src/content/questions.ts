import "server-only";

/**
 * OCEAN DIVE — QUESTION BANK (PLACEHOLDER SET — EDIT FREELY)
 * ===========================================================
 * This is the ONE file to edit for questions, answers, explanations and sources.
 * It is imported only by server code, so canonical answers and aliases never
 * reach a student's browser before the classroom session is complete.
 *
 * Rules:
 *  - Keep exactly 7 entries (5 "problem" + 2 "solution") unless you also want a
 *    different game length — the engine uses QUESTIONS.length everywhere.
 *  - `aliases` are the AUTHORITATIVE accepted answers. Matching is exact after
 *    normalization (case, spacing, punctuation, accents, CO₂→co2, etc.).
 *    If the class finds a reasonable synonym you forgot, add it here and redeploy.
 *  - `acceptedAnswerPolicy.maxEditDistance` enables small-typo tolerance for that
 *    question only. Leave it at 0 (strict) unless the typo cannot turn into a
 *    different scientific term.
 *  - English only.
 */

export type QuestionCategory = "problem" | "solution";

export interface AcceptedAnswerPolicy {
  /** "exact" = normalized exact match against canonicalAnswer + aliases. */
  mode: "exact";
  /** Optional bounded typo tolerance (Levenshtein) for longer aliases only. 0 = strict. */
  maxEditDistance: 0 | 1 | 2;
  /** Minimum alias length (after normalization) before typo tolerance applies. */
  minLengthForTypos: number;
}

export interface QuestionDefinition {
  id: string;
  order: number;
  category: QuestionCategory;
  categoryLabel: string;
  prompt: string;
  canonicalAnswer: string;
  aliases: string[];
  explanation: string;
  referenceLabel: string;
  referenceUrl: string;
  acceptedAnswerPolicy: AcceptedAnswerPolicy;
}

const STRICT: AcceptedAnswerPolicy = { mode: "exact", maxEditDistance: 0, minLengthForTypos: 99 };

export const QUESTION_SET_NOTE =
  "Placeholder question set for Project 3 — our group will review and edit before class.";

export const QUESTIONS: QuestionDefinition[] = [
  {
    id: "q1-co2",
    order: 1,
    category: "problem",
    categoryLabel: "Problem background",
    prompt: "What greenhouse gas released by burning fossil fuels is a major driver of ocean acidification?",
    canonicalAnswer: "Carbon dioxide (CO₂)",
    aliases: ["carbon dioxide", "CO2", "CO₂", "carbon dioxide gas"],
    explanation:
      "Burning coal, oil, and natural gas releases carbon dioxide into the atmosphere. The ocean absorbs some of this added CO₂, changing seawater chemistry and contributing to ocean acidification.",
    referenceLabel: "NASA — Causes of Climate Change; NOAA — What Is Ocean Acidification?",
    referenceUrl: "https://oceanservice.noaa.gov/facts/acidification.html",
    acceptedAnswerPolicy: STRICT,
  },
  {
    id: "q2-acidification",
    order: 2,
    category: "problem",
    categoryLabel: "Problem background",
    prompt: "What is the process called when added CO₂ causes seawater pH to decrease over time?",
    canonicalAnswer: "Ocean acidification",
    aliases: ["ocean acidification", "acidification of the ocean", "marine acidification"],
    explanation:
      "Ocean acidification is the long-term decrease in seawater pH associated primarily with the ocean absorbing atmospheric CO₂. It does not mean ocean water has generally become acidic in the everyday pH-below-7 sense.",
    referenceLabel: "NOAA — What Is Ocean Acidification?",
    referenceUrl: "https://oceanservice.noaa.gov/facts/acidification.html",
    acceptedAnswerPolicy: STRICT,
  },
  {
    id: "q3-carbonate",
    order: 3,
    category: "problem",
    categoryLabel: "Problem background",
    prompt:
      "Which ions become less available for oysters and corals to build shells and skeletons as ocean acidification increases?",
    canonicalAnswer: "Carbonate ions",
    aliases: ["carbonate ions", "carbonate ion", "carbonate", "CO3 2-", "CO₃²⁻"],
    explanation:
      "When CO₂ reacts with seawater, the resulting chemical shift reduces carbonate-ion availability. Many shell-building organisms use calcium and carbonate to produce calcium carbonate; less available carbonate can make calcification harder.",
    referenceLabel: "NOAA — Ocean Acidification; Doney et al. (2020)",
    referenceUrl: "https://www.noaa.gov/education/resource-collections/ocean-coasts/ocean-acidification",
    acceptedAnswerPolicy: STRICT,
  },
  {
    id: "q4-shellfish",
    order: 4,
    category: "problem",
    categoryLabel: "Problem background",
    prompt: "What coastal industry can suffer when acidic seawater harms oyster larvae and shellfish hatcheries?",
    canonicalAnswer: "Shellfish farming / aquaculture",
    aliases: [
      "shellfish farming",
      "shellfish industry",
      "oyster farming",
      "oyster industry",
      "aquaculture",
      "seafood farming",
      "shellfish aquaculture",
    ],
    explanation:
      "Pacific Northwest oyster hatcheries experienced severe early-life-stage production problems associated with unfavorable seawater chemistry. This affected shellfish businesses, which responded with better monitoring and treatment practices. This does not mean every kind of fishing is harmed to the same extent.",
    referenceLabel: "Barton et al. (2015), Oceanography",
    referenceUrl: "https://doi.org/10.5670/oceanog.2015.38",
    acceptedAnswerPolicy: STRICT,
  },
  {
    id: "q5-justice",
    order: 5,
    category: "problem",
    categoryLabel: "Problem background & environmental justice",
    prompt:
      "What concept describes the unfair situation where some vulnerable coastal communities bear disproportionate environmental harm?",
    canonicalAnswer: "Environmental injustice",
    aliases: [
      "environmental injustice",
      "environmental inequity",
      "unequal environmental burden",
      "environmental inequality",
      "environmental justice issue",
      "environmental justice",
    ],
    explanation:
      "Communities differ in their economic dependence on marine resources and their capacity to adapt. An environmental justice lens asks who is exposed to harm, who has resources to respond, and whether costs and benefits are distributed fairly. This is not proof that every small town has lower emissions; local comparisons require local data.",
    referenceLabel: "Ekstrom et al. (2015), Nature Climate Change; Doney et al. (2020)",
    referenceUrl: "https://doi.org/10.1038/nclimate2508",
    acceptedAnswerPolicy: STRICT,
  },
  {
    id: "q6-kelp-seagrass",
    order: 6,
    category: "solution",
    categoryLabel: "Local solution proposal",
    prompt: "Name ONE native marine plant our group proposes using in coastal habitat nurseries to support marine life.",
    canonicalAnswer: "Kelp or seagrass",
    aliases: ["kelp", "seagrass", "sea grass", "native kelp", "native seagrass"],
    explanation:
      "Our group's proposed local adaptation involves restoring suitable native kelp or seagrass habitats and, where appropriate, nursery/reef structures. Such habitats can support marine organisms and coastal ecosystems. The local chemistry and fisheries benefits are context-dependent; planting alone is not a demonstrated permanent solution to global ocean acidification.",
    referenceLabel: "Project 3, Part 3 — Group's Proposed Local Solution",
    referenceUrl: "https://www.globalseafood.org/advocate/study-mussel-and-seaweed-farming-can-boost-wild-fish-populations/",
    acceptedAnswerPolicy: STRICT,
  },
  {
    id: "q7-oae",
    order: 7,
    category: "solution",
    categoryLabel: "Global / systemic solution proposal",
    prompt: "What is the proposed technique that adds alkaline materials to seawater to increase its alkalinity?",
    canonicalAnswer: "Ocean Alkalinity Enhancement (OAE)",
    aliases: ["ocean alkalinity enhancement", "OAE", "ocean alkalinity addition", "enhanced ocean alkalinity"],
    explanation:
      "Our group's Part 3 proposes Ocean Alkalinity Enhancement as a potential larger-scale approach to seawater chemistry, alongside reducing fossil-fuel emissions. OAE is an emerging research area with ecological, monitoring, governance, and deployment uncertainties; it is not an already proven, risk-free global fix.",
    referenceLabel: "Project 3, Part 3 — Group's Proposed Systemic Solution",
    referenceUrl: "https://www.ncbi.nlm.nih.gov/books/NBK580052/",
    acceptedAnswerPolicy: STRICT,
  },
];
