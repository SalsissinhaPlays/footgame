import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "..", "data", "game.db");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS saves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position TEXT NOT NULL,
    jersey_number INTEGER NOT NULL,
    pace INTEGER NOT NULL DEFAULT 50,
    stamina INTEGER NOT NULL DEFAULT 50,
    skill INTEGER NOT NULL DEFAULT 50,
    jumping INTEGER NOT NULL DEFAULT 50,
    shot_stopping INTEGER NOT NULL DEFAULT 50,
    reflexes INTEGER NOT NULL DEFAULT 50,
    heading INTEGER NOT NULL DEFAULT 50,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A transfer is always team-to-team (sign a player away from their
  -- current team) — free agents / an unsigned player pool are a separate,
  -- not-yet-built concept (they'd belong with newgens/player generation,
  -- not here) and deliberately out of scope for this table.
  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    from_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    to_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    fee INTEGER NOT NULL DEFAULT 0,
    -- Nullable: a transfer between teams that aren't part of any save (e.g.
    -- today's unscoped demo teams) has no season to record it against.
    season INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Unlike a transfer, a league only makes sense within a save's world, so
  -- save_id is NOT NULL here. Each row is one competition for one season —
  -- "the same league" continuing next season with different membership is
  -- just a new row, not a mutation of this one. That sidesteps
  -- promotion/relegation entirely, which isn't a requirement yet.
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    save_id INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    season INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS league_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    UNIQUE(league_id, team_id)
  );

  -- home_score/away_score are NULL until the fixture is played — standings
  -- are computed live from these (see computeStandings in index.ts) rather
  -- than stored as a separately-maintained table, so there's no way for a
  -- standings row to drift out of sync with the actual results.
  CREATE TABLE IF NOT EXISTS fixtures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    home_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    away_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    home_score INTEGER,
    away_score INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// CREATE TABLE IF NOT EXISTS is a no-op against a DB that already exists on
// disk from before these columns existed — it does NOT add columns to an
// already-existing table. This migration runs unconditionally on every
// startup so both a fresh DB (columns already present, no-op) and an
// existing one (columns backfilled to the DEFAULT value) end up consistent.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("players", "jumping", "jumping INTEGER NOT NULL DEFAULT 50");
ensureColumn("players", "shot_stopping", "shot_stopping INTEGER NOT NULL DEFAULT 50");
ensureColumn("players", "reflexes", "reflexes INTEGER NOT NULL DEFAULT 50");
ensureColumn("players", "heading", "heading INTEGER NOT NULL DEFAULT 50");
// Nullable, no default: existing teams (today's seeded demo data, and any
// team created before saves existed) get save_id = NULL, meaning "not part
// of any save" — that's what keeps the existing unscoped GET /api/teams
// path (used by the live match/hotseat/AI/sandbox flows) behaving exactly
// as it does today. save_id only matters to the new, separate
// /api/saves/... routes. players don't get their own save_id — they
// inherit their save through team_id, same as they already inherit
// everything else about their team.
ensureColumn("teams", "save_id", "save_id INTEGER REFERENCES saves(id) ON DELETE CASCADE");
// The minimal "time is passing" primitive a save needs — deliberately just
// a season counter, not a full calendar/date system, since nothing
// (Transfers, and later Leagues/Progression) needs day-level granularity
// yet. Starts at 1; nothing currently advances it — that action belongs
// with whichever system first needs to trigger "a season ended" (Leagues'
// fixture list finishing, most likely), not built speculatively here.
ensureColumn("saves", "season", "season INTEGER NOT NULL DEFAULT 1");
// Nullable: a save's user-chosen team, set via PATCH /api/saves/:id once
// the player picks one from the auto-generated starter league (see
// starterLeague.ts and POST /api/saves) — null only briefly between a save
// being created and the choice actually being made.
ensureColumn("saves", "user_team_id", "user_team_id INTEGER REFERENCES teams(id)");

function seedIfEmpty() {
  const teamCount = db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number };
  if (teamCount.n > 0) return;

  const insertTeam = db.prepare("INSERT INTO teams (name) VALUES (?)");
  const insertPlayer = db.prepare(
    `INSERT INTO players (team_id, name, position, jersey_number, pace, stamina, skill, jumping, shot_stopping, reflexes, heading)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // The keeper is a clear specialist in jumping/shot_stopping/reflexes;
  // outfield players get a modest generic jumping value (relevant to
  // headers, not the point of this feature for them) and low, mostly-
  // irrelevant shot_stopping/reflexes. heading matters for any outfield
  // player who might contest a header — strikers/defenders skew slightly
  // higher (finishing headers / defensive clearances) than midfielders; the
  // GK's own heading is largely irrelevant to his job but still gets a
  // generic value for consistency. Starting points for playtesting.
  const demoSquad = [
    { name: "Goalkeeper Silva", position: "GK", jersey_number: 1, pace: 40, stamina: 60, skill: 55, jumping: 70, shot_stopping: 75, reflexes: 72, heading: 40 },
    { name: "Defender Costa", position: "DEF", jersey_number: 2, pace: 55, stamina: 65, skill: 50, jumping: 55, shot_stopping: 20, reflexes: 30, heading: 60 },
    { name: "Defender Lima", position: "DEF", jersey_number: 3, pace: 50, stamina: 65, skill: 52, jumping: 50, shot_stopping: 20, reflexes: 30, heading: 58 },
    { name: "Midfielder Souza", position: "MID", jersey_number: 8, pace: 60, stamina: 70, skill: 60, jumping: 45, shot_stopping: 15, reflexes: 25, heading: 50 },
    { name: "Midfielder Alves", position: "MID", jersey_number: 10, pace: 62, stamina: 68, skill: 65, jumping: 45, shot_stopping: 15, reflexes: 25, heading: 52 },
    { name: "Striker Rocha", position: "FWD", jersey_number: 9, pace: 70, stamina: 60, skill: 58, jumping: 50, shot_stopping: 10, reflexes: 20, heading: 65 },
  ];

  for (const teamName of ["Eagle FC", "Rival United"]) {
    const teamId = insertTeam.run(teamName).lastInsertRowid;
    for (const p of demoSquad) {
      insertPlayer.run(
        teamId,
        p.name,
        p.position,
        p.jersey_number,
        p.pace,
        p.stamina,
        p.skill,
        p.jumping,
        p.shot_stopping,
        p.reflexes,
        p.heading
      );
    }
  }
}

seedIfEmpty();
