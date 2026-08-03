import {
  CAPTURE_RADIUS,
  GK_ANCHOR_DEPTH,
  GOAL_ROW_MAX,
  GOAL_ROW_MIN,
  GRID_COLS,
  GRID_ROWS,
  KICK_CHARGE_COST,
  KICK_RANGE,
  OOB_CELLS,
  PASS_RANGE,
  PAWN_MOVE_BUDGET,
  SPRINT_SPEED_MULTIPLIER,
  TACKLE_RADIUS,
} from "./constants";
import { landingSpread, RISK_SAFE_SIGMA, RISK_VERY_RISKY_SIGMA } from "./aim";
import { chargesFor, distance, distanceToSegment, isShotOnTarget } from "./resolve";
import { DEFAULT_TACTICAL_PROFILE } from "./tacticalProfile";
import type { TacticalProfile } from "./tacticalProfile";
import type { Ball, Pawn, PlannedStep, PlayerDTO, Side, Stance, Vec2 } from "./types";

// --- Balance-robust AI tuning ---
// AI-only heuristics, deliberately kept out of constants.ts (they're not
// engine mechanics resolve.ts itself consumes). Every one is expressed as a
// fraction/multiplier of an existing engine value (PAWN_MOVE_BUDGET,
// KICK_RANGE, the pitch dimensions, ...) rather than a bare literal, so a
// future balance pass (different pitch size, different movement budget,
// different roster size) only means retuning the base these multiply
// against — never restructuring this file's decision logic. These are the
// baseline every TacticalProfile field multiplies/blends against; see
// tacticalProfile.ts for the manager-facing knobs themselves.
const PRESS_ENGAGE_BASE_FRACTION = 0.5; // of GRID_COLS / 2
const SPRINT_DISTANCE_TRIGGER_FRACTION = 0.5; // of PAWN_MOVE_BUDGET
const CHAIN_DRIBBLE_LOOKAHEAD_FRACTION = 0.6; // of PAWN_MOVE_BUDGET
const SHOT_AIM_SAMPLE_PAD_FRACTION = 0.2; // of the goal mouth's height
const CROSS_TARGET_DEPTH_FRACTION = 0.3; // of KICK_RANGE
const SUPPORT_LATERAL_SPREAD_FRACTION = 0.5; // of GRID_ROWS
const PASS_ADVANCEMENT_MARGIN_FRACTION = 1 / 6; // of PAWN_MOVE_BUDGET — replaces the old bare "-1" minimum-advancement margin
const CROSS_BIAS_THRESHOLD = 0.15; // floor on TacticalProfile.crossBias below which a manager never crosses at all
const TACKLE_PROXIMITY_AGGRESSIVE_FRACTION = 0.5; // of TACKLE_RADIUS
const SHAPE_BALL_SIDE_SHIFT_FRACTION = 0.2; // how far a defensive line shifts toward the ball's side each turn
const COVER_LANE_GOAL_BIAS_FRACTION = 0.3; // of PAWN_MOVE_BUDGET — how far a cover_passing lane position sits toward our own goal
const SUPPORT_HOLD_DEPTH_FRACTION = 0.15; // of PAWN_MOVE_BUDGET — a recycling-position shuffle, not a real run
const COVER_LOOSE_BALL_FRACTION = 0.6; // of PAWN_MOVE_BUDGET — the second-nearest pawn covers, doesn't fully commit like the chaser

function inBounds(pos: Vec2): boolean {
  return (
    pos.x >= -OOB_CELLS &&
    pos.x < GRID_COLS + OOB_CELLS &&
    pos.y >= -OOB_CELLS &&
    pos.y < GRID_ROWS + OOB_CELLS
  );
}

function midGoalY(): number {
  return Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2);
}

/** The pitch-edge point closest to the opponent's goal — used for movement/ranking, always in bounds. */
function opponentGoalLinePoint(side: Side): Vec2 {
  return { x: side === "home" ? GRID_COLS - 1 : 0, y: midGoalY() };
}

/** Just past the goal line, inside the net — the actual shot/cross target, since a goal only counts out there. */
function opponentGoalNetPoint(side: Side): Vec2 {
  return { x: side === "home" ? GRID_COLS : -1, y: midGoalY() };
}

