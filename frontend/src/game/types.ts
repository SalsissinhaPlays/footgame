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
 * of) plannedSteps — a pawn can have an explicit chain of waypoints/kicks AND
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

/**
 * One entry in a pawn's waypoint chain. `pos` means different things
 * depending on `kick`: for an ordinary step, it's a destination to walk to
 * (part of the pawn's PAWN_MOVE_BUDGET distance); for a kick step, it's the
 * kick's AIM TARGET, not a place to walk — the kick fires from wherever the
 * chain has left the pawn by that point (their previous step, or their real
 * position if it's first), consuming zero movement distance, only a charge
 * (see constants.ts's KICK_CHARGE_COST). A kick step only actually fires if
 * the pawn genuinely holds the ball once the chain reaches it — see
 * resolve.ts's tick loop; if they don't, it silently fizzles and the chain
 * just continues to whatever comes after.
 */
export interface PlannedStep {
  pos: Vec2;
  kick?: { loft: boolean };
}

export interface Pawn {
  id: string;
  player: PlayerDTO;
  side: Side;
  pos: Vec2;
  /**
   * This turn's plan — an ordered chain of movement waypoints and/or kicks,
   * executed in sequence (see resolve.ts's tick loop). Empty = no plan this
   * turn, same meaning the old single `plannedPos: null` had. Built by
   * repeated clicks in Game.tsx, not a single click-and-replace. A kick can
   * appear anywhere in the sequence, not just at the end — move, kick, then
   * keep moving is a valid plan.
   */
  plannedSteps: PlannedStep[];
  stance: Stance | null;
  /** This turn's choice to sprint — turn-scoped like plannedSteps/stance. */
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
