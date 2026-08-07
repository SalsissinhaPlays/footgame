/**
 * Generates a manager: a name, a named "style" archetype, and a full
 * tactical profile (the same 9 fields team_tactics/TacticalProfile already
 * use) randomized within that archetype's band. Pure content generation —
 * no DB access here, index.ts's POST /api/saves and the season-rollover
 * firing logic are what actually insert/assign these.
 */

import { FIRST_NAMES, LAST_NAMES } from "./starterLeague.js";

export const TACTIC_FIELDS = [
  "defensive_line_depth_frac",
  "pressing_trigger_distance_mult",
  "marking_coverage_frac",
  "attacking_commitment_frac",
  "supporting_run_depth_mult",
  "shooting_range_mult",
  "pass_risk_tolerance",
  "cross_bias",
  "sprint_aggressiveness",
] as const;

export type TacticField = (typeof TACTIC_FIELDS)[number];
export type TacticFields = Record<TacticField, number>;

export interface GeneratedManager {
  name: string;
  style: string;
  tactics: TacticFields;
}

// Matches TeamTactics.tsx's own slider ranges exactly — a generated value
// outside these would just be an unreachable slider position in the UI.
const BOUNDS: Record<TacticField, [number, number]> = {
  defensive_line_depth_frac: [0, 1],
  pressing_trigger_distance_mult: [0.5, 1.5],
  marking_coverage_frac: [0, 1],
  attacking_commitment_frac: [0, 1],
  supporting_run_depth_mult: [0, 0.6],
  shooting_range_mult: [0.5, 1.5],
  pass_risk_tolerance: [0, 1],
  cross_bias: [0, 1],
  sprint_aggressiveness: [0, 1],
};

/**
 * A handful of named, recognizable identities rather than 9 independent
 * random numbers per manager — real tactical personalities are coherent
 * bundles (a high-press team is ALSO usually a high defensive line), not
 * arbitrary combinations. Each field still gets a small jitter (see
 * generateManager) so two "High Press" managers aren't byte-identical.
 */
const ARCHETYPES: { style: string; base: TacticFields }[] = [
  {
    style: "Balanced",
    base: {
      defensive_line_depth_frac: 0.4,
      pressing_trigger_distance_mult: 1.0,
      marking_coverage_frac: 0.5,
      attacking_commitment_frac: 0.5,
      supporting_run_depth_mult: 0.25,
      shooting_range_mult: 1.0,
      pass_risk_tolerance: 0.5,
      cross_bias: 0.4,
      sprint_aggressiveness: 0.5,
    },
  },
  {
    style: "High Press",
    base: {
      defensive_line_depth_frac: 0.75,
      pressing_trigger_distance_mult: 1.35,
      marking_coverage_frac: 0.75,
      attacking_commitment_frac: 0.6,
      supporting_run_depth_mult: 0.4,
      shooting_range_mult: 1.0,
      pass_risk_tolerance: 0.55,
      cross_bias: 0.4,
      sprint_aggressiveness: 0.75,
    },
  },
  {
    style: "Park the Bus",
    base: {
      defensive_line_depth_frac: 0.15,
      pressing_trigger_distance_mult: 0.55,
      marking_coverage_frac: 0.3,
      attacking_commitment_frac: 0.25,
      supporting_run_depth_mult: 0.1,
      shooting_range_mult: 0.7,
      pass_risk_tolerance: 0.25,
      cross_bias: 0.3,
      sprint_aggressiveness: 0.35,
    },
  },
  {
    style: "Counter-Attack",
    base: {
      defensive_line_depth_frac: 0.3,
      pressing_trigger_distance_mult: 0.65,
      marking_coverage_frac: 0.4,
      attacking_commitment_frac: 0.35,
      supporting_run_depth_mult: 0.2,
      shooting_range_mult: 1.3,
      pass_risk_tolerance: 0.4,
      cross_bias: 0.35,
      sprint_aggressiveness: 0.95,
    },
  },
  {
    style: "Wing Play",
    base: {
      defensive_line_depth_frac: 0.45,
      pressing_trigger_distance_mult: 1.0,
      marking_coverage_frac: 0.45,
      attacking_commitment_frac: 0.55,
      supporting_run_depth_mult: 0.35,
      shooting_range_mult: 0.9,
      pass_risk_tolerance: 0.5,
      cross_bias: 0.8,
      sprint_aggressiveness: 0.55,
    },
  },
  {
    style: "Direct",
    base: {
      defensive_line_depth_frac: 0.45,
      pressing_trigger_distance_mult: 0.95,
      marking_coverage_frac: 0.45,
      attacking_commitment_frac: 0.5,
      supporting_run_depth_mult: 0.25,
      shooting_range_mult: 1.4,
      pass_risk_tolerance: 0.6,
      cross_bias: 0.35,
      sprint_aggressiveness: 0.5,
    },
  },
  {
    style: "Possession",
    base: {
      defensive_line_depth_frac: 0.55,
      pressing_trigger_distance_mult: 0.9,
      marking_coverage_frac: 0.35,
      attacking_commitment_frac: 0.5,
      supporting_run_depth_mult: 0.3,
      shooting_range_mult: 0.75,
      pass_risk_tolerance: 0.35,
      cross_bias: 0.25,
      sprint_aggressiveness: 0.4,
    },
  },
];

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function generateManager(): GeneratedManager {
  const archetype = ARCHETYPES[randInt(0, ARCHETYPES.length - 1)];
  const tactics = {} as TacticFields;
  for (const field of TACTIC_FIELDS) {
    const [min, max] = BOUNDS[field];
    // +/- 8% of the field's own range — enough that two managers sharing
    // an archetype still play measurably differently, not so much that
    // the archetype's identity gets lost in the noise.
    const jitter = (max - min) * 0.08;
    const raw = archetype.base[field] + (Math.random() * 2 - 1) * jitter;
    tactics[field] = clamp(raw, min, max);
  }
  const name = `${FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[randInt(0, LAST_NAMES.length - 1)]}`;
  return { name, style: archetype.style, tactics };
}