function ownGoalPoint(side: Side): Vec2 {
  return { x: side === "home" ? 0 : GRID_COLS - 1, y: midGoalY() };
}

/**
 * Whether any of `obstacles` sits close enough to the straight line between
 * `from` and `to` to plausibly reach it — the same CAPTURE_RADIUS the
 * resolution engine itself uses to decide if a defender can intercept a
 * flight, checked via distance-from-segment rather than exact-cell equality.
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
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ...pos };
  const factor = Math.min(1, maxDistance / d);
  const target = { x: pos.x + dx * factor, y: pos.y + dy * factor };
  return inBounds(target) ? target : pos;
}

// --- Phase 1: assess ---

interface TeamContext {
  aiSide: Side;
  ball: Ball;
  teammates: Pawn[];
  opponents: Pawn[];
  gk: Pawn | null;
  carrier: Pawn | null;
  weHaveBall: boolean;
  theyHaveBall: boolean;
  looseBall: boolean;
  opponentGoalLine: Vec2;
  opponentGoalNet: Vec2;
  ownGoal: Vec2;
  halfwayX: number;
}

/**
 * Whoever (either side) is within CAPTURE_RADIUS of the ball carries it —
 * the same rule resolveTurn itself starts a turn with. Deliberately NOT the
 * old exact-position-equality check it replaces: a pawn essentially never
 * sits on the ball's exact float position after its first move, so that
 * check silently stopped detecting a carrier once positions went continuous.
 */
function findCarrier(pawns: Pawn[], ball: Ball): Pawn | null {
  return pawns.find((p) => distance(p.pos, ball.pos) <= CAPTURE_RADIUS) ?? null;
}

function assessSituation(pawns: Pawn[], ball: Ball, aiSide: Side): TeamContext {
  const teammates = pawns.filter((p) => p.side === aiSide);
  const opponents = pawns.filter((p) => p.side !== aiSide);
  const gk = teammates.find((p) => p.player.position === "GK") ?? null;
  const carrier = findCarrier(pawns, ball);
  const weHaveBall = carrier?.side === aiSide;
  return {
    aiSide,
    ball,
    teammates,
    opponents,
    gk,
    carrier,
    weHaveBall,
    theyHaveBall: carrier !== null && !weHaveBall,
    looseBall: carrier === null,
    opponentGoalLine: opponentGoalLinePoint(aiSide),
    opponentGoalNet: opponentGoalNetPoint(aiSide),
    ownGoal: ownGoalPoint(aiSide),
    halfwayX: GRID_COLS / 2,
  };
}

// --- Phase 2: decide ---

type PawnIntent =
  | { kind: "gk" }
  | { kind: "carrier_shoot"; aim: Vec2 }
  | { kind: "carrier_cross"; aim: Vec2; targetId: string }
  | { kind: "carrier_pass"; targetId: string }
  | { kind: "carrier_dribble"; thenKick?: { aim: Vec2; kind: "shot" | "pass"; targetId?: string } }
  | { kind: "press"; targetId: string; aggressive: boolean }
  | { kind: "man_mark"; targetId: string }
  | { kind: "cover_passing"; laneTarget: Vec2 }
  | { kind: "expect_cross_defensively" }
  | { kind: "hold_shape" }
  | { kind: "support_attack"; expectingHeader: boolean; laneIndex: number; laneCount: number; meetPoint?: Vec2 }
  | { kind: "support_hold" }
  | { kind: "chase_loose_ball" }
  | { kind: "cover_loose_ball" };

interface KickEvaluation {
  sigma: number;
  onTarget: boolean;
}

/**
 * Scores a candidate kick using the same real accuracy formula the
 * resolution engine samples the actual landing point from (aim.ts's
 * landingSpread) — risk tolerance is anchored to the true model, not an
 * invented number. A cross skips the clear-lane check: it's contested via a
 * header once airborne, not blocked by a defender standing in a ground-level
 * lane.
 */
