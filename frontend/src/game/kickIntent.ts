import { GOAL_ROW_MAX, GOAL_ROW_MIN, GRID_COLS } from "./constants";
import type { Pawn, Side, Vec2 } from "./types";

/**
 * What a given kick target actually represents — a shot at the opponent's
 * goal, a pass to a teammate, or just clearing the ball into space. Purely
 * player-facing classification for feedback (cell tinting, the aim-ring
 * label); the resolution engine itself doesn't care what a kick "means" —
 * every kick resolves through the exact same flight/aim mechanics
 * regardless of what it's aimed at.
 */
export type KickIntent = "shot" | "pass" | "clear";

const PASS_TARGET_RADIUS = 2.5;
const GOAL_LINE_MARGIN = 6;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function classifyKickTarget(target: Vec2, side: Side, kickerId: string, pawns: Pawn[]): KickIntent {
  const inGoalRows = target.y >= GOAL_ROW_MIN && target.y <= GOAL_ROW_MAX;
  const nearOpponentGoalLine =
    side === "home" ? target.x >= GRID_COLS - GOAL_LINE_MARGIN : target.x <= GOAL_LINE_MARGIN;
  if (inGoalRows && nearOpponentGoalLine) return "shot";

  const nearTeammate = pawns.some(
    (p) => p.id !== kickerId && p.side === side && distance(p.pos, target) <= PASS_TARGET_RADIUS
  );
  if (nearTeammate) return "pass";

  return "clear";
}

/** A plain-language risk qualifier for a kick's aim spread — the same sigma the aim-ring is sized from. */
export function riskLabel(sigma: number): string {
  if (sigma < 0.6) return "Safe";
  if (sigma < 1.4) return "Risky";
  return "Very risky";
}

const INTENT_LABEL: Record<KickIntent, string> = {
  shot: "Shot",
  pass: "Pass",
  clear: "Clear",
};

export function intentLabel(intent: KickIntent): string {
  return INTENT_LABEL[intent];
}
