import type { ReactNode } from "react";

/** Tiny crisp SVG submarine used in rosters and the dive log. */
export function SubIcon({ dim = false, color = "#ffd23f" }: { dim?: boolean; color?: string }) {
  const c = dim ? "#2b4a80" : color;
  return (
    <svg className="ico" viewBox="0 0 12 9" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="5" y="0" width="1" height="2" fill={dim ? "#2b4a80" : "#8a93b8"} />
      <rect x="4" y="2" width="3" height="1" fill={c} />
      <rect x="1" y="3" width="9" height="1" fill={c} />
      <rect x="0" y="4" width="11" height="3" fill={c} />
      <rect x="1" y="7" width="9" height="1" fill={dim ? "#203a66" : "#f59e2b"} />
      <rect x="5" y="4" width="2" height="2" fill={dim ? "#203a66" : "#4ff0e0"} />
      <rect x="11" y="4" width="1" height="3" fill={dim ? "#203a66" : "#8a93b8"} />
    </svg>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="px-box" style={{ maxWidth: 520, width: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="display" style={{ fontSize: 15, margin: "0 0 16px", color: "var(--yellow)" }}>
          {title}
        </h2>
        {children}
        <div style={{ marginTop: 18, textAlign: "right" }}>
          <button className="px-btn small-btn" onClick={onClose} autoFocus>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["4", "Join your group. When all 4 divers are in, press Start Game."],
    ["7", "questions, at your own pace. Type one answer for each (25 s)."],
    ["+1", "Correct = +1 group credit and your sub dives 100 m deeper."],
    ["0", "Wrong = 0 points. You stay at your depth, but keep playing."],
    ["?", "Other groups' scores stay secret. The leaderboard appears when every diver has finished."],
  ];
  return (
    <Modal title="How to play" onClose={onClose}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {rows.map(([k, v]) => (
          <li key={k} style={{ display: "grid", gridTemplateColumns: "44px 1fr", alignItems: "center", gap: 12 }}>
            <span className="display" style={{ fontSize: 14, color: "var(--cyan)", textAlign: "center" }}>
              {k}
            </span>
            <span className="body-text">{v}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