function evaluateKick(
  carrier: Pawn,
  aim: Vec2,
  kind: "shot" | "pass" | "cross",
  opponents: Pawn[],
  profile: TacticalProfile
): KickEvaluation | null {
  if (kind !== "cross" && !hasClearLane(carrier.pos, aim, opponents)) return null;
  const d = distance(carrier.pos, aim);
  if (kind === "pass" && d > PASS_RANGE) return null;
  if (kind !== "pass" && d > KICK_RANGE) return null;
  const onTarget = kind === "shot" && isShotOnTarget(carrier.pos, aim, carrier.side);
  const sigma = landingSpread(d, carrier.player.skill, kind, onTarget);
  const acceptable = RISK_SAFE_SIGMA + profile.passRiskTolerance * (RISK_VERY_RISKY_SIGMA - RISK_SAFE_SIGMA);
  return sigma <= acceptable ? { sigma, onTarget } : null;
}

/** Samples 3 aim points across the goal mouth, prefers a genuinely on-target one (the real accuracy bonus), else the best clear-lane alternative. */
function pickShotAimPoint(carrier: Pawn, context: TeamContext, profile: TacticalProfile): { aim: Vec2; evaluation: KickEvaluation } | null {
  if (distance(carrier.pos, context.opponentGoalNet) > profile.shootingRangeMult * KICK_RANGE) return null;

  const goalHeight = GOAL_ROW_MAX - GOAL_ROW_MIN;
  const pad = SHOT_AIM_SAMPLE_PAD_FRACTION * goalHeight;
  const candidateYs = [GOAL_ROW_MIN + pad, midGoalY(), GOAL_ROW_MAX - pad];

  const candidates = candidateYs
    .map((y): Vec2 => ({ x: context.opponentGoalNet.x, y }))
    .map((aim) => ({ aim, evaluation: evaluateKick(carrier, aim, "shot", context.opponents, profile) }))
    .filter((c): c is { aim: Vec2; evaluation: KickEvaluation } => c.evaluation !== null);

  if (candidates.length === 0) return null;
  return candidates.find((c) => c.evaluation.onTarget) ?? candidates[0];
}

/** Most advanced teammate that's meaningfully ahead of the carrier, has a clear lane, and clears the profile's risk bar. */
function pickPassTarget(carrier: Pawn, context: TeamContext, profile: TacticalProfile): { targetId: string; evaluation: KickEvaluation } | null {
  const margin = PASS_ADVANCEMENT_MARGIN_FRACTION * PAWN_MOVE_BUDGET;
  const candidates = context.teammates
    .filter((t) => t.id !== carrier.id && t.player.position !== "GK")
    .filter((t) => distance(t.pos, context.opponentGoalLine) < distance(carrier.pos, context.opponentGoalLine) - margin)
    .map((t) => ({ t, evaluation: evaluateKick(carrier, t.pos, "pass", context.opponents, profile) }))
    .filter((c): c is { t: Pawn; evaluation: KickEvaluation } => c.evaluation !== null)
    .sort((a, b) => distance(a.t.pos, context.opponentGoalLine) - distance(b.t.pos, context.opponentGoalLine));
  const best = candidates[0];
  return best ? { targetId: best.t.id, evaluation: best.evaluation } : null;
}

/** A cross only makes sense from a wide, advanced position, gated by the profile's crossBias, aimed at a teammate already in the danger area. */
function pickCrossTarget(carrier: Pawn, context: TeamContext, profile: TacticalProfile): { targetId: string; aim: Vec2; evaluation: KickEvaluation } | null {
  if (profile.crossBias < CROSS_BIAS_THRESHOLD) return null;
  if (distance(carrier.pos, context.opponentGoalNet) > KICK_RANGE) return null;

  const goalHeight = GOAL_ROW_MAX - GOAL_ROW_MIN;
  const isWide = Math.abs(carrier.pos.y - midGoalY()) > goalHeight * 0.5;
  if (!isWide) return null;

  const dangerDepth = CROSS_TARGET_DEPTH_FRACTION * KICK_RANGE;
  const receiver = context.teammates
    .filter((t) => t.id !== carrier.id && t.player.position !== "GK")
    .filter((t) => distance(t.pos, context.opponentGoalNet) <= dangerDepth)
    .sort((a, b) => distance(a.pos, context.opponentGoalNet) - distance(b.pos, context.opponentGoalNet))[0];
  if (!receiver) return null;

  const evaluation = evaluateKick(carrier, receiver.pos, "cross", context.opponents, profile);
  return evaluation ? { targetId: receiver.id, aim: receiver.pos, evaluation } : null;
}

