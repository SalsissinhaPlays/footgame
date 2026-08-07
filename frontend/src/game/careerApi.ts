import type { PlayerDTO, TeamDTO } from "./types";
import type {
  SaveDTO,
  LeagueDTO,
  FixtureDTO,
  ManagerDTO,
  ManagerFiring,
  PlayerSearchDTO,
  StandingRow,
  TeamTacticsDTO,
  TopScorerRow,
  TransferDTO,
} from "./careerTypes";
import type { TacticalProfile } from "./tacticalProfile";
import type { LineupSlot } from "./formations";

// Same relative, same-origin path as api.ts (Vite proxies /api to the
// backend) — see that file's comment on why this must stay relative rather
// than a hardcoded localhost URL (tunneled playtests).
const API_BASE = "/api";
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Every backend error response is `{ error: string }` — surface it as a
 * real Error message instead of a generic "request failed." Called as
 * `.then(json<T>)` (explicit type argument) at every call site rather than
 * `.then(json)`, since TS can't infer json's generic from that position —
 * there's no argument to infer T from, only the return type, which
 * inference doesn't flow backward from.
 */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// --- Saves ---

export function fetchSaves(): Promise<SaveDTO[]> {
  return fetch(`${API_BASE}/saves`).then(json<SaveDTO[]>);
}

export function fetchSave(id: number): Promise<SaveDTO> {
  return fetch(`${API_BASE}/saves/${id}`).then(json<SaveDTO>);
}

/** Also auto-provisions a full 12-team starter league inside the new save — see the backend's POST /api/saves comment. */
export function createSave(name: string): Promise<SaveDTO> {
  return fetch(`${API_BASE}/saves`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then(json<SaveDTO>);
}

/** Sets which of the save's teams the player is managing. */
export function setUserTeam(saveId: number, teamId: number): Promise<SaveDTO> {
  return fetch(`${API_BASE}/saves/${saveId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ user_team_id: teamId }),
  }).then(json<SaveDTO>);
}

export function deleteSave(id: number): Promise<void> {
  return fetch(`${API_BASE}/saves/${id}`, { method: "DELETE" }).then(json<void>);
}

// --- Teams within a save ---

export function fetchSaveTeams(saveId: number): Promise<TeamDTO[]> {
  return fetch(`${API_BASE}/saves/${saveId}/teams`).then(json<TeamDTO[]>);
}

/** Every player across every team in the save, in one request — see the Search screen, the only consumer that needs "all players" rather than one team's roster. */
export function fetchSavePlayers(saveId: number): Promise<PlayerSearchDTO[]> {
  return fetch(`${API_BASE}/saves/${saveId}/players`).then(json<PlayerSearchDTO[]>);
}

export function createTeam(saveId: number, name: string): Promise<TeamDTO> {
  return fetch(`${API_BASE}/saves/${saveId}/teams`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then(json<TeamDTO>);
}

export function renameTeam(teamId: number, name: string): Promise<TeamDTO> {
  return fetch(`${API_BASE}/teams/${teamId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then(json<TeamDTO>);
}

export function deleteTeam(teamId: number): Promise<void> {
  return fetch(`${API_BASE}/teams/${teamId}`, { method: "DELETE" }).then(json<void>);
}

// --- Players ---
// fetchPlayers(teamId) already exists in ./api.ts (GET /api/teams/:id/players)
// and returns the exact same shape needed here — reused rather than duplicated.

export interface PlayerInput {
  name: string;
  position: string;
  jersey_number: number;
  pace?: number;
  stamina?: number;
  skill?: number;
  jumping?: number;
  shot_stopping?: number;
  reflexes?: number;
  heading?: number;
}

export function createPlayer(teamId: number, data: PlayerInput): Promise<PlayerDTO> {
  return fetch(`${API_BASE}/teams/${teamId}/players`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  }).then(json<PlayerDTO>);
}

export function updatePlayer(playerId: number, data: Partial<PlayerInput>): Promise<PlayerDTO> {
  return fetch(`${API_BASE}/players/${playerId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  }).then(json<PlayerDTO>);
}

export function deletePlayer(playerId: number): Promise<void> {
  return fetch(`${API_BASE}/players/${playerId}`, { method: "DELETE" }).then(json<void>);
}

export function transferPlayer(playerId: number, toTeamId: number, fee: number): Promise<PlayerDTO> {
  return fetch(`${API_BASE}/players/${playerId}/transfer`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ to_team_id: toTeamId, fee }),
  }).then(json<PlayerDTO>);
}

export function fetchPlayerTransfers(playerId: number): Promise<TransferDTO[]> {
  return fetch(`${API_BASE}/players/${playerId}/transfers`).then(json<TransferDTO[]>);
}

// --- Leagues ---

export function fetchSaveLeagues(saveId: number): Promise<LeagueDTO[]> {
  return fetch(`${API_BASE}/saves/${saveId}/leagues`).then(json<LeagueDTO[]>);
}

export function createLeague(saveId: number, name: string): Promise<LeagueDTO> {
  return fetch(`${API_BASE}/saves/${saveId}/leagues`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  }).then(json<LeagueDTO>);
}

export function deleteLeague(id: number): Promise<void> {
  return fetch(`${API_BASE}/leagues/${id}`, { method: "DELETE" }).then(json<void>);
}

export function fetchLeagueTeams(leagueId: number): Promise<TeamDTO[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/teams`).then(json<TeamDTO[]>);
}

export function addTeamToLeague(leagueId: number, teamId: number): Promise<void> {
  return fetch(`${API_BASE}/leagues/${leagueId}/teams`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ team_id: teamId }),
  }).then(json<void>);
}

