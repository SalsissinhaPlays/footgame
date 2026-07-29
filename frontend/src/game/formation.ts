import { GRID_COLS } from "./constants";
import type { Pawn, PlayerDTO, Side, Vec2 } from "./types";

const HOME_SLOTS: Record<string, Vec2> = {
  GK: { x: 1, y: 5 },
  DEF: { x: 3, y: 3 },
  DEF2: { x: 3, y: 7 },
  MID: { x: 6, y: 2 },
  MID2: { x: 6, y: 8 },
  FWD: { x: 6, y: 5 },
};

const SLOT_ORDER = ["GK", "DEF", "DEF2", "MID", "MID2", "FWD"];

function mirrorX(x: number): number {
  return GRID_COLS - 1 - x;
}

export function buildFormation(players: PlayerDTO[], side: Side): Pawn[] {
  const seenCounts: Record<string, number> = {};

  return players.map((player, index) => {
    const baseKey = player.position;
    const count = seenCounts[baseKey] ?? 0;
    seenCounts[baseKey] = count + 1;
    const slotKey = count === 0 ? baseKey : `${baseKey}${count + 1}`;
    const slot = HOME_SLOTS[slotKey] ?? HOME_SLOTS[SLOT_ORDER[index] ?? "MID"];

    const pos: Vec2 = side === "home" ? { ...slot } : { x: mirrorX(slot.x), y: slot.y };

    return {
      id: `${side}-${player.id}`,
      player,
      side,
      pos,
      plannedPos: null,
      plannedKick: null,
    };
  });
}
