import { useEffect, useMemo, useState } from "react";
import { fetchManagers, fetchSave, fetchSavePlayers, fetchSaveTeams } from "../../game/careerApi";
import type { ManagerDTO, PlayerSearchDTO, SaveDTO } from "../../game/careerTypes";
import type { TeamDTO } from "../../game/types";
import "./career.css";

interface Props {
  saveId: number;
  onBack: () => void;
}

type ResultKind = "manager" | "team" | "player";
type Selected = { kind: ResultKind; id: number } | null;

const RESULT_LIMIT = 25;
const ATTR_LABELS: Array<{ key: keyof PlayerSearchDTO & string; label: string }> = [
  { key: "pace", label: "Pace" },
  { key: "stamina", label: "Stamina" },
  { key: "skill", label: "Skill" },
  { key: "jumping", label: "Jumping" },
  { key: "shot_stopping", label: "Shot stopping" },
  { key: "reflexes", label: "Reflexes" },
  { key: "heading", label: "Heading" },
];

/**
 * Replaces the old flat Managers screen — "the 'Managers' button doesn't
 * really make sense from a gameplay perspective... turn this into a search
 * engine that can find managers, teams and players, seems more intuitive,"
 * in the words of the request this was built from. One text box, results
 * grouped by kind as you type, and clicking any result shows its detail in
 * the right-hand pane (a team's full roster, a player's attributes, a
 * manager's club) — no separate navigation/screens per kind, everything
 * stays on this one page. Per that same conversation, per-team manager
 * info surfacing elsewhere (e.g. on a team's own screen) is intentionally
 * left for later — this is just the lookup tool itself.
 */
