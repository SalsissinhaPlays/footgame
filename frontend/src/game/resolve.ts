import {
  BALL_REACH_HEIGHT,
  BALL_SPEED,
  CAPTURE_RADIUS,
  DECISIVE_CONTEST_MARGIN,
  DEFLECTION_ANGLE_SPREAD,
  DEFLECTION_SPEED,
  FOUL_AGGRESSIVE_BONUS,
  FOUL_CHANCE_AT_THRESHOLD,
  FOUL_CHANCE_MARGIN_RANGE,
  FOUL_CHANCE_MAX,
  GK_AGGRESSIVE_THREAT_RANGE,
  GK_ANCHOR_DEPTH,
  GK_CLAIM_RADIUS,
  GK_HEIGHT_DISTANCE_WEIGHT,
  GK_PENALTY_DEPTH,
  GK_PENALTY_PAD,
  GK_SIX_YARD_DEPTH,
  GOAL_ROW_MAX,
  GOAL_ROW_MIN,
  GRID_COLS,
  GRID_ROWS,
  HEADER_CLEARANCE_DISTANCE,
  HEADER_DIFFICULTY_THRESHOLD,
  HEADER_RADIUS,
  HEADER_REACH_HEIGHT,
  KICK_RANGE,
  LOFT_APEX_HEIGHT_RATIO,
  LOFT_APEX_MAX,
  LOFT_APEX_MIN,
  MAN_MARK_PULL_WEIGHT,
  MOVE_RANGE,
  OOB_CELLS,
  PAWN_COLLISION_RADIUS,
  PAWN_SPEED_PER_TICK,
  PENALTY_SPOT_DEPTH,
  PRESSURE_RADIUS,
  PRESSURE_SLOW_FACTOR,
  REACT_RADIUS,
  ROLL_FRICTION,
  ROLL_START_SPEED,
  ROLL_STOP_EPS,
  SAVE_DIFFICULTY_THRESHOLD,
  SPRINT_SPEED_MULTIPLIER,
  STAMINA_CHARGES_BASE,
  STAMINA_PER_BONUS_CHARGE,
  TACKLE_RADIUS,
} from "./constants";
import { sampleLanding } from "./aim";
import { resolveContest, resolveContestDetailed, rollHeaderAttempt, rollSaveAttempt } from "./contest";
import type { ContestKind } from "./contest";
import { attemptsReaction } from "./reactions";
import type { Ball, Pawn, PlayerDTO, Side, Vec2 } from "./types";

/**
 * How many waypoint-leg "charges" a pawn gets this turn, from their stamina
 * attribute — one charge per PAWN_MOVE_BUDGET-capped leg (see constants.ts).
 * Exported for Game.tsx's click-to-plan UI (gating how many waypoints a
 * player can add and showing the remaining count) as well as resolve.ts's
 * own internal use.
 */
export function chargesFor(player: PlayerDTO): number {
  return STAMINA_CHARGES_BASE + Math.floor(player.stamina / STAMINA_PER_BONUS_CHARGE);
}

export interface ResolveSnapshot {
  pawns: Pawn[];
  ball: Vec2;
  /** How high off the ground the ball is this tick (meters) — 0 unless a lofted kick is currently in flight. See heightAlongFlight. */
  ballHeight: number;
  /** Events that occurred during this specific tick — lets a UI reveal the log in sync with the animation instead of dumping everything at the end. */
  events: string[];
}

export interface ResolveResult {
  snapshots: ResolveSnapshot[];
  /** Side that scored, if the ball ended the turn inside a goal mouth. */
  goal: Side | null;
  /** Set when the ball left the pitch (any of the three ball-states) and the turn froze for a restart — see boundaryCrossing/classifyDeadBall. */
  deadBall: DeadBallResult | null;
}

export interface DeadBallResult {
  type: "throw_in" | "corner" | "goal_kick" | "free_kick" | "penalty";
  /** Side AWARDED the restart. */
  side: Side;
  /** Where the ball is placed — and where the nearest eligible pawn of `side` snaps to (see Game.tsx). */
  spot: Vec2;
}

function isInGoalRows(y: number): boolean {
  return y >= GOAL_ROW_MIN && y <= GOAL_ROW_MAX;
}

/**
 * Which side's net the ball is sitting in, if any. The pitch itself spans
 * x in [0, GRID_COLS) — the goal line is the pitch edge, and the net is just
 * beyond it, so scoring requires the ball to have actually crossed the line
 * (x < 0 or x >= GRID_COLS), not merely reached the edge cell.
 */
function goalScoredAt(pos: Vec2): Side | null {
  if (!isInGoalRows(pos.y)) return null;
  if (pos.x < 0) return "away";
  if (pos.x >= GRID_COLS) return "home";
  return null;
}

/**
 * Whether the ball's movement THIS TICK (from `from` to `to`) actually
 * crossed a goal line, checked at the crossing point itself rather than
 * just the tick's end position — and, unlike a plain yes/no, exactly WHERE
 * it crossed, which is what a goalkeeper's save attempt is judged against
 * (see attemptSave). A fast roll or deflection can jump from well before
 * the line to well past it — including past the goal-row band entirely —
 * within a single tick; sampling only the endpoint (as a plain
 * goalScoredAt(to) would) can miss the exact moment the ball was actually
 * within the goal mouth, the same tunneling problem already solved for
 * ball-vs-pawn interception via segment checks.
 */
export function goalCrossing(from: Vec2, to: Vec2): { side: Side; point: Vec2 } | null {
  if (from.x >= 0 && to.x < 0) {
    const t = from.x / (from.x - to.x);
    const y = from.y + (to.y - from.y) * t;
    if (isInGoalRows(y)) return { side: "away", point: { x: 0, y } };
  }
  if (from.x < GRID_COLS && to.x >= GRID_COLS) {
    const t = (GRID_COLS - from.x) / (to.x - from.x);
    const y = from.y + (to.y - from.y) * t;
    if (isInGoalRows(y)) return { side: "home", point: { x: GRID_COLS, y } };
  }
  const scored = goalScoredAt(to);
  return scored ? { side: scored, point: to } : null;
}

/** Thin wrapper kept for callers (including the project's throwaway verification scripts) that only care which side scored, not where. */
export function goalCrossedAlong(from: Vec2, to: Vec2): Side | null {
  return goalCrossing(from, to)?.side ?? null;
}

type BoundaryCrossing =
  | { kind: "goal_line"; defendingSide: Side; point: Vec2 }
  | { kind: "touchline"; point: Vec2 };

/**
 * Whether the ball's movement this tick crossed the touchline, or the goal
 * line OUTSIDE the goal mouth (the goal-mouth case is fully owned by
 * goalCrossing/scoring above and is deliberately excluded here via the
 * !isInGoalRows guards). Same segment-interpolation shape as goalCrossing,
 * for the same reason: a fast roll/deflection can jump clean past a
 * boundary within one tick, and the exact crossing point matters for where
 * the restart is actually placed, not just whether one happened.
 */
export function boundaryCrossing(from: Vec2, to: Vec2): BoundaryCrossing | null {
  type Candidate = { t: number; result: BoundaryCrossing };
  const candidates: Candidate[] = [];

  if (from.x >= 0 && to.x < 0) {
    const t = from.x / (from.x - to.x);
    const y = from.y + (to.y - from.y) * t;
    if (!isInGoalRows(y)) candidates.push({ t, result: { kind: "goal_line", defendingSide: "home", point: { x: 0, y } } });
  }
  if (from.x < GRID_COLS && to.x >= GRID_COLS) {
    const t = (GRID_COLS - from.x) / (to.x - from.x);
    const y = from.y + (to.y - from.y) * t;
    if (!isInGoalRows(y)) candidates.push({ t, result: { kind: "goal_line", defendingSide: "away", point: { x: GRID_COLS, y } } });
  }
  if (from.y >= 0 && to.y < 0) {
    const t = from.y / (from.y - to.y);
    const x = from.x + (to.x - from.x) * t;
    candidates.push({ t, result: { kind: "touchline", point: { x: Math.max(0, Math.min(GRID_COLS, x)), y: 0 } } });
  }
  if (from.y < GRID_ROWS && to.y >= GRID_ROWS) {
    const t = (GRID_ROWS - from.y) / (to.y - from.y);
    const x = from.x + (to.x - from.x) * t;
    candidates.push({ t, result: { kind: "touchline", point: { x: Math.max(0, Math.min(GRID_COLS, x)), y: GRID_ROWS } } });
  }

  if (candidates.length === 0) {
    // Endpoint fallback, mirroring goalCrossing's goalScoredAt(to) fallback —
    // defensive only, for a `to` already past a boundary with no clean
    // sign-change caught above.
    if (to.x < 0 && !isInGoalRows(to.y)) return { kind: "goal_line", defendingSide: "home", point: { x: 0, y: to.y } };
    if (to.x >= GRID_COLS && !isInGoalRows(to.y)) return { kind: "goal_line", defendingSide: "away", point: { x: GRID_COLS, y: to.y } };
    if (to.y < 0) return { kind: "touchline", point: { x: Math.max(0, Math.min(GRID_COLS, to.x)), y: 0 } };
    if (to.y >= GRID_ROWS) return { kind: "touchline", point: { x: Math.max(0, Math.min(GRID_COLS, to.x)), y: GRID_ROWS } };
    return null;
  }
  // Whichever boundary the segment crosses FIRST chronologically (smallest
  // t) wins — a diagonal deflection exiting right near a corner flag can
  // cross both a goal line and a touchline within one tick's travel budget,
  // and a fixed "always check X first" rule would occasionally misattribute
  // which one actually happened first.
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0].result;
}

