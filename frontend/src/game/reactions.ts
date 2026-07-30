import type { Pawn } from "./types";

/**
 * Whether a pawn, gated by attributes, actually notices and reacts to a
 * triggering situation during resolution — a ball suddenly loose nearby —
 * rather than blindly continuing on whatever course was planned before the
 * turn started. This is not a contest (nobody else is involved), just an
 * attribute-scaled chance, but it's structured the same way as contest.ts's
 * weight tables so a new reactive trigger (an aerial ball demanding a
 * header, a defender stepping out to press) is another table entry, not a
 * new mechanism.
 */
export type ReactionKind = "press_loose_ball";

interface ReactionWeights {
  skill: number;
  pace: number;
  stamina: number;
}

const REACTION_WEIGHTS: Record<ReactionKind, ReactionWeights> = {
  // Reading that the ball's suddenly up for grabs is mostly about
  // awareness/anticipation, with a little pace mixed in for "alert enough to
  // actually get moving," not just "would eventually notice."
  press_loose_ball: { skill: 0.8, pace: 0.2, stamina: 0 },
};

const BASE_CHANCE = 0.25;
const REFERENCE_ATTRIBUTE = 50; // treated as "average" for this weighted sum
const CHANCE_PER_POINT = 0.012;

export function reactionChance(pawn: Pawn, kind: ReactionKind): number {
  const w = REACTION_WEIGHTS[kind];
  const { skill, pace, stamina } = pawn.player;
  const weighted = skill * w.skill + pace * w.pace + stamina * w.stamina;
  const chance = BASE_CHANCE + (weighted - REFERENCE_ATTRIBUTE) * CHANCE_PER_POINT;
  return Math.max(0.05, Math.min(0.95, chance));
}

/** Rolls once against reactionChance — call this only when a trigger condition is first met, not every tick, so a pawn's reaction doesn't flicker on and off. */
export function attemptsReaction(pawn: Pawn, kind: ReactionKind): boolean {
  return Math.random() < reactionChance(pawn, kind);
}
