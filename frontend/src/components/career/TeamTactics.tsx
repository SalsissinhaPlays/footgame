import { useEffect, useState } from "react";
import { fetchTeamTactics, toTacticalProfile, updateTeamTactics } from "../../game/careerApi";
import type { TacticalProfile } from "../../game/tacticalProfile";
import "./career.css";

interface Props {
  teamId: number;
  onBack: () => void;
}

interface SliderSpec {
  key: keyof TacticalProfile;
  label: string;
  low: string;
  high: string;
  min: number;
  max: number;
  step: number;
}

// Ranges for the two "0..1 fraction" and "multiplier" families follow
// tacticalProfile.ts's own doc comments — a fraction always spans its full
// 0..1 domain, a multiplier spans a band centered on DEFAULT_TACTICAL_PROFILE's
// value (widening it further has no real effect since ai.ts's own
// module-level constants already set the balance-robust baseline these
// multiply against).
const SLIDERS: SliderSpec[] = [
  { key: "defensiveLineDepthFrac", label: "Defensive Line", low: "Deep", high: "High", min: 0, max: 1, step: 0.05 },
  {
    key: "pressingTriggerDistanceMult",
    label: "Pressing",
    low: "Passive",
    high: "Aggressive",
    min: 0.5,
    max: 1.5,
    step: 0.05,
  },
  {
    key: "markingCoverageFrac",
    label: "Marking",
    low: "Zonal",
    high: "Man-to-Man",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "attackingCommitmentFrac",
    label: "Attacking Commitment",
    low: "Cautious",
    high: "Committed",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "supportingRunDepthMult",
    label: "Supporting Runs",
    low: "Short",
    high: "Deep",
    min: 0,
    max: 0.6,
    step: 0.05,
  },
  {
    key: "shootingRangeMult",
    label: "Shooting Range",
    low: "Close range only",
    high: "Shoots from distance",
    min: 0.5,
    max: 1.5,
    step: 0.05,
  },
  { key: "passRiskTolerance", label: "Pass/Cross Risk", low: "Safe", high: "Risky", min: 0, max: 1, step: 0.05 },
  { key: "crossBias", label: "Width", low: "Central play", high: "Wing play", min: 0, max: 1, step: 0.05 },
  {
    key: "sprintAggressiveness",
    label: "Sprint Usage",
    low: "Conservative",
    high: "Opportunistic",
    min: 0,
    max: 1,
    step: 0.05,
  },
];

/**
 * Exposes game/tacticalProfile.ts's TacticalProfile — already fully wired
 * through ai.ts's decision logic, just never fed anything but the one
 * DEFAULT_TACTICAL_PROFILE until now (see Game.tsx's planAiTurn calls).
 * This screen is purely a data-and-labels problem on top of that existing
 * engine plumbing, not new AI behavior.
 */
export function TeamTactics({ teamId, onBack }: Props) {
  const [profile, setProfile] = useState<TacticalProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchTeamTactics(teamId)
      .then((dto) => setProfile(toTacticalProfile(dto)))
      .catch((e) => setError(String(e.message ?? e)));
  }, [teamId]);

  function setField(key: keyof TacticalProfile, value: number) {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function handleSave() {
    if (!profile) return;
    setError(null);
    setSaving(true);
    try {
      await updateTeamTactics(teamId, profile);
      setSaved(true);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Club
        </button>
        <h1>Tactics</h1>
      </div>
      <p className="career-muted">
        Shapes how this team plays whenever it isn't the one you're directly controlling — your own club's rival
        clubs, or your own team when left to the AI in a testing sandbox.
      </p>

      {error && <p className="career-error">{error}</p>}

      {profile === null ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="career-tactics-sliders">
            {SLIDERS.map((spec) => (
              <div key={spec.key} className="career-tactic-row">
                <div className="career-tactic-label">{spec.label}</div>
                <input
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={profile[spec.key]}
                  onChange={(e) => setField(spec.key, Number(e.target.value))}
                />
                <div className="career-tactic-endpoints">
                  <span>{spec.low}</span>
                  <span>{spec.high}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="career-preview-actions">
            <button type="button" className="career-home-button" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : saved ? "Saved" : "Save Tactics"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