/**
 * Shoot -> cross -> pass -> dribble(-then-kick), in that order. A carrier
 * with a spare charge beyond the one movement leg it always has probes a
 * SECOND kick from a projected position further upfield — an accepted
 * approximation (opponents won't actually stay static), same category of
 * imprecision moveToward already has not knowing about the engine's
 * per-tick sidestep logic.
 */
function decideCarrierIntent(
  carrier: Pawn,
  context: TeamContext,
  profile: TacticalProfile
): { intent: PawnIntent; designatedTargetId: string | null } {
  const shot = pickShotAimPoint(carrier, context, profile);
  if (shot) return { intent: { kind: "carrier_shoot", aim: shot.aim }, designatedTargetId: null };

  const cross = pickCrossTarget(carrier, context, profile);
  if (cross) {
    return {
      intent: { kind: "carrier_cross", aim: cross.aim, targetId: cross.targetId },
      designatedTargetId: cross.targetId,
    };
  }

  const pass = pickPassTarget(carrier, context, profile);
  if (pass) return { intent: { kind: "carrier_pass", targetId: pass.targetId }, designatedTargetId: pass.targetId };

  let thenKick: { aim: Vec2; kind: "shot" | "pass"; targetId?: string } | undefined;
  if (chargesFor(carrier.player) > 1) {
    const lookahead = CHAIN_DRIBBLE_LOOKAHEAD_FRACTION * PAWN_MOVE_BUDGET;
    const projectedPos = moveToward(carrier.pos, context.opponentGoalLine, lookahead);
    const projectedCarrier: Pawn = { ...carrier, pos: projectedPos };

    const projectedShot = pickShotAimPoint(projectedCarrier, context, profile);
    if (projectedShot) {
      thenKick = { aim: projectedShot.aim, kind: "shot" };
    } else {
      const projectedPass = pickPassTarget(projectedCarrier, context, profile);
      if (projectedPass) {
        const receiver = context.teammates.find((t) => t.id === projectedPass.targetId);
        if (receiver) thenKick = { aim: receiver.pos, kind: "pass", targetId: projectedPass.targetId };
      }
    }
  }
  return { intent: { kind: "carrier_dribble", thenKick }, designatedTargetId: thenKick?.targetId ?? null };
}

