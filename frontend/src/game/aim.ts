import type { Vec2 } from "./types";

/**
 * How far a kick actually lands from where it was aimed isn't all-or-nothing
 * — it's a spread: tighter for a skilled passer and a short ball, wider for
 * a long one, and biased toward the center rather than uniform (a "mortar"
 * reticle, where most kicks land close to the aim point and a few land
 * meaningfully off). This is the math an eventual aim-cone UI would
 * visualize; for now it's just what every kick's landing point runs through.
 */

// Tuned so a short pass (distance ~3) lands reliably inside CAPTURE_RADIUS
// while a near-max-range shot (distance ~20, close to KICK_RANGE) scatters
// well beyond it. Re-derived alongside the interaction-radii tuning pass
// that shrank CAPTURE_RADIUS/KICK_RANGE back down to a tighter, more
// personal-space-sized scale — these track that same scale, not the raw
// pitch dimensions.
const BASE_SPREAD = 0.12;
const DISTANCE_SPREAD_FACTOR = 0.095;
// A cross is a genuinely harder ball to place than a short pass — this
// factor (roughly double the normal one) replaces DISTANCE_SPREAD_FACTOR
// when isCross. BASE_SPREAD/SKILL_SPREAD_FACTOR stay shared, which is what
// makes a SHORT cross land almost like a lobbed pass (both formulas
// converge as distance -> 0) while a long one scatters much more than a
// pass/shot would at the same distance — the steeper factor only starts to
// dominate once there's real distance for it to multiply.
const CROSS_DISTANCE_SPREAD_FACTOR = 0.19;
const SKILL_SPREAD_FACTOR = 0.03;
const MIN_SIGMA = 0.08;
// Skill value treated as "average" — passers above it tighten the spread,
// passers below it widen it. Matches the ~50-70 band the seeded players
// currently use as a mid-table skill level.
const REFERENCE_SKILL = 50;

/** Standard deviation of the landing offset for a kick of this distance struck by a player of this skill. `isCross` swaps in the steeper CROSS_DISTANCE_SPREAD_FACTOR — see its own comment for why. */
export function landingSpread(distance: number, skill: number, isCross = false): number {
  const distanceFactor = isCross ? CROSS_DISTANCE_SPREAD_FACTOR : DISTANCE_SPREAD_FACTOR;
  const raw = BASE_SPREAD + distance * distanceFactor - (skill - REFERENCE_SKILL) * SKILL_SPREAD_FACTOR;
  return Math.max(MIN_SIGMA, raw);
}

/** Standard normal via Box-Muller — gives a center-biased landing offset instead of a uniform one. */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface LandingResult {
  point: Vec2;
  /** How far the actual landing point ended up from the aimed point. */
  missBy: number;
  /** The spread that produced this landing — lets callers judge "worse than typical" without recomputing the formula. */
  sigma: number;
}

/** Samples where a kick aimed at `aim` (struck from `origin`, `distance` units away, by a player of `skill`) actually lands. */
export function sampleLanding(aim: Vec2, distance: number, skill: number, isCross = false): LandingResult {
  const sigma = landingSpread(distance, skill, isCross);
  const dx = gaussian() * sigma;
  const dy = gaussian() * sigma;
  return {
    point: { x: aim.x + dx, y: aim.y + dy },
    missBy: Math.hypot(dx, dy),
    sigma,
  };
}

/** A plain-language risk qualifier for a kick's aim spread — the same sigma the aim-ring is sized from. Moved here from the now-deleted kickIntent.ts, which owned it only because it lived next to the other aim-ring label logic; it's really just a derivative of landingSpread's own output. */
export function riskLabel(sigma: number): string {
  if (sigma < 0.6) return "Safe";
  if (sigma < 1.4) return "Risky";
  return "Very risky";
}