export function removeTeamFromLeague(leagueId: number, teamId: number): Promise<void> {
  return fetch(`${API_BASE}/leagues/${leagueId}/teams/${teamId}`, { method: "DELETE" }).then(json<void>);
}

export function generateFixtures(leagueId: number): Promise<FixtureDTO[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/generate-fixtures`, { method: "POST" }).then(json<FixtureDTO[]>);
}

export function fetchFixtures(leagueId: number): Promise<FixtureDTO[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/fixtures`).then(json<FixtureDTO[]>);
}

/** scorerPlayerIds is one entry per goal (a player id repeated once per goal they scored) — omitted for quick-simmed fixtures, which have no per-goal data. See resolve.ts's GoalScorer/Game.tsx's match.scorers. */
export function recordResult(
  fixtureId: number,
  homeScore: number,
  awayScore: number,
  scorerPlayerIds?: number[]
): Promise<FixtureDTO> {
  return fetch(`${API_BASE}/fixtures/${fixtureId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ home_score: homeScore, away_score: awayScore, scorer_player_ids: scorerPlayerIds ?? [] }),
  }).then(json<FixtureDTO>);
}

export function fetchStandings(leagueId: number): Promise<StandingRow[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/standings`).then(json<StandingRow[]>);
}

/** Only ever reflects fixtures the player played interactively — see the backend endpoint's own comment. */
export function fetchTopScorers(leagueId: number): Promise<TopScorerRow[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/top-scorers`).then(json<TopScorerRow[]>);
}

/** Instantly resolves every still-unplayed fixture in that round via the backend's quick-sim model — see quickSim.ts. */
export function simulateRound(leagueId: number, round: number): Promise<FixtureDTO[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/simulate-round`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ round }),
  }).then(json<FixtureDTO[]>);
}

/**
 * Only valid once every fixture in the save's current league has a
 * recorded score — creates next season's league + fixtures for the same
 * teams. `firings` reports any AI clubs whose manager got sacked and
 * replaced as part of this rollover, weighted by how they finished — see
 * the backend's fireAndRehireManager.
 */
export function advanceSeason(saveId: number): Promise<LeagueDTO & { firings: ManagerFiring[] }> {
  return fetch(`${API_BASE}/saves/${saveId}/advance-season`, { method: "POST" }).then(
    json<LeagueDTO & { firings: ManagerFiring[] }>
  );
}

export function fetchManagers(saveId: number): Promise<ManagerDTO[]> {
  return fetch(`${API_BASE}/saves/${saveId}/managers`).then(json<ManagerDTO[]>);
}

// --- Team tactics ---
// A team with no saved row plays under game/tacticalProfile.ts's own
// DEFAULT_TACTICAL_PROFILE — the backend mirrors those exact defaults, see
// its own team_tactics/DEFAULT_TACTICS comments — so fetchTeamTactics
// always returns a usable TacticalProfile, never a "no tactics yet" state.

export function toTacticalProfile(dto: TeamTacticsDTO): TacticalProfile {
  return {
    defensiveLineDepthFrac: dto.defensive_line_depth_frac,
    pressingTriggerDistanceMult: dto.pressing_trigger_distance_mult,
    markingCoverageFrac: dto.marking_coverage_frac,
    attackingCommitmentFrac: dto.attacking_commitment_frac,
    supportingRunDepthMult: dto.supporting_run_depth_mult,
    shootingRangeMult: dto.shooting_range_mult,
    passRiskTolerance: dto.pass_risk_tolerance,
    crossBias: dto.cross_bias,
    sprintAggressiveness: dto.sprint_aggressiveness,
  };
}

export function fetchTeamTactics(teamId: number): Promise<TeamTacticsDTO> {
  return fetch(`${API_BASE}/teams/${teamId}/tactics`).then(json<TeamTacticsDTO>);
}

// --- Corner-kick presets ---
// Only ever for a team's OWN attacking corner — see db.ts's
// team_corner_presets comment for why a defensive setup and free-kicks
// aren't covered. offsets is in a corner-relative coordinate frame
// (alongAttack/alongTouch), not raw world x/y — see Game.tsx's
// cornerPresetOffset/applyCornerPreset for the transform to/from that.

export interface CornerOffset {
  alongAttack: number;
  alongTouch: number;
}

export interface CornerPresetDTO {
  team_id: number;
  offsets: CornerOffset[] | null;
}

export function fetchCornerPreset(teamId: number): Promise<CornerPresetDTO> {
  return fetch(`${API_BASE}/teams/${teamId}/corner-preset`).then(json<CornerPresetDTO>);
}

export function saveCornerPreset(teamId: number, offsets: CornerOffset[]): Promise<CornerPresetDTO> {
  return fetch(`${API_BASE}/teams/${teamId}/corner-preset`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ offsets }),
  }).then(json<CornerPresetDTO>);
}

// --- Base lineup / formation ---
// slots is stored opaquely on the backend (see db.ts's team_lineups
// comment) and already matches game/formations.ts's own LineupSlot shape
// one-to-one, so there's no snake_case/camelCase conversion layer needed
// here the way TacticalProfile/TeamTacticsDTO has.

export interface TeamLineupDTO {
  team_id: number;
  slots: LineupSlot[] | null;
}

export function fetchTeamLineup(teamId: number): Promise<TeamLineupDTO> {
  return fetch(`${API_BASE}/teams/${teamId}/lineup`).then(json<TeamLineupDTO>);
}

export function saveTeamLineup(teamId: number, slots: LineupSlot[]): Promise<TeamLineupDTO> {
  return fetch(`${API_BASE}/teams/${teamId}/lineup`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ slots }),
  }).then(json<TeamLineupDTO>);
}
