import { MAN_MARK_PULL_WEIGHT, MOVE_RANGE, PAWN_OVERLAP_RADIUS, PAWN_SPEED_PER_TICK } from "./constants";
import { candidateHeadings, distance } from "./resolve";
import type { DeadBallResult, ResolveSnapshot } from "./resolve";
import type { Pawn, Vec2 } from "./types";

/**
 * How many extra full turns of movement-only planning "extended setup"
 * grants before a dead-ball restart is actually taken — see resolveSetupTurn.
 * Corners get more than throw-ins/goal-kicks since they're a real scoring
 * threat worth organizing for; fouls (a separate, later feature) will need
 * their own, larger entry here.
 */
export const SETUP_TURNS_BY_TYPE: Record<DeadBallResult["type"], number> = {
  throw_in: 1,
  corner: 2,
  goal_kick: 1,
  free_kick: 3,
  // Never actually read — a penalty skips the quick-vs-extended-setup
  // prompt entirely (see Game.tsx), so restartSetup never gets constructed
  // for one. Kept only so this map stays exhaustive over DeadBallResult's
  // full type union.
  penalty: 0,
};

/**
 * Resolves one "extended setup" turn ahead of a dead-ball restart: pure
 * repositioning, no live ball. Deliberately NOT a mode of resolveTurn — there's
 * no kick/carrier/tackle/save/reaction machinery to run at all here, just
 * movement (plus man-mark's auto-aim) with the ball sitting dead at a fixed
 * spot for the whole turn. Kicking is disabled by the UI during setup (see
 * Game.tsx), so a PlannedStep's `kick` field is never read here — only `pos`.
 *
 * Collision is a simplified, sequential single pass (process pawns in array
 * order, take the first non-colliding candidate heading, otherwise stay put)
 * rather than resolveTurn's simultaneous fixed-point Rules 1-3 — that
 * machinery exists to referee contested ball-adjacent collisions with a skill
 * check, and there's no ball or contest at stake while pawns are just getting
 * organized during a stoppage. GK auto-positioning also doesn't carry over
 * into setup turns — a keeper only moves here via an explicit plannedSteps
 * entry or a man_mark order, same as any other pawn.
 *
 * Deliberately single-waypoint only, even though live turns now support a
 * full waypoint chain (see resolve.ts) — only the FIRST planned step is read
 * here. A dead-ball setup turn is background positioning, not the core
 * gameplay loop; multi-leg chaining during a stoppage isn't v1 scope.
 */
export function resolveSetupTurn(pawns: Pawn[], deadBallSpot: Vec2): ResolveSnapshot[] {
  let current = pawns.map((p) => ({ ...p }));
  const snapshots: ResolveSnapshot[] = [];
  const hasExplicitPlan = new Set(current.filter((p) => p.plannedSteps.length > 0).map((p) => p.id));
  const destinations = new Map<string, Vec2>(current.map((p) => [p.id, p.plannedSteps[0]?.pos ?? p.pos]));

  for (let tick = 0; tick < MOVE_RANGE; tick++) {
    for (const p of current) {
      const stance = p.stance;
      if (!stance || stance.kind !== "man_mark" || hasExplicitPlan.has(p.id)) continue;
      const target = current.find((t) => t.id === stance.targetId);
      if (!target) continue;
      destinations.set(p.id, {
        x: p.pos.x + (target.pos.x - p.pos.x) * MAN_MARK_PULL_WEIGHT,
        y: p.pos.y + (target.pos.y - p.pos.y) * MAN_MARK_PULL_WEIGHT,
      });
    }

    const settled = new Map<string, Vec2>();
    for (const p of current) {
      const options = candidateHeadings(p.pos, destinations.get(p.id)!, PAWN_SPEED_PER_TICK);
      const clear = options.find(
        (candidate) =>
          !current.some((o) => {
            if (o.id === p.id) return false;
            const otherPos = settled.get(o.id) ?? o.pos;
            return distance(otherPos, candidate) < PAWN_OVERLAP_RADIUS;
          })
      );
      settled.set(p.id, clear ?? p.pos);
    }

    // plannedSteps is cleared the same way resolveTurn's own tick loop clears
    // it — destinations was already captured before the loop started, so this
    // is purely to keep the overlay/HUD from showing a stale planned-move
    // marker once the turn has actually resolved.
    current = current.map((p) => ({ ...p, pos: settled.get(p.id)!, plannedSteps: [] }));
    snapshots.push({
      pawns: current.map((p) => ({ ...p })),
      ball: { ...deadBallSpot },
      ballHeight: 0,
      events: [],
    });
  }

  return snapshots;
}
