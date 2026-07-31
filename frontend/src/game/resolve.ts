import {
  BALL_SPEED,
  CAPTURE_RADIUS,
  DECISIVE_CONTEST_MARGIN,
  DEFLECTION_ANGLE_SPREAD,
  DEFLECTION_SPEED,
  GOAL_ROW_MAX,
  GOAL_ROW_MIN,
  GRID_COLS,
  GRID_ROWS,
  KICK_RANGE,
  MOVE_RANGE,
  OOB_CELLS,
  PAWN_COLLISION_RADIUS,
  PAWN_SPEED_PER_TICK,
  REACT_RADIUS,
  ROLL_FRICTION,
  ROLL_START_SPEED,
  ROLL_STOP_EPS,
} from "./constants";
import { sampleLanding } from "./aim";
import { resolveContest, resolveContestDetailed } from "./contest";
import { attemptsReaction } from "./reactions";
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
 * just the tick's end position. A fast roll or deflection can jump from
 * well before the line to well past it — including past the goal-row band
 * entirely — within a single tick; sampling only the endpoint (as a plain
 * goalScoredAt(to) would) can miss the exact moment the ball was actually
 * within the goal mouth, the same tunneling problem already solved for
 * ball-vs-pawn interception via segment checks.
 */
export function goalCrossedAlong(from: Vec2, to: Vec2): Side | null {
  if (from.x >= 0 && to.x < 0) {
    const t = from.x / (from.x - to.x);
    if (isInGoalRows(from.y + (to.y - from.y) * t)) return "away";
  }
  if (from.x < GRID_COLS && to.x >= GRID_COLS) {
    const t = (GRID_COLS - from.x) / (to.x - from.x);
    if (isInGoalRows(from.y + (to.y - from.y) * t)) return "home";
  }
  return goalScoredAt(to);
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
 * directly toward the destination at up to PAWN_SPEED_PER_TICK (clamped so a
 * pawn doesn't overshoot when already close), then trying increasing angular
 * deviations off that ideal direction to skirt an obstacle. Lets a pawn
 * route around a stationary blocker instead of being stuck the instant the
 * straight line to its target is occupied.
 */
function candidateHeadings(pos: Vec2, dest: Vec2): Vec2[] {
  const toDest = { x: dest.x - pos.x, y: dest.y - pos.y };
  const remaining = Math.hypot(toDest.x, toDest.y);
  if (remaining < 1e-6) return [{ ...pos }];

  const dir = normalizeVec(toDest);
  const step = Math.min(PAWN_SPEED_PER_TICK, remaining);
  return SIDESTEP_ANGLES_DEG.map((deg) => {
    const rotated = rotateVec(dir, (deg * Math.PI) / 180);
    return { x: pos.x + rotated.x * step, y: pos.y + rotated.y * step };
  });
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

function distance(a: Vec2, b: Vec2): number {
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
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
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
}

interface FlightStart {
  flight: BallFlight;
  /** Set when the kick landed noticeably off its aim point — worth a distinct event message. */
  mishit: boolean;
}

function startFlight(carrier: Pawn, rawTarget: Vec2): FlightStart {
  const dist = Math.max(Math.abs(rawTarget.x - carrier.pos.x), Math.abs(rawTarget.y - carrier.pos.y));
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
  return {
    flight: {
      kickerId: carrier.id,
      kickerSide: carrier.side,
      from: { ...carrier.pos },
      to: landing.point,
      totalDist: Math.max(distance(carrier.pos, landing.point), 1e-6),
      traveled: 0,
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

interface CaptureOutcome {
  receiver: Pawn | null;
  interceptedBy: Pawn | null;
  /** A challenge was contested and won, but not decisively — the ball squirts loose from this point rather than settling with anyone. */
  deflectedAt: Vec2 | null;
  /** Who caused the deflection — excluded from immediately reclaiming their own loose touch. */
  deflectedBy: string | null;
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
  const nearby = pawns
    .filter((p) => p.id !== flight.kickerId && !flight.contested.has(p.id))
    .map((p) => ({ p, d: distanceToSegment(p.pos, from, to) }))
    .filter(({ d }) => d <= CAPTURE_RADIUS)
    .sort((a, b) => a.d - b.d);

  for (const { p } of nearby) {
    if (p.side === flight.kickerSide) {
      return {
        receiver: p,
        interceptedBy: null,
        deflectedAt: null,
        deflectedBy: null,
        event: `Passe: ${kicker.player.name} encontra ${p.player.name}`,
      };
    }
    const { winner, margin } = resolveContestDetailed([p, kicker], "interception");
    if (winner === p) {
      if (margin >= DECISIVE_CONTEST_MARGIN) {
        return {
          receiver: null,
          interceptedBy: p,
          deflectedAt: null,
          deflectedBy: null,
          event: `Interceptação: ${p.player.name} corta o chute de ${kicker.player.name}`,
        };
      }
      return {
        receiver: null,
        interceptedBy: null,
        deflectedAt: closestPointOnSegment(p.pos, from, to),
        deflectedBy: p.id,
        event: `${p.player.name} desvia o chute de ${kicker.player.name} — bola solta!`,
      };
    }
    flight.contested.add(p.id);
  }
  return { receiver: null, interceptedBy: null, deflectedAt: null, deflectedBy: null, event: null };
}

/**
 * Resolves one full turn tick by tick. Invariant that must never break: no
 * two pawns may ever be closer than PAWN_COLLISION_RADIUS in any snapshot.
 * Pawns move continuously (any direction, real distance per tick) rather
 * than stepping cell-to-cell, so this is a proximity guarantee, not an
 * exact-cell one. Collisions are settled with a skill check; losers are
 * stopped for the rest of the turn.
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
  let current: Pawn[] = pawns.map((p) => ({ ...p }));
  const snapshots: ResolveSnapshot[] = [];

  // Whoever starts the turn within capture range of the ball carries it. If
  // nobody is there, the ball just sits still until someone reaches it.
  const carrier = current.find((p) => distance(p.pos, ball.pos) <= CAPTURE_RADIUS) ?? null;
  let ballPos: Vec2 = { ...ball.pos };
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
        ? `${carrier.player.name} chuta, mas a bola sai imprecisa`
        : `${carrier.player.name} chuta a bola`
    );
    // The kicker releases the ball and stays put; nobody else's plan changes.
    current = current.map((p) =>
      p.id === carrier.id ? { ...p, plannedPos: null, plannedKick: null } : p
    );
    currentCarrierId = null;
  }

  // Each pawn's final destination for the turn; movement advances up to
  // PAWN_SPEED_PER_TICK real distance toward it each tick, so a pawn blocked
  // mid-way keeps whatever progress it already made instead of losing the
  // whole turn. Reacting to a loose ball (below) overrides a pawn's entry
  // here instead of needing its own movement path — it goes through the
  // exact same candidateHeadings/collision machinery as any planned move.
  const destinations = new Map(current.map((p) => [p.id, p.plannedPos ?? p.pos]));
  const stopped = new Set<string>();
  // Pawns who've committed to chasing a loose ball instead of their planned
  // move, and pawns who've already had their one-time chance to react (so a
  // pawn that chose to ignore a loose ball isn't re-asked every tick it
  // stays nearby — a flicker-free decision, not a live re-evaluation).
  const chasingIds = new Set<string>();
  const reactionDecided = new Set<string>();

  for (let tick = 0; tick < MOVE_RANGE; tick++) {
    // Chasers re-aim at the ball's last known position before this tick's
    // movement resolves — one tick of "reaction time" behind where it
    // actually is, same as a human noticing and then moving.
    for (const id of chasingIds) {
      destinations.set(id, { ...ballPos });
    }

    const preTickPos = new Map(current.map((p) => [p.id, p.pos]));
    // Recomputed fresh every tick, since a blocker from an earlier tick may
    // have since moved out of the way.
    const candidates = new Map(
      current.map((p) => [p.id, candidateHeadings(p.pos, destinations.get(p.id)!)])
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
        let blocker = stationaryBlockerAt(intended.get(p.id)!, p.id);
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
        if (!isMoving(p.id) || stopped.has(p.id)) continue;
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
            distance(preTickPos.get(o.id)!, dest) <= PAWN_COLLISION_RADIUS &&
            distance(intended.get(o.id)!, preTickPos.get(p.id)!) <= PAWN_COLLISION_RADIUS
        );
        if (!occupant) continue;

        const winner = resolveContest([p, occupant], "loose_ball");
        const loser = winner.id === p.id ? occupant : p;
        events.push(
          `Choque ao cruzar: ${p.player.name} vs ${occupant.player.name} — vence ${winner.player.name}`
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
      const movingIds = current.filter((p) => isMoving(p.id)).map((p) => p.id);
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
          `Disputa por espaço: ${contestants.map((c) => c.player.name).join(" vs ")} — vence ${winner.player.name}`
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

    if (flight) {
      const tickStart = pointAlongFlight(flight);
      flight.traveled = Math.min(flight.totalDist, flight.traveled + BALL_SPEED);
      const point = pointAlongFlight(flight);
      const goal = goalCrossedAlong(tickStart, point);
      if (goal) {
        ballPos = point;
        events.push(goal === "home" ? "GOL do time da casa!" : "GOL do time visitante!");
        const frozen = current.map((p) => ({ ...p, plannedPos: null, plannedKick: null }));
        snapshots.push({ pawns: frozen, ball: { ...ballPos } });
        return { snapshots, events, goal };
      }

      const clampedPoint = clampBallToBounds(point);
      if (clampedPoint.x !== point.x || clampedPoint.y !== point.y) {
        // Missed everything and left the playable+apron area — stops right
        // at the boundary instead of sailing off somewhere unreachable.
        flight = null;
        currentCarrierId = null;
        ballPos = clampedPoint;
        events.push("A bola sai de campo");
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos } });
        continue;
      }

      const outcome = checkCapture(flight, tickStart, point, current);
      ballPos = point;
      if (outcome.event) events.push(outcome.event);

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
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos } });
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
        };
        ballPos = outcome.deflectedAt;
      } else if (flight.traveled >= flight.totalDist) {
        // Nobody there to meet it — the ball keeps a little energy and rolls
        // on rather than stopping dead exactly at the aim point.
        const dir = normalizeVec({ x: flight.to.x - flight.from.x, y: flight.to.y - flight.from.y });
        flight = null;
        currentCarrierId = null;
        roll = { pos: point, vx: dir.x * ROLL_START_SPEED, vy: dir.y * ROLL_START_SPEED };
      }
    } else if (roll) {
      const rollFrom = { ...roll.pos };
      roll.pos = { x: roll.pos.x + roll.vx, y: roll.pos.y + roll.vy };
      roll.vx *= ROLL_FRICTION;
      roll.vy *= ROLL_FRICTION;
      ballPos = roll.pos;

      const rollGoal = goalCrossedAlong(rollFrom, ballPos);
      if (rollGoal) {
        events.push(rollGoal === "home" ? "GOL do time da casa!" : "GOL do time visitante!");
        const frozen = current.map((p) => ({ ...p, plannedPos: null, plannedKick: null }));
        snapshots.push({ pawns: frozen, ball: { ...ballPos } });
        return { snapshots, events, goal: rollGoal };
      }

      const clampedRollPos = clampBallToBounds(ballPos);
      if (clampedRollPos.x !== ballPos.x || clampedRollPos.y !== ballPos.y) {
        roll = null;
        currentCarrierId = null;
        ballPos = clampedRollPos;
        events.push("A bola sai de campo");
        snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos } });
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
        events.push(`${winner.player.name} fica com a bola solta`);
        if (turnover) {
          snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos } });
          break;
        }
      } else if (Math.hypot(roll.vx, roll.vy) < ROLL_STOP_EPS) {
        roll = null;
        currentCarrierId = null;
      }
    } else if (currentCarrierId) {
      const holder = current.find((p) => p.id === currentCarrierId);
      if (holder) ballPos = { ...holder.pos };
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
          events.push(`${p.player.name} reage à bola solta`);
        }
      }
    }

    snapshots.push({ pawns: current.map((p) => ({ ...p })), ball: { ...ballPos } });
  }

  const goal = goalScoredAt(ballPos);
  if (goal) {
    events.push(goal === "home" ? "GOL do time da casa!" : "GOL do time visitante!");
  }

  return { snapshots, events, goal };
}
