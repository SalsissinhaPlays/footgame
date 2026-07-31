import {
  STANCE_AGGRESSIVE_PACE_FACTOR,
  STANCE_COVER_PASSING_SKILL_FACTOR,
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
export type ContestKind = "loose_ball" | "interception" | "tackle";

interface AttributeWeights {
  skill: number;
  pace: number;
  stamina: number;
}

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
  if (stance.kind === "aggressive" && kind === "tackle") {
    return pawn.player.pace * STANCE_AGGRESSIVE_PACE_FACTOR;
  }
  if (stance.kind === "cover_passing" && kind === "interception") {
    return pawn.player.skill * STANCE_COVER_PASSING_SKILL_FACTOR;
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

function rollFor(pawn: Pawn, kind: ContestKind, against: Pawn | null): number {
  const w = WEIGHTS[kind];
  const { skill, pace, stamina } = pawn.player;
  return (
    skill * w.skill +
    pace * w.pace +
    stamina * w.stamina +
    stanceBonus(pawn, against, kind) +
    (Math.random() * RANDOM_SPREAD - RANDOM_SPREAD / 2)
  );
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
