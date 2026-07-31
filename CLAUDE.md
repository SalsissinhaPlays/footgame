# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A turn-based tactical soccer game. Players move pawns on a continuous pitch, plan moves/kicks/stances/sprints simultaneously each turn, then watch a tick-by-tick "autobattle" resolution. Long-term scope (not yet built) also includes teams, leagues/championships, and player career progression (newgens, aging, retirement, form) — the current codebase only covers the match engine itself plus a bare-bones team/player data layer.

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

**There is no automated test suite.** To verify logic in `frontend/src/game/*.ts` (which is plain TS with no React/DOM dependency), write a throwaway script that imports the function under test, run it with `npx tsx some-script.ts` from `frontend/`, then delete the script — this has been the established pattern for validating the resolution engine (see git history for examples: collision fuzz-testing, contest win-rate checks, kick trajectory/aim-spread checks, cooldown-bookkeeping checks, etc.).

## Architecture

### Two independent processes, no shared build

`backend/` and `frontend/` are separate npm packages with no workspace linking; the root `package.json` only wires them together via `concurrently` for local dev. There is no shared-types package — `frontend/src/game/types.ts` (`PlayerDTO`, `TeamDTO`) duplicates the shape of what the backend returns and must be kept in sync by hand.

### Backend: Express + `node:sqlite`

- Persistence uses Node's **built-in** `node:sqlite` module (`DatabaseSync`), not `better-sqlite3`. This was a deliberate choice after `better-sqlite3` failed to install on this Windows machine (no prebuilt binary for the installed Node version, and no Python/build tools for a native compile). Do not reintroduce a native-addon DB driver without checking the environment first.
- `backend/src/db.ts` opens/creates `data/game.db`, defines the `teams` and `players` tables, and seeds two demo teams ("Eagle FC", "Rival United") with a 6-player squad each (GK/DEF/DEF/MID/MID/FWD) if the DB is empty.
- `backend/src/index.ts` is a thin Express layer: `GET /api/teams`, `GET /api/teams/:id/players`, `GET /api/health`. No auth, no write endpoints yet.

### Frontend: the match engine is decoupled from rendering

All match-simulation logic lives in `frontend/src/game/*.ts` as plain, framework-free functions/types with **no dependency on React or Phaser**. `frontend/src/components/Game.tsx` owns all state (pawns, ball, score, turn, camera, selection) and orchestrates it; rendering is delegated to a Phaser 3 scene (see below), not JSX.

