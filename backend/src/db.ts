import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "..", "data", "game.db");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function seedIfEmpty() {
  const teamCount = db.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number };
  if (teamCount.n > 0) return;

  const insertTeam = db.prepare("INSERT INTO teams (name) VALUES (?)");
  const insertPlayer = db.prepare(
    `INSERT INTO players (team_id, name, position, jersey_number, pace, stamina, skill)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const demoSquad = [
    { name: "Goalkeeper Silva", position: "GK", jersey_number: 1, pace: 40, stamina: 60, skill: 55 },
    { name: "Defender Costa", position: "DEF", jersey_number: 2, pace: 55, stamina: 65, skill: 50 },
    { name: "Defender Lima", position: "DEF", jersey_number: 3, pace: 50, stamina: 65, skill: 52 },
    { name: "Midfielder Souza", position: "MID", jersey_number: 8, pace: 60, stamina: 70, skill: 60 },
    { name: "Midfielder Alves", position: "MID", jersey_number: 10, pace: 62, stamina: 68, skill: 65 },
    { name: "Striker Rocha", position: "FWD", jersey_number: 9, pace: 70, stamina: 60, skill: 58 },
  ];

  for (const teamName of ["Eagle FC", "Rival United"]) {
    const teamId = insertTeam.run(teamName).lastInsertRowid;
    for (const p of demoSquad) {
      insertPlayer.run(teamId, p.name, p.position, p.jersey_number, p.pace, p.stamina, p.skill);
    }
  }
}

seedIfEmpty();
