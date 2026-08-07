import { useEffect, useState } from "react";
import { fetchPlayers } from "../../game/api";
import { fetchTeamLineup } from "../../game/careerApi";
import { FORMATION_7V7_DEFAULT } from "../../game/formations";
import type { PlayerDTO } from "../../game/types";
import "./career.css";

// Derived from the actual default formation's slot count, not a separate
// hardcoded number, so a future squad-size change (see formations.ts) only
// needs touching there.
const STARTERS_NEEDED = FORMATION_7V7_DEFAULT.slots.length;

interface Props {
  teamId: number;
  opponentName: string;
  onBack: () => void;
  onConfirm: (startingPlayerIds: number[]) => void;
}

/**
 * The real prerequisite for substitutions to mean anything: before this,
 * "who starts" was never a choice at all — buildFormation's assignSlots
 * just walked the roster in whatever order the backend returned it
 * (jersey_number), so which STARTERS_NEEDED of a 12-player career squad
 * actually took the pitch was an accident of jersey numbering. Defaults to
 * the team's saved base lineup (see Team Management's Formation page) when
 * one exists, pre-checked, so a player who set their team up once and
 * doesn't need to make a situational change can confirm immediately. Falls
 * back to the original first-N-by-jersey-number selection when no lineup
 * has ever been saved — matching what buildFormation's own default already
 * does.
 */
export function LineupSelect({ teamId, opponentName, onBack, onConfirm }: Props) {
  const [players, setPlayers] = useState<PlayerDTO[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPlayers(teamId), fetchTeamLineup(teamId)])
      .then(([list, lineupDto]) => {
        setPlayers(list);
        const savedIds = lineupDto.slots
          ?.map((s) => s.playerId)
          .filter((id) => list.some((p) => p.id === id));
        setSelected(
          new Set(savedIds && savedIds.length === STARTERS_NEEDED ? savedIds : list.slice(0, STARTERS_NEEDED).map((p) => p.id))
        );
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [teamId]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < STARTERS_NEEDED) {
        next.add(id);
      }
      return next;
    });
  }

  const ready = selected.size === STARTERS_NEEDED;

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Club
        </button>
        <h1>Starting Lineup</h1>
      </div>
      <p className="career-muted">
        vs {opponentName} — pick {STARTERS_NEEDED} starters ({selected.size}/{STARTERS_NEEDED} selected). Everyone
        else sits out this match.
      </p>

      {error && <p className="career-error">{error}</p>}

      {players === null ? (
        <p>Loading…</p>
      ) : (
        <ul className="career-list">
          {players.map((p) => {
            const isSelected = selected.has(p.id);
            const disableToggle = !isSelected && selected.size >= STARTERS_NEEDED;
            return (
              <li key={p.id} className="career-list-row">
                <button
                  type="button"
                  className="career-list-row-clickable"
                  disabled={disableToggle}
                  onClick={() => toggle(p.id)}
                >
                  <span className="career-preview-player-pos">{p.position}</span>
                  <span className="career-preview-player-name">
                    #{p.jersey_number} {p.name}
                  </span>
                  <span className={isSelected ? "career-lineup-badge starting" : "career-lineup-badge"}>
                    {isSelected ? "Starting" : "Bench"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="career-preview-actions">
        <button
          type="button"
          className="career-home-button"
          disabled={!ready}
          onClick={() => onConfirm([...selected])}
        >
          {ready ? "Kick off" : `Pick ${STARTERS_NEEDED - selected.size} more`}
        </button>
      </div>
    </div>
  );
}
