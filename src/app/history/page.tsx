"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VISUAL_SCALE } from "@/components/Game";
import OceanScene from "@/components/OceanScene";
import { ApiError, api } from "@/lib/client";
import type { HistoryEntry } from "@/lib/types";

interface HistoryResponse {
  entries: HistoryEntry[];
  personalDepth: number;
  correctCount: number;
  groupNumber: number;
  displayName: string | null;
}

const MAX = 210; // 7 questions × 30 m

export default function HistoryPage() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<HistoryResponse>("/api/history")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load your dive log."));
  }, []);

  const finalDepth = data?.personalDepth ?? 0;

  return (
    <>
      <OceanScene mode="game" depth={finalDepth} showGauge={!!data} visualScale={VISUAL_SCALE} />
      <main className={`app ${data ? "with-gauge" : ""}`} style={{ alignItems: "center", gap: 18, paddingTop: "max(16px, 6dvh)" }}>
        <section className="px-box" style={{ width: "min(760px, 100%)", padding: "22px 18px" }}>
          <p className="label" style={{ margin: 0 }}>
            Ocean Dive • Answer history
          </p>
          <h1 className="display" style={{ fontSize: "clamp(20px, 5vw, 30px)", margin: "12px 0 6px", color: "var(--yellow)", textShadow: "3px 3px 0 var(--navy-900)" }}>
            Dive log
          </h1>
          {data && (
            <>
              <p className="body-text" style={{ margin: "8px 0 16px" }}>
                Group {data.groupNumber}
                {data.displayName ? ` • ${data.displayName}` : ""} — {data.correctCount}/7 correct, {finalDepth} m deep.
              </p>
              <div className="trail" aria-label="Depth after each question">
                {data.entries.map((e) => (
                  <div key={e.index}>
                    <s style={{ height: `${Math.min(1, e.depthAfter / MAX) * 50}px` }} />
                    <i className={e.isCorrect ? "up" : ""} style={{ top: `${Math.min(1, e.depthAfter / MAX) * 50}px` }} title={`Q${e.order}: ${e.depthAfter} m`} />
                    <b>Q{e.order}</b>
                  </div>
                ))}
              </div>
            </>
          )}
          {!data && !error && (
            <p className="body-text">
              Opening your dive log<span className="dots" />
            </p>
          )}
          {error && (
            <>
              <p className="body-text" role="alert" style={{ color: "var(--coral)" }}>
                {error}
              </p>
              <Link className="px-btn" href="/">
                Back to the ocean
              </Link>
            </>
          )}
        </section>

        {data?.entries.map((e) => (
          <article key={e.index} className="px-box log-entry" style={{ width: "min(760px, 100%)", padding: "20px 18px" }} aria-labelledby={`q${e.order}`}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="tag meta">Question {e.order} / 7</span>
              <span className={`tag ${e.isCorrect ? "ok" : "no"}`}>{e.isCorrect ? "Correct" : e.attempts.length ? "Incorrect" : "No answer"}</span>
              <span className="tag meta">
                +{e.depthAwarded} m • {e.depthAfter} m total
              </span>
            </div>
            <p className="label" style={{ margin: "4px 0 0", color: "var(--pink)" }}>
              {e.categoryLabel}
            </p>
            <h2 id={`q${e.order}`} style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 22, lineHeight: 1.3, margin: 0, color: "var(--white)" }}>
              {e.prompt}
            </h2>
            <div className="answer-line">
              <span className="label">My answer</span>
              <span className="body-text" style={{ color: e.isCorrect ? "var(--cyan)" : "var(--coral)", overflowWrap: "anywhere" }}>
                {e.myAnswer ?? "No answer / Time expired"}
              </span>
            </div>
            {e.attempts.length > 1 && (
              <div className="answer-line">
                <span className="label">Attempts</span>
                <span className="small" style={{ overflowWrap: "anywhere" }}>
                  {e.attempts.map((a, i) => (
                    <span key={i} style={{ color: a.isCorrect ? "var(--cyan)" : "var(--coral)" }}>
                      {i > 0 ? " → " : ""}
                      {a.answer} ({a.seconds}s)
                    </span>
                  ))}
                </span>
              </div>
            )}
            <div className="answer-line">
              <span className="label">Correct answer</span>
              <span className="body-text" style={{ color: "var(--yellow)" }}>
                {e.canonicalAnswer}
              </span>
            </div>
            <div className="answer-line">
              <span className="label">Also accepted</span>
              <span className="small">{e.acceptedExamples.join(" · ")}</span>
            </div>
            <p className="body-text" style={{ margin: "4px 0 0" }}>
              {e.explanation}
            </p>
            <p className="small src" style={{ margin: 0 }}>
              <span className="label" style={{ marginRight: 8 }}>
                Source
              </span>
              <a href={e.referenceUrl} target="_blank" rel="noopener noreferrer">
                {e.referenceLabel}
              </a>
            </p>
          </article>
        ))}

        {data && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", paddingBottom: 24 }}>
            <Link className="px-btn" href="/">
              Back to the dive
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
