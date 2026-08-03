/**
 * A team's tactical style, as a set of named knobs a future "manager" system
 * will eventually plug in different values for (a defensive-minded manager,
 * a proactive/high-press one, ...). This file only builds that seam: one
 * default profile, used by every AI-controlled team today. `ai.ts` never
 * reads these fields itself in isolation — they're always threaded through
 * as an explicit parameter, which is what lets a future caller substitute a
 * different profile with zero changes to `ai.ts`'s decision logic.
 *
 * Every field is deliberately either a fraction of the AI's own roster/pitch
 * (so it survives a player-count or pitch-size change automatically) or a
 * multiplier on an existing engine constant/formula (so it survives a
 * balance retune automatically) — never a bare absolute number. See
 * `ai.ts`'s own module-level constants for the balance-robust baselines
 * these fields multiply/blend against.
 */
export interface TacticalProfile {
  /** 0 (deep low block, defends near its own goal) .. 1 (high line, holds near halfway). */
  defensiveLineDepthFrac: number;
  /** Multiplier on the base press-engagement distance — how far up the pitch pressing starts kicking in. */
  pressingTriggerDistanceMult: number;
  /** 0..1 fraction of the opponent's outfield count that gets man-marked. */
  markingCoverageFrac: number;
  /** 0..1 fraction of off-ball outfielders sent forward in support when this team has the ball. */
  attackingCommitmentFrac: number;
  /** Multiplier on PAWN_MOVE_BUDGET — how far a supporting run pushes upfield. */
  supportingRunDepthMult: number;
  /** Multiplier on KICK_RANGE — only takes clean, close chances (low) vs. shoots from distance (high). */
  shootingRangeMult: number;
  /** 0 (only the safest kicks) .. 1 (accepts a low-percentage pass/cross) — mapped onto aim.ts's real accuracy spread. */
  passRiskTolerance: number;
  /** 0 (never crosses) .. 1 (strongly prefers width and crosses over central play). */
  crossBias: number;
  /** 0 (conserves sprint) .. 1 (uses it opportunistically) — lowers the distance bar a leg must clear to trigger it. */
  sprintAggressiveness: number;
}

/** Today's only profile — a balanced, neutral team. Every AI-controlled side uses this until a manager system exists to assign others. */
export const DEFAULT_TACTICAL_PROFILE: TacticalProfile = {
  defensiveLineDepthFrac: 0.4,
  pressingTriggerDistanceMult: 1.0,
  markingCoverageFrac: 0.5,
  attackingCommitmentFrac: 0.5,
  supportingRunDepthMult: 0.25,
  shootingRangeMult: 1.0,
  passRiskTolerance: 0.5,
  crossBias: 0.4,
  sprintAggressiveness: 0.5,
};
