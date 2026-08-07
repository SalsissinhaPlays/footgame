import { GRID_COLS } from "./constants";
import { FORMATION_6V6_DEFAULT } from "./formations";
import type { Formation } from "./formations";
import type { Pawn, PlayerDTO, Side, Vec2 } from "./types";

function mirrorX(x: number): number {
  return GRID_COLS - 1 - x;
}

/**
 * Assigns each formation SLOT the first remaining player matching its
 * position, falling back to whichever player is left if none match (e.g. a
 * roster missing a GK entirely still fields someone in goal rather than
 * leaving the slot empty). Iterating over slots rather than players is
 * what correctly benches a roster's surplus beyond the formation's own
 * size — a 12-player squad (starterLeague.ts deliberately carries a backup
 * GK plus real squad depth) only ever puts formation.slots.length players
 * on the pitch; the other half of the roster is simply never assigned a
 * position and never becomes a pawn. Slot order/count is entirely
 * data-driven (see formations.ts) — this algorithm has no knowledge of
 * squad size or shape.
 */
function assignSlots(players: PlayerDTO[], formation: Formation): { player: PlayerDTO; pos: Vec2 }[] {
  const remaining = [...players];
  const result: { player: PlayerDTO; pos: Vec2 }[] = [];
  for (const slot of formation.slots) {
    if (remaining.length === 0) break; // fewer players than the formation has slots
    const matchIndex = remaining.findIndex((p) => p.position === slot.position);
    const index = matchIndex !== -1 ? matchIndex : 0;
    const [player] = remaining.splice(index, 1);
    result.push({ player, pos: slot.pos });
  }
  return result;
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
      stance: null,
      plannedSprint: false,
      sprintCooldown: 0,
      plannedTackle: null,
      tackleCooldown: 0,
    };
  });
}
