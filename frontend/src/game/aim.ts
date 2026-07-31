import type { Vec2 } from "./types";

/**
 * How far a kick actually lands from where it was aimed isn't all-or-nothing
 * — it's a spread: tighter for a skilled passer and a short ball, wider for
 * a long one, and biased toward the center rather than uniform (a "mortar"
 * reticle, where most kicks land close to the aim point and a few land
 * meaningfully off). This is the math an eventual aim-cone UI would
 * visualize; for now it's just what every kick's landing point runs through.
 */

// Tuned so a short pass (distance ~5) lands reliably inside CAPTURE_RADIUS
// while a near-max-range shot (distance ~35) scatters well beyond it — the
// dynamic range that felt flat on the old 16x12 pitch, where BASE_SPREAD
// dominated the formula regardless of distance.
const BASE_SPREAD = 0.3;
const DISTANCE_SPREAD_FACTOR = 0.12;
const SKILL_SPREAD_FACTOR = 0.08;
const MIN_SIGMA = 0.2;
// Skill value treated as "average" — passers above it tighten the spread,
// passers below it widen it. Matches the ~50-70 band the seeded players
// currently use as a mid-table skill level.
const REFERENCE_SKILL = 50;

/** Standard deviation of the landing offset for a kick of this distance struck by a player of this skill. */
export function landingSpread(distance: number, skill: number): number {
  const raw =
    BASE_SPREAD + distance * DISTANCE_SPREAD_FACTOR - (skill - REFERENCE_SKILL) * SKILL_SPREAD_FACTOR;
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
export function sampleLanding(aim: Vec2, distance: number, skill: number): LandingResult {
  const sigma = landingSpread(distance, skill);
  const dx = gaussian() * sigma;
  const dy = gaussian() * sigma;
  return {
    point: { x: aim.x + dx, y: aim.y + dy },
    missBy: Math.hypot(dx, dy),
    sigma,
  };
}
