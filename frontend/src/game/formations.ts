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

/** The only formation in use today — a 6-a-side GK/DEF/DEF/MID/MID/FWD shape, same positions the game has always used. */
export const FORMATION_6V6_DEFAULT: Formation = {
  slots: [
    { position: "GK", pos: { x: 4, y: 20 } },
    { position: "DEF", pos: { x: 11, y: 10 } },
    { position: "DEF", pos: { x: 11, y: 30 } },
    { position: "MID", pos: { x: 22, y: 7 } },
    { position: "MID", pos: { x: 22, y: 33 } },
    { position: "FWD", pos: { x: 22, y: 20 } },
  ],
};
