import { useEffect, useState } from "react";
import { fetchSaves } from "../../game/careerApi";
import type { SaveDTO } from "../../game/careerTypes";
import "./career.css";

interface Props {
  onContinue: (mostRecentSave: SaveDTO) => void;
  onLoadGame: () => void;
  onNewGame: () => void;
  onReturn: () => void;
}

/**
 * The Career landing screen: Continue / Load Game / New Game / Return.
 * Continue and Load Game are disabled until at least one save exists —
 * there's nothing to continue or load yet. "Most recent" is approximated
 * by highest save id (auto-increment, always monotonic) rather than
 * created_at, since there's no separate last-played timestamp in the
 * schema and id sidesteps any string-timestamp-format assumptions.
 */
export function CareerHome({ onContinue, onLoadGame, onNewGame, onReturn }: Props) {
  const [saves, setSaves] = useState<SaveDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSaves()
      .then(setSaves)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const hasSaves = (saves?.length ?? 0) > 0;
  const mostRecentSave = saves && saves.length > 0 ? saves.reduce((a, b) => (b.id > a.id ? b : a)) : null;

  return (
    <div className="career-page">
      <div className="career-header">
        <h1>Career</h1>
      </div>

      {error && <p className="career-error">{error}</p>}

      <div className="career-home-options">
        <button
          type="button"
          className="career-home-button"
          disabled={!mostRecentSave}
          onClick={() => mostRecentSave && onContinue(mostRecentSave)}
        >
          Continue
        </button>
        <button type="button" className="career-home-button" disabled={!hasSaves} onClick={onLoadGame}>
          Load Game
        </button>
        <button type="button" className="career-home-button" onClick={onNewGame}>
          New Game
        </button>
        <button type="button" className="career-home-button career-home-button-secondary" onClick={onReturn}>
          Return
        </button>
      </div>
    </div>
  );
}
