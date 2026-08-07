import type { PlayerDTO, TeamDTO } from "./types";

// Relative, same-origin path — Vite's dev server proxies this to the
// backend (see vite.config.ts's `server.proxy`). A hardcoded
// `http://localhost:3001/api` broke for anyone reaching the frontend
// through something like a Cloudflare tunnel: their browser would resolve
// "localhost" to their own machine, not the host's.
const API_BASE = "/api";

export async function fetchTeams(): Promise<TeamDTO[]> {
  const res = await fetch(`${API_BASE}/teams`);
  return res.json();
}

/** Single-team lookup — used by Game.tsx's career-match path to load a specific team's info by id, rather than always taking the first two rows off fetchTeams(). */
export async function fetchTeam(teamId: number): Promise<TeamDTO> {
  const res = await fetch(`${API_BASE}/teams/${teamId}`);
  return res.json();
}

export async function fetchPlayers(teamId: number): Promise<PlayerDTO[]> {
  const res = await fetch(`${API_BASE}/teams/${teamId}/players`);
  return res.json();
}
