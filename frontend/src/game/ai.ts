import {
  GOAL_ROW_MAX,
  GOAL_ROW_MIN,
  GRID_COLS,
  GRID_ROWS,
  KICK_RANGE,
  MOVE_RANGE,
  OOB_CELLS,
} from "./constants";
import { lineCells } from "./resolve";
import type { Ball, Pawn, Side, Vec2 } from "./types";

function dist(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
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

/** Whether any of `obstacles` sits on the straight line between `from` and `to`. */
function hasClearLane(from: Vec2, to: Vec2, obstacles: Pawn[]): boolean {
  const path = lineCells(from, to);
  return !path.some((cell) => obstacles.some((o) => o.pos.x === cell.x && o.pos.y === cell.y));
}

/** Destination up to `maxCells` away from `pos`, heading straight toward `dest`, clamped to the field. */
function moveToward(pos: Vec2, dest: Vec2, maxCells: number): Vec2 {
  const dx = dest.x - pos.x;
  const dy = dest.y - pos.y;
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  if (distance === 0) return { ...pos };
  const factor = Math.min(1, maxCells / distance);
  const target = {
    x: Math.round(pos.x + dx * factor),
    y: Math.round(pos.y + dy * factor),
  };
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
      return { ...pawn, plannedPos: moveToward(pawn.pos, target, MOVE_RANGE), plannedKick: null };
    }

    if (carrier && pawn.id === carrier.id) {
      if (dist(pawn.pos, goalNet) <= KICK_RANGE && hasClearLane(pawn.pos, goalNet, opponents)) {
        return { ...pawn, plannedKick: goalNet, plannedPos: null };
      }

      const passTarget = teammates
        .filter((t) => t.id !== pawn.id && t.player.position !== "GK")
        .filter((t) => dist(pawn.pos, t.pos) <= KICK_RANGE && hasClearLane(pawn.pos, t.pos, opponents))
        .filter((t) => dist(t.pos, goalLine) < dist(pawn.pos, goalLine) - 1)
        .sort((a, b) => dist(a.pos, goalLine) - dist(b.pos, goalLine))[0];

      if (passTarget) {
        return { ...pawn, plannedKick: passTarget.pos, plannedPos: null };
      }

      return { ...pawn, plannedPos: moveToward(pawn.pos, goalLine, MOVE_RANGE), plannedKick: null };
    }

    if (carrier) {
      // Team has the ball: hold a supporting position a little further upfield.
      return { ...pawn, plannedPos: moveToward(pawn.pos, goalLine, 1), plannedKick: null };
    }

    if (pawn.id === closestChaserId) {
      return { ...pawn, plannedPos: moveToward(pawn.pos, ball.pos, MOVE_RANGE), plannedKick: null };
    }

    return { ...pawn, plannedPos: moveToward(pawn.pos, home, 1), plannedKick: null };
  });
}
