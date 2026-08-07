import { useEffect, useMemo, useState } from "react";
import { fetchFixtures, fetchLeagueTeams, fetchStandings } from "../../game/careerApi";
import type { FixtureDTO, StandingRow } from "../../game/careerTypes";
import type { TeamDTO } from "../../game/types";
import "./career.css";

interface Props {
  leagueId: number;
  onBack: () => void;
}

/**
 * Read-only view of the season: fixtures grouped by round, plus the
 * standings table. There's deliberately no "Play"/manual-score-entry here
 * anymore — that's what used to let the player launch (or hand-edit) any
 * fixture on the calendar, not just their own. The only way to actually
 * advance the season now is Club Home's "Next Match" tile, which always
 * plays the player's own next fixture and auto-resolves the rest of that
 * round alongside it.
 */
export function Calendar({ leagueId, onBack }: Props) {
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [fixtures, setFixtures] = useState<FixtureDTO[]>([]);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLeagueTeams(leagueId)
      .then(setTeams)
      .catch((e) => setError(String(e.message ?? e)));
    fetchFixtures(leagueId)
      .then(setFixtures)
      .catch((e) => setError(String(e.message ?? e)));
    fetchStandings(leagueId)
      .then(setStandings)
      .catch((e) => setError(String(e.message ?? e)));
  }, [leagueId]);

  const teamName = useMemo(() => {
    const map = new Map(teams.map((t) => [t.id, t.name]));
    return (id: number) => map.get(id) ?? `#${id}`;
  }, [teams]);

  const rounds = useMemo(() => {
    const byRound = new Map<number, FixtureDTO[]>();
    for (const f of fixtures) {
      if (!byRound.has(f.round)) byRound.set(f.round, []);
      byRound.get(f.round)!.push(f);
    }
    return [...byRound.entries()].sort(([a], [b]) => a - b);
  }, [fixtures]);

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Club
        </button>
        <h1>Calendar</h1>
      </div>

      {error && <p className="career-error">{error}</p>}

      <div className="career-section">
        <h2>Standings</h2>
        {standings.length === 0 ? (
          <p className="career-empty">No teams in this league yet.</p>
        ) : (
          <table className="career-standings-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>P</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF</th>
                <th>GA</th>
                <th>GD</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((r) => (
                <tr key={r.team_id}>
                  <td>{r.team_name}</td>
                  <td>{r.played}</td>
                  <td>{r.won}</td>
                  <td>{r.drawn}</td>
                  <td>{r.lost}</td>
                  <td>{r.goals_for}</td>
                  <td>{r.goals_against}</td>
                  <td>{r.goal_difference}</td>
                  <td>
                    <strong>{r.points}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="career-section">
        <h2>Fixtures</h2>
        {rounds.length === 0 ? (
          <p className="career-empty">No fixtures yet.</p>
        ) : (
          <div style={{ marginTop: 14 }}>
            {rounds.map(([round, roundFixtures]) => (
              <div key={round} className="career-round">
                <h3>Round {round}</h3>
                {roundFixtures.map((f) => {
                  const played = f.home_score !== null && f.away_score !== null;
                  return (
                    <div key={f.id} className="career-fixture-row">
                      <span className="career-fixture-team home">{teamName(f.home_team_id)}</span>
                      <span className="career-fixture-score">
                        {played ? (
                          <>
                            {f.home_score} – {f.away_score}
                          </>
                        ) : (
                          <span className="career-muted">vs</span>
                        )}
                      </span>
                      <span className="career-fixture-team away">{teamName(f.away_team_id)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
