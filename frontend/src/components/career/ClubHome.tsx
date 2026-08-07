import { useEffect, useState } from "react";
import { advanceSeason, fetchFixtures, fetchSave, fetchSaveLeagues, fetchSaveTeams } from "../../game/careerApi";
import type { FixtureDTO, LeagueDTO, ManagerFiring, SaveDTO } from "../../game/careerTypes";
import type { TeamDTO } from "../../game/types";
import "./career.css";

interface Props {
  saveId: number;
  onOpenCalendar: (leagueId: number) => void;
  onOpenTeamManagement: (teamId: number) => void;
  onOpenManagers: () => void;
  /**
   * Launches the fixture as a real interactive match — see Career.tsx's
   * "match" screen. Passes the user's own team id too: a fixture's
   * home_team_id/away_team_id reflect the round-robin schedule, not who's
   * human-controlled, and roughly half of a season's fixtures list the
   * player's team as away — Career.tsx needs to know which one is really
   * theirs to make sure the human always ends up controlling their own
   * club, not whichever side the schedule happened to list first. Also
   * passes the opponent's display name — ClubHome already has the full
   * team list loaded, so the next screen (lineup selection) doesn't need
   * its own redundant fetch just to show "vs Crimson City".
   */
  onPlayFixture: (fixture: FixtureDTO, leagueId: number, userTeamId: number, opponentName: string) => void;
  onSave: () => void;
  onExit: () => void;
}

/**
 * The club's home screen — where every save lands once a team's been
 * chosen (New Game's pick flow, or reopening via Continue/Load Game).
 * Replaces the raw Teams/Leagues admin screen (SaveDetail) as the main
 * hub: "Next Match" is the one and only way to advance the season, which
 * is what fixes the earlier bug where any fixture (not just the player's
 * own) could be launched from League Detail's fixture list.
 */
export function ClubHome({
  saveId,
  onOpenCalendar,
  onOpenTeamManagement,
  onOpenManagers,
  onPlayFixture,
  onSave,
  onExit,
}: Props) {
  const [save, setSave] = useState<SaveDTO | null>(null);
  const [league, setLeague] = useState<LeagueDTO | null>(null);
  const [fixtures, setFixtures] = useState<FixtureDTO[]>([]);
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [lastFirings, setLastFirings] = useState<ManagerFiring[]>([]);

  function reload() {
    fetchSave(saveId)
      .then(setSave)
      .catch((e) => setError(String(e.message ?? e)));
    fetchSaveTeams(saveId)
      .then(setTeams)
      .catch((e) => setError(String(e.message ?? e)));
    fetchSaveLeagues(saveId)
      .then((leagues) => {
        // Leagues come back ordered by season DESC (see careerApi) — the
        // first one is always the current season, same convention the
        // backend's own advance-season endpoint uses.
        const current = leagues[0] ?? null;
        setLeague(current);
        if (current) {
          fetchFixtures(current.id)
            .then(setFixtures)
            .catch((e) => setError(String(e.message ?? e)));
        } else {
          setFixtures([]);
        }
      })
      .catch((e) => setError(String(e.message ?? e)));
  }

  useEffect(reload, [saveId]);

  const teamName = (id: number) => teams.find((t) => t.id === id)?.name ?? `#${id}`;
  const userTeamId = save?.user_team_id ?? null;

  const nextMatch =
    userTeamId != null
      ? [...fixtures]
          .filter((f) => f.home_team_id === userTeamId || f.away_team_id === userTeamId)
          .sort((a, b) => a.round - b.round)
          .find((f) => f.home_score === null) ?? null
      : null;
  const seasonComplete = fixtures.length > 0 && fixtures.every((f) => f.home_score !== null);

  async function handleAdvanceSeason() {
    setError(null);
    setAdvancing(true);
    try {
      const result = await advanceSeason(saveId);
      setLastFirings(result.firings);
      reload();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <div className="career-page">
      <div className="career-header">
        <h1>{save?.name ?? "Club"}</h1>
      </div>
      {userTeamId != null && teams.length > 0 && (
        <p className="career-muted">
          Managing {teamName(userTeamId)}
          {league ? ` — ${league.name} (season ${league.season})` : ""}
        </p>
      )}

      {error && <p className="career-error">{error}</p>}

      {lastFirings.length > 0 && (
        <div className="career-section career-firings-banner">
          <h2>Managerial changes this season</h2>
          <ul className="career-list">
            {lastFirings.map((f) => (
              <li key={f.team_id} className="career-manager-row">
                <span className="career-manager-team">{f.team_name}</span>
                <span className="career-manager-name">
                  {f.old_manager_name} out, {f.new_manager_name} in
                </span>
                <span className="career-manager-style">{f.new_style}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="career-home-options">
        <button type="button" className="career-home-button" disabled title="Coming soon — needs a market/events system first.">
          News
        </button>

        {seasonComplete ? (
          <button type="button" className="career-home-button" disabled={advancing} onClick={handleAdvanceSeason}>
            {advancing ? "Preparing next season…" : `Start Season ${(league?.season ?? 1) + 1}`}
          </button>
        ) : (
          <button
            type="button"
            className="career-home-button"
            disabled={!nextMatch || !league}
            onClick={() =>
              nextMatch &&
              league &&
              userTeamId != null &&
              onPlayFixture(
                nextMatch,
                league.id,
                userTeamId,
                teamName(nextMatch.home_team_id === userTeamId ? nextMatch.away_team_id : nextMatch.home_team_id)
              )
            }
          >
            {nextMatch ? `Next Match: ${teamName(nextMatch.home_team_id)} vs ${teamName(nextMatch.away_team_id)}` : "Next Match"}
          </button>
        )}

        <button type="button" className="career-home-button" disabled={!league} onClick={() => league && onOpenCalendar(league.id)}>
          Calendar
        </button>
        <button
          type="button"
          className="career-home-button"
          disabled={userTeamId == null}
          onClick={() => userTeamId != null && onOpenTeamManagement(userTeamId)}
        >
          Team Management
        </button>
        <button type="button" className="career-home-button" onClick={onOpenManagers}>
          Managers
        </button>
        <button type="button" className="career-home-button career-home-button-secondary" onClick={onSave}>
          Save
        </button>
        <button type="button" className="career-home-button career-home-button-secondary" onClick={onExit}>
          Exit
        </button>
      </div>
    </div>
  );
}
