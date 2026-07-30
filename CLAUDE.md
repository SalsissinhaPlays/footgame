# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A turn-based tactical soccer game (Portuguese-language UI). Players move pawns on a grid pitch, plan moves/kicks simultaneously each turn, then watch a tick-by-tick "autobattle" resolution. Long-term scope (not yet built) also includes teams, leagues/championships, and player career progression (newgens, aging, retirement, form) — the current codebase only covers the match engine itself plus a bare-bones team/player data layer.

## Commands

Run from the repo root unless noted:

```bash
npm run dev              # starts backend (port 3001) and frontend (Vite, port 5173/5174) together
npm run dev --prefix backend   # backend only (tsx watch)
npm run dev --prefix frontend  # frontend only (vite)
```

Frontend (`frontend/`):
```bash
npx tsc --noEmit -p tsconfig.app.json   # type-check the app code — run this after any change
npm run build                            # tsc -b && vite build
npm run lint                             # oxlint
```

Backend (`backend/`):
```bash
npx tsc --noEmit    # type-check
npm run build       # compiles to dist/
```

**There is no automated test suite.** To verify logic in `frontend/src/game/*.ts` (which is plain TS with no React/DOM dependency), write a throwaway script that imports the function under test, run it with `npx tsx some-script.ts` from `frontend/`, then delete the script — this has been the established pattern for validating the resolution engine (see git history for examples: collision fuzz-testing, kick trajectory checks, etc.).

## Architecture

### Two independent processes, no shared build

`backend/` and `frontend/` are separate npm packages with no workspace linking; the root `package.json` only wires them together via `concurrently` for local dev. There is no shared-types package — `frontend/src/game/types.ts` (`PlayerDTO`, `TeamDTO`) duplicates the shape of what the backend returns and must be kept in sync by hand.

### Backend: Express + `node:sqlite`

- Persistence uses Node's **built-in** `node:sqlite` module (`DatabaseSync`), not `better-sqlite3`. This was a deliberate choice after `better-sqlite3` failed to install on this Windows machine (no prebuilt binary for the installed Node version, and no Python/build tools for a native compile). Do not reintroduce a native-addon DB driver without checking the environment first.
- `backend/src/db.ts` opens/creates `data/game.db`, defines the `teams` and `players` tables, and seeds two demo teams ("Eagle FC", "Rival United") with a 6-player squad each (GK/DEF/DEF/MID/MID/FWD) if the DB is empty.
- `backend/src/index.ts` is a thin Express layer: `GET /api/teams`, `GET /api/teams/:id/players`, `GET /api/health`. No auth, no write endpoints yet.

### Frontend: the match engine is decoupled from rendering

All match-simulation logic lives in `frontend/src/game/*.ts` as plain, framework-free functions/types with **no dependency on React or Phaser**. `frontend/src/components/Game.tsx` owns all state (pawns, ball, score, turn, camera, selection) and orchestrates it; rendering is delegated to a Phaser 3 scene (see below), not JSX.

- **`constants.ts`** — every tunable game parameter (grid size, `MOVE_RANGE`, `KICK_RANGE`, `BALL_SPEED`, `TOTAL_TURNS`, goal-mouth rows, `OOB_CELLS`). Tune gameplay feel here, not by scattering magic numbers.
- **`formation.ts`** — `buildFormation(players, side)` places a squad's `PlayerDTO[]` into fixed grid slots (mirrored horizontally for the away side).
- **`resolve.ts`** — the core simulation, `resolveTurn(pawns, ball): { snapshots, events, goal }`. This is the most important file to understand before making mechanical changes. Pure function, no side effects, fully unit-testable via the tsx-script pattern above.
- **`ai.ts`** — rule-based opponent (see below).
- **`iso.ts`** — pure isometric projection math (`createProjector(rotationDeg, tiltDeg)`), used only by the Phaser scene for positioning. Grid size is `GRID_COLS x GRID_ROWS` (16x12); an extra `OOB_CELLS`-wide out-of-bounds apron is walkable on all four sides, and the goal net pocket (`GOAL_NET_DEPTH` beyond the goal line) is where scoring actually happens — see below.
- **`api.ts`** — thin `fetch` wrappers for the two backend endpoints.
- **`types.ts`** — `Pawn` (with `plannedPos` **or** `plannedKick`, mutually exclusive), `Ball`, `Side`.

### Rendering: Phaser 3, bridged to React

The pitch/pawns/ball are drawn by a **Phaser 3** (`phaser@3.90.0`, pinned — not the newer Phaser 4 that npm resolves to by default) scene, not SVG/JSX. This was a deliberate migration; `frontend/src/components/Field.tsx`/`PawnView.tsx`/`BallView.tsx` (the original SVG renderers) were deleted.

