import { GRID_COLS } from "./constants";
import { FORMATION_7V7_DEFAULT } from "./formations";
import type { Formation, FormationSlot, LineupSlot } from "./formations";
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

function toPawns(assigned: { player: PlayerDTO; pos: Vec2 }[], side: Side): Pawn[] {
  return assigned.map(({ player, pos: slotPos }) => {
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

export function buildFormation(players: PlayerDTO[], side: Side, formation: Formation = FORMATION_7V7_DEFAULT): Pawn[] {
  return toPawns(assignSlots(players, formation), side);
}

/**
 * Like buildFormation, but seeded from a team's saved base lineup (see the
 * Team Management Formation screen / backend's team_lineups table) instead
 * of a generic position-shaped Formation — each saved slot is pinned to a
 * SPECIFIC player, not just a position category. `startingPlayerIds` is
 * LineupSelect's confirmed starting lineup for this match, which may differ
 * from the saved lineup (the player swapped a tired starter out) — a saved
 * slot whose player isn't in `startingPlayerIds` is "vacated," and whichever
 * confirmed starter isn't covered by an unvacated saved slot ("newcomers")
 * fills those vacated slots via the same position-matching `assignSlots`
 * already uses everywhere else, so a substitute lands somewhere sensible
 * (a DEF replacing a DEF) rather than at a arbitrary/default spot.
 *
 * `vacated.length` always exactly equals `newcomers.length` by construction
 * (both are `savedSlots.length - kept.length`) whenever `savedSlots.length
 * === startingPlayerIds.length`, which is the only case this function
 * handles specially — a length mismatch (no saved lineup yet, or the
 * roster's squad size changed since one was saved) falls back to the
 * ordinary, well-understood `buildFormation` default entirely rather than
 * guessing at a partial reconciliation.
 */
export function buildFormationFromLineup(
  players: PlayerDTO[],
  side: Side,
  startingPlayerIds: number[],
  savedSlots: LineupSlot[] | null
): Pawn[] {
  if (!savedSlots || savedSlots.length !== startingPlayerIds.length) {
    // `players` is the FULL roster (buildFormationFromLineup needs it to
    // look up any id from savedSlots or startingPlayerIds), not already
    // filtered down to the confirmed starters the way callers used to
    // filter before this function existed — falling back to plain
    // buildFormation(players, side) here would silently re-run assignSlots'
    // position-matching over the WHOLE roster and ignore LineupSelect's
    // actual choice entirely (a real bug caught live: a bench player picked
    // up here purely because their position happened to fill a gap, even
    // though the human explicitly benched them). Filter to the confirmed
    // starters first, matching what every other branch of this function
    // already respects.
    const startingSet = new Set(startingPlayerIds);
    return buildFormation(players.filter((p) => startingSet.has(p.id)), side);
  }

  const startingSet = new Set(startingPlayerIds);
  const byId = new Map(players.map((p) => [p.id, p]));

  const kept: { player: PlayerDTO; pos: Vec2 }[] = [];
  const vacated: FormationSlot[] = [];
  for (const slot of savedSlots) {
    const player = startingSet.has(slot.playerId) ? byId.get(slot.playerId) : undefined;
    if (player) {
      kept.push({ player, pos: slot.pos });
    } else {
      vacated.push({ position: slot.position, pos: slot.pos });
    }
  }

  const keptIds = new Set(kept.map((k) => k.player.id));
  const newcomers = startingPlayerIds
    .map((id) => byId.get(id))
    .filter((p): p is PlayerDTO => p != null && !keptIds.has(p.id));

  const assignedNewcomers = assignSlots(newcomers, { slots: vacated });

  return toPawns([...kept, ...assignedNewcomers], side);
}
