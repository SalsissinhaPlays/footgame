import type { Vec2 } from "./types";

/**
 * Formation data, decoupled from formation.ts's placement algorithm — adding
 * a new squad size or shape (a future 11v11 formation, an alternate 6v6
 * shape) means adding a new Formation value here, not touching the engine
 * that places players into one. Coordinates are always in "home" orientation
 * (mirrored horizontally for the away side by formation.ts).
 */
export interface FormationSlot {
  /** Matched against a player's PlayerDTO.position — see formation.ts's assignSlots. */
  position: string;
  pos: Vec2;
}

export interface Formation {
  slots: FormationSlot[];
}

/** A saved base-lineup slot (see the Team Management Formation screen / backend's team_lineups table) — a FormationSlot pinned to a SPECIFIC player, not just a position category. `position` is still carried alongside `playerId` (the player's PlayerDTO.position at save time) so a vacated slot — one whose player isn't in a given match's confirmed starting lineup — can still be filled by a sensibly-matching substitute via formation.ts's ordinary position-matching, without a second roster fetch. */
export interface LineupSlot extends FormationSlot {
  playerId: number;
}

/**
 * The only formation in use today — a 7-a-side GK/DEF/DEF/MID/MID/MID/FWD
 * (1-2-3-1) shape. Was 6-a-side (GK/DEF/DEF/MID/MID/FWD) until bumped by an
 * explicit user request; the extra slot went to MID rather than DEF or FWD
 * since the 12-player career roster's own position spread (2 GK, 4 DEF, 4
 * MID, 2 FWD — see starterLeague.ts's POSITION_PLAN) has the most depth
 * there, and a back-two/front-one shape with a real 3-wide midfield is a
 * common small-sided-football shape. Every consumer (buildFormation's
 * default, LineupSelect's STARTERS_NEEDED, the Formation Editor's own
 * default-slot fallback) reads the shape from here rather than a separate
 * hardcoded count, so this is the only place a future squad-size change
 * needs to touch.
 */
export const FORMATION_7V7_DEFAULT: Formation = {
  slots: [
    { position: "GK", pos: { x: 4, y: 20 } },
    { position: "DEF", pos: { x: 11, y: 10 } },
    { position: "DEF", pos: { x: 11, y: 30 } },
    { position: "MID", pos: { x: 18, y: 20 } },
    { position: "MID", pos: { x: 24, y: 8 } },
    { position: "MID", pos: { x: 24, y: 32 } },
    { position: "FWD", pos: { x: 26, y: 20 } },
  ],
};