export function Search({ saveId, onBack }: Props) {
  const [save, setSave] = useState<SaveDTO | null>(null);
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [managers, setManagers] = useState<ManagerDTO[]>([]);
  const [players, setPlayers] = useState<PlayerSearchDTO[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selected>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSave(saveId), fetchSaveTeams(saveId), fetchManagers(saveId), fetchSavePlayers(saveId)])
      .then(([s, t, m, p]) => {
        setSave(s);
        setTeams(t);
        setManagers(m);
        setPlayers(p);
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [saveId]);

  const q = query.trim().toLowerCase();

  const matchedManagers = useMemo(() => {
    if (!q) return [];
    return managers.filter((m) => m.name.toLowerCase().includes(q) || m.style.toLowerCase().includes(q)).slice(0, RESULT_LIMIT);
  }, [managers, q]);

  const matchedTeams = useMemo(() => {
    if (!q) return [];
    return teams.filter((t) => t.name.toLowerCase().includes(q)).slice(0, RESULT_LIMIT);
  }, [teams, q]);

  const matchedPlayers = useMemo(() => {
    if (!q) return [];
    return players
      .filter((p) => p.name.toLowerCase().includes(q) || p.team_name.toLowerCase().includes(q) || p.position.toLowerCase() === q)
      .slice(0, RESULT_LIMIT);
  }, [players, q]);

  // team_id -> the manager currently running them, if any (a free agent
  // isn't in this map at all, same "employed is derived" convention the
  // backend already uses).
  const managerByTeamId = useMemo(() => {
    const map = new Map<number, ManagerDTO>();
    for (const m of managers) if (m.team_id != null) map.set(m.team_id, m);
    return map;
  }, [managers]);

  function rosterFor(teamId: number): PlayerSearchDTO[] {
    return players.filter((p) => p.team_id === teamId).slice().sort((a, b) => a.jersey_number - b.jersey_number);
  }

  const selectedManager = selected?.kind === "manager" ? (managers.find((m) => m.id === selected.id) ?? null) : null;
  const selectedTeam = selected?.kind === "team" ? (teams.find((t) => t.id === selected.id) ?? null) : null;
  const selectedPlayer = selected?.kind === "player" ? (players.find((p) => p.id === selected.id) ?? null) : null;

  const hasQuery = q.length > 0;
  const hasResults = matchedManagers.length > 0 || matchedTeams.length > 0 || matchedPlayers.length > 0;

  function isActive(kind: ResultKind, id: number) {
    return selected?.kind === kind && selected.id === id;
  }

  return (
    <div className="career-page career-page-wide">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Club
        </button>
        <h1>Search</h1>
      </div>
      <p className="career-muted">Find any manager, club, or player in this save.</p>

      {error && <p className="career-error">{error}</p>}

      <input
        type="text"
        className="career-search-input"
        placeholder="Search managers, teams, players…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="career-team-mgmt">
          <div className="career-team-mgmt-list career-search-results">
            {!hasQuery && <p className="career-empty">Start typing to search.</p>}
            {hasQuery && !hasResults && <p className="career-empty">No matches.</p>}

            {matchedManagers.length > 0 && (
              <>
                <div className="career-formation-bench-label">Managers</div>
                {matchedManagers.map((m) => (
                  <button
                    key={`manager-${m.id}`}
                    type="button"
                    className={`career-team-mgmt-list-item${isActive("manager", m.id) ? " selected" : ""}`}
                    onClick={() => setSelected({ kind: "manager", id: m.id })}
                  >
                    <span className="career-manager-style">{m.style}</span>
                    <span className="career-team-mgmt-list-name">
                      {m.name} <span className="career-muted">— {m.team_name ?? "Free agent"}</span>
                    </span>
                  </button>
                ))}
              </>
            )}

            {matchedTeams.length > 0 && (
              <>
                <div className="career-formation-bench-label">Teams</div>
                {matchedTeams.map((t) => (
                  <button
                    key={`team-${t.id}`}
                    type="button"
                    className={`career-team-mgmt-list-item${isActive("team", t.id) ? " selected" : ""}`}
                    onClick={() => setSelected({ kind: "team", id: t.id })}
                  >
                    <span className="career-team-mgmt-list-name">{t.name}</span>
                    {t.id === save?.user_team_id && <span className="career-lineup-badge starting">Your club</span>}
                  </button>
                ))}
              </>
            )}

            {matchedPlayers.length > 0 && (
              <>
                <div className="career-formation-bench-label">Players</div>
                {matchedPlayers.map((p) => (
                  <button
                    key={`player-${p.id}`}
                    type="button"
                    className={`career-team-mgmt-list-item${isActive("player", p.id) ? " selected" : ""}`}
                    onClick={() => setSelected({ kind: "player", id: p.id })}
                  >
                    <span className="career-team-mgmt-list-pos">{p.position}</span>
                    <span className="career-team-mgmt-list-name">
                      #{p.jersey_number} {p.name} <span className="career-muted">— {p.team_name}</span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="career-team-mgmt-detail">
            {selectedManager && (
              <div>
                <h2>{selectedManager.name}</h2>
                <p>
                  <span className="career-manager-style">{selectedManager.style}</span>
                </p>
                <p className="career-muted">
                  {selectedManager.team_name
                    ? `Manages ${selectedManager.team_name}`
                    : "Free agent — currently unemployed."}
                </p>
              </div>
            )}

            {selectedTeam && (
              <div>
                <h2>{selectedTeam.name}</h2>
                <p className="career-muted">
                  {selectedTeam.id === save?.user_team_id
                    ? "You manage this club yourself."
                    : managerByTeamId.has(selectedTeam.id)
                      ? `Managed by ${managerByTeamId.get(selectedTeam.id)!.name} (${managerByTeamId.get(selectedTeam.id)!.style})`
                      : "No manager currently assigned."}
                </p>
                <ul className="career-list">
                  {rosterFor(selectedTeam.id).map((p) => (
                    <li key={p.id} className="career-list-row">
                      <span className="career-preview-player-pos">{p.position}</span>
                      <span className="career-preview-player-name">
                        #{p.jersey_number} {p.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedPlayer && (
              <div>
                <h2>
                  #{selectedPlayer.jersey_number} {selectedPlayer.name}
                </h2>
                <p className="career-muted">
                  {selectedPlayer.position}, age {selectedPlayer.age} — {selectedPlayer.team_name}
                </p>
                <div className="career-player-detail-attrs">
                  {ATTR_LABELS.map(({ key, label }) => (
                    <div key={key} className="career-attr-row">
                      <span>{label}</span>
                      <span>{selectedPlayer[key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!selected && <p className="career-empty">Select a result to see details.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
