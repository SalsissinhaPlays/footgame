export interface PlayerDTO {
  id: number;
  team_id: number;
  name: string;
  position: string;
  jersey_number: number;
  pace: number;
  stamina: number;
  skill: number;
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
 */
export type Stance =
  | { kind: "aggressive" }
  | { kind: "pressure" }
  | { kind: "cover_passing" }
  | { kind: "man_mark"; targetId: string };

export interface Pawn {
  id: string;
  player: PlayerDTO;
  side: Side;
  pos: Vec2;
  plannedPos: Vec2 | null;
  /** Set instead of plannedPos when this pawn (must be the ball carrier) kicks/passes this turn. */
  plannedKick: Vec2 | null;
  stance: Stance | null;
}

export interface Ball {
  pos: Vec2;
}