- **`constants.ts`** — every tunable game parameter. Tune gameplay feel here, not by scattering magic numbers. Pitch is `GRID_COLS x GRID_ROWS` (60x40 world units — real distances, not literal grid cells; the "GRID_"/"_CELLS" naming predates continuous movement and was kept to avoid a pure renaming churn). Movement/ball speed (`PAWN_SPEED_PER_TICK`, `BALL_SPEED`, `MOVE_RANGE` ticks/turn, `KICK_RANGE`) are all deliberately tuned so a turn covers a modest fraction of the pitch — an earlier pass scaled everything up proportionally with the pitch size and it felt cramped despite the bigger world, so movement/interaction radii were pulled back down independent of pitch dimensions. Interaction radii (`CAPTURE_RADIUS`, `PAWN_COLLISION_RADIUS`, `TACKLE_RADIUS`, `REACT_RADIUS`, `PRESSURE_RADIUS`) are kept at a real "personal space" scale for the same reason. Matches have no turn cap (`TOTAL_TURNS` was removed — they're open-ended).
- **`formation.ts`** — `buildFormation(players, side)` places a squad's `PlayerDTO[]` into fixed pitch positions (mirrored horizontally for the away side), constructing fresh `Pawn`s (all planning/stance/cooldown fields reset).
- **`resolve.ts`** — the core simulation, `resolveTurn(pawns, ball): { snapshots, goal }`. This is the most important file to understand before making mechanical changes. Pure function, no side effects, fully unit-testable via the tsx-script pattern above. See "How a turn resolves" below.
- **`contest.ts`** — every skill-check in the game funnels through `resolveContestDetailed(contestants, kind)`, where `kind` is `"loose_ball" | "interception" | "tackle"`, each with its own `{skill, pace, stamina}` attribute-weight table plus random noise. Returns a winner and a "margin" (how decisive the win was — a big margin is a clean win, a small one produces a scrappy/contested outcome instead of a clean turnover). `stanceBonus()` layers a small additional attribute-weighted term on top for pawns with an active stance (see below) — every bonus is a factor times a real `pawn.player` attribute, not a flat number, so it automatically tracks whatever new attributes get added later.
- **`aim.ts`** — `landingSpread(distance, skill)`/`sampleLanding(...)`: a kick's actual landing point is sampled from a Gaussian spread around the aim point (a "mortar" reticle — most kicks land close, a few land meaningfully off), tighter for a shorter/more-skilled kick. This is what `resolve.ts`'s kick flight aims at, not the raw clicked point.
- **`reactions.ts`** — `attemptsReaction(pawn, kind)`: a one-shot, attribute-gated chance (currently only `"press_loose_ball"`) that lets a pawn abandon its planned move to chase a ball that's just become loose nearby. Rolled once per pawn per loose-ball episode, not every tick, so a pawn's reaction doesn't flicker on and off.
- **`kickIntent.ts`** — purely player-facing classification of what a kick target actually represents (shot/pass/clear) plus a plain-language risk label (`"Safe"/"Risky"/"Very risky"`) derived from the same `landingSpread` sigma the aim-ring is drawn from. The resolution engine itself doesn't care what a kick "means" — this only feeds UI (cell/reach-area tinting, the aim-ring label).
- **`ai.ts`** — rule-based opponent (see below). Flagged as due for a full overhaul — it predates the contest/aim/stance/sprint systems and doesn't use any of them.
- **`iso.ts`** — pure isometric projection math (`createProjector(rotationDeg, tiltDeg)`), used only by the Phaser scene for positioning **and** for recovering a click's world position (`fromIso`, the algebraic inverse of `toIso`) — there is no per-cell click grid anymore (see Rendering below). An extra `OOB_CELLS`-wide out-of-bounds apron is walkable on all four sides, and the goal net pocket (`GOAL_NET_DEPTH` beyond the goal line) is where scoring actually happens.
- **`api.ts`** — thin `fetch` wrappers for the two backend endpoints.
- **`types.ts`** — `Pawn`: `plannedPos` **or** `plannedKick` (mutually exclusive — a destination or a kick, not both), plus additive per-turn fields `stance` (a defensive order, see below) and `plannedSprint`, plus `sprintCooldown` which is the one field that is **not** turn-scoped — it persists and decrements across turns (see "Stances and Sprint" below).

### Rendering: Phaser 3, bridged to React

The pitch/pawns/ball are drawn by a **Phaser 3** (`phaser@3.90.0`, pinned — not the newer Phaser 4 that npm resolves to by default) scene, not SVG/JSX.

- **`frontend/src/phaser/PhaserGame.tsx`** — React wrapper that creates/destroys the `Phaser.Game` instance in a `<div>` on mount/unmount and forwards the ready scene via a callback prop.
- **`frontend/src/phaser/MatchScene.ts`** — the actual renderer. `preload()` loads the sprite PNGs from `frontend/public/sprites/`; `create()` builds static field Graphics and **one static full-world hit `Zone`** (not a per-cell grid — clicks are resolved to a continuous world point via `iso.ts`'s `fromIso`, then Game.tsx checks Euclidean distance against the selected pawn's move/kick budget). `syncState(state)` is the single entry point React calls after every render — it applies camera zoom/pan (`applyCamera`, clamped so panning can't lose the world off-screen, with more pan room available the more zoomed-in the camera is), re-projects and moves/tweens pawn and ball sprites, redraws the field when camera rotation/tilt changed, updates the reach-area highlight, the pawn/ball influence-radius debug overlay, and the planned-move/kick/stance overlay. Pawn/ball position changes are animated via `this.tweens.add(...)` (350ms linear) rather than CSS transitions.
- **`frontend/src/phaser/EventBus.ts`** — a `Phaser.Events.EventEmitter` singleton (same pattern as the official `phaserjs/template-react`), used only for the scene to announce `"current-scene-ready"`.
- **Data flow is one-directional and imperative, not prop-driven**: `Game.tsx` keeps a `sceneRef` (set once via the ready callback) and calls `sceneRef.current?.syncState(...)` in a dependency-free `useEffect` that reruns after every render, gated by a `sceneReady` **state** flag (a ref alone wouldn't trigger the effect that populates the first sprites). Click input flows the other way: the field zone and pawn `pointerdown` handlers call `this.callbacks.onFieldClick/onPawnClick`, which `Game.tsx` wires to always-fresh closures via a `handlersRef` (avoids stale `pawns`/`selectedId` in the one-time `setCallbacks` call).
- **Camera rotation/tilt/pan are not Phaser camera features** — Phaser's `camera.rotation` just spins the 2D view, which isn't what an orbiting isometric camera needs. Rotation/tilt are handled entirely by `iso.ts`'s projection math (recomputed and re-applied to every sprite in `syncState`); only **zoom** and **pan** (via `centerOn`) use Phaser's real camera. Mouse drag-to-orbit (middle/side button, horizontal = rotate, vertical = tilt), wheel-to-zoom, and **WASD-to-pan** are all handled in `Game.tsx`, not inside the Phaser scene. WASD pan runs its own `requestAnimationFrame` loop tracking held keys, screen-relative (no rotation compensation needed since it operates directly in the same projected space `centerOn` uses).
- **Scale mode is `Phaser.Scale.RESIZE`, not `FIT`** — the canvas's real pixel resolution always matches its container exactly. `iso.ts`'s `VIEW_W`/`VIEW_H` remain the fixed *world* size the isometric projection targets; `MatchScene.handleResize` computes `fitZoom = min(canvasW/VIEW_W, canvasH/VIEW_H)` and `applyCamera` applies it times the user's zoom/pan, so the fixed-size world is scaled/centered to fill whatever container size Phaser reports. `PhaserGame.tsx` runs its own `ResizeObserver` on the container div and calls `game.scale.resize(width, height)` directly, since Phaser's `RESIZE` mode only reacts to the *window* `resize` event on its own (not a parent container changing size for other reasons, e.g. entering Fullscreen).
- Sprite art in `frontend/public/sprites/` (`player_home.png`, `player_away.png`, `player_gk.png`, `ball.png`) is AI-generated, stylized pixel-art, cropped tight to content and alpha-cleaned via one-off PowerShell/System.Drawing scripts (not checked in). Two things to check before dropping in regenerated art: (1) **the character's pose must have both feet flat and grounded** — a mid-stride/walking pose with a raised foot causes an unfixable-by-rendering "floating pawn" look; (2) some AI tools export a "transparent" background that's actually a semi-transparent gradient (partial alpha, not 0) — check the alpha histogram before assuming a plain crop is enough. `MatchScene.ts`'s `SPRITE_WIDTH` is `SPRITE_HEIGHT * <aspect ratio>` — recompute that multiplier to match new art's actual width:height ratio. The pitch's ground is **not** an image — it's a per-tile checkerboard fill plus deterministic speckle noise, computed directly from each tile's own projected corners in `redrawField()` (tile size is `CHECKER_CELL_SIZE`, decoupled from gameplay units so draw cost stays bounded on the larger pitch), which can't drift out of sync with the field under rotation.

### How a turn resolves (`resolveTurn`)

Ball and pawns both move through continuous (fractional) coordinate space, not grid cells, advancing over `MOVE_RANGE` ticks per turn.

1. **Kick check**: whoever starts the turn within `CAPTURE_RADIUS` of the ball is the carrier. If they set `plannedKick`, it resolves *before* the tick loop: `startFlight` clamps the raw target to `KICK_RANGE` (Euclidean), then `aim.ts`'s `sampleLanding` perturbs it by a skill/distance-scaled spread — the flight travels toward that *sampled* point, not the raw click. Each tick, `checkCapture` sweeps the segment the flight covered that tick (not just the endpoint, to avoid tunneling past a defender) against every pawn: a teammate within `CAPTURE_RADIUS` receives it; an opponent gets an `"interception"` contest — a decisive win is a clean pick-off (turnover, freezes the turn), a narrow win only knocks the ball loose (a `BallRoll` with friction and a random deflection angle, not a clean takeover). An unopposed flight that reaches its sampled landing point also becomes a loose roll rather than stopping dead.
2. **Movement**: every other pawn advances up to `PAWN_SPEED_PER_TICK` (real distance, any direction) toward its `plannedPos` each tick via `candidateHeadings`, which also tries sidestep angles if the direct line is blocked — a pawn keeps partial progress and can try again next tick rather than being permanently stuck. Effective per-tick speed is not always the base rate: a `"pressure"`-stance opponent nearby cuts it (`PRESSURE_SLOW_FACTOR`), an active sprint multiplies it up (`SPRINT_SPEED_MULTIPLIER`) — these stack multiplicatively, computed fresh each tick. A `"man_mark"` stance pawn with no explicit `plannedPos` gets its destination recomputed every tick as a blend toward the marked opponent's live position (`MAN_MARK_PULL_WEIGHT` — mostly pulled toward the target, partly holding ground, not a blind chase); an explicit `plannedPos` always overrides this.
3. **Collision rules**, run as a fixed-point loop each tick (resolving one collision can create another): **Rule 1 (hard block)** — a pawn not vacating its cell this tick can't be entered, no skill check. **Rule 2 (swap)** — two pawns crossing into each other's space get a `"loose_ball"` contest; the loser is stopped for the rest of the turn. **Rule 3 (group contest)** — three-plus pawns converging on nearby positions, same contest kind, losers stopped. **Invariant**: no two pawns may ever be closer than `PAWN_COLLISION_RADIUS` in any snapshot — this has been fuzz-tested (random start/destination pairs, hundreds of trials); preserve it if you touch collision rules.
4. **Tackling**: a dribbling (non-kicking) carrier can be challenged every tick by the nearest not-yet-tried opponent within `TACKLE_RADIUS` — a `"tackle"` contest, decisive win = clean turnover (freezes the turn), narrow win = ball knocked loose. A `stanceBonus` applies for `"aggressive"` (pace-scaled) or `"man_mark"` (skill+pace-scaled, only against the actual marked opponent) challengers.
5. **Reactions**: any pawn newly within `REACT_RADIUS` of a still-loose ball gets a one-shot `attemptsReaction` roll to abandon its plan and chase it instead (see `reactions.ts`).
6. **Scoring**: if the ball's movement this tick crossed a goal line within the goal-mouth rows (checked at the crossing point, not just the tick's end position, to avoid tunneling — `goalCrossedAlong`), `goal` is set and the rest of the turn freezes immediately; `Game.tsx` increments score, resets both sides to kickoff formation, and re-centers the ball.
7. **Per-tick events**: each `ResolveSnapshot` carries the events generated *during that specific tick* (not one flat end-of-turn list) via a running cursor into the shared event log — this is what lets `Game.tsx` reveal the events log in sync with the animation instead of dumping everything after playback finishes.

### Stances and Sprint

Two different categories of per-pawn tactical choice, layered on top of `plannedPos`/`plannedKick` rather than replacing them:

- **Stances** (`types.ts`'s `Stance` union) are freely re-selectable every turn, cleared automatically once a turn resolves (`Game.tsx`'s post-turn bookkeeping in `resolveWithPawns`): `"aggressive"` (tackle-contest bonus), `"pressure"` (slows nearby opponents' movement, see step 2 above), `"cover_passing"` (interception-contest bonus), `"man_mark"` (auto-movement blend + contest bonus against one specific opponent, picked via a target-picker click mode in `Game.tsx`). Left open to future variants (a header-bonus stance once crossing/heights exist, offensive stances) without needing a redesign.
- **Sprint** is deliberately *not* a stance — it's a cooldown-gated skill (`plannedSprint` + `sprintCooldown` on `Pawn`), since there's no stamina-drain/fatigue resource to draw a numeric cost from; the cooldown lockout is the cost. `sprintCooldown` is the one piece of pawn state that persists and evolves across turn boundaries rather than resetting — `resolve.ts` only reads `plannedSprint` (a pure per-turn function has no notion of "next turn"), while `Game.tsx` sets/decrements `sprintCooldown` in the same post-turn pass that clears stances.
- Both are hidden from the non-controlling side in hotseat the same way `plannedPos`/`plannedKick` already are (`MatchScene.ts`'s `updatePawns`); `sprintCooldown` itself stays visible to both sides since it's a public status, not hidden intent.
- Neither is wired into `ai.ts` — intentionally, pending the AI overhaul mentioned above.

### Hotseat multiplayer and hidden information

`Game.tsx` holds `controllingSide`, `readySides`, and `handoff`. Each side plans only its own pawns (`handlePawnClick` gates by `controllingSide`), then clicks "Ready" (`handleReady`). If the other side isn't ready yet, a full-screen handoff prompt ("Pass the computer") hides the board until the next player clicks through; when both sides are ready, `resolveTurn` runs automatically. `MatchScene.ts`'s `updatePawns` strips `plannedPos`/`plannedKick`/`stance`/`plannedSprint` from the non-controlling side's pawns before rendering, so a player can't see the opponent's queued intent. There is no server-side authority or actual separation between the two "players" — this is local/same-screen only, by design. (A separate in-game test-environment mode, rather than relying on hotseat for testing, has been discussed but not built — "Solo mode" below is the current stand-in.)

### AI opponent (`game/ai.ts`)

`planAiTurn(pawns, ball, aiSide)` is a simple rule-based decision function, not search/minimax — it returns a full `Pawn[]` with `plannedPos`/`plannedKick` filled in for `aiSide` only. Rules, checked in order, for the AI's ball carrier: shoot if the opponent's goal is within `KICK_RANGE` and the straight line to it is clear (`hasClearLane`, using `distanceToSegment` against `CAPTURE_RADIUS` — not exact-cell equality, which broke once pawn positions went continuous); else pass to the most advanced teammate with a clear lane; else dribble upfield (`moveToward`, Euclidean, clamped to the move budget). Off the ball: the nearest non-GK teammate presses the ball if the AI doesn't have it, everyone else holds/drifts toward their own half; the `GK` always shadows the ball's row in front of its own goal. `moveToward` picks a final destination for the turn (like a human click) — it doesn't know about `resolveTurn`'s per-tick sidestep logic, so it can still get fully blocked by a defender sitting directly on a same-row/same-column line to its target. Does not use stances or sprint (see above) and is generally considered due for a broader overhaul given everything shipped since it was written.

In `Game.tsx`, `mode: "ai"` skips the `readySides`/`handoff` dance entirely: clicking "Continue" computes the AI's moves for `"away"` synchronously and resolves immediately, so the AI's plan is never held in React state before resolution (nothing to accidentally reveal).

### Pre-game menu

`MainMenu.tsx` offers three modes, all English: "Local multiplayer" (hotseat, see above), "Play against AI" (human always plays `home`, AI always plays `away`), and "Solo mode (testing)" (practice — away side never gets a plan, stays put; useful for testing mechanics without an opponent). `App.tsx` is a tiny two-screen state machine (`menu` / `match`) with no router.

### Windows dev environment note

Node.js was installed via `winget install OpenJS.NodeJS.LTS` mid-project. If a shell reports `node`/`npm` not found despite Node being installed, it's a stale PATH in that shell session, not a missing install.
