import { GOAL_ROW_MAX, GOAL_ROW_MIN, GRID_COLS, MOVE_RANGE } from "./constants";
import type { Ball, Pawn, Side, Vec2 } from "./types";

export interface ResolveSnapshot {
  pawns: Pawn[];
  ball: Vec2;
}

export interface ResolveResult {
  snapshots: ResolveSnapshot[];
  events: string[];
  /** Side that scored, if the ball ended the turn inside a goal mouth. */
  goal: Side | null;
}

function isInGoalRows(y: number): boolean {
  return y >= GOAL_ROW_MIN && y <= GOAL_ROW_MAX;
}

/** Which side's net the ball is sitting in, if any. Home attacks toward the right edge. */
function goalScoredAt(pos: Vec2): Side | null {
  if (!isInGoalRows(pos.y)) return null;
  if (pos.x <= 0) return "away";
  if (pos.x >= GRID_COLS - 1) return "home";
  return null;
}

function key(v: Vec2): string {
  return `${v.x},${v.y}`;
}

function lerpPath(start: Vec2, end: Vec2, steps: number): Vec2[] {
  const path: Vec2[] = [];
  for (let t = 1; t <= steps; t++) {
    const fraction = t / steps;
    path.push({
      x: Math.round(start.x + (end.x - start.x) * fraction),
      y: Math.round(start.y + (end.y - start.y) * fraction),
    });
  }
  return path;
}

function skillCheckRoll(pawn: Pawn): number {
  const { skill, pace } = pawn.player;
  return skill * 0.7 + pace * 0.3 + (Math.random() * 30 - 15);
}

function pickWinner(contestants: Pawn[]): Pawn {
  let best = contestants[0];
  let bestRoll = -Infinity;
  for (const c of contestants) {
    const roll = skillCheckRoll(c);
    if (roll > bestRoll) {
      bestRoll = roll;
      best = c;
    }
  }
  return best;
}

/**
 * Resolves one full turn tick by tick. Invariant that must never break:
 * no two pawns may occupy the same cell in any snapshot. Collisions are
 * settled with a skill check; losers are stopped for the rest of the turn.
 */
export function resolveTurn(pawns: Pawn[], ball: Ball): ResolveResult {
  const events: string[] = [];
  let current: Pawn[] = pawns.map((p) => ({ ...p }));
  const paths = new Map(
    current.map((p) => [p.id, lerpPath(p.pos, p.plannedPos ?? p.pos, MOVE_RANGE)])
  );
  const stopped = new Set<string>();
  const snapshots: ResolveSnapshot[] = [];

  // Whoever starts the turn standing on the ball carries it. If nobody is
  // there, the ball just sits still until someone reaches it next turn.
  const carrierId = current.find((p) => key(p.pos) === key(ball.pos))?.id ?? null;
  let ballPos: Vec2 = { ...ball.pos };

  for (let tick = 0; tick < MOVE_RANGE; tick++) {
    const preTickPos = new Map(current.map((p) => [p.id, p.pos]));
    const intended = new Map<string, Vec2>();
    for (const p of current) {
      intended.set(p.id, stopped.has(p.id) ? p.pos : paths.get(p.id)![tick]);
    }

    const isMoving = (id: string) => key(intended.get(id)!) !== key(preTickPos.get(id)!);
    const occupantOf = (cell: Vec2, excludeId: string) =>
      current.find((o) => o.id !== excludeId && key(preTickPos.get(o.id)!) === key(cell));

    // Settling one collision can create a new one (e.g. a pawn frozen by rule 3
    // becomes a hard block for someone else's path), so all three rules run
    // together in a fixed-point loop until a full pass makes no more changes.
    let changed = true;
    while (changed) {
      changed = false;

      // Rule 1: a cell held by a pawn that isn't vacating it this tick is a
      // hard block — no skill check, nobody can walk through an occupied square.
      for (const p of current) {
        if (!isMoving(p.id)) continue;
        const occupant = occupantOf(intended.get(p.id)!, p.id);
        if (occupant && !isMoving(occupant.id)) {
          intended.set(p.id, preTickPos.get(p.id)!);
          stopped.add(p.id);
          changed = true;
        }
      }

      // Rule 2: direct swaps (A -> B's cell, B -> A's cell). Neither completes
      // the crossing this tick; the loser is stopped for good, the winner may
      // try again on a later tick.
      for (const p of current) {
        if (!isMoving(p.id) || stopped.has(p.id)) continue;
        const dest = intended.get(p.id)!;
        const occupant = occupantOf(dest, p.id);
        if (!occupant || !isMoving(occupant.id) || stopped.has(occupant.id)) continue;
        if (key(intended.get(occupant.id)!) !== key(preTickPos.get(p.id)!)) continue;

        const winner = pickWinner([p, occupant]);
        const loser = winner.id === p.id ? occupant : p;
        events.push(
          `Choque ao cruzar: ${p.player.name} vs ${occupant.player.name} — vence ${winner.player.name}`
        );
        stopped.add(loser.id);
        intended.set(loser.id, preTickPos.get(loser.id)!);
        intended.set(winner.id, preTickPos.get(winner.id)!);
        changed = true;
      }

      // Rule 3: two or more pawns converging on the same free cell.
      const destGroups = new Map<string, string[]>();
      for (const p of current) {
        if (!isMoving(p.id)) continue;
        const arr = destGroups.get(key(intended.get(p.id)!)) ?? [];
        arr.push(p.id);
        destGroups.set(key(intended.get(p.id)!), arr);
      }
      for (const [cellKey, ids] of destGroups) {
        if (ids.length <= 1) continue;
        const contestants = ids.map((id) => current.find((p) => p.id === id)!);
        const winner = pickWinner(contestants);
        events.push(
          `Disputa em (${cellKey}): ${contestants.map((c) => c.player.name).join(" vs ")} — vence ${winner.player.name}`
        );
        for (const c of contestants) {
          if (c.id !== winner.id) {
            stopped.add(c.id);
            intended.set(c.id, preTickPos.get(c.id)!);
            changed = true;
          }
        }
      }
    }

    current = current.map((p) => ({ ...p, pos: intended.get(p.id)!, plannedPos: null }));
    if (carrierId) {
      ballPos = { ...current.find((p) => p.id === carrierId)!.pos };
    }
    snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos } });
  }

  const goal = goalScoredAt(ballPos);
  if (goal) {
    events.push(goal === "home" ? "GOL do time da casa!" : "GOL do time visitante!");
  }

  return { snapshots, events, goal };
}
