# Design audit and visual QA

## Reference decision

The brief asked for a pixel-level reproduction of krillion.io (its art, typography, layout and animation). **That was not done.** OCEAN DIVE uses an **original** visual design in the same genre: retro pixel art, a sky-and-sea landing, a living underwater scene that darkens with depth, a depth gauge, and a typed-answer quiz where correct answers dive. No Krillion assets, fonts, code, measurements or screenshots were collected or used. So this document records our own design system and a screenshot QA loop against our own spec, not a side-by-side comparison with the reference.

## Design tokens (all original, defined in `src/app/globals.css` and `src/components/OceanScene.tsx`)

| Token | Value | Use |
|---|---|---|
| Navy 800 / 900 | `#0b1a3d` / `#04102b` | Panels, outlines, hard drop shadows |
| Sea (0 m → 820 m) | `#2a9de6` → `#1f86d1` → `#166bb8` → `#0f4f97` → `#0a3672` → `#06224f` → `#031436` | Water bands, quantized every 9 m |
| Sky | `#67b8f2` → `#c8ecff` | Banded sky, 3 px steps |
| Foam | `#e8f8ff` | Wave crests, panel borders, text |
| Yellow | `#ffd23f` (shade `#c99a12`) | Primary buttons, sub, depth marker, headings |
| Coral | `#ff6f91` (shade `#c93d63`) | Join CTA, wrong/timeout feedback |
| Cyan | `#4ff0e0` | Correct feedback, credits bars, deep-sea glow |
| Pink | `#ff9ec7` | Category labels, jellyfish, coral |
| Display font | Press Start 2P (Google Fonts) | Title, labels, HUD, buttons |
| Body font | Pixelify Sans (Google Fonts) | Questions, explanations, inputs |
| Pixel unit | 4 px (desktop) / 3 px (≤ 900 px wide) | 1 art pixel; borders are 3–4 px notched box-shadows |

## Motion spec

| State | Motion | Depth change |
|---|---|---|
| Idle | Waves (two sine layers), drifting clouds, fish schools, jellyfish (220–580 m), whale silhouette (parallax 0.5), rising bubbles, marine snow, swaying kelp | none |
| Join | Camera glides from the surface view to the dive view (1.5 s, ease-in-out); sub sinks from the surface | none |
| Correct | 900 ms eased dive, fast propeller, bubble trail and burst, "+100 M" popup, gauge ticks scroll | +100 m |
| Wrong / timeout | 420 ms horizontal shake of the sub, faint coral pulse, text shake | **none** (verified in screenshot 10) |
| Next question | Panel swaps in with a stepped fade | none |
| Reduced motion | Ambient animation frozen, transitions instant, CSS animations 1 ms | — |

## Screenshot QA loop (`node scripts/qa-screens.mjs`, output in `qa/screenshots/`)

Three iterations were run on desktop (1440×900) and phone (390×844 @2x) viewports, the last against the production build (`next start`). Each run ended with **no console errors and no horizontal overflow**.

| Iteration | Problems found | Fixes |
|---|---|---|
| 1 | Mobile join button below the fold; desktop panel clipped at 900 px; sub hidden under the waterline; gauge ticks every 25 m too sparse; HUD wrapped into 3 tall rows on phones; deep-water overlay dimmed the player's sub; headlight rendered as a grey block; empty groups showed "0/0" | Compact form (optional name behind a toggle, smaller tiles); sub floats on the surface on landing; gauge every 10 m with labels every 50 m; single HUD bar; darkness applied to the world before the sub; headlight removed (blinking nose lamp instead); "—" for empty groups |
| 2 | Panel covered the waterline and boat on mobile; HUD truncated "GROUP 1 • DIVER 1"; gauge strip looked like a grey band in the sky; 401 console error on the presenter login screen | Panel starts at 50 dvh; two-row HUD on ≤ 520 px; gauge strip starts at the waterline; `/api/presenter/me` auth check |
| 3 | Leaderboard rows wrapped heavily on phones; history depth trail too subtle | Shorter stat line; trail with depth stems |

