import {
  CAPTURE_RADIUS,
  GOAL_ROW_MAX,
  GOAL_ROW_MIN,
  GRID_COLS,
  GRID_ROWS,
  KICK_RANGE,
  OOB_CELLS,
  PAWN_MOVE_BUDGET,
} from "./constants";
import { distanceToSegment } from "./resolve";
import type { Ball, Pawn, Side, Vec2 } from "./types";

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function inBounds(pos: Vec2): boolean {
  return (
    pos.x >= -OOB_CELLS &&
    pos.x < GRID_COLS + OOB_CELLS &&
    pos.y >= -OOB_CELLS &&
    pos.y < GRID_ROWS + OOB_CELLS
  );
}

/** The pitch-edge point closest to the opponent's goal — used for movement/ranking, always in bounds. */
function opponentGoalLine(side: Side): Vec2 {
  return { x: side === "home" ? GRID_COLS - 1 : 0, y: Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2) };
}

/** Just past the goal line, inside the net — the actual shot target, since a goal only counts out there. */
function opponentGoalNet(side: Side): Vec2 {
  return { x: side === "home" ? GRID_COLS : -1, y: Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2) };
}

function ownGoal(side: Side): Vec2 {
  return { x: side === "home" ? 0 : GRID_COLS - 1, y: Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2) };
}

/**
 * Whether any of `obstacles` sits close enough to the straight line between
 * `from` and `to` to plausibly reach it — the same CAPTURE_RADIUS the
 * resolution engine itself uses to decide if a defender can intercept a
 * flight, checked via distance-from-segment rather than exact-cell
 * equality. Exact equality against a rounded lineCells path was a latent bug
 * once pawn positions went continuous: a pawn essentially never sits on an
 * exact integer point after its first move, so it silently never blocked.
 */
function hasClearLane(from: Vec2, to: Vec2, obstacles: Pawn[]): boolean {
  return !obstacles.some((o) => distanceToSegment(o.pos, from, to) <= CAPTURE_RADIUS);
}

/**
 * Destination up to `maxDistance` (real, Euclidean) away from `pos`, heading
 * straight toward `dest`, clamped to the field. The engine walks a pawn
 * there at a real distance-per-tick pace in any direction, so the AI plans
 * on the same continuous terms — no rounding to a whole cell.
 */
function moveToward(pos: Vec2, dest: Vec2, maxDistance: number): Vec2 {
  const dx = dest.x - pos.x;
  const dy = dest.y - pos.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { ...pos };
  const factor = Math.min(1, maxDistance / distance);
  const target = { x: pos.x + dx * factor, y: pos.y + dy * factor };
  return inBounds(target) ? target : pos;
}

/**
 * A simple rule-based opponent: shoot when there's a clear sight of goal,
 * otherwise pass to a more advanced open teammate, otherwise dribble upfield.
 * Off the ball, the nearest outfield pawn presses; everyone else holds shape.
 * The goalkeeper just shadows the ball's row in front of its own goal.
 */
export function planAiTurn(pawns: Pawn[], ball: Ball, aiSide: Side): Pawn[] {
  const teammates = pawns.filter((p) => p.side === aiSide);
  const opponents = pawns.filter((p) => p.side !== aiSide);
  const carrier = teammates.find((p) => p.pos.x === ball.pos.x && p.pos.y === ball.pos.y) ?? null;
  const goalLine = opponentGoalLine(aiSide);
  const goalNet = opponentGoalNet(aiSide);
  const home = ownGoal(aiSide);

  const closestChaserId = teammates
    .filter((p) => p.player.position !== "GK")
    .sort((a, b) => dist(a.pos, ball.pos) - dist(b.pos, ball.pos))[0]?.id;

  return pawns.map((pawn) => {
    if (pawn.side !== aiSide) return pawn;

    if (pawn.player.position === "GK") {
      const targetY = Math.max(GOAL_ROW_MIN, Math.min(GOAL_ROW_MAX, ball.pos.y));
      const target = { x: home.x + (aiSide === "home" ? 1 : -1), y: targetY };
      return { ...pawn, plannedSteps: [{ pos: moveToward(pawn.pos, target, PAWN_MOVE_BUDGET) }] };
    }

    if (carrier && pawn.id === carrier.id) {
      if (dist(pawn.pos, goalNet) <= KICK_RANGE && hasClearLane(pawn.pos, goalNet, opponents)) {
        return { ...pawn, plannedSteps: [{ pos: goalNet, kick: { loft: false, kind: "shot" } }] };
      }

      const passTarget = teammates
        .filter((t) => t.id !== pawn.id && t.player.position !== "GK")
        .filter((t) => dist(pawn.pos, t.pos) <= KICK_RANGE && hasClearLane(pawn.pos, t.pos, opponents))
        .filter((t) => dist(t.pos, goalLine) < dist(pawn.pos, goalLine) - 1)
        .sort((a, b) => dist(a.pos, goalLine) - dist(b.pos, goalLine))[0];

      if (passTarget) {
        return { ...pawn, plannedSteps: [{ pos: passTarget.pos, kick: { loft: false, kind: "pass" } }] };
      }

      return { ...pawn, plannedSteps: [{ pos: moveToward(pawn.pos, goalLine, PAWN_MOVE_BUDGET) }] };
    }

    if (carrier) {
      // Team has the ball: hold a supporting position a little further upfield.
      return { ...pawn, plannedSteps: [{ pos: moveToward(pawn.pos, goalLine, 1) }] };
    }

    if (pawn.id === closestChaserId) {
      return { ...pawn, plannedSteps: [{ pos: moveToward(pawn.pos, ball.pos, PAWN_MOVE_BUDGET) }] };
    }

    return { ...pawn, plannedSteps: [{ pos: moveToward(pawn.pos, home, 1) }] };
  });
}
