// DTO shapes for the career-mode backend (saves/leagues/fixtures/transfers)
// — same hand-kept-in-sync-with-the-backend duplication convention
// types.ts's PlayerDTO/TeamDTO already established, just split into their
// own file since this is a distinct, larger group of shapes.

import type { PlayerDTO } from "./types";

export interface SaveDTO {
  id: number;
  name: string;
  season: number;
  created_at: string;
  /** Which of the save's (auto-generated) teams the player is managing — null until they choose one on the ChooseTeam screen. */
  user_team_id: number | null;
}

export interface LeagueDTO {
  id: number;
  save_id: number;
  name: string;
  season: number;
  created_at: string;
}

export interface FixtureDTO {
  id: number;
  league_id: number;
  round: number;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  created_at: string;
}

export interface StandingRow {
  team_id: number;
  team_name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
}

/** Snake_case, matching the backend's team_tactics table — see careerApi.ts's toTacticalProfile/fromTacticalProfile for the mapping to/from game/tacticalProfile.ts's camelCase TacticalProfile. */
export interface TeamTacticsDTO {
  team_id: number;
  defensive_line_depth_frac: number;
  pressing_trigger_distance_mult: number;
  marking_coverage_frac: number;
  attacking_commitment_frac: number;
  supporting_run_depth_mult: number;
  shooting_range_mult: number;
  pass_risk_tolerance: number;
  cross_bias: number;
  sprint_aggressiveness: number;
}

/**
 * A manager's own tactical profile (same 9 fields as TeamTacticsDTO,
 * duplicated rather than nested — see managers' own backend table
 * comment for why: a manager owns their tactics intrinsically, a team
 * just borrows whichever manager's currently assigned). `team_id`/
 * `team_name` are null for a free agent — nobody currently employs them.
 */
export interface ManagerDTO {
  id: number;
  save_id: number;
  name: string;
  style: string;
  defensive_line_depth_frac: number;
  pressing_trigger_distance_mult: number;
  marking_coverage_frac: number;
  attacking_commitment_frac: number;
  supporting_run_depth_mult: number;
  shooting_range_mult: number;
  pass_risk_tolerance: number;
  cross_bias: number;
  sprint_aggressiveness: number;
  created_at: string;
  team_id: number | null;
  team_name: string | null;
}

/** One club's manager getting sacked and replaced — see careerApi.ts's advanceSeason. */
export interface ManagerFiring {
  team_id: number;
  team_name: string;
  old_manager_name: string;
  new_manager_name: string;
  new_style: string;
}

/** A human-team player who rolled into retirement this rollover but hasn't been finalized — see careerApi.ts's advanceSeason/finalizeRetirement, and ClubHome's Keep/Let go banner. */
export interface PendingRetirement {
  player_id: number;
  name: string;
  position: string;
  age: number;
  team_id: number;
}

/** An AI-controlled team's retirement, already resolved (player replaced by a newgen) by the time advance-season returns — purely informational, nothing to act on. */
export interface ResolvedRetirement {
  team_id: number;
  team_name: string;
  player_name: string;
  age: number;
  newgen_name: string;
}

export interface TopScorerRow {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  goals: number;
}

/** A PlayerDTO row plus the owning team's name — see careerApi.ts's fetchSavePlayers, which is the Search screen's own single-fetch alternative to N per-team fetchPlayers calls. */
export interface PlayerSearchDTO extends PlayerDTO {
  team_name: string;
}

export interface TransferDTO {
  id: number;
  player_id: number;
  from_team_id: number;
  to_team_id: number;
  fee: number;
  /** null for a transfer between teams outside any save. */
  season: number | null;
  created_at: string;
}
