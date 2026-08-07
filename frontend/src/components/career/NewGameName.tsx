import { useState } from "react";
import { createSave } from "../../game/careerApi";
import type { SaveDTO } from "../../game/careerTypes";
import "./career.css";

interface Props {
  onBack: () => void;
  onCreated: (save: SaveDTO) => void;
}

/**
 * Step 1 of New Game: manager name entry. The name doubles as the save's
 * own name (there's no separate manager-name column) — creating the save
 * here also auto-provisions its 12-team starter league (see backend's
 * POST /api/saves), which is why "Next" has a brief loading state.
 * Body/appearance customization is future scope, once in-game player
 * models exist to customize — deliberately not attempted here.
 */
export function NewGameName({ onBack, onCreated }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleNext() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    setCreating(true);
    try {
      const save = await createSave(trimmed);
      onCreated(save);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setCreating(false);
    }
  }

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Career
        </button>
        <h1>New Game</h1>
      </div>

      {error && <p className="career-error">{error}</p>}

      <p className="career-muted">What's your manager name?</p>

      <div className="career-name-form">
        <input
          type="text"
          placeholder="Manager name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleNext()}
        />
        <button type="button" className="career-home-button" disabled={creating || !name.trim()} onClick={handleNext}>
          {creating ? "Building your league…" : "Next"}
        </button>
      </div>
    </div>
  );
}
