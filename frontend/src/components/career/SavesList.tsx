import { useEffect, useState } from "react";
import { deleteSave, fetchSaves } from "../../game/careerApi";
import type { SaveDTO } from "../../game/careerTypes";
import "./career.css";

interface Props {
  onBack: () => void;
  /** Passed the full save, not just its id — its user_team_id decides whether Career.tsx routes to ChooseTeam or straight into SaveDetail. */
  onOpenSave: (save: SaveDTO) => void;
}

/** Pure "Load Game" picker — creating a new save now lives in the New Game flow (see NewGameName.tsx). */
export function SavesList({ onBack, onOpenSave }: Props) {
  const [saves, setSaves] = useState<SaveDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    fetchSaves()
      .then(setSaves)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleDelete(id: number) {
    if (!confirm("Delete this save? This removes all its teams, players, leagues, and fixtures.")) return;
    setError(null);
    try {
      await deleteSave(id);
      reload();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Career
        </button>
        <h1>Load Game</h1>
      </div>

      {error && <p className="career-error">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : saves.length === 0 ? (
        <p className="career-empty">No saves yet — start a New Game from the Career menu.</p>
      ) : (
        <ul className="career-list">
          {saves.map((s) => (
            <li key={s.id} className="career-list-row">
              <button type="button" className="career-list-open" onClick={() => onOpenSave(s)}>
                {s.name} <span className="career-muted">(season {s.season})</span>
              </button>
              <button type="button" className="career-delete" onClick={() => handleDelete(s.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