/** Opponent has the ball: press, man-mark, cover the passing lane, cover an incoming cross, everyone else holds the defensive line. */
function decideDefensiveIntents(context: TeamContext, profile: TacticalProfile): Map<string, PawnIntent> {
  const carrier = context.carrier!;
  const intents = new Map<string, PawnIntent>();
  const outfield = context.teammates.filter((p) => p.player.position !== "GK");
  const assigned = new Set<string>();

  // Press: engages only once the threat is within a manager-scaled distance
  // of the AI's own goal — a low-press profile only ever engages deep in its
  // own territory, a high-press one engages far up the pitch.
  const pressEngageDistance = PRESS_ENGAGE_BASE_FRACTION * (GRID_COLS / 2) * profile.pressingTriggerDistanceMult;
  if (distance(carrier.pos, context.ownGoal) <= pressEngageDistance) {
    const presser = [...outfield].sort((a, b) => distance(a.pos, carrier.pos) - distance(b.pos, carrier.pos))[0];
    if (presser) {
      assigned.add(presser.id);
      const aggressive = distance(presser.pos, carrier.pos) <= TACKLE_PROXIMITY_AGGRESSIVE_FRACTION * TACKLE_RADIUS;
      intents.set(presser.id, { kind: "press", targetId: carrier.id, aggressive });
    }
  }

  // Man-marking: the most advanced unengaged opponents, nearest still-free
  // teammate each. Count scales with the actual roster (a fraction of the
  // opponent's outfield count), never a fixed number — survives any future
  // squad-size change automatically.
  const markableOpponents = context.opponents
    .filter((o) => o.player.position !== "GK" && o.id !== carrier.id)
    .sort((a, b) => distance(a.pos, context.ownGoal) - distance(b.pos, context.ownGoal));
  const nonGkOpponentCount = context.opponents.filter((o) => o.player.position !== "GK").length;
  const markCount = Math.min(
    Math.round(profile.markingCoverageFrac * nonGkOpponentCount),
    markableOpponents.length,
    outfield.filter((p) => !assigned.has(p.id)).length
  );
  const markTargets = markableOpponents.slice(0, markCount);
  for (const target of markTargets) {
    const marker = outfield
      .filter((p) => !assigned.has(p.id))
      .sort((a, b) => distance(a.pos, target.pos) - distance(b.pos, target.pos))[0];
    if (!marker) break;
    assigned.add(marker.id);
    intents.set(marker.id, { kind: "man_mark", targetId: target.id });
  }

  // Cover passing: one spare teammate covers the lane between the carrier
  // and the most dangerous still-unmarked opponent, biased toward our goal.
  const spareForCover = outfield.find((p) => !assigned.has(p.id));
  if (spareForCover) {
    const dangerOpponent =
      markableOpponents.find((o) => !markTargets.some((m) => m.id === o.id)) ?? markableOpponents[0] ?? carrier;
    const laneMid: Vec2 = {
      x: (carrier.pos.x + dangerOpponent.pos.x) / 2,
      y: (carrier.pos.y + dangerOpponent.pos.y) / 2,
    };
    const laneTarget = moveToward(laneMid, context.ownGoal, COVER_LANE_GOAL_BIAS_FRACTION * PAWN_MOVE_BUDGET);
    assigned.add(spareForCover.id);
    intents.set(spareForCover.id, { kind: "cover_passing", laneTarget });
  }

  // Defensive header cover: the opponent has already fully planned this turn
  // by the time planAiTurn runs (the human clicks Continue first), so
  // scanning their queued plan for a cross is reading input data, not
  // telepathy.
  const incomingCross = context.opponents.some((o) => o.plannedSteps.some((s) => s.kick?.kind === "cross"));
  if (incomingCross) {
    const spareForHeader = outfield.find((p) => !assigned.has(p.id));
    if (spareForHeader) {
      assigned.add(spareForHeader.id);
      intents.set(spareForHeader.id, { kind: "expect_cross_defensively" });
    }
  }

  for (const p of outfield) {
    if (!assigned.has(p.id)) intents.set(p.id, { kind: "hold_shape" });
  }
  return intents;
}

/** We have the ball: rank off-ball teammates by advancement, commit a manager-scaled fraction forward, the rest hold to recycle possession. */
function decideAttackingIntents(
  context: TeamContext,
  profile: TacticalProfile,
  carrierId: string,
  designatedTargetId: string | null,
  designatedMeetPoint: Vec2 | null
): Map<string, PawnIntent> {
  const intents = new Map<string, PawnIntent>();
  const eligible = context.teammates
    .filter((p) => p.id !== carrierId && p.player.position !== "GK")
    .sort((a, b) => distance(b.pos, context.ownGoal) - distance(a.pos, context.ownGoal));

  const commitCount = Math.round(profile.attackingCommitmentFrac * eligible.length);
  const supportRunners = eligible.filter((p, index) => index < commitCount || p.id === designatedTargetId);
  const laneCount = supportRunners.length;

  supportRunners.forEach((pawn, laneIndex) => {
    const isDesignated = pawn.id === designatedTargetId;
    intents.set(pawn.id, {
      kind: "support_attack",
      expectingHeader: isDesignated,
      laneIndex,
      laneCount,
      // The pawn we're relying on to actually meet a cross needs to run to
      // where the ball is going, not a generic advance-toward-goal spot —
      // without this it can drift away from the flight's path before it
      // arrives, missing the header contest entirely despite being flagged
      // to expect it.
      meetPoint: isDesignated && designatedMeetPoint ? designatedMeetPoint : undefined,
    });
  });
  for (const pawn of eligible) {
    if (!intents.has(pawn.id)) intents.set(pawn.id, { kind: "support_hold" });
  }
  return intents;
}

