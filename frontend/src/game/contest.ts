import {
  GK_MIN_REACH_FACTOR,
  GK_REACH_FALLOFF_RANGE,
  GK_STRETCH_RANGE_BASE,
  GK_STRETCH_RANGE_PER_JUMPING,
  HARD_TACKLE_PACE_FACTOR,
  STANCE_COVER_PASSING_SKILL_FACTOR,
  STANCE_EXPECTING_HEADER_JUMPING_FACTOR,
  STANCE_MAN_MARK_PACE_FACTOR,
  STANCE_MAN_MARK_SKILL_FACTOR,
} from "./constants";
import type { Pawn } from "./types";

/**
 * Every skill-check in the resolution engine funnels through this module.
 * Different situations should lean on different attributes — a physical
 * jostle for a loose ball rewards pace more than a technical read of a
 * passing lane does — so each kind of contest gets its own attribute
 * weighting instead of one flat formula. Adding a new attribute (passing,
 * tackling, positioning, ...) or a new kind of contest (a tackle, an aerial
 * duel, a shot vs. a goalkeeper) means adding a table entry here, not
 * touching the resolution loop that calls into this.
 */
export type ContestKind = "loose_ball" | "interception" | "tackle" | "gk_claim" | "save" | "header";

// A partial map rather than a fixed {skill,pace,stamina} interface — the
// growing attribute surface (jumping/shot_stopping/reflexes added for the
// goalkeeper) means different contest kinds legitimately care about
// different subsets of attributes, not just different weights on the same
// fixed three.
type ContestAttribute = "skill" | "pace" | "stamina" | "jumping" | "shot_stopping" | "reflexes";
type AttributeWeights = Partial<Record<ContestAttribute, number>>;

const WEIGHTS: Record<ContestKind, AttributeWeights> = {
  // Two pawns physically racing/jostling for the same cell or a loose ball:
  // quickness and sharpness matter more here than the ball-playing technique
  // "skill" otherwise represents.
  loose_ball: { skill: 0.35, pace: 0.45, stamina: 0.2 },
  // Reading and cutting out a pass: anticipation/technique dominates; pace
  // only helps a defender close the distance in time, it doesn't replace
  // being switched on.
  interception: { skill: 0.65, pace: 0.25, stamina: 0.1 },
  // Challenging a dribbling carrier for the ball: still mostly a technical
  // read (timing the tackle without missing it), but closing speed matters
  // more here than it does for reading a pass, since the carrier is
  // actively moving away/around the challenger.
  tackle: { skill: 0.6, pace: 0.3, stamina: 0.1 },
  // A goalkeeper proactively coming out to claim an incoming cross/pass
  // (gk_aggressive stance only, see checkCapture in resolve.ts) — reading
  // the flight and getting across it, with pace to actually close the
  // ground before it arrives.
  gk_claim: { shot_stopping: 0.3, reflexes: 0.3, skill: 0.25, pace: 0.15 },
  // Stopping a shot that's already threatening goal — shot_stopping
  // dominates, reflexes a real but smaller factor, skill (positioning/
  // game-reading) a minor one. No jumping entry here — see reachFactor
  // below for why.
  save: { shot_stopping: 0.55, reflexes: 0.3, skill: 0.15 },
  // Winning the physical duel for a header: jumping dominates (getting up
  // to and controlling the ball in the air), skill a real secondary factor
  // (timing/technique), pace a light one (getting to the spot at all).
  // Same shape as tackle's weights (dominant + secondary + light tertiary,
  // summing to 1.0). Note `heading` (redirect precision once a header is
  // won) deliberately has no entry here — it governs aim.ts's landing
  // spread for the redirect, not who wins the contest.
  header: { jumping: 0.5, skill: 0.3, pace: 0.2 },
};

const RANDOM_SPREAD = 30; // roll gets +/- half of this, i.e. +/-15

/**
 * Small additive edge from a pawn's standing stance (see types.ts's Stance),
 * on top of the base attribute-weighted roll above. `against` is the other
 * contestant in a head-to-head roll (tackle/interception are always 2-way in
 * practice) — man-marking only pays off against the specific pawn it's
 * targeting, not generically. Every term is a factor times a real attribute
 * rather than a flat number, so these automatically track whatever new
 * attributes get added later instead of needing a redesign.
 */
function stanceBonus(pawn: Pawn, against: Pawn | null, kind: ContestKind): number {
  const stance = pawn.stance;
  if (!stance) return 0;
  if (stance.kind === "cover_passing" && kind === "interception") {
    return pawn.player.skill * STANCE_COVER_PASSING_SKILL_FACTOR;
  }
  if (stance.kind === "expecting_header" && kind === "header") {
    return pawn.player.jumping * STANCE_EXPECTING_HEADER_JUMPING_FACTOR;
  }
  if (
    stance.kind === "man_mark" &&
    against &&
    stance.targetId === against.id &&
    (kind === "tackle" || kind === "interception")
  ) {
    return pawn.player.skill * STANCE_MAN_MARK_SKILL_FACTOR + pawn.player.pace * STANCE_MAN_MARK_PACE_FACTOR;
  }
  return 0;
}

