import { useEffect, useState } from "react";
import { fetchManagers } from "../../game/careerApi";
import type { ManagerDTO } from "../../game/careerTypes";
import "./career.css";

interface Props {
  saveId: number;
  onBack: () => void;
}

/**
 * Read-only browse of the save's managers — who manages each rival club,
 * and their tactical identity (style + a couple of headline numbers, not
 * all 9 raw fields, which only really mean something on the sliders
 * themselves — see TeamTactics.tsx). There's no hire/fire UI here: a
 * manager only ever changes hands via POST /api/saves (initial
 * assignment) or the autonomous, performance-weighted firing at season
 * rollover (see ClubHome's "Start Season" flow) — this screen just shows
 * the result, it doesn't drive it.
 */
export function Managers({ saveId, onBack }: Props) {
  const [managers, setManagers] = useState<ManagerDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchManagers(saveId)
      .then(setManagers)
      .catch((e) => setError(String(e.message ?? e)));
  }, [saveId]);

  const employed = (managers ?? []).filter((m) => m.team_id != null);
  const freeAgents = (managers ?? []).filter((m) => m.team_id == null);

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Club
        </button>
        <h1>Managers</h1>
      </div>
      <p className="career-muted">
        Every AI-controlled club has its own manager shaping how it plays — your own team has none, since you manage
        it yourself. A struggling manager can lose their job at the end of a season; a sacked one may resurface at
        another club later.
      </p>

      {error && <p className="career-error">{error}</p>}

      {managers === null ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="career-section">
            <h2>Club Managers</h2>
            <ul className="career-list">
              {employed.map((m) => (
                <li key={m.id} className="career-manager-row">
                  <span className="career-manager-team">{m.team_name}</span>
                  <span className="career-manager-name">{m.name}</span>
                  <span className="career-manager-style">{m.style}</span>
                </li>
              ))}
            </ul>
          </div>

          {freeAgents.length > 0 && (
            <div className="career-section">
              <h2>Free Agents</h2>
              <p className="career-muted">Unemployed managers who may be hired by a club that sacks its own.</p>
              <ul className="career-list">
                {freeAgents.map((m) => (
                  <li key={m.id} className="career-manager-row">
                    <span className="career-manager-name">{m.name}</span>
                    <span className="career-manager-style">{m.style}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
