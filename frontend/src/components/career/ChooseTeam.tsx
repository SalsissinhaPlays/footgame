import { useEffect, useState } from "react";
import { fetchSaveTeams } from "../../game/careerApi";
import type { SaveDTO } from "../../game/careerTypes";
import type { TeamDTO } from "../../game/types";
import "./career.css";

interface Props {
  save: SaveDTO;
  onBack: () => void;
  onPickTeam: (team: TeamDTO) => void;
}

/**
 * Shown after a save is created (or reopened before a team's been picked) —
 * the save already comes with a full 12-team starter league, so this is the
 * one deliberate choice the player makes: which of those teams is theirs.
 * Clicking a team doesn't commit it — it opens a roster preview
 * (TeamPreview.tsx) where the actual "pick this team" confirmation lives.
 */
export function ChooseTeam({ save, onBack, onPickTeam }: Props) {
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSaveTeams(save.id)
      .then(setTeams)
      .catch((e) => setError(String(e.message ?? e)));
  }, [save.id]);

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Career
        </button>
        <h1>Choose your team</h1>
      </div>
      <p className="career-muted">
        "{save.name}" already has a full 12-team league ready to go. Pick the one you'll manage — you can still edit
        any team's roster afterward, including the others.
      </p>

      {error && <p className="career-error">{error}</p>}

      {teams.length === 0 ? (
        <p>Loading…</p>
      ) : (
        <ul className="career-list">
          {teams.map((t) => (
            <li key={t.id} className="career-list-row">
              <button type="button" className="career-list-row-clickable" onClick={() => onPickTeam(t)}>
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
