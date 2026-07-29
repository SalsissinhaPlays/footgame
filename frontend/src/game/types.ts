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

export interface Pawn {
  id: string;
  player: PlayerDTO;
  side: Side;
  pos: Vec2;
  plannedPos: Vec2 | null;
}

export interface Ball {
  pos: Vec2;
}
