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
 * a stance. Left open to future variants (offensive stances) rather than
 * closed off, but only variants with a real mechanic to attach to belong
 * here.
 *
 * gk_on_line/gk_aggressive are GK-only (enforced at the UI level, not the
 * type level — the same limitation man_mark already has: nothing stops an
 * outfield pawn from being assigned one). `gk_aggressive` is a deliberately
 * separate literal from any outfield stance — it governs unrelated GK
 * positioning/claim-eligibility behavior (see resolve.ts's gkAutoTarget and
 * checkCapture).
 *
 * `expecting_header` gates header eligibility itself (see resolve.ts's
 * checkHeader), not a contest bonus like the others — without it, a lofted
 * ball just isn't headable by anyone nearby at all, it sails through the
 * headable height band untouched until it descends low enough for a normal
 * capture. This is deliberately more restrictive than every other stance,
 * added specifically because an unconditional "anyone in HEADER_RADIUS
 * auto-contests" rule made an ordinary lofted pass between two teammates
 * involuntarily turn into a header duel the instant it crossed headable
 * height — real football requires anticipating a cross to attack/defend it
 * in the air, not an automatic reflex.
 *
 * `auto_tackle` is the one stance that does NOT reset to "None" every turn
 * the way every other stance does (see Game.tsx's post-turn bookkeeping) —
 * it's a standing "let this defender auto-tackle whenever it gets the
 * chance" order that persists until the player explicitly changes it,
 * deliberately different from every other stance's turn-scoped lifetime.
 * See resolve.ts's tackle-challenge gating and Pawn.plannedTackle below for
 * how it interacts with an explicit, one-turn tackle declaration. The old
 * outfield "aggressive" stance (a flat tackle-contest bonus + foul-risk bump)
 * was retired in favor of an explicit Clean/Hard choice on plannedTackle —
 * see constants.ts's HARD_TACKLE_PACE_FACTOR/HARD_TACKLE_FOUL_BONUS.
 */
export type Stance =
  | { kind: "pressure" }
  | { kind: "cover_passing" }
  | { kind: "man_mark"; targetId: string }
  | { kind: "expecting_header" }
  | { kind: "auto_tackle" }
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
 *
 * `kick.kind` is the player's own explicit declaration of what this kick is
 * for — not inferred from geometry (an earlier version guessed shot/pass/
 * clear from the target's position, purely for a UI label; that guess never
 * fed back into the resolution engine and has been retired). All three kinds
 * now resolve differently: `"cross"` widens the landing spread and keeps the
 * full KICK_RANGE, `"pass"` keeps the normal spread but is capped at the
 * shorter PASS_RANGE, and `"shot"` keeps KICK_RANGE and tightens the spread
 * further when genuinely aimed on target (see aim.ts's landingSpread and
 * resolve.ts's isShotOnTarget/startFlight).
 */
export interface PlannedStep {
  pos: Vec2;
  kick?: { loft: boolean; kind: "shot" | "pass" | "cross" };
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
  /**
   * This turn's explicit tackle declaration — turn-scoped like plannedSprint,
   * reset to null every turn regardless of whether an attempt actually
   * happened (see ResolveResult.tacklesAttempted in resolve.ts for that
   * separate signal). Not part of plannedSteps: unlike a kick, a tackle isn't
   * tied to a position in the movement/kick chain — resolve.ts checks it
   * every tick against whichever opponent currently carries the ball,
   * wherever this pawn happens to be that tick. `kind` picks Clean (baseline
   * roll, no extra foul risk) vs Hard (pace-scaled tackle-contest bonus, more
   * foul risk on a bad miss) — see constants.ts's HARD_TACKLE_PACE_FACTOR/
   * HARD_TACKLE_FOUL_BONUS. The `auto_tackle` stance can also trigger a
   * tackle attempt with no explicit plannedTackle set at all (defaults to
   * Clean when it fires) — see resolve.ts's tackle-challenge filter.
   */
  plannedTackle: { kind: "clean" | "hard" } | null;
  /**
   * Turns remaining before this pawn can enter another tackle challenge (0 =
   * available) — NOT turn-scoped, same persistence shape as sprintCooldown.
   * While > 0, this pawn's effective movement speed is halved (see
   * constants.ts's TACKLE_COOLDOWN_SPEED_FACTOR) and it's ineligible for a
   * new tackle challenge regardless of plannedTackle/auto_tackle. Set by
   * Game.tsx's post-turn bookkeeping whenever this pawn's id appears in
   * ResolveResult.tacklesAttempted, decremented otherwise.
   */
  tackleCooldown: number;
}

export interface Ball {
  pos: Vec2;
}