/** Nobody has the ball: nearest chases, next-nearest covers, everyone else holds shape. */
function decideLooseBallIntents(context: TeamContext): Map<string, PawnIntent> {
  const intents = new Map<string, PawnIntent>();
  const outfield = context.teammates.filter((p) => p.player.position !== "GK");
  const sorted = [...outfield].sort((a, b) => distance(a.pos, context.ball.pos) - distance(b.pos, context.ball.pos));
  sorted.forEach((pawn, index) => {
    if (index === 0) intents.set(pawn.id, { kind: "chase_loose_ball" });
    else if (index === 1) intents.set(pawn.id, { kind: "cover_loose_ball" });
    else intents.set(pawn.id, { kind: "hold_shape" });
  });
  return intents;
}

/**
 * Strict three-way dispatch on ball state — no overlapping cases. The GK is
 * always handled separately, untouched by any of the three branches.
 */
function decideTeamIntents(context: TeamContext, profile: TacticalProfile): Map<string, PawnIntent> {
  const intents = new Map<string, PawnIntent>();
  if (context.gk) intents.set(context.gk.id, { kind: "gk" });

  if (context.looseBall) {
    for (const [id, intent] of decideLooseBallIntents(context)) intents.set(id, intent);
    return intents;
  }

  if (context.theyHaveBall) {
    for (const [id, intent] of decideDefensiveIntents(context, profile)) intents.set(id, intent);
    return intents;
  }

  const carrier = context.carrier!;
  const { intent: carrierIntent, designatedTargetId } = decideCarrierIntent(carrier, context, profile);
  intents.set(carrier.id, carrierIntent);
  const designatedMeetPoint = carrierIntent.kind === "carrier_cross" ? carrierIntent.aim : null;
  for (const [id, intent] of decideAttackingIntents(context, profile, carrier.id, designatedTargetId, designatedMeetPoint)) {
    intents.set(id, intent);
  }
  return intents;
}

// --- Phase 3: realize ---

/**
 * The single shared plan constructor every branch below funnels through —
 * tracks charges used (chargesFor) and cumulative movement distance
 * (PAWN_MOVE_BUDGET, boosted when sprinting) as it assembles legs,
 * shortening a leg that would overrun (via moveToward) rather than silently
 * dropping it. This keeps every plan the AI emits already consistent with
 * what resolve.ts's own defensive clampStepsToBudget would do to it — the
 * AI never relies on that clamp to save it from an over-budget plan.
 */
function buildChain(from: Vec2, legs: PlannedStep[], player: PlayerDTO, sprinting: boolean): PlannedStep[] {
  const maxCharges = chargesFor(player);
  const maxDist = sprinting ? PAWN_MOVE_BUDGET * SPRINT_SPEED_MULTIPLIER : PAWN_MOVE_BUDGET;
  const steps: PlannedStep[] = [];
  let cursor = from;
  let remainingDistance = maxDist;
  let chargesUsed = 0;

  for (const leg of legs) {
    const cost = leg.kick ? KICK_CHARGE_COST : 1;
    if (chargesUsed + cost > maxCharges) break;

    if (leg.kick) {
      steps.push({ pos: leg.pos, kick: leg.kick });
      chargesUsed += cost;
      continue; // a kick step doesn't move the cursor or spend distance
    }

    if (remainingDistance <= 0) break;
    const legDist = distance(cursor, leg.pos);
    const dest = legDist <= remainingDistance ? leg.pos : moveToward(cursor, leg.pos, remainingDistance);
    steps.push({ pos: dest });
    cursor = dest;
    remainingDistance -= Math.min(legDist, remainingDistance);
    chargesUsed += cost;
  }

  return steps;
}

function gkTarget(gk: Pawn, ball: Ball): Vec2 {
  const targetY = Math.max(GOAL_ROW_MIN, Math.min(GOAL_ROW_MAX, ball.pos.y));
  const x = gk.side === "home" ? GK_ANCHOR_DEPTH : GRID_COLS - GK_ANCHOR_DEPTH;
  return { x, y: targetY };
}

