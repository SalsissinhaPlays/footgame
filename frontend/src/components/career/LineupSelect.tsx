import { useEffect, useState } from "react";
import { fetchPlayers } from "../../game/api";
import type { PlayerDTO } from "../../game/types";
import "./career.css";

const STARTERS_NEEDED = 6;

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
 * (jersey_number), so which 6 of a 12-player career squad actually took
 * the pitch was an accident of jersey numbering. Defaults to that exact
 * same first-6-by-jersey-number selection, pre-checked, so a player who
 * doesn't care can confirm immediately — this only matters once someone
 * actually wants to bench their backup GK or start a different striker.
 */
export function LineupSelect({ teamId, opponentName, onBack, onConfirm }: Props) {
  const [players, setPlayers] = useState<PlayerDTO[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlayers(teamId)
      .then((list) => {
        setPlayers(list);
        setSelected(new Set(list.slice(0, STARTERS_NEEDED).map((p) => p.id)));
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