- **`frontend/src/phaser/PhaserGame.tsx`** — React wrapper that creates/destroys the `Phaser.Game` instance in a `<div>` on mount/unmount and forwards the ready scene via a callback prop.
- **`frontend/src/phaser/MatchScene.ts`** — the actual renderer. `preload()` loads the sprite PNGs from `frontend/public/sprites/`; `create()` builds static field Graphics and the interactive cell grid (each cell is a `Phaser.GameObjects.Zone` with a custom `Phaser.Geom.Polygon` hit area, since cells are diamond-shaped under the iso projection, not rectangles). `syncState(state)` is the single entry point React calls after every render — it re-projects and moves/tweens pawn and ball sprites, redraws the field when camera rotation/tilt changed, and updates cell highlight colors. Pawn/ball position changes are animated via `this.tweens.add(...)` (350ms linear) rather than CSS transitions.
- **`frontend/src/phaser/EventBus.ts`** — a `Phaser.Events.EventEmitter` singleton (same pattern as the official `phaserjs/template-react`), used only for the scene to announce `"current-scene-ready"`.
- **Data flow is one-directional and imperative, not prop-driven**: `Game.tsx` keeps a `sceneRef` (set once via the ready callback) and calls `sceneRef.current?.syncState(...)` in a dependency-free `useEffect` that reruns after every render. Because setting a ref doesn't trigger a re-render, there's also a `sceneReady` **state** flag flipped in the ready callback — without it, the first `syncState` call (the one that actually populates pawn sprites) never fires, since the effect that would call it already ran (with a null ref) before the scene finished loading. Click input flows the other way: pawn/cell `pointerdown` handlers call `this.callbacks.onPawnClick/onCellClick`, which `Game.tsx` wires to always-fresh closures via a `handlersRef` (avoids stale `pawns`/`selectedId` in the one-time `setCallbacks` call).
- **Camera rotation/tilt is not a Phaser camera feature** — Phaser's `camera.rotation` just spins the 2D view, which isn't what an orbiting isometric camera needs. Rotation/tilt are handled entirely by `iso.ts`'s projection math (recomputed and re-applied to every sprite in `syncState`); only **zoom** uses Phaser's real `camera.setZoom`. Mouse drag-to-orbit (middle/side button, horizontal = rotate, vertical = tilt) and wheel-to-zoom are handled in `Game.tsx` on the wrapping `<div>`, not inside the Phaser scene, so the existing proven mouse-event code didn't need to move.
- **Scale mode is `Phaser.Scale.RESIZE`, not `FIT`** — the canvas's real pixel resolution always matches its container exactly (no CSS-scaled fixed-resolution canvas, no letterbox bars baked into the DOM). `iso.ts`'s `VIEW_W`/`VIEW_H` remain the fixed *world* size the isometric projection targets; `MatchScene.handleResize` computes `fitZoom = min(canvasW/VIEW_W, canvasH/VIEW_H)` and applies it via `camera.setZoom(fitZoom * userZoom)` plus `camera.centerOn(VIEW_W/2, VIEW_H/2)`, so the fixed-size world is scaled/centered to fill whatever container size Phaser reports — this is what lets the pitch fill any window/device aspect ratio without ever cropping content (a deliberate tradeoff over `ENVELOP`, which would crop). Phaser's `RESIZE` mode only reacts to the *window* `resize` event on its own; it does **not** notice a parent container changing size for other reasons (entering Fullscreen, a CSS layout change). `PhaserGame.tsx` therefore runs its own `ResizeObserver` on the container div and calls `game.scale.resize(width, height)` directly — without it, resizing the container (e.g. toggling fullscreen) silently leaves the canvas at its original resolution.
- Sprite art in `frontend/public/sprites/` (`player_home.png`, `player_away.png`, `player_gk.png`, `ball.png`) is AI-generated, stylized pixel-art (Ragnarok Online / AoE2-ish), cropped tight to content and alpha-cleaned via one-off PowerShell/System.Drawing scripts (not checked in). Two things to check before dropping in regenerated art: (1) **the character's pose must have both feet flat and grounded** — a mid-stride/walking pose with a raised foot is a real, unfixable-by-rendering cause of a "floating pawn" look, found by literally cropping and zooming into the sprite's feet; (2) some AI tools export a "transparent" background that's actually a semi-transparent gradient (partial alpha, not 0) rather than true transparency — check the alpha histogram (background and character alpha values should form two clearly separated clusters) before assuming a plain crop is enough; if the background has partial alpha, threshold-remap it (e.g. ramp alpha 0 below ~140, 255 above ~190) before cropping. `MatchScene.ts`'s `SPRITE_WIDTH` is `SPRITE_HEIGHT * <aspect ratio>` — recompute that multiplier to match new art's actual width:height ratio, or characters render stretched. The pitch's ground texture is **not** an image — `grass_light.png`/`grass_dark.png` were tried as a masked `TileSprite` and dropped (see git history: it produced a static, non-rotating "ghost" layer behind the correctly-rotating field, and this environment couldn't render/verify Phaser output to debug it further); the ground is now a per-cell checkerboard fill plus deterministic speckle noise, both computed directly from each cell's own projected corners in `redrawField()`, which can't drift out of sync with the rest of the field under rotation.

### How a turn resolves (`resolveTurn`)

1. **Kick check**: whoever currently occupies the ball's cell is the carrier. If they set `plannedKick`, the kick resolves *before* normal movement: the ball travels in a straight line (`lineCells`) toward the (range-clamped) target. It stops at the first occupied cell — a teammate there receives the pass, an opponent gets a skill-check to intercept — or when it enters a goal mouth (`goalScoredAt`), or at the end of its range. A scoring kick ends the turn immediately (everyone else freezes) with the ball animated across the flight path at `BALL_SPEED` cells/tick, not teleported.
2. **Movement**: every other pawn advances **one cell per tick** toward its `plannedPos` (not a precomputed multi-cell path — this matters: it's what lets a pawn keep partial progress if it gets blocked partway, and lets it try again next tick). If the ideal diagonal step is blocked by a stationary pawn, it tries sidestep candidates (`candidateSteps`: diagonal, then horizontal-only, then vertical-only) before giving up for that tick only — being blocked never permanently freezes a pawn.
3. **Collision rules**, run as a fixed-point loop each tick (resolving one collision can create another, e.g. a pawn frozen by rule 3 becomes a new hard-block for someone else):
   - **Rule 1 (hard block)**: a cell held by a pawn not vacating it this tick can't be entered — no skill check, it's just occupied.
   - **Rule 2 (swap)**: two pawns trying to cross into each other's cell — skill-check; the loser is stopped for the rest of the turn, the winner is also frozen *this tick only* (to avoid a one-tick overlap) but may proceed next tick.
   - **Rule 3 (group contest)**: two-plus pawns converging on the same free cell — skill-check; losers stopped for the rest of the turn.
   - Skill check (`skillCheckRoll`): `skill*0.7 + pace*0.3 + random(-15, 15)`, highest wins. This is a placeholder formula, expected to be retuned.
4. **Invariant**: no two pawns may ever occupy the same cell in any snapshot. This has been fuzz-tested (random start/destination pairs, hundreds of trials) — preserve this invariant if you touch the collision rules.
5. If the ball ends the turn past the goal line (`goalScoredAt`: `x < 0` or `x >= GRID_COLS`, within `GOAL_ROW_MIN..GOAL_ROW_MAX`) — i.e. actually inside the net, not just standing on the pitch-edge cell — `goal` is set; `Game.tsx` increments score, resets both sides to kickoff formation, and re-centers the ball (`BALL_START`). Reaching the net works whether the ball got there by a kick or by a pawn dribbling it there, since pawns are allowed to walk into the out-of-bounds apron/net (`OOB_CELLS`).

### Hotseat multiplayer and hidden information

`Game.tsx` holds `controllingSide`, `readySides`, and `handoff`. Each side plans only its own pawns (`handlePawnClick` gates by `controllingSide`), then clicks "Pronto" (`handleReady`). If the other side isn't ready yet, a full-screen handoff prompt ("Passe o computador") hides the board until the next player clicks through; when both sides are ready, `resolveTurn` runs automatically. `visiblePawns` (derived in render) strips `plannedPos`/`plannedKick` from the non-controlling side so a player can't see the opponent's queued moves. There is no server-side authority or actual separation between the two "players" — this is local/same-screen only, by design (the user described it as "para testes mesmo").

### AI opponent (`game/ai.ts`)

`planAiTurn(pawns, ball, aiSide)` is a simple rule-based decision function, not search/minimax — it returns a full `Pawn[]` with `plannedPos`/`plannedKick` filled in for `aiSide` only, ready to feed straight into `resolveTurn`. Rules, checked in order, for the AI's ball carrier: shoot if the opponent's goal is within `KICK_RANGE` and the straight line to it is clear (`hasClearLane`); else pass to the most advanced teammate with a clear lane; else dribble upfield (`moveToward` the goal, clamped to `MOVE_RANGE`). Off the ball: the nearest non-GK teammate presses the ball if the AI doesn't have it, everyone else holds/drifts toward their own half; the `GK` always just shadows the ball's row in front of its own goal. `moveToward` picks a final destination for the turn (like a human clicking a cell) — it does not know about `resolveTurn`'s per-tick sidestep logic, so the AI can still get fully blocked by a defender sitting directly on a same-row/same-column line to its target (no lateral give to route around, same limitation as human-planned moves in that geometry).

In `Game.tsx`, `mode: "ai"` skips the `readySides`/`handoff` dance entirely: clicking "Prosseguir" computes the AI's moves for `"away"` synchronously and resolves immediately, so the AI's plan is never held in React state before resolution (nothing to accidentally reveal).

### Pre-game menu

`MainMenu.tsx` offers three modes: "Multiplayer local" (hotseat, see above), "Jogar contra a IA" (human always plays `home`, AI always plays `away`), and "Modo solo" (practice — away side never gets a plan, stays put; useful for testing mechanics without an opponent). `App.tsx` is a tiny two-screen state machine (`menu` / `match`) with no router.

### Windows dev environment note

Node.js was installed via `winget install OpenJS.NodeJS.LTS` mid-project. If a shell reports `node`/`npm` not found despite Node being installed, it's a stale PATH in that shell session, not a missing install.