/**
 * Hard tackle's contest bonus — kept separate from stanceBonus rather than
 * folded into it, since Pawn.plannedTackle and Pawn.stance are independent
 * fields now (unlike the old outfield "aggressive" stance this replaces,
 * which WAS a stance). A pawn can be man-marking a specific opponent AND
 * declaring a Hard tackle on them in the same turn — both bonuses need to
 * apply together, which folding this into stanceBonus's early-return chain
 * would silently break.
 */
function tackleTypeBonus(pawn: Pawn, kind: ContestKind): number {
  if (kind !== "tackle" || pawn.plannedTackle?.kind !== "hard") return 0;
  return pawn.player.pace * HARD_TACKLE_PACE_FACTOR;
}

function rollFor(pawn: Pawn, kind: ContestKind, against: Pawn | null): number {
  const w = WEIGHTS[kind];
  let base = 0;
  for (const attr of Object.keys(w) as ContestAttribute[]) {
    base += pawn.player[attr] * (w[attr] ?? 0);
  }
  return (
    base +
    stanceBonus(pawn, against, kind) +
    tackleTypeBonus(pawn, kind) +
    (Math.random() * RANDOM_SPREAD - RANDOM_SPREAD / 2)
  );
}

/**
 * How much of a keeper's shot_stopping/reflexes potential is usable for THIS
 * save attempt, based on how far the threat point is from a comfortable,
 * central position. jumping is deliberately NOT a WEIGHTS.save entry above —
 * an additive term scaling with distance would let a maxed-jumping keeper
 * dominate every roll regardless of distance. Instead jumping only extends
 * the full-effectiveness range outward; beyond that, effectiveness falls off
 * linearly to a floor rather than to 0 — even a near-impossible stretch
 * keeps a sliver of a chance.
 */
function reachFactor(gk: Pawn, effectiveDistance: number): number {
  const stretchRange = GK_STRETCH_RANGE_BASE + gk.player.jumping * GK_STRETCH_RANGE_PER_JUMPING;
  if (effectiveDistance <= stretchRange) return 1;
  const over = effectiveDistance - stretchRange;
  return Math.max(GK_MIN_REACH_FACTOR, 1 - over / GK_REACH_FALLOFF_RANGE);
}

/**
 * A "save" roll gated by reachFactor — scales only shot_stopping/reflexes
 * (the attributes that represent actually reaching the ball), not the
 * pawn's whole attribute set, since skill isn't a "reach" attribute.
 */
export function rollSaveAttempt(gk: Pawn, effectiveDistance: number): number {
  const factor = reachFactor(gk, effectiveDistance);
  const scaled: Pawn = {
    ...gk,
    player: {
      ...gk.player,
      shot_stopping: gk.player.shot_stopping * factor,
      reflexes: gk.player.reflexes * factor,
    },
  };
  return rollFor(scaled, "save", null);
}

/**
 * Raw header roll for a single unopposed pawn — compared against
 * HEADER_DIFFICULTY_THRESHOLD by resolve.ts's checkHeader, not against
 * another contestant's roll. A 1-contestant resolveContestDetailed call
 * would give a margin of 0 (runner-up falls back to the same roll), which
 * isn't what an uncontested header needs — it needs the raw value.
 */
export function rollHeaderAttempt(pawn: Pawn): number {
  return rollFor(pawn, "header", null);
}

export interface ContestOutcome {
  winner: Pawn;
  /** Winner's roll minus the runner-up's — how decisive the win was, not just who won. A callsite can use this to tell a commanding win apart from one that only just barely got there (e.g. a clean interception vs. a defender getting a faint touch that merely deflects the ball). */
  margin: number;
}

/** Highest roll wins a multi-way contest (a group of pawns converging on the same cell, or several pawns near a loose ball). */
export function resolveContestDetailed(contestants: Pawn[], kind: ContestKind): ContestOutcome {
  // Only a genuine 1-on-1 has a well-defined "the pawn I'm up against" for
  // man-marking to key off; group contests (3+ pawns converging on a loose
  // ball) get no stance bonus from this — rollFor just treats `against` as
  // null for them.
  const against = contestants.length === 2 ? contestants : null;
  const rolls = contestants
    .map((pawn) => ({
      pawn,
      roll: rollFor(pawn, kind, against ? against.find((p) => p !== pawn)! : null),
    }))
    .sort((a, b) => b.roll - a.roll);
  const runnerUpRoll = rolls.length > 1 ? rolls[1].roll : rolls[0].roll;
  return { winner: rolls[0].pawn, margin: rolls[0].roll - runnerUpRoll };
}

export function resolveContest(contestants: Pawn[], kind: ContestKind): Pawn {
  return resolveContestDetailed(contestants, kind).winner;
}

/** Head-to-head convenience: does `a` beat `b` in this kind of contest? */
export function wins(a: Pawn, b: Pawn, kind: ContestKind): boolean {
  return resolveContest([a, b], kind) === a;
}
