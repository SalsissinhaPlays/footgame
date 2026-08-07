import { useEffect, useState } from "react";
import { fetchPlayers } from "../../game/api";
import { setUserTeam } from "../../game/careerApi";
import type { SaveDTO } from "../../game/careerTypes";
import type { PlayerDTO, TeamDTO } from "../../game/types";
import "./career.css";

interface Props {
  save: SaveDTO;
  team: TeamDTO;
  onBack: () => void;
  onPicked: (saveId: number) => void;
}

/**
 * Read-only roster view for a team the player is considering, reached by
 * clicking a team in ChooseTeam.tsx. Only "Pick this team" actually commits
 * (calls setUserTeam) — browsing here has no side effects, so backing out
 * to try a different team is free.
 */
export function TeamPreview({ save, team, onBack, onPicked }: Props) {
  const [players, setPlayers] = useState<PlayerDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    fetchPlayers(team.id)
      .then(setPlayers)
      .catch((e) => setError(String(e.message ?? e)));
  }, [team.id]);

  async function handlePick() {
    setError(null);
    setPicking(true);
    try {
      await setUserTeam(save.id, team.id);
      onPicked(save.id);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setPicking(false);
    }
  }

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Choose team
        </button>
        <h1>{team.name}</h1>
      </div>

      {error && <p className="career-error">{error}</p>}

      {players === null ? (
        <p>Loading…</p>
      ) : (
        <ul className="career-list">
          {players.map((p) => (
            <li key={p.id} className="career-preview-player-row">
              <span className="career-preview-player-pos">{p.position}</span>
              <span className="career-preview-player-name">
                #{p.jersey_number} {p.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="career-preview-actions">
        <button type="button" className="career-home-button" disabled={picking} onClick={handlePick}>
          {picking ? "Confirming…" : `Pick ${team.name}`}
        </button>
      </div>
    </div>
  );
}
