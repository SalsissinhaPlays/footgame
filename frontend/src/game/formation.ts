import { GRID_COLS } from "./constants";
import { FORMATION_6V6_DEFAULT } from "./formations";
import type { Formation } from "./formations";
import type { Pawn, PlayerDTO, Side, Vec2 } from "./types";

function mirrorX(x: number): number {
  return GRID_COLS - 1 - x;
}

/**
 * Assigns each player to the formation slot matching their PlayerDTO.position,
 * falling back to whatever slot is left over for anyone whose position has no
 * (or no more) matching slot — e.g. an extra MID beyond the formation's own
 * MID count still gets placed somewhere sensible rather than dropped. Slot
 * order/count is entirely data-driven (see formations.ts) — this algorithm
 * has no knowledge of squad size or shape.
 */
function assignSlots(players: PlayerDTO[], formation: Formation): { player: PlayerDTO; pos: Vec2 }[] {
  const remaining = [...formation.slots];
  return players.map((player) => {
    const matchIndex = remaining.findIndex((s) => s.position === player.position);
    const index = matchIndex !== -1 ? matchIndex : 0;
    const [slot] = remaining.splice(index, 1);
    return { player, pos: slot?.pos ?? { x: GRID_COLS / 2, y: 20 } };
  });
}

export function buildFormation(players: PlayerDTO[], side: Side, formation: Formation = FORMATION_6V6_DEFAULT): Pawn[] {
  return assignSlots(players, formation).map(({ player, pos: slotPos }) => {
    const pos: Vec2 = side === "home" ? { ...slotPos } : { x: mirrorX(slotPos.x), y: slotPos.y };

    return {
      id: `${side}-${player.id}`,
      player,
      side,
      pos,
      plannedSteps: [],
      plannedKick: null,
      plannedKickLoft: false,
      stance: null,
      plannedSprint: false,
      sprintCooldown: 0,
    };
  });
}