/** A real defensive line: depth interpolated between our own goal and halfway by the profile, shifted toward the ball's side. */
function defensiveShapeTarget(pawn: Pawn, context: TeamContext, profile: TacticalProfile): Vec2 {
  const lineX = context.ownGoal.x + (context.halfwayX - context.ownGoal.x) * profile.defensiveLineDepthFrac;
  const y = pawn.pos.y + (context.ball.pos.y - pawn.pos.y) * SHAPE_BALL_SIDE_SHIFT_FRACTION;
  return { x: lineX, y };
}

/** Advances toward goal by a profile-scaled amount, spread laterally across however many teammates are also making a run this turn. */
function supportingRunTarget(pawn: Pawn, context: TeamContext, profile: TacticalProfile, laneIndex: number, laneCount: number): Vec2 {
  const advance = profile.supportingRunDepthMult * PAWN_MOVE_BUDGET;
  const towardGoal = moveToward(pawn.pos, context.opponentGoalNet, advance);
  const spread = laneCount > 0 ? ((laneIndex - (laneCount - 1) / 2) * SUPPORT_LATERAL_SPREAD_FRACTION * GRID_ROWS) / laneCount : 0;
  const y = Math.max(0, Math.min(GRID_ROWS - 1, towardGoal.y + spread));
  return { x: towardGoal.x, y };
}

function maybeSprint(pawn: Pawn, primaryLegDistance: number, profile: TacticalProfile): boolean {
  if (pawn.sprintCooldown > 0) return false;
  const threshold = SPRINT_DISTANCE_TRIGGER_FRACTION * (1.5 - profile.sprintAggressiveness) * PAWN_MOVE_BUDGET;
  return primaryLegDistance >= threshold;
}

