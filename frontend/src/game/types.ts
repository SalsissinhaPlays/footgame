export interface PlayerDTO {
  id: number;
  team_id: number;
  name: string;
  position: string;
  jersey_number: number;
  pace: number;
  stamina: number;
  skill: number;
  jumping: number;
  shot_stopping: number;
  reflexes: number;
  /** Governs redirect precision when this pawn wins a header — see aim.ts's sampleLanding, called with this in place of skill. */
  heading: number;
}

export interface TeamDTO {
  id: number;
  name: string;
}

export interface Vec2 {
  x: number;
  y: number;
}

export type Side = "home" | "away";

/**
 * A standing defensive order for this turn, layered on top of (not instead
 * of) plannedPos/plannedKick — a pawn can have an explicit destination AND
 * a stance. Left open to future variants (offensive stances, a header-bonus
 * stance once crossing/heights exist) rather than closed off, but only
 * variants with a real mechanic to attach to belong here.
 *
 * gk_on_line/gk_aggressive are GK-only (enforced at the UI level, not the
 * type level — the same limitation man_mark already has: nothing stops an
 * outfield pawn from being assigned one). Deliberately not reusing the
 * "aggressive" literal for the GK variant — contest.ts's stanceBonus already
 * keys off kind === "aggressive" for an outfield tackle bonus, and a name
 * collision would risk a GK tripping that branch.
 */
export type Stance =
  | { kind: "aggressive" }
  | { kind: "pressure" }
  | { kind: "cover_passing" }
  | { kind: "man_mark"; targetId: string }
  | { kind: "gk_on_line" }
  | { kind: "gk_aggressive" };

export interface Pawn {
  id: string;
  player: PlayerDTO;
  side: Side;
  pos: Vec2;
  plannedPos: Vec2 | null;
  /** Set instead of plannedPos when this pawn (must be the ball carrier) kicks/passes this turn. */
  plannedKick: Vec2 | null;
  /** Only meaningful when plannedKick !== null: whether this kick is a lofted (airborne) trajectory rather than grounded. Turn-scoped like plannedKick — set alongside it, reset alongside it. */
  plannedKickLoft: boolean;
  stance: Stance | null;
  /** This turn's choice to sprint — turn-scoped like plannedPos/plannedKick/stance. */
  plannedSprint: boolean;
  /**
   * Turns remaining before sprint can be used again (0 = available). Unlike
   * everything else on Pawn, this is NOT turn-scoped — it persists and
   * decrements across turn boundaries (see Game.tsx's post-turn bookkeeping),
   * since sprint is a cooldown-gated skill rather than a freely-repeatable
   * per-turn order.
   */
  sprintCooldown: number;
}

export interface Ball {
  pos: Vec2;
}
