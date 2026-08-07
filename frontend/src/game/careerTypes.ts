// DTO shapes for the career-mode backend (saves/leagues/fixtures/transfers)
// — same hand-kept-in-sync-with-the-backend duplication convention
// types.ts's PlayerDTO/TeamDTO already established, just split into their
// own file since this is a distinct, larger group of shapes.

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

export interface TopScorerRow {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  goals: number;
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