/**
 * Throw-in / corner / goal-kick classification once a boundary crossing is
 * known. `touchedBySide` is whoever last touched the ball (see
 * BallRoll.touchedBySide / flight.kickerSide at the call sites) — distinct
 * from "who controls the ball," since a deflection or a parried save counts
 * as a touch here even though it never grants control.
 */
function classifyDeadBall(crossing: BoundaryCrossing, touchedBySide: Side): DeadBallResult {
  if (crossing.kind === "touchline") {
    const side: Side = touchedBySide === "home" ? "away" : "home";
    return { type: "throw_in", side, spot: crossing.point };
  }
  const { defendingSide, point } = crossing;
  const attackingSide: Side = defendingSide === "home" ? "away" : "home";
  if (touchedBySide === defendingSide) {
    // The defender's own touch sent it behind their line -> corner for the
    // attackers. Unambiguous which end: boundaryCrossing only reports
    // "goal_line" outside the goal rows, so point.y is strictly below
    // GOAL_ROW_MIN or strictly above GOAL_ROW_MAX, never in between.
    const cornerY = point.y < GOAL_ROW_MIN ? 0 : GRID_ROWS;
    return { type: "corner", side: attackingSide, spot: { x: point.x, y: cornerY } };
  }
  // The attacking side's own shot/pass went behind with no defensive touch
  // -> goal kick, from inside the six-yard box.
  const y = Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2);
  const x = defendingSide === "home" ? GK_SIX_YARD_DEPTH : GRID_COLS - GK_SIX_YARD_DEPTH;
  return { type: "goal_kick", side: defendingSide, spot: { x, y } };
}

function deadBallLabel(d: DeadBallResult): string {
  const sideName = d.side === "home" ? "the home side" : "the away side";
  if (d.type === "throw_in") return `Throw-in to ${sideName}`;
  if (d.type === "corner") return `Corner to ${sideName}`;
  return `Goal kick to ${sideName}`;
}

/** Whether `pos` sits within `side`'s goalkeeper box (six-yard or penalty, per depth/pad). Mirrors MatchScene.ts's own box polygon math (same raw grid coordinates) so "inside the drawn box" and "inside the gameplay box" can't drift apart. */
function inGkZone(pos: Vec2, side: Side, depth: number, pad: number): boolean {
  if (pos.y < GOAL_ROW_MIN - pad || pos.y > GOAL_ROW_MAX + pad) return false;
  return side === "home" ? pos.x >= 0 && pos.x <= depth : pos.x <= GRID_COLS && pos.x >= GRID_COLS - depth;
}

function withinPenaltyBox(pos: Vec2, side: Side): boolean {
  return inGkZone(pos, side, GK_PENALTY_DEPTH, GK_PENALTY_PAD);
}

/**
 * A foul by `challenger` against ball-carrying `holder` — awarded to
 * `holder.side`. A foul committed inside the CHALLENGER's own box is a
 * penalty (fixed spot, no wall/setup concept); anywhere else it's a direct
 * free kick taken from the exact spot of the foul.
 */
function classifyFoul(holder: Pawn, challenger: Pawn): DeadBallResult {
  if (withinPenaltyBox(holder.pos, challenger.side)) {
    const y = Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2);
    const x = challenger.side === "home" ? PENALTY_SPOT_DEPTH : GRID_COLS - PENALTY_SPOT_DEPTH;
    return { type: "penalty", side: holder.side, spot: { x, y } };
  }
  return { type: "free_kick", side: holder.side, spot: { ...holder.pos } };
}

// The ball is never allowed to end a tick's movement beyond the walkable
// out-of-bounds apron — without this, a missed shot/deflection/roll that
// isn't a goal could sail off past where any pawn could ever be planned to
// reach, permanently stranding it.
const BALL_BOUND_MIN_X = -OOB_CELLS;
const BALL_BOUND_MAX_X = GRID_COLS + OOB_CELLS;
const BALL_BOUND_MIN_Y = -OOB_CELLS;
const BALL_BOUND_MAX_Y = GRID_ROWS + OOB_CELLS;

export function clampBallToBounds(pos: Vec2): Vec2 {
  return {
    x: Math.max(BALL_BOUND_MIN_X, Math.min(BALL_BOUND_MAX_X, pos.x)),
    y: Math.max(BALL_BOUND_MIN_Y, Math.min(BALL_BOUND_MAX_Y, pos.y)),
  };
}

function key(v: Vec2): string {
  return `${v.x},${v.y}`;
}

// Best-first fallback headings, as an angular deviation off the ideal
// direction toward a destination — the continuous equivalent of the old
// diagonal/horizontal/vertical-only sidestep options, just not locked to
// grid-aligned compass directions.
const SIDESTEP_ANGLES_DEG = [0, -30, 30, -60, 60, -90, 90];

/**
 * Candidate next positions from `pos` toward `dest`, best first: stepping
 * directly toward the destination at up to `speed` (clamped so a pawn
 * doesn't overshoot when already close), then trying increasing angular
 * deviations off that ideal direction to skirt an obstacle. Lets a pawn
 * route around a stationary blocker instead of being stuck the instant the
 * straight line to its target is occupied. `speed` defaults to the normal
 * per-tick rate but can be reduced (e.g. by a nearby "pressure"-stance
 * opponent) without touching the sidestep logic itself.
 */
export function candidateHeadings(pos: Vec2, dest: Vec2, speed: number = PAWN_SPEED_PER_TICK): Vec2[] {
  const toDest = { x: dest.x - pos.x, y: dest.y - pos.y };
  const remaining = Math.hypot(toDest.x, toDest.y);
  if (remaining < 1e-6) return [{ ...pos }];

  const dir = normalizeVec(toDest);
  const step = Math.min(speed, remaining);
  return SIDESTEP_ANGLES_DEG.map((deg) => {
    const rotated = rotateVec(dir, (deg * Math.PI) / 180);
    return { x: pos.x + rotated.x * step, y: pos.y + rotated.y * step };
  });
}

/**
 * How many ticks a pawn's full waypoint chain needs at base speed, from its
 * current position through every planned leg in order — used only to pick a
 * generous-enough tick-loop bound for the turn (see resolveTurn), not to
 * predict movement exactly. Deliberately ignores dynamic per-tick effects
 * (sprint/pressure): a pawn who ends up slowed simply doesn't finish its plan
 * by turn's end, the same accepted degradation a single blocked leg already
 * has today.
 */
function ticksForSteps(from: Vec2, steps: Vec2[]): number {
  let total = 0;
  let cursor = from;
  for (const step of steps) {
    total += distance(cursor, step);
    cursor = step;
  }
  return Math.ceil(total / PAWN_SPEED_PER_TICK);
}

/** Grid cells crossed in a straight line from `start` to `end`, excluding `start`. */
export function lineCells(start: Vec2, end: Vec2): Vec2[] {
  const dist = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y), 1);
  const cells: Vec2[] = [];
  let lastKey: string | null = null;
  for (let i = 1; i <= dist; i++) {
    const fraction = i / dist;
    const cell = {
      x: Math.round(start.x + (end.x - start.x) * fraction),
      y: Math.round(start.y + (end.y - start.y) * fraction),
    };
    const cellKey = key(cell);
    if (cellKey !== lastKey) {
      cells.push(cell);
      lastKey = cellKey;
    }
  }
  return cells;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Closest point to `p` on the segment `a -> b`. */
function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * Shortest distance from `p` to the segment `a -> b`. Capture checks use this
 * instead of point-to-point distance against just the ball's post-tick
 * position, because the ball can cover several grid units in one tick (faster
 * than BALL_SPEED-radius) — checking only the endpoint would let it tunnel
 * straight past a defender sitting exactly on the line without ever coming
 * within range of it.
 */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