function realizePawnIntent(pawn: Pawn, intent: PawnIntent, context: TeamContext, profile: TacticalProfile): Pawn {
  switch (intent.kind) {
    case "gk": {
      const steps = buildChain(pawn.pos, [{ pos: gkTarget(pawn, context.ball) }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: false };
    }

    case "carrier_shoot": {
      const steps = buildChain(pawn.pos, [{ pos: intent.aim, kick: { loft: false, kind: "shot" } }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: false };
    }

    case "carrier_cross": {
      const steps = buildChain(pawn.pos, [{ pos: intent.aim, kick: { loft: true, kind: "cross" } }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: false };
    }

    case "carrier_pass": {
      const receiver = context.teammates.find((t) => t.id === intent.targetId);
      const aim = receiver ? receiver.pos : pawn.pos;
      const steps = buildChain(pawn.pos, [{ pos: aim, kick: { loft: false, kind: "pass" } }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: false };
    }

    case "carrier_dribble": {
      // The RAW (uncapped) distance to the goal line drives the sprint
      // decision; buildChain itself does the real distance-clamping using
      // whatever budget that decision unlocks. Pre-capping the leg here
      // before deciding to sprint would leave the sprint boost with nothing
      // left to actually extend — see the case fixed by this shape below.
      const rawDist = distance(pawn.pos, context.opponentGoalLine);
      const sprint = maybeSprint(pawn, rawDist, profile);
      const legs: PlannedStep[] = [{ pos: context.opponentGoalLine }];
      if (intent.thenKick) legs.push({ pos: intent.thenKick.aim, kick: { loft: false, kind: intent.thenKick.kind } });
      const steps = buildChain(pawn.pos, legs, pawn.player, sprint);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: sprint };
    }

    case "press": {
      const carrierPos = context.carrier?.pos ?? context.ball.pos;
      const rawDist = distance(pawn.pos, carrierPos);
      const sprint = maybeSprint(pawn, rawDist, profile);
      const steps = buildChain(pawn.pos, [{ pos: carrierPos }], pawn.player, sprint);
      const stance: Stance = intent.aggressive ? { kind: "aggressive" } : { kind: "pressure" };
      return { ...pawn, plannedSteps: steps, stance, plannedSprint: sprint };
    }

    case "man_mark": {
      // Deliberately no explicit plan — resolve.ts's own auto-follow drives
      // movement every tick at MAN_MARK_PULL_WEIGHT, live-tracking the
      // target's real position. An explicit step here (even one) would
      // permanently defeat that in favor of one stale snapshot destination.
      return { ...pawn, plannedSteps: [], stance: { kind: "man_mark", targetId: intent.targetId }, plannedSprint: false };
    }

    case "cover_passing": {
      const dest = moveToward(pawn.pos, intent.laneTarget, PAWN_MOVE_BUDGET);
      const steps = buildChain(pawn.pos, [{ pos: dest }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: { kind: "cover_passing" }, plannedSprint: false };
    }

    case "expect_cross_defensively": {
      const dest = moveToward(pawn.pos, context.ownGoal, PAWN_MOVE_BUDGET);
      const steps = buildChain(pawn.pos, [{ pos: dest }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: { kind: "expecting_header" }, plannedSprint: false };
    }

    case "hold_shape": {
      // No pre-cap here either — most turns the shape target is already
      // close (a routine shuffle), but a pawn caught well out of position
      // after a turnover needs the room to actually cover that distance,
      // sprinting if it clears the threshold.
      const target = defensiveShapeTarget(pawn, context, profile);
      const rawDist = distance(pawn.pos, target);
      const sprint = maybeSprint(pawn, rawDist, profile);
      const steps = buildChain(pawn.pos, [{ pos: target }], pawn.player, sprint);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: sprint };
    }

    case "support_attack": {
      // The designated header target runs to meet the actual cross, not a
      // generic advance-toward-goal spot — otherwise it can drift away from
      // the flight's path before the ball arrives.
      const target = intent.meetPoint ?? supportingRunTarget(pawn, context, profile, intent.laneIndex, intent.laneCount);
      const dest = moveToward(pawn.pos, target, PAWN_MOVE_BUDGET);
      const steps = buildChain(pawn.pos, [{ pos: dest }], pawn.player, false);
      const stance: Stance | null = intent.expectingHeader ? { kind: "expecting_header" } : null;
      return { ...pawn, plannedSteps: steps, stance, plannedSprint: false };
    }

    case "support_hold": {
      const dest = moveToward(pawn.pos, context.ownGoal, SUPPORT_HOLD_DEPTH_FRACTION * PAWN_MOVE_BUDGET);
      const steps = buildChain(pawn.pos, [{ pos: dest }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: false };
    }

    case "chase_loose_ball": {
      const rawDist = distance(pawn.pos, context.ball.pos);
      const sprint = maybeSprint(pawn, rawDist, profile);
      const steps = buildChain(pawn.pos, [{ pos: context.ball.pos }], pawn.player, sprint);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: sprint };
    }

    case "cover_loose_ball": {
      const dest = moveToward(pawn.pos, context.ball.pos, COVER_LOOSE_BALL_FRACTION * PAWN_MOVE_BUDGET);
      const steps = buildChain(pawn.pos, [{ pos: dest }], pawn.player, false);
      return { ...pawn, plannedSteps: steps, stance: null, plannedSprint: false };
    }
  }
}

/**
 * A rule-based opponent — still no search/minimax/ML, just a substantially
 * more complete set of rules than before: multi-step chains, stances
 * (pressure/aggressive/cover_passing/man_mark/expecting_header), sprint, and
 * the full shot/pass/cross(+loft) decision, all scaled off the actual
 * roster/pitch rather than a fixed 6v6 assumption (see formation.ts).
 *
 * `profile` is threaded explicitly through every decision helper rather than
 * read from a module-level default — that's what lets a future manager
 * system substitute a different TacticalProfile with zero changes to this
 * file's control flow. Game.tsx's existing call site needs no change: the
 * default parameter covers it.
 */
export function planAiTurn(
  pawns: Pawn[],
  ball: Ball,
  aiSide: Side,
  profile: TacticalProfile = DEFAULT_TACTICAL_PROFILE
): Pawn[] {
  const context = assessSituation(pawns, ball, aiSide);
  const intents = decideTeamIntents(context, profile);
  return pawns.map((p) =>
    p.side !== aiSide ? p : realizePawnIntent(p, intents.get(p.id) ?? { kind: "hold_shape" }, context, profile)
  );
}
