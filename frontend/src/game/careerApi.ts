import type { PlayerDTO, TeamDTO } from "./types";
import type { SaveDTO, LeagueDTO, FixtureDTO, StandingRow, TransferDTO } from "./careerTypes";

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

export function recordResult(fixtureId: number, homeScore: number, awayScore: number): Promise<FixtureDTO> {
  return fetch(`${API_BASE}/fixtures/${fixtureId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ home_score: homeScore, away_score: awayScore }),
  }).then(json<FixtureDTO>);
}

export function fetchStandings(leagueId: number): Promise<StandingRow[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/standings`).then(json<StandingRow[]>);
}

/** Instantly resolves every still-unplayed fixture in that round via the backend's quick-sim model — see quickSim.ts. */
export function simulateRound(leagueId: number, round: number): Promise<FixtureDTO[]> {
  return fetch(`${API_BASE}/leagues/${leagueId}/simulate-round`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ round }),
  }).then(json<FixtureDTO[]>);
}

/** Only valid once every fixture in the save's current league has a recorded score — creates next season's league + fixtures for the same teams. */
export function advanceSeason(saveId: number): Promise<LeagueDTO> {
  return fetch(`${API_BASE}/saves/${saveId}/advance-season`, { method: "POST" }).then(json<LeagueDTO>);
}