Screens covered: 01 landing (desktop and mobile), 02 invalid group, 04 group full, 05 lobby, 06 presenter ready, 07 read phase / Q1, 08 typing, 09 correct dive (mid-animation and after), 10 incorrect stays put, 11 deep Q7 with seabed, 12 waiting, 13 Q2 with preserved depth, 14 reconnect mid-session, 15 complete, 16 leaderboard, 17 history (desktop and mobile), 18 presenter live and complete, 19 phone with keyboard (short viewport).

## Update: student-driven flow (teacher dashboard removed)

New screens, checked with the same loop (`qa/screenshots/`, desktop 1440×900 and phone 390×844, using real browsers plus API bot students for a full 16-player class; no console errors, no horizontal overflow):

* **03 / 04 group waiting room:** "Group 1 — 3 of 4 players joined", a live roster, and a Start Game button that stays locked until 4/4, then shows "Your group is ready!".
* **06 Get ready:** a 3-second countdown after the student's own Start.
* **07–12 play:** unchanged HUD, ocean, dive and stay-put behaviour. The roster now shows teammates' progress (Q3/7, finished).
* **13 waiting:** "Great job! You've completed the Ocean Dive Challenge", the student's own stats, and a class progress bar ("4 of 16 divers finished · 12 still to join"). No other group's score appears.
* **14 reveal:** rows rise in from last place to first (stepped 520 ms each, 0.7 s apart) and the credit bars grow. Then the winner banner pops in ("Group 2 wins!" or "It's a tie! Groups 1 & 2") and pulses. Reduced motion shows everything at once.

## Update 2: host/player modes, synchronized rounds, depth scoring (2026-11-23)

The visual system above is unchanged (same canvas ocean, palette, fonts, panels, buttons, HUD, gauge). New screens reuse those tokens and classes. Before screenshots are in `qa/before/`, after screenshots in `qa/screenshots/` (desktop 1440×900, phone 390×844 @2x; no console errors, no horizontal overflow).

| Screen | Built from |
|---|---|
| 01 entry: HOST / PLAYER | Landing header unchanged; two `role-card`s styled like group tiles (pink HOST, yellow PLAYER) |
| 02 waiting for host | Landing panel + bobbing sub + "WAITING FOR THE HOST TO OPEN THE GAME…" |
| 03/04 host login, host open | Landing header + panel; wrong password = coral input + bounce |
| 05/06 groups + "Set up your profile" | Existing tiles (now labelled GROUP n, STARTED/FULL) and the existing modal |
| 07 group waiting room | "GROUP 1", "PLAYERS (n/4)", roster slots with names, Start game |
| 09–14 play | Same HUD (Team depth replaces credits) and question card; "Worth +30/+20/+10 M" hint |
| 10 wrong answer | Coral input flash (1.1 s), 460 ms stepped pixel bounce of the form, sub shake + coral pulse, depth unchanged |
| 11 correct answer | "+30 M" popup (bigger and yellow for 30 m), eased dive whose length and duration scale with the reward, bubble burst sized by reward, gauge ticks |
| 12 final countdown | Timer bar turns coral and blinks, panel border coral, big popping 3·2·1 next to the timer, blinking coral screen frame; the sub stays visible |
| 15 complete | "OCEAN DIVE COMPLETE!", "YOUR DEPTH", "WAITING FOR ALL TEAMS TO FINISH…", n/4 teams bar, history link |
| 16 host waiting | Title + "THE CHALLENGE IS IN PROGRESS" + four group status slots (no scores) |
| 18 host final results | Existing reveal animation (rows rise 4th→1st, bars grow, winner banner) at projection size: "1ST PLACE — GROUP 2 … 520 M" |

Depth scale: personal depth is at most 7 × 30 = 210 m, so the scene draws 1 real meter as 3 scene meters (`VISUAL_SCALE`) to keep the same trip from the surface into the deep. The gauge labels show real meters.

Iteration fixes: the final-countdown number first covered the submarine, so it moved into the card with a screen-edge flash. The red input stayed red after a wrong answer, so it is now a short flash. Teammate status read "diving…" between questions, so it is now blank. The sub icon on the waiting-for-host screen rendered full-size, so it now has an explicit size.