function normalizeVec(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/** Rotates `v` by `angleRad` radians. */
function rotateVec(v: Vec2, angleRad: number): Vec2 {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * A ball in flight, tracked as a real point moving along a fixed straight
 * line (from the carrier's position at the moment of the kick, to the
 * clamped target) rather than a precomputed list of grid cells. Advancing it
 * is just moving `traveled` forward each tick; where it actually is at any
 * point is a continuous position, which is what lets height/curve/roll be
 * layered on top later without changing this shape.
 */
interface BallFlight {
  kickerId: string;
  kickerSide: Side;
  from: Vec2;
  to: Vec2;
  totalDist: number;
  traveled: number;
  /** Peak height (meters) of this flight's arc; 0 for a grounded kick, which is what keeps a grounded flight's height at exactly 0 for every tick without any special-casing elsewhere. */
  apexHeight: number;
  /** Defenders who already had their one contest against this flight and lost — they don't get a second roll just for staying close. */
  contested: Set<string>;
}

/**
 * A loose ball moving under its own momentum rather than heading toward a
 * kicked target — what an unopposed kick becomes once it "lands" with nobody
 * there to meet it, or what a scrappy (non-decisive) challenge produces
 * instead of a clean takeover. Decays via friction each tick; whoever it
 * ends up within CAPTURE_RADIUS of picks it up (a contest if more than one
 * pawn qualifies), same as any other capture check.
 */
interface BallRoll {
  pos: Vec2;
  vx: number;
  vy: number;
  /** The pawn whose touch just knocked the ball loose, if any — excluded from claiming it back for the rest of this roll, since a ball that's just come off your foot at a bad angle isn't immediately back under your control. */
  excludeId?: string;
  /** Side that last touched the ball to produce this roll — a Side rather than a pawn id, since excludeId is absent for an unopposed landing (nobody touched it, just residual momentum) while a side is always knowable. Used for throw-in/corner/goal-kick attribution if this roll goes out of bounds. */
  touchedBySide: Side;
}

interface FlightStart {
  flight: BallFlight;
  /** Set when the kick landed noticeably off its aim point — worth a distinct event message. */
  mishit: boolean;
}

function startFlight(carrier: Pawn, rawTarget: Vec2): FlightStart {
  const dist = distance(carrier.pos, rawTarget);
  const clampFraction = dist > KICK_RANGE ? KICK_RANGE / dist : 1;
  const aim: Vec2 = {
    x: carrier.pos.x + (rawTarget.x - carrier.pos.x) * clampFraction,
    y: carrier.pos.y + (rawTarget.y - carrier.pos.y) * clampFraction,
  };
  // Where the kick is actually going isn't the aim point itself — it's
  // sampled from a spread around it, tighter for a shorter/more skilled
  // kick. The flight then travels toward that real landing point exactly
  // like any other kick: same straight-line path, same tick-by-tick
  // interception checks. Only the target the flight aims for changes.
  const landing = sampleLanding(aim, distance(carrier.pos, aim), carrier.player.skill);
  const totalDist = Math.max(distance(carrier.pos, landing.point), 1e-6);
  const apexHeight = carrier.plannedKickLoft
    ? Math.min(LOFT_APEX_MAX, Math.max(LOFT_APEX_MIN, totalDist * LOFT_APEX_HEIGHT_RATIO))
    : 0;
  return {
    flight: {
      kickerId: carrier.id,
      kickerSide: carrier.side,
      from: { ...carrier.pos },
      to: landing.point,
      totalDist,
      traveled: 0,
      apexHeight,
      contested: new Set(),
    },
    mishit: landing.missBy > landing.sigma,
  };
}

/**
 * A header's redirect: starts from the CONTACT POINT (where the header
 * happened — see checkHeader), not the winning pawn's own pos, toward the
 * auto-picked target, using `heading` for spread instead of `skill`.
 * apexHeight is always 0 — headers stay grounded this pass, deliberately no
 * header-off-a-header (see checkHeader's and the tick loop's doc comments).
 * A standalone function rather than a helper shared with startFlight — the
 * two have different calling shapes (one reads plannedKickLoft off a
 * carrier Pawn, the other starts from a bare contact point with no carrier/
 * loft concept at all), and this codebase already keeps similarly-shaped-
 * but-distinct logic separate elsewhere rather than force a shared
 * abstraction onto it.
 */
function startHeaderFlight(winner: Pawn, contactPoint: Vec2, rawTarget: Vec2): FlightStart {
  const dist = distance(contactPoint, rawTarget);
  const clampFraction = dist > KICK_RANGE ? KICK_RANGE / dist : 1;
  const aim: Vec2 = {
    x: contactPoint.x + (rawTarget.x - contactPoint.x) * clampFraction,
    y: contactPoint.y + (rawTarget.y - contactPoint.y) * clampFraction,
  };
  const landing = sampleLanding(aim, distance(contactPoint, aim), winner.player.heading);
  const totalDist = Math.max(distance(contactPoint, landing.point), 1e-6);
  return {
    flight: {
      kickerId: winner.id,
      kickerSide: winner.side,
      from: { ...contactPoint },
      to: landing.point,
      totalDist,
      traveled: 0,
      apexHeight: 0,
      contested: new Set(),
    },
    mishit: landing.missBy > landing.sigma,
  };
}

function pointAlongFlight(flight: BallFlight): Vec2 {
  const t = Math.min(1, flight.traveled / flight.totalDist);
  return {
    x: flight.from.x + (flight.to.x - flight.from.x) * t,
    y: flight.from.y + (flight.to.y - flight.from.y) * t,
  };
}

/** Height (meters) along a flight's arc: a simple parabola, 0 at both ends, peaking at apexHeight halfway through — 0 for every tick of a grounded kick (apexHeight 0), and back to exactly 0 once the flight lands (t=1), with no special-casing needed at either boundary. */
function heightAlongFlight(flight: BallFlight): number {
  const t = Math.min(1, flight.traveled / flight.totalDist);
  return flight.apexHeight * 4 * t * (1 - t);
}

interface CaptureOutcome {
  receiver: Pawn | null;
  interceptedBy: Pawn | null;
  /** A challenge was contested and won, but not decisively — the ball squirts loose from this point rather than settling with anyone. */
  deflectedAt: Vec2 | null;
  /** Who caused the deflection — excluded from immediately reclaiming their own loose touch. */
  deflectedBy: string | null;
  /** Side of the deflecting pawn — used for throw-in/corner/goal-kick attribution if the resulting loose ball goes out of bounds. */
  deflectedBySide: Side | null;
  event: string | null;
}

/**
 * Checks the ground this tick's flight movement actually swept over — the
 * segment from where it started the tick to where it ends up — against
 * every pawn's up-to-date position, not just whoever was in the way at the
 * moment of the kick. A teammate within CAPTURE_RADIUS of that segment
 * receives the ball; an opponent gets a contest to intercept it. Winning that
 * contest decisively is a clean takeover; winning it narrowly only knocks the
 * ball loose (see DECISIVE_CONTEST_MARGIN) rather than granting control.
 * Losing the contest doesn't end the flight (the kick "breaks through"), but
 * that defender is marked so lingering next to the ball's path isn't a free
 * repeated roll.
 */
function checkCapture(flight: BallFlight, from: Vec2, to: Vec2, pawns: Pawn[]): CaptureOutcome {
  const kicker = pawns.find((p) => p.id === flight.kickerId)!;
  // An Aggressive-stance defending GK gets a wider reach than the generic
  // CAPTURE_RADIUS any defender gets — but only inside his own penalty box,
  // so a GK who's wandered upfield doesn't get a supernatural reach
  // elsewhere. This is what lets him proactively claim a cross before it
  // becomes a shot, not just react once the ball is already dangerous.
  const nearby = pawns
    .filter((p) => p.id !== flight.kickerId && !flight.contested.has(p.id))
    .map((p) => ({ p, d: distanceToSegment(p.pos, from, to) }))
    .filter(({ p, d }) => {
      if (d <= CAPTURE_RADIUS) return true;
      return (
        p.side !== flight.kickerSide &&
        p.player.position === "GK" &&
        p.stance?.kind === "gk_aggressive" &&
        withinPenaltyBox(p.pos, p.side) &&
        d <= GK_CLAIM_RADIUS
      );
    })
    .sort((a, b) => a.d - b.d);

  for (const { p } of nearby) {
    if (p.side === flight.kickerSide) {
      return {
        receiver: p,
        interceptedBy: null,
        deflectedAt: null,
        deflectedBy: null,
        deflectedBySide: null,
        event: `Pass: ${kicker.player.name} finds ${p.player.name}`,
      };
    }
    // A claiming GK reads the situation with goalkeeper attributes, not
    // generic outfield interception attributes — same downstream handling
    // either way (decisive win, scrappy deflection, or a lost attempt that
    // leaves him marked and out of position for the rest of this flight).
    const kind: ContestKind = p.player.position === "GK" && p.stance?.kind === "gk_aggressive" ? "gk_claim" : "interception";
    const { winner, margin } = resolveContestDetailed([p, kicker], kind);
    if (winner === p) {
      if (margin >= DECISIVE_CONTEST_MARGIN) {
        return {
          receiver: null,
          interceptedBy: p,
          deflectedAt: null,
          deflectedBy: null,
          deflectedBySide: null,
          event: `Interception: ${p.player.name} cuts out ${kicker.player.name}'s pass`,
        };
      }
      return {
        receiver: null,
        interceptedBy: null,
        deflectedAt: closestPointOnSegment(p.pos, from, to),
        deflectedBy: p.id,
        deflectedBySide: p.side,
        event: `${p.player.name} half-blocks ${kicker.player.name}'s shot — loose ball!`,
      };
    }
    flight.contested.add(p.id);
  }
  return { receiver: null, interceptedBy: null, deflectedAt: null, deflectedBy: null, deflectedBySide: null, event: null };
}

interface HeaderOutcome {
  /** Pawn who won the header and is now redirecting it. Null when nobody was eligible this tick (flight continues untouched) or when a lone uncontested pawn fluffed it. */
  winner: Pawn | null;
  /** Where the header contact happened. Null iff winner is null AND nobody was eligible at all. */
  contactPoint: Vec2 | null;
  /** True only for the lone-uncontested-pawn case that failed HEADER_DIFFICULTY_THRESHOLD. */
  fluffed: boolean;
  /** Side of whoever fluffed it, when fluffed is true — used for throw-in/corner/goal-kick attribution if the resulting loose ball goes out of bounds. */
  fluffedBySide: Side | null;
  event: string | null;
}

interface HeaderTarget {
  point: Vec2;
  label: string;
}

function goalNetFor(attackingSide: Side): Vec2 {
  const y = Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2);
  return { x: attackingSide === "home" ? GRID_COLS : -1, y };
}

function goalLineFor(attackingSide: Side): Vec2 {
  const y = Math.floor((GOAL_ROW_MIN + GOAL_ROW_MAX) / 2);
  return { x: attackingSide === "home" ? GRID_COLS - 1 : 0, y };
}

/** Same shape as ai.ts's hasClearLane (distanceToSegment against CAPTURE_RADIUS) — reimplemented here rather than imported, since ai.ts is frozen/deferred pending its own overhaul (see CLAUDE.md). */
function hasHeaderLane(from: Vec2, to: Vec2, obstacles: Pawn[]): boolean {
  return !obstacles.some((o) => distanceToSegment(o.pos, from, to) <= CAPTURE_RADIUS);
}

/**
 * Fully automatic aim-point choice for a won header — no planning UI, this
 * runs mid-resolution regardless of who "controls" the winning pawn this
 * turn. Mirrors ai.ts's shoot/pass/dribble shape (hasClearLane, nearest
 * more-advanced open teammate, KICK_RANGE-gated shot) but must work for
 * EITHER side, unlike ai.ts which only ever plans for one side per turn —
 * hence a fresh implementation here, not a call into ai.ts.
 */
function pickHeaderTarget(winner: Pawn, contactPoint: Vec2, pawns: Pawn[]): HeaderTarget {
  const opponents = pawns.filter((p) => p.side !== winner.side);
  const teammates = pawns.filter((p) => p.side === winner.side && p.id !== winner.id);
  const goalNet = goalNetFor(winner.side);
  const goalLine = goalLineFor(winner.side);

  if (distance(contactPoint, goalNet) <= KICK_RANGE && hasHeaderLane(contactPoint, goalNet, opponents)) {
    return { point: goalNet, label: "toward goal" };
  }

  const passTarget = teammates
    .filter((t) => t.player.position !== "GK")
    .filter((t) => distance(contactPoint, t.pos) <= KICK_RANGE && hasHeaderLane(contactPoint, t.pos, opponents))
    .filter((t) => distance(t.pos, goalLine) < distance(contactPoint, goalLine) - 1)
    .sort((a, b) => distance(a.pos, goalLine) - distance(b.pos, goalLine))[0];
  if (passTarget) return { point: passTarget.pos, label: `to ${passTarget.player.name}` };

  // Clearance: a point upfield along the winner's OWN attacking direction
  // (away from the goal they defend), not tied to any teammate.
  const dirX = winner.side === "home" ? 1 : -1;
  return {
    point: { x: contactPoint.x + dirX * HEADER_CLEARANCE_DISTANCE, y: contactPoint.y },
    label: "clear of danger",
  };
}

/**
 * Checks this tick's swept segment for header eligibility (HEADER_RADIUS of
 * any pawn, either side, excluding the flight's own kicker and anyone
 * already in flight.contested — same exclusions checkCapture already uses:
 * the kicker shouldn't head their own just-struck pass, and a pawn who
 * already lost one contest against this flight doesn't get a free second
 * roll just because the height band changed).
 *
 * 2+ eligible pawns is a genuine resolveContestDetailed(..., "header")
 * contest — always produces a winner, no separate fail chance (a contested
 * win is always clean this pass; unlike tackle/interception there's no
 * DECISIVE_CONTEST_MARGIN split here — a future refinement could add one
 * without restructuring anything). Exactly 1 eligible pawn still rolls,
 * against HEADER_DIFFICULTY_THRESHOLD rather than auto-winning — clearing
 * it is a clean header, failing it is a fluff (ball squirts loose, same
 * deflection shape checkCapture's narrow-win case uses). 0 eligible pawns:
 * no header this tick, flight continues untouched.
 */
function checkHeader(flight: BallFlight, from: Vec2, to: Vec2, pawns: Pawn[]): HeaderOutcome {
  const eligible = pawns
    .filter((p) => p.id !== flight.kickerId && !flight.contested.has(p.id))
    .map((p) => ({ p, d: distanceToSegment(p.pos, from, to) }))
    .filter(({ d }) => d <= HEADER_RADIUS)
    .sort((a, b) => a.d - b.d);

  if (eligible.length === 0) {
    return { winner: null, contactPoint: null, fluffed: false, fluffedBySide: null, event: null };
  }

  if (eligible.length === 1) {
    const { p } = eligible[0];
    const contactPoint = closestPointOnSegment(p.pos, from, to);
    if (rollHeaderAttempt(p) < HEADER_DIFFICULTY_THRESHOLD) {
      return {
        winner: null,
        contactPoint,
        fluffed: true,
        fluffedBySide: p.side,
        event: `${p.player.name} rises for it... and fluffs the header!`,
      };
    }
    return {
      winner: p,
      contactPoint,
      fluffed: false,
      fluffedBySide: null,
      event: `${p.player.name} rises unchallenged and wins the header`,
    };
  }

  const contestants = eligible.map(({ p }) => p);
  const { winner } = resolveContestDetailed(contestants, "header");
  return {
    winner,
    contactPoint: closestPointOnSegment(winner.pos, from, to),
    fluffed: false,
    fluffedBySide: null,
    event: `Header duel: ${contestants.map((c) => c.player.name).join(" vs ")} — ${winner.player.name} wins it`,
  };
}

type SaveOutcome = { result: "goal" } | { result: "caught"; gk: Pawn } | { result: "parried"; gk: Pawn };

/**
 * Whether a shot heading into the goal mouth at `crossingPoint` actually
 * goes in, or the defending side's goalkeeper deals with it first. Purely
 * geometric — takes only where/how high the ball crossed, nothing about the
 * kick's declared intent — so a misdirected pass or a deflected loose ball
 * drifting toward net gets exactly the same save attempt a deliberate shot
 * would (see the three call sites in resolveTurn). If the defending side has
 * no GK pawn at all, it's an automatic goal, same as today.
 */
function attemptSave(pawns: Pawn[], scoringSide: Side, crossingPoint: Vec2, height: number): SaveOutcome {
  const defendingSide: Side = scoringSide === "home" ? "away" : "home";
  const gk = pawns.find((p) => p.side === defendingSide && p.player.position === "GK");
  if (!gk) return { result: "goal" };
  const effectiveDistance = distance(gk.pos, crossingPoint) + height * GK_HEIGHT_DISTANCE_WEIGHT;
  const roll = rollSaveAttempt(gk, effectiveDistance);
  if (roll < SAVE_DIFFICULTY_THRESHOLD) return { result: "goal" };
  if (roll - SAVE_DIFFICULTY_THRESHOLD >= DECISIVE_CONTEST_MARGIN) return { result: "caught", gk };
  return { result: "parried", gk };
}

/**
 * Where an off-the-ball goalkeeper with no explicit order this turn shadows
 * to: shallow and anchored to the ball's row by default (gk_on_line and the
 * no-stance default both resolve to this, aggressive=false), advancing
 * further off the line toward the penalty-box depth the closer an incoming
 * threat gets when aggressive=true (gk_aggressive stance).
 */
function gkAutoTarget(gk: Pawn, ballPos: Vec2, aggressive: boolean): Vec2 {
  const targetY = Math.max(GOAL_ROW_MIN, Math.min(GOAL_ROW_MAX, ballPos.y));
  const goalLineX = gk.side === "home" ? 0 : GRID_COLS;
  const distFromGoalLine = Math.abs(ballPos.x - goalLineX);
  let depth = GK_ANCHOR_DEPTH;
  if (aggressive && distFromGoalLine <= GK_AGGRESSIVE_THREAT_RANGE) {
    const closeness = 1 - distFromGoalLine / GK_AGGRESSIVE_THREAT_RANGE; // 0..1, 1 = ball right on the line
    depth = GK_ANCHOR_DEPTH + (GK_PENALTY_DEPTH - GK_ANCHOR_DEPTH) * closeness;
  }
  return { x: gk.side === "home" ? depth : GRID_COLS - depth, y: targetY };
}

/**
 * Resolves one full turn tick by tick. Invariant (relaxed for one case): no
 * two pawns may ever be closer than PAWN_COLLISION_RADIUS in any snapshot,
 * EXCEPT that a goalkeeper positioned within his own penalty box may end up
 * closer than this to another pawn also converging there — modeling a
 * goalmouth scramble rather than two solid bodies that can never overlap
 * (see gkProtected below). Outside his own box the GK is a normal pawn,
 * fully subject to the general invariant — this is what makes coming off
 * his line for a claim (see checkCapture's gk_aggressive handling) carry a
 * real positional cost. Pawns move continuously (any direction, real
 * distance per tick) rather than stepping cell-to-cell, so this is a
 * proximity guarantee, not an exact-cell one. Collisions are settled with a
 * skill check; losers are stopped for the rest of the turn.
 *
 * The ball and pawn movement share this same tick loop rather than being two
 * sequential phases: a kicked ball is checked against every pawn's
 * just-updated position every tick, so a defender or receiver moving into its
 * path this same turn — not just whoever was already standing there — can
 * change the outcome. A turnover (interception) freezes the rest of the
 * turn's resolution immediately, same as a goal; a completed pass to a
 * teammate does not, since possession hasn't actually changed sides.
 */
export function resolveTurn(pawns: Pawn[], ball: Ball): ResolveResult {
  const events: string[] = [];
  // Cursor into `events`: everything from here to the current length hasn't
  // been attached to a snapshot yet. A single running cursor (rather than
  // resetting it at the top of each tick) is what lets the pre-loop kick
  // announcement below — pushed before tick 0 even starts — still end up
  // attached to the first snapshot instead of being silently dropped.
  let sliceStart = 0;
  function takeNewEvents(): string[] {
    const slice = events.slice(sliceStart);
    sliceStart = events.length;
    return slice;
  }
  // Defensively clamp to each pawn's own charge budget, the same way
  // startFlight clamps a kick to KICK_RANGE regardless of what was
  // requested — the UI is expected to already gate this when building a
  // chain, but resolveTurn shouldn't silently trust an input that claims
  // more legs than the pawn's stamina actually grants.
  let current: Pawn[] = pawns.map((p) => ({ ...p, plannedSteps: p.plannedSteps.slice(0, chargesFor(p.player)) }));
  const snapshots: ResolveSnapshot[] = [];
  // Captured before the tick loop wipes plannedSteps each tick (see the
  // end-of-tick reset below) — a man-marking pawn's auto-movement only kicks
  // in when the PLAYER never gave it an explicit waypoint chain this turn;
  // an explicit click always wins.
  const hasExplicitPlan = new Set(current.filter((p) => p.plannedSteps.length > 0).map((p) => p.id));

  // Whoever starts the turn within capture range of the ball carries it. If
  // nobody is there, the ball just sits still until someone reaches it.
  const carrier = current.find((p) => distance(p.pos, ball.pos) <= CAPTURE_RADIUS) ?? null;
  let ballPos: Vec2 = { ...ball.pos };
  let ballHeight = 0;
  let flight: BallFlight | null = null;
  let roll: BallRoll | null = null;
  let currentCarrierId: string | null = carrier?.id ?? null;
  // Whichever side last actually controlled the ball — used to tell a real
  // turnover (the other side ends up with it) apart from a side simply
  // recovering its own loose ball, which shouldn't interrupt resolution.
  let lastControllingSide: Side | null = carrier?.side ?? null;

  if (carrier && carrier.plannedKick) {
    const started = startFlight(carrier, carrier.plannedKick);
    flight = started.flight;
    events.push(
      started.mishit
        ? `${carrier.player.name} strikes it, but the ball is off target`
        : `${carrier.player.name} strikes the ball`
    );
    // The kicker releases the ball and stays put; nobody else's plan changes.
    current = current.map((p) =>
      p.id === carrier.id ? { ...p, plannedSteps: [], plannedKick: null, plannedKickLoft: false } : p
    );
    currentCarrierId = null;
  }

  // Each pawn's plan is now a CHAIN of waypoints (plannedSteps), not one
  // destination — captured here, once, before the tick loop starts clearing
  // plannedSteps every tick for display hygiene (see the end-of-tick reset
  // below). stepCursor tracks which waypoint each pawn is currently walking
  // toward; currentStepTarget is what `destinations` gets refreshed from at
  // the top of every tick (below), same as the chasing/man-mark/GK blocks
  // already refresh it for their own cases — a pawn arriving at its current
  // waypoint just advances the cursor to the next one, going through the
  // exact same candidateHeadings/collision machinery any planned move always
  // did.
  const plannedStepsById = new Map<string, Vec2[]>(current.map((p) => [p.id, p.plannedSteps]));
  const stepCursor = new Map<string, number>(current.map((p) => [p.id, 0]));
  function currentStepTarget(p: Pawn): Vec2 {
    const steps = plannedStepsById.get(p.id)!;
    return steps[stepCursor.get(p.id)!] ?? p.pos;
  }

  const destinations = new Map(current.map((p) => [p.id, currentStepTarget(p)]));
  const stopped = new Set<string>();
  // Pawns who've committed to chasing a loose ball instead of their planned
  // move, and pawns who've already had their one-time chance to react (so a
  // pawn that chose to ignore a loose ball isn't re-asked every tick it
  // stays nearby — a flicker-free decision, not a live re-evaluation).
  const chasingIds = new Set<string>();
  const reactionDecided = new Set<string>();
  // Tracks tackle attempts against the CURRENT dribble specifically — reset
  // whenever the ball changes hands, so a defender who already failed
  // doesn't get a free repeated roll every tick just for staying close, but
  // a new carrier (or a fresh challenger) always gets a real read.
  let tackleCarrierId: string | null = currentCarrierId;
  const tackleAttempted = new Set<string>();

  // A turn's tick count is no longer a fixed MOVE_RANGE — a pawn chaining
  // several waypoints needs proportionally more ticks to actually walk the
  // whole plan, while everyone else just keeps ticking alongside them
  // (idling once their own, shorter plan is done, exactly like a pawn with
  // no plan at all already does today). MOVE_RANGE stays the floor, so a
  // turn using nothing but ordinary single-destination plans behaves
  // identically to before.
  const totalTicks = Math.max(MOVE_RANGE, ...current.map((p) => ticksForSteps(p.pos, p.plannedSteps)));

  for (let tick = 0; tick < totalTicks; tick++) {
    // Refresh each explicitly-planned pawn's target from wherever its step
    // cursor currently points (advanced below, once this tick's movement has
    // resolved, if they've arrived at it). Pawns without an explicit plan
    // keep whatever `destinations` already holds for them — their own
    // position, or a man-mark/GK auto-target the next two blocks refresh.
    for (const p of current) {
      if (hasExplicitPlan.has(p.id)) destinations.set(p.id, currentStepTarget(p));
    }

    // Chasers re-aim at the ball's last known position before this tick's
    // movement resolves — one tick of "reaction time" behind where it
    // actually is, same as a human noticing and then moving.
    for (const id of chasingIds) {
      destinations.set(id, { ...ballPos });
    }

    // Man-marking pawns with no explicit order re-aim every tick too, at a
    // point blended between the marked opponent's live position and the
    // marker's own current spot ("focus more, but not exclusively" — a full
    // pull would be a blind chase). An explicit plannedSteps chain already
    // took priority in the refresh block above and is never touched here.
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

    // GK auto-positioning: a keeper with no explicit order this turn
    // shadows the ball's threat automatically, same "only re-aim pawns
    // without an explicit plan" gate man-marking uses above. This is also
    // what keeps ai.ts's AI-controlled GK sensible without touching ai.ts:
    // ai.ts always sets an explicit plannedSteps chain for its own GK every turn,
    // so hasExplicitPlan is always true for it and this block simply never
    // runs for an AI-controlled keeper.
    for (const p of current) {
      if (p.player.position !== "GK" || hasExplicitPlan.has(p.id)) continue;
      destinations.set(p.id, gkAutoTarget(p, ballPos, p.stance?.kind === "gk_aggressive"));
    }

    const preTickPos = new Map(current.map((p) => [p.id, p.pos]));
    // A "pressure"-stance pawn saps the effective speed of any opponent
    // currently within PRESSURE_RADIUS of it, checked against positions as
    // of the start of this tick — applies regardless of why that opponent
    // is moving (planned move, loose-ball chase, or man-marking auto-move).
    const isPressured = (p: Pawn) =>
      current.some(
        (o) => o.side !== p.side && o.stance?.kind === "pressure" && distance(p.pos, o.pos) <= PRESSURE_RADIUS
      );
    // Recomputed fresh every tick, since a blocker from an earlier tick may
    // have since moved out of the way.
    const candidates = new Map(
      current.map((p) => {
        const base = isPressured(p) ? PAWN_SPEED_PER_TICK * PRESSURE_SLOW_FACTOR : PAWN_SPEED_PER_TICK;
        // Stacks multiplicatively with pressure rather than needing special
        // casing — sprinting through an opponent's pressure nets to
        // PRESSURE_SLOW_FACTOR * SPRINT_SPEED_MULTIPLIER (a mild net
        // slowdown at the current tuning), which reads correctly as
        // "sprinting barely overcomes someone right on top of you."
        const speed = p.plannedSprint ? base * SPRINT_SPEED_MULTIPLIER : base;
        return [p.id, candidateHeadings(p.pos, destinations.get(p.id)!, speed)];
      })
    );
    const candidateIndex = new Map(current.map((p) => [p.id, 0]));
    const intended = new Map<string, Vec2>();
    for (const p of current) {
      intended.set(p.id, stopped.has(p.id) ? p.pos : candidates.get(p.id)![0]);
    }

    const isMoving = (id: string) => distance(intended.get(id)!, preTickPos.get(id)!) > 1e-6;
    // A pawn that is NOT moving this tick and sits within radius of `pos` —
    // a genuine hard block, as opposed to a pawn that merely happens to be
    // nearby but is vacating the area too (which isn't a real obstacle).
    const stationaryBlockerAt = (pos: Vec2, excludeId: string) =>
      current.find(
        (o) => o.id !== excludeId && !isMoving(o.id) && distance(preTickPos.get(o.id)!, pos) <= PAWN_COLLISION_RADIUS
      );
    // A goalkeeper inside his own penalty box is exempt from the collision
    // rules below AS A BLOCKED PARTY (real football protects a keeper from
    // being barged/blocked in his own box) — he can still legitimately
    // block others by standing still, that direction is unchanged. Checked
    // against the START-of-tick position, same timing every other
    // proximity check in this loop already uses.
    const gkProtected = (id: string) => {
      const p = current.find((c) => c.id === id)!;
      return p.player.position === "GK" && withinPenaltyBox(preTickPos.get(id)!, p.side);
    };

    // Settling one collision can create a new one (e.g. a pawn frozen by rule 3
    // becomes a hard block for someone else's path), so all three rules run
    // together in a fixed-point loop until a full pass makes no more changes.
    let changed = true;
    while (changed) {
      changed = false;

      // Rule 1: a cell held by a pawn that isn't vacating it this tick is a
      // hard block — no skill check, nobody can walk through an occupied square.
      // Rather than giving up immediately, the pawn tries its next-best
      // sidestep candidate (skirting the obstacle) before settling for staying
      // put this tick — it can still try again next tick either way.
      for (const p of current) {
        if (!isMoving(p.id)) continue;
        // Combine "is anyone there" and "are they actually a stationary
        // blocker" into one predicate — otherwise, when a candidate position
        // happens to be within radius of BOTH a moving pawn (vacating the
        // area, not really blocking) AND a separate stationary one, `.find`
        // could return the moving one first and wrongly conclude there's no
        // block at all, masking the real one.
        let blocker = gkProtected(p.id) ? undefined : stationaryBlockerAt(intended.get(p.id)!, p.id);
        while (blocker) {
          const options = candidates.get(p.id)!;
          const nextIndex = candidateIndex.get(p.id)! + 1;
          if (nextIndex >= options.length) {
            intended.set(p.id, preTickPos.get(p.id)!);
            blocker = undefined;
          } else {
            candidateIndex.set(p.id, nextIndex);
            intended.set(p.id, options[nextIndex]);
            blocker = stationaryBlockerAt(intended.get(p.id)!, p.id);
          }
          changed = true;
        }
      }

      // Rule 2: swaps — each pawn's intended position lands within
      // PAWN_COLLISION_RADIUS of where the OTHER currently stands (a
      // generalization of "exact reversal" for continuous positions: two
      // pawns heading into each other's space, not necessarily a pixel-perfect
      // trade). Neither completes the crossing this tick; the loser is
      // stopped for good, the winner may try again on a later tick.
      for (const p of current) {
        if (!isMoving(p.id) || stopped.has(p.id) || gkProtected(p.id)) continue;
        const dest = intended.get(p.id)!;
        // Same combined-predicate approach as Rule 1: search for a pawn that
        // satisfies the FULL swap condition (moving, not stopped, heading
        // roughly into p's current spot while p heads into theirs) in one
        // pass, rather than taking whichever pawn happens to be nearest
        // `dest` first and only then checking if it qualifies — otherwise an
        // unrelated nearby pawn that fails one condition could mask a real
        // swap partner a little further off but still within radius.
        const occupant = current.find(
          (o) =>
            o.id !== p.id &&
            isMoving(o.id) &&
            !stopped.has(o.id) &&
            !gkProtected(o.id) &&
            distance(preTickPos.get(o.id)!, dest) <= PAWN_COLLISION_RADIUS &&
            distance(intended.get(o.id)!, preTickPos.get(p.id)!) <= PAWN_COLLISION_RADIUS
        );
        if (!occupant) continue;

        const winner = resolveContest([p, occupant], "loose_ball");
        const loser = winner.id === p.id ? occupant : p;
        events.push(
          `Collision crossing paths: ${p.player.name} vs ${occupant.player.name} — ${winner.player.name} wins`
        );
        stopped.add(loser.id);
        intended.set(loser.id, preTickPos.get(loser.id)!);
        intended.set(winner.id, preTickPos.get(winner.id)!);
        changed = true;
      }

      // Rule 3: three-plus-way contests — pawns converging on intended
      // positions that are mutually close, not necessarily identical. Grouped
      // by simple proximity (not a full transitive closure — pawn counts are
      // small enough that this is a non-issue in practice) rather than an
      // exact-cell key, since "the same free cell" doesn't mean anything once
      // destinations are continuous.
      const movingIds = current.filter((p) => isMoving(p.id) && !gkProtected(p.id)).map((p) => p.id);
      const grouped = new Set<string>();
      for (const id of movingIds) {
        if (grouped.has(id)) continue;
        const group = movingIds.filter(
          (otherId) =>
            !grouped.has(otherId) &&
            distance(intended.get(id)!, intended.get(otherId)!) <= PAWN_COLLISION_RADIUS
        );
        if (group.length <= 1) continue;
        for (const gid of group) grouped.add(gid);

        const contestants = group.map((gid) => current.find((p) => p.id === gid)!);
        const winner = resolveContest(contestants, "loose_ball");
        events.push(
          `Contest for space: ${contestants.map((c) => c.player.name).join(" vs ")} — ${winner.player.name} wins`
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

    current = current.map((p) => ({ ...p, pos: intended.get(p.id)!, plannedSteps: [] }));

    // A pawn that's arrived at its current waypoint (within floating-point
    // tolerance — candidateHeadings clamps a tick's step to exactly close
    // the remaining distance once it's within reach) advances to the next
    // one for subsequent ticks. Only meaningful for explicitly-planned pawns
    // — man-mark/GK auto-targets are recomputed fresh every tick regardless
    // and never consume a "step."
    for (const p of current) {
      if (!hasExplicitPlan.has(p.id)) continue;
      const steps = plannedStepsById.get(p.id)!;
      const cursor = stepCursor.get(p.id)!;
      const target = steps[cursor];
      if (target && distance(p.pos, target) < 1e-6) {
        stepCursor.set(p.id, cursor + 1);
      }
    }

    if (flight) {
      const tickStart = pointAlongFlight(flight);
      const heightBeforeTick = heightAlongFlight(flight);
      flight.traveled = Math.min(flight.totalDist, flight.traveled + BALL_SPEED);
      const point = pointAlongFlight(flight);
      ballHeight = heightAlongFlight(flight);
      // checkCapture sweeps the WHOLE segment covered this tick, not just its
      // endpoint — so gating on the endpoint's height alone would wrongly
      // allow a capture on the tick a descending ball crosses the reach
      // threshold (high for most of the sweep, grounded only right at the
      // end). Using the higher of the tick's start/end height gates the
      // entire swept segment, not just where it lands.
      const captureGateHeight = Math.max(heightBeforeTick, ballHeight);
      const crossing = goalCrossing(tickStart, point);
      if (crossing) {
        const outcome = attemptSave(current, crossing.side, crossing.point, captureGateHeight);
        if (outcome.result === "goal") {
          ballPos = crossing.point;
          events.push(crossing.side === "home" ? "GOAL for the home side!" : "GOAL for the away side!");
          const frozen = current.map((p) => ({ ...p, plannedSteps: [], plannedKick: null }));
          snapshots.push({ pawns: frozen, ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
          return { snapshots, goal: crossing.side, deadBall: null };
        }
        // Saved or parried: the flight ends here either way. Capture the
        // flight's direction before nulling it (needed for the parry's
        // deflection angle).
        const flightDir = normalizeVec({ x: flight.to.x - flight.from.x, y: flight.to.y - flight.from.y });
        flight = null;
        if (outcome.result === "caught") {
          currentCarrierId = outcome.gk.id;
          lastControllingSide = outcome.gk.side;
          ballPos = { ...outcome.gk.pos };
          ballHeight = 0;
          events.push(`${outcome.gk.player.name} saves it and gathers the ball!`);
        } else {
          const kicked = rotateVec(flightDir, (Math.random() * 2 - 1) * DEFLECTION_ANGLE_SPREAD);
          roll = {
            pos: crossing.point,
            vx: kicked.x * DEFLECTION_SPEED,
            vy: kicked.y * DEFLECTION_SPEED,
            excludeId: outcome.gk.id,
            touchedBySide: outcome.gk.side,
          };
          ballPos = crossing.point;
          events.push(`${outcome.gk.player.name} parries it away — loose ball!`);
        }
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
        continue;
      }

      const boundary = boundaryCrossing(tickStart, point);
      if (boundary) {
        const deadBall = classifyDeadBall(boundary, flight.kickerSide);
        flight = null;
        currentCarrierId = null;
        ballPos = boundary.point;
        events.push(deadBallLabel(deadBall));
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
        return { snapshots, goal: null, deadBall };
      }

      const clampedPoint = clampBallToBounds(point);
      if (clampedPoint.x !== point.x || clampedPoint.y !== point.y) {
        // Missed everything and left the playable+apron area — stops right
        // at the boundary instead of sailing off somewhere unreachable.
        flight = null;
        currentCarrierId = null;
        ballPos = clampedPoint;
        events.push("The ball goes out of play");
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
        continue;
      }

      // Three height bands: grounded/reachable (normal capture), headable
      // (a new header contest), or still fully untouchable — captureGateHeight
      // already accounts for the whole tick's swept segment, not just where
      // it lands (see its own definition above).
      let outcome: CaptureOutcome = { receiver: null, interceptedBy: null, deflectedAt: null, deflectedBy: null, deflectedBySide: null, event: null };
      let header: HeaderOutcome | null = null;
      if (captureGateHeight <= BALL_REACH_HEIGHT) {
        outcome = checkCapture(flight, tickStart, point, current);
      } else if (captureGateHeight <= HEADER_REACH_HEIGHT) {
        header = checkHeader(flight, tickStart, point, current);
      }
      // Above HEADER_REACH_HEIGHT: both stay at their all-null defaults —
      // still fully untouchable, unchanged from before headers existed.

      ballPos = point;
      if (outcome.event) events.push(outcome.event);
      if (header?.event) events.push(header.event);

      if (outcome.receiver) {
        // Possession stays with the same side — play continues, the receiver
        // just becomes who the ball follows for the rest of the turn.
        flight = null;
        currentCarrierId = outcome.receiver.id;
        lastControllingSide = outcome.receiver.side;
      } else if (outcome.interceptedBy) {
        // Turnover: freeze everything else right here, mid-turn.
        flight = null;
        currentCarrierId = outcome.interceptedBy.id;
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
        break;
      } else if (outcome.deflectedAt) {
        // Contested but not cleanly won — the ball comes off this challenge
        // at a wide, unpredictable angle rather than settling with anyone.
        const dir = normalizeVec({ x: flight.to.x - flight.from.x, y: flight.to.y - flight.from.y });
        const kicked = rotateVec(dir, (Math.random() * 2 - 1) * DEFLECTION_ANGLE_SPREAD);
        const deflectorId = outcome.deflectedBy;
        flight = null;
        roll = {
          pos: outcome.deflectedAt,
          vx: kicked.x * DEFLECTION_SPEED,
          vy: kicked.y * DEFLECTION_SPEED,
          excludeId: deflectorId ?? undefined,
          touchedBySide: outcome.deflectedBySide!,
        };
        ballPos = outcome.deflectedAt;
      } else if (header?.winner && header.contactPoint) {
        // Clean header: a genuine NEW BallFlight, not a carrier handoff —
        // `flight` is reassigned (not nulled), so the NEXT tick's
        // `if (flight)` branch just continues resolving this new flight
        // exactly like any freshly kicked one, from traveled=0. Deliberately
        // no freeze/break here even when the winner's side differs from
        // lastControllingSide — the ball's still airborne, possession hasn't
        // settled with anyone the way a real interception settles it.
        // Whatever eventually receives/intercepts/saves THIS new flight gets
        // its own existing freeze semantics, unchanged.
        const target = pickHeaderTarget(header.winner, header.contactPoint, current);
        const started = startHeaderFlight(header.winner, header.contactPoint, target.point);
        flight = started.flight;
        ballPos = header.contactPoint;
        ballHeight = 0;
        lastControllingSide = header.winner.side;
        events.push(
          started.mishit
            ? `${header.winner.player.name} heads it, but it's off target`
            : `${header.winner.player.name} heads it ${target.label}`
        );
      } else if (header?.fluffed && header.contactPoint) {
        // Same shape as outcome.deflectedAt — ball squirts loose at a wide
        // random angle off the incoming flight's direction. No excludeId:
        // unlike a deflection there's no separate "deflector" pawn to
        // exclude from reclaiming it — the lone header-attempter IS who
        // fluffed it, and excluding them from a ball right at their own feet
        // would feel wrong.
        const dir = normalizeVec({ x: flight.to.x - flight.from.x, y: flight.to.y - flight.from.y });
        const kicked = rotateVec(dir, (Math.random() * 2 - 1) * DEFLECTION_ANGLE_SPREAD);
        flight = null;
        roll = {
          pos: header.contactPoint,
          vx: kicked.x * DEFLECTION_SPEED,
          vy: kicked.y * DEFLECTION_SPEED,
          touchedBySide: header.fluffedBySide!,
        };
        ballPos = header.contactPoint;
      } else if (flight.traveled >= flight.totalDist) {
        // Nobody there to meet it — the ball keeps a little energy and rolls
        // on rather than stopping dead exactly at the aim point.
        const dir = normalizeVec({ x: flight.to.x - flight.from.x, y: flight.to.y - flight.from.y });
        const kickerSide = flight.kickerSide;
        flight = null;
        currentCarrierId = null;
        roll = { pos: point, vx: dir.x * ROLL_START_SPEED, vy: dir.y * ROLL_START_SPEED, touchedBySide: kickerSide };
      }
    } else if (roll) {
      // A loose ball on the ground — always grounded, whether it just
      // bounced down off a lofted flight or came off a deflection/tackle.
      ballHeight = 0;
      const rollFrom = { ...roll.pos };
      roll.pos = { x: roll.pos.x + roll.vx, y: roll.pos.y + roll.vy };
      roll.vx *= ROLL_FRICTION;
      roll.vy *= ROLL_FRICTION;
      ballPos = roll.pos;

      const rollCrossing = goalCrossing(rollFrom, ballPos);
      if (rollCrossing) {
        // Purely geometric, same as the flight-branch hook above — a
        // deflected/scrappy ball drifting toward net gets exactly the same
        // save attempt a deliberate shot would, not a free pass.
        const outcome = attemptSave(current, rollCrossing.side, rollCrossing.point, 0);
        if (outcome.result === "goal") {
          events.push(rollCrossing.side === "home" ? "GOAL for the home side!" : "GOAL for the away side!");
          const frozen = current.map((p) => ({ ...p, plannedSteps: [], plannedKick: null }));
          snapshots.push({ pawns: frozen, ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
          return { snapshots, goal: rollCrossing.side, deadBall: null };
        }
        roll = null;
        if (outcome.result === "caught") {
          currentCarrierId = outcome.gk.id;
          lastControllingSide = outcome.gk.side;
          ballPos = { ...outcome.gk.pos };
          events.push(`${outcome.gk.player.name} gathers the loose ball off the line!`);
        } else {
          const angle = Math.random() * 2 * Math.PI;
          roll = {
            pos: rollCrossing.point,
            vx: Math.cos(angle) * DEFLECTION_SPEED,
            vy: Math.sin(angle) * DEFLECTION_SPEED,
            excludeId: outcome.gk.id,
            touchedBySide: outcome.gk.side,
          };
          ballPos = rollCrossing.point;
          events.push(`${outcome.gk.player.name} keeps it out — loose ball!`);
        }
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
        continue;
      }

      const rollBoundary = boundaryCrossing(rollFrom, ballPos);
      if (rollBoundary) {
        const deadBall = classifyDeadBall(rollBoundary, roll.touchedBySide);
        roll = null;
        currentCarrierId = null;
        ballPos = rollBoundary.point;
        events.push(deadBallLabel(deadBall));
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
        return { snapshots, goal: null, deadBall };
      }

      const clampedRollPos = clampBallToBounds(ballPos);
      if (clampedRollPos.x !== ballPos.x || clampedRollPos.y !== ballPos.y) {
        roll = null;
        currentCarrierId = null;
        ballPos = clampedRollPos;
        events.push("The ball goes out of play");
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
        continue;
      }

      const claimants = current.filter(
        (p) => p.id !== roll!.excludeId && distanceToSegment(p.pos, rollFrom, roll!.pos) <= CAPTURE_RADIUS
      );
      if (claimants.length > 0) {
        const winner = claimants.length === 1 ? claimants[0] : resolveContest(claimants, "loose_ball");
        const turnover = lastControllingSide !== null && winner.side !== lastControllingSide;
        roll = null;
        currentCarrierId = winner.id;
        ballPos = { ...winner.pos };
        lastControllingSide = winner.side;
        events.push(`${winner.player.name} gets to the loose ball`);
        if (turnover) {
          snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
          break;
        }
      } else if (Math.hypot(roll.vx, roll.vy) < ROLL_STOP_EPS) {
        roll = null;
        currentCarrierId = null;
      }
    } else if (currentCarrierId) {
      if (tackleCarrierId !== currentCarrierId) {
        tackleCarrierId = currentCarrierId;
        tackleAttempted.clear();
      }
      const holder = current.find((p) => p.id === currentCarrierId);
      if (holder) {
        ballPos = { ...holder.pos };
        ballHeight = 0;

        const holderFrom = preTickPos.get(holder.id)!;
        const dribbleBoundary = boundaryCrossing(holderFrom, holder.pos);
        if (dribbleBoundary) {
          const deadBall = classifyDeadBall(dribbleBoundary, holder.side);
          currentCarrierId = null;
          ballPos = dribbleBoundary.point;
          events.push(deadBallLabel(deadBall));
          snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
          return { snapshots, goal: null, deadBall };
        }

        // Tackling: a dribbling carrier can be challenged for the ball, not
        // just a kicked one. Without this, a carrier who never kicks is
        // completely undisputed — bumping into them during movement has no
        // effect on possession at all (movement collision and ball
        // possession are handled by entirely separate code). Same
        // decisive-vs-scrappy split as an interception: a commanding win is
        // a clean, instant takeover; a narrow one only knocks the ball loose
        // (reusing the exact same roll/deflection machinery as a mishit or
        // half-blocked shot).
        const challenger = current
          .filter((p) => p.side !== holder.side && !tackleAttempted.has(p.id))
          .map((p) => ({ p, d: distance(p.pos, holder.pos) }))
          .filter(({ d }) => d <= TACKLE_RADIUS)
          .sort((a, b) => a.d - b.d)[0]?.p;

        if (challenger) {
          const { winner, margin } = resolveContestDetailed([challenger, holder], "tackle");
          if (winner === challenger) {
            if (margin >= DECISIVE_CONTEST_MARGIN) {
              // Clean tackle: turnover, freeze everything else right here.
              currentCarrierId = challenger.id;
              lastControllingSide = challenger.side;
              ballPos = { ...challenger.pos };
              events.push(`Tackle: ${challenger.player.name} takes the ball off ${holder.player.name}`);
              snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
              break;
            }
            // Not decisive — the ball squirts loose rather than cleanly
            // changing hands. No "flight direction" to bias off here (unlike
            // a kick deflection), so the scatter direction is fully random.
            const angle = Math.random() * 2 * Math.PI;
            const dir = { x: Math.cos(angle), y: Math.sin(angle) };
            currentCarrierId = null;
            roll = {
              pos: { ...holder.pos },
              vx: dir.x * DEFLECTION_SPEED,
              vy: dir.y * DEFLECTION_SPEED,
              excludeId: challenger.id,
              touchedBySide: challenger.side,
            };
            ballPos = { ...holder.pos };
            events.push(`${challenger.player.name} half-tackles ${holder.player.name} — loose ball!`);
          } else {
            // Challenger lost — margin is holder's advantage, i.e. how badly
            // the tackle attempt went. Only a genuinely bad miss risks a
            // foul; a narrow, competent-but-unsuccessful challenge never
            // does. Aggressive stance nudges the chance up on top of its
            // existing tackle-contest bonus — a real risk/reward trade-off,
            // not a pure upside.
            if (margin >= DECISIVE_CONTEST_MARGIN) {
              let foulChance =
                FOUL_CHANCE_AT_THRESHOLD +
                (FOUL_CHANCE_MAX - FOUL_CHANCE_AT_THRESHOLD) *
                  Math.min(1, (margin - DECISIVE_CONTEST_MARGIN) / FOUL_CHANCE_MARGIN_RANGE);
              if (challenger.stance?.kind === "aggressive") foulChance += FOUL_AGGRESSIVE_BONUS;
              if (Math.random() < foulChance) {
                const deadBall = classifyFoul(holder, challenger);
                const sideName = deadBall.side === "home" ? "the home side" : "the away side";
                events.push(
                  deadBall.type === "penalty"
                    ? `Foul! ${challenger.player.name} brings down ${holder.player.name} in the box — penalty to ${sideName}!`
                    : `Foul! ${challenger.player.name} brings down ${holder.player.name} — free kick to ${sideName}`
                );
                snapshots.push({
                  pawns: current.map((p) => ({ ...p })),
                  ball: { ...holder.pos },
                  ballHeight,
                  events: takeNewEvents(),
                });
                return { snapshots, goal: null, deadBall };
              }
            }
            tackleAttempted.add(challenger.id);
          }
        }
      }
    } else {
      // The ball is sitting idle: never kicked this turn, no residual roll,
      // nobody currently carrying it. Without this check, a pawn that walks
      // onto a stationary ball mid-turn wouldn't actually gain control of it
      // until the FOLLOWING turn's start-of-turn carrier lookup — which
      // plays out as walking right through the ball and having it just sit
      // there. Mirrors the roll branch's claimant logic, but for a ball that
      // was never in motion this turn.
      const claimants = current.filter((p) => distance(p.pos, ballPos) <= CAPTURE_RADIUS);
      if (claimants.length > 0) {
        const winner = claimants.length === 1 ? claimants[0] : resolveContest(claimants, "loose_ball");
        const turnover = lastControllingSide !== null && winner.side !== lastControllingSide;
        currentCarrierId = winner.id;
        ballPos = { ...winner.pos };
        ballHeight = 0;
        lastControllingSide = winner.side;
        events.push(`${winner.player.name} picks up the ball`);
        if (turnover) {
          snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
          break;
        }
      }
    }

    // Reactive layer: anyone close enough to a ball that's still loose after
    // this tick's processing gets a one-time chance (gated by attributes) to
    // abandon their planned move and chase it down instead. This runs
    // whether the roll has existed for a while or was only just created this
    // same tick (a deflection, or an unopposed kick coming to rest) — either
    // way, a pawn already standing nearby should get to react to it.
    if (roll) {
      for (const p of current) {
        if (p.id === roll.excludeId || chasingIds.has(p.id) || reactionDecided.has(p.id)) continue;
        if (distance(p.pos, roll.pos) > REACT_RADIUS) continue;
        reactionDecided.add(p.id);
        if (attemptsReaction(p, "press_loose_ball")) {
          chasingIds.add(p.id);
          events.push(`${p.player.name} reacts to the loose ball`);
        }
      }
    }

    snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos }, ballHeight, events: takeNewEvents() });
  }

  // A dribbling carrier walking the ball into the goal mouth isn't checked
  // by either hook above (there's no goal check inside the currentCarrierId
  // tick branch) — only here, at the very end. Gated the same as the other
  // two, for the same "every path a goal can be scored through" reason.
  const finalGoalSide = goalScoredAt(ballPos);
  if (finalGoalSide) {
    const outcome = attemptSave(current, finalGoalSide, ballPos, ballHeight);
    const last = snapshots[snapshots.length - 1];
    if (outcome.result === "goal") {
      events.push(finalGoalSide === "home" ? "GOAL for the home side!" : "GOAL for the away side!");
      if (last) last.events.push(...takeNewEvents());
      return { snapshots, goal: finalGoalSide, deadBall: null };
    }
    events.push(`${outcome.gk.player.name} denies it right on the line!`);
    if (last) last.events.push(...takeNewEvents());
    return { snapshots, goal: null, deadBall: null };
  }

  return { snapshots, goal: null, deadBall: null };
}
