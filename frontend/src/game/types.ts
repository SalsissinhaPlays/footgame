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
 * of) plannedSteps/plannedKick — a pawn can have an explicit destination AND
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
  /**
   * This turn's waypoint chain — an ordered list of movement destinations, walked in
   * sequence (each leg capped at PAWN_MOVE_BUDGET distance from wherever the
   * previous leg ended, gated by the pawn's stamina-derived charge count — see
   * constants.ts's chargesFor). Empty = no plan this turn, same meaning the old
   * single `plannedPos: null` had. Built by repeated clicks in Game.tsx, not a
   * single click-and-replace.
   */
  plannedSteps: Vec2[];
  /** Set instead of a plannedSteps leg when this pawn (must be the ball carrier) kicks/passes this turn. */
  plannedKick: Vec2 | null;
  /** Only meaningful when plannedKick !== null: whether this kick is a lofted (airborne) trajectory rather than grounded. Turn-scoped like plannedKick — set alongside it, reset alongside it. */
  plannedKickLoft: boolean;
  stance: Stance | null;
  /** This turn's choice to sprint — turn-scoped like plannedSteps/plannedKick/stance. */
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
