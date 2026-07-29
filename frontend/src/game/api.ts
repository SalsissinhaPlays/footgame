import type { PlayerDTO, TeamDTO } from "./types";

const API_BASE = "http://localhost:3001/api";

export async function fetchTeams(): Promise<TeamDTO[]> {
  const res = await fetch(`${API_BASE}/teams`);
  return res.json();
}

export async function fetchPlayers(teamId: number): Promise<PlayerDTO[]> {
  const res = await fetch(`${API_BASE}/teams/${teamId}/players`);
  return res.json();
}
