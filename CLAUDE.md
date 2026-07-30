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

### Frontend: the match engine is decoupled from React

All match-simulation logic lives in `frontend/src/game/*.ts` as plain, framework-free functions/types. `frontend/src/components/Game.tsx` is the only component with state; everything else (`Field`, `PawnView`, `BallView`, `MainMenu`) is presentational.

- **`constants.ts`** — every tunable game parameter (grid size, `MOVE_RANGE`, `KICK_RANGE`, `BALL_SPEED`, `TOTAL_TURNS`, goal-mouth rows). Tune gameplay feel here, not by scattering magic numbers.
- **`formation.ts`** — `buildFormation(players, side)` places a squad's `PlayerDTO[]` into fixed grid slots (mirrored horizontally for the away side).
- **`resolve.ts`** — the core simulation, `resolveTurn(pawns, ball): { snapshots, events, goal }`. This is the most important file to understand before making mechanical changes. Pure function, no side effects, fully unit-testable via the tsx-script pattern above.
- **`api.ts`** — thin `fetch` wrappers for the two backend endpoints.
- **`types.ts`** — `Pawn` (with `plannedPos` **or** `plannedKick`, mutually exclusive), `Ball`, `Side`.

### How a turn resolves (`resolveTurn`)

1. **Kick check**: whoever currently occupies the ball's cell is the carrier. If they set `plannedKick`, the kick resolves *before* normal movement: the ball travels in a straight line (`lineCells`) toward the (range-clamped) target. It stops at the first occupied cell — a teammate there receives the pass, an opponent gets a skill-check to intercept — or when it enters a goal mouth (`goalScoredAt`), or at the end of its range. A scoring kick ends the turn immediately (everyone else freezes) with the ball animated across the flight path at `BALL_SPEED` cells/tick, not teleported.
2. **Movement**: every other pawn advances **one cell per tick** toward its `plannedPos` (not a precomputed multi-cell path — this matters: it's what lets a pawn keep partial progress if it gets blocked partway, and lets it try again next tick). If the ideal diagonal step is blocked by a stationary pawn, it tries sidestep candidates (`candidateSteps`: diagonal, then horizontal-only, then vertical-only) before giving up for that tick only — being blocked never permanently freezes a pawn.
3. **Collision rules**, run as a fixed-point loop each tick (resolving one collision can create another, e.g. a pawn frozen by rule 3 becomes a new hard-block for someone else):
   - **Rule 1 (hard block)**: a cell held by a pawn not vacating it this tick can't be entered — no skill check, it's just occupied.
   - **Rule 2 (swap)**: two pawns trying to cross into each other's cell — skill-check; the loser is stopped for the rest of the turn, the winner is also frozen *this tick only* (to avoid a one-tick overlap) but may proceed next tick.
   - **Rule 3 (group contest)**: two-plus pawns converging on the same free cell — skill-check; losers stopped for the rest of the turn.
   - Skill check (`skillCheckRoll`): `skill*0.7 + pace*0.3 + random(-15, 15)`, highest wins. This is a placeholder formula, expected to be retuned.
4. **Invariant**: no two pawns may ever occupy the same cell in any snapshot. This has been fuzz-tested (random start/destination pairs, hundreds of trials) — preserve this invariant if you touch the collision rules.
5. If the ball ends the turn inside a goal mouth (`goalScoredAt`, columns 0 or `GRID_COLS-1` within `GOAL_ROW_MIN..GOAL_ROW_MAX`), `goal` is set; `Game.tsx` increments score, resets both sides to kickoff formation, and re-centers the ball (`BALL_START`).

### Hotseat multiplayer and hidden information

`Game.tsx` holds `controllingSide`, `readySides`, and `handoff`. Each side plans only its own pawns (`handlePawnClick` gates by `controllingSide`), then clicks "Pronto" (`handleReady`). If the other side isn't ready yet, a full-screen handoff prompt ("Passe o computador") hides the board until the next player clicks through; when both sides are ready, `resolveTurn` runs automatically. `visiblePawns` (derived in render) strips `plannedPos`/`plannedKick` from the non-controlling side so a player can't see the opponent's queued moves. There is no server-side authority or actual separation between the two "players" — this is local/same-screen only, by design (the user described it as "para testes mesmo").

### AI opponent (`game/ai.ts`)

`planAiTurn(pawns, ball, aiSide)` is a simple rule-based decision function, not search/minimax — it returns a full `Pawn[]` with `plannedPos`/`plannedKick` filled in for `aiSide` only, ready to feed straight into `resolveTurn`. Rules, checked in order, for the AI's ball carrier: shoot if the opponent's goal is within `KICK_RANGE` and the straight line to it is clear (`hasClearLane`); else pass to the most advanced teammate with a clear lane; else dribble upfield (`moveToward` the goal, clamped to `MOVE_RANGE`). Off the ball: the nearest non-GK teammate presses the ball if the AI doesn't have it, everyone else holds/drifts toward their own half; the `GK` always just shadows the ball's row in front of its own goal. `moveToward` picks a final destination for the turn (like a human clicking a cell) — it does not know about `resolveTurn`'s per-tick sidestep logic, so the AI can still get fully blocked by a defender sitting directly on a same-row/same-column line to its target (no lateral give to route around, same limitation as human-planned moves in that geometry).

In `Game.tsx`, `mode: "ai"` skips the `readySides`/`handoff` dance entirely: clicking "Prosseguir" computes the AI's moves for `"away"` synchronously and resolves immediately, so the AI's plan is never held in React state before resolution (nothing to accidentally reveal).

### Pre-game menu

`MainMenu.tsx` offers "Multiplayer local" (hotseat, see above) and "Jogar contra a IA" (human always plays `home`, AI always plays `away`). `App.tsx` is a tiny two-screen state machine (`menu` / `match`) with no router.

### Windows dev environment note

Node.js was installed via `winget install OpenJS.NodeJS.LTS` mid-project. If a shell reports `node`/`npm` not found despite Node being installed, it's a stale PATH in that shell session, not a missing install.
