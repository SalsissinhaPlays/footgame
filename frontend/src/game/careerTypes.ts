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
