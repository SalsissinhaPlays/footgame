import express from "express";
import cors from "cors";
import { db } from "./db.js";
import { generateRoundRobin } from "./fixtures.js";
import { generateStarterLeague } from "./starterLeague.js";
import { computeTeamStrength, simulateScore, type PlayerAttrs } from "./quickSim.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Unscoped — deliberately untouched by the saves work below. This is what
// the live match/hotseat/AI/Team-Management-sandbox flows call today, and
// it keeps returning every team regardless of save_id (including the
// save_id = NULL demo teams), so none of that existing behavior changes.
app.get("/api/teams", (_req, res) => {
  const teams = db.prepare("SELECT * FROM teams").all();
  res.json(teams);
});

// Single-team lookup — needed so the match flow can load one specific
// career team's info (name) when launched with an explicit team id, rather
// than always pulling the first two rows from the unscoped list above.
app.get("/api/teams/:id", (req, res) => {
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(req.params.id);
  if (!team) {
    res.status(404).json({ error: "team not found" });
    return;
  }
  res.json(team);
});

app.get("/api/teams/:id/players", (req, res) => {
  const players = db
    .prepare("SELECT * FROM players WHERE team_id = ? ORDER BY jersey_number")
    .all(req.params.id);
  res.json(players);
});

// --- Saves ---
// A save is the label that lets teams/players belong to a particular career
// instead of being one shared global pool — see db.ts's save_id migration
// comment.

/**
 * Creating a save auto-provisions a full 12-team, 12-players-each starter
 * league (see starterLeague.ts) with a complete fixture schedule, all in
 * one transaction — the player should never have to manually build teams
 * or a league from an empty save; that's exactly the busywork this
 * replaces. user_team_id stays null until they choose one via
 * PATCH /api/saves/:id.
 */
app.post("/api/saves", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  let saveId: number;
  db.exec("BEGIN");
  try {
    saveId = Number(db.prepare("INSERT INTO saves (name) VALUES (?)").run(name).lastInsertRowid);

    const starterTeams = generateStarterLeague();
    const insertTeam = db.prepare("INSERT INTO teams (name, save_id) VALUES (?, ?)");
    const insertPlayer = db.prepare(
      `INSERT INTO players (team_id, name, position, jersey_number, pace, stamina, skill, jumping, shot_stopping, reflexes, heading)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const teamIds: number[] = [];
    for (const team of starterTeams) {
      const teamId = Number(insertTeam.run(team.name, saveId).lastInsertRowid);
      teamIds.push(teamId);
      for (const p of team.players) {
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

    const leagueId = Number(
      db.prepare("INSERT INTO leagues (save_id, name, season) VALUES (?, ?, 1)").run(saveId, "Season 1 League")
        .lastInsertRowid
    );
    const insertLeagueTeam = db.prepare("INSERT INTO league_teams (league_id, team_id) VALUES (?, ?)");
    for (const teamId of teamIds) insertLeagueTeam.run(leagueId, teamId);

    const pairs = generateRoundRobin(teamIds);
    const insertFixture = db.prepare(
      "INSERT INTO fixtures (league_id, round, home_team_id, away_team_id) VALUES (?, ?, ?, ?)"
    );
    for (const pair of pairs) insertFixture.run(leagueId, pair.round, pair.homeTeamId, pair.awayTeamId);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.status(201).json(db.prepare("SELECT * FROM saves WHERE id = ?").get(saveId));
});

app.get("/api/saves", (_req, res) => {
  const saves = db.prepare("SELECT * FROM saves ORDER BY created_at DESC").all();
  res.json(saves);
});

/** Sets which of the save's (auto-generated) teams the player is actually managing. */
app.patch("/api/saves/:id", (req, res) => {
  const save = db.prepare("SELECT * FROM saves WHERE id = ?").get(req.params.id) as { id: number } | undefined;
  if (!save) {
    res.status(404).json({ error: "save not found" });
    return;
  }
  const userTeamId = req.body?.user_team_id;
  if (typeof userTeamId !== "number") {
    res.status(400).json({ error: "user_team_id is required" });
    return;
  }
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(userTeamId) as
    | { save_id: number | null }
    | undefined;
  if (!team || team.save_id !== save.id) {
    res.status(400).json({ error: "team does not belong to this save" });
    return;
  }
  db.prepare("UPDATE saves SET user_team_id = ? WHERE id = ?").run(userTeamId, req.params.id);
  res.json(db.prepare("SELECT * FROM saves WHERE id = ?").get(req.params.id));
});

app.get("/api/saves/:id", (req, res) => {
  const save = db.prepare("SELECT * FROM saves WHERE id = ?").get(req.params.id);
  if (!save) {
    res.status(404).json({ error: "save not found" });
    return;
  }
  res.json(save);
});

app.delete("/api/saves/:id", (req, res) => {
  // ON DELETE CASCADE on teams.save_id (and teams -> players is already
  // cascading) means this one statement removes every team and player that
  // belonged to this save too.
  const result = db.prepare("DELETE FROM saves WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "save not found" });
    return;
  }
  res.status(204).end();
});

// --- Teams within a save ---

app.get("/api/saves/:id/teams", (req, res) => {
  const teams = db.prepare("SELECT * FROM teams WHERE save_id = ?").all(req.params.id);
  res.json(teams);
});

app.post("/api/saves/:id/teams", (req, res) => {
  const save = db.prepare("SELECT id FROM saves WHERE id = ?").get(req.params.id);
  if (!save) {
    res.status(404).json({ error: "save not found" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const result = db.prepare("INSERT INTO teams (name, save_id) VALUES (?, ?)").run(name, req.params.id);
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(team);
});

app.patch("/api/teams/:id", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const result = db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(name, req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "team not found" });
    return;
  }
  res.json(db.prepare("SELECT * FROM teams WHERE id = ?").get(req.params.id));
});

app.delete("/api/teams/:id", (req, res) => {
  // A team currently set as some save's user_team_id can't be deleted (no
  // ON DELETE clause on that reference — see db.ts) — checked explicitly
  // here so that surfaces as a clean 400 instead of an unhandled 500 from
  // the raw FOREIGN KEY constraint failure.
  const referencingSave = db.prepare("SELECT id FROM saves WHERE user_team_id = ?").get(req.params.id);
  if (referencingSave) {
    res.status(400).json({ error: "can't delete the team currently chosen as a save's managed team" });
    return;
  }
  const result = db.prepare("DELETE FROM teams WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "team not found" });
    return;
  }
  res.status(204).end();
});

// --- Players within a team ---
// Attribute fields are optional in the request body and fall back to the
// same DEFAULT 50 the players table itself already uses — a caller can
// create a bare-minimum player and tune attributes later via PATCH.

const PLAYER_ATTRIBUTES = ["pace", "stamina", "skill", "jumping", "shot_stopping", "reflexes", "heading"] as const;

function readAttribute(body: unknown, key: string): number {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 50;
}

app.post("/api/teams/:id/players", (req, res) => {
  const team = db.prepare("SELECT id FROM teams WHERE id = ?").get(req.params.id);
  if (!team) {
    res.status(404).json({ error: "team not found" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const position = typeof req.body?.position === "string" ? req.body.position.trim() : "";
  const jerseyNumber = req.body?.jersey_number;
  if (!name || !position || typeof jerseyNumber !== "number") {
    res.status(400).json({ error: "name, position, and jersey_number are required" });
    return;
  }
  const attrs = PLAYER_ATTRIBUTES.map((key) => readAttribute(req.body, key));
  const result = db
    .prepare(
      `INSERT INTO players (team_id, name, position, jersey_number, pace, stamina, skill, jumping, shot_stopping, reflexes, heading)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.params.id, name, position, jerseyNumber, ...attrs);
  res.status(201).json(db.prepare("SELECT * FROM players WHERE id = ?").get(result.lastInsertRowid));
});

app.patch("/api/players/:id", (req, res) => {
  const existing = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: "player not found" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : String(existing.name);
  const position = typeof req.body?.position === "string" ? req.body.position.trim() : String(existing.position);
  const jerseyNumber =
    typeof req.body?.jersey_number === "number" ? req.body.jersey_number : Number(existing.jersey_number);
  const attrs = PLAYER_ATTRIBUTES.map((key) =>
    typeof req.body?.[key] === "number" ? req.body[key] : Number(existing[key])
  );
  db.prepare(
    `UPDATE players SET name = ?, position = ?, jersey_number = ?, pace = ?, stamina = ?, skill = ?, jumping = ?, shot_stopping = ?, reflexes = ?, heading = ?
     WHERE id = ?`
  ).run(name, position, jerseyNumber, ...attrs, req.params.id);
  res.json(db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id));
});

app.delete("/api/players/:id", (req, res) => {
  const result = db.prepare("DELETE FROM players WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "player not found" });
    return;
  }
  res.status(204).end();
});

// --- Transfers ---
// A transfer moves a player to a different team and logs the move — see
// db.ts's transfers table comment for why it's always team-to-team (no
// free-agent pool yet). The insert + team_id update happen inside one
// transaction so a failure partway through can't leave the log and the
// player's actual team out of sync with each other.

app.post("/api/players/:id/transfer", (req, res) => {
  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(req.params.id) as
    | { id: number; team_id: number }
    | undefined;
  if (!player) {
    res.status(404).json({ error: "player not found" });
    return;
  }
  const toTeamId = req.body?.to_team_id;
  if (typeof toTeamId !== "number") {
    res.status(400).json({ error: "to_team_id is required" });
    return;
  }
  const toTeam = db.prepare("SELECT * FROM teams WHERE id = ?").get(toTeamId) as
    | { id: number; save_id: number | null }
    | undefined;
  if (!toTeam) {
    res.status(404).json({ error: "destination team not found" });
    return;
  }
  if (toTeam.id === player.team_id) {
    res.status(400).json({ error: "player is already on that team" });
    return;
  }
  const fee = typeof req.body?.fee === "number" ? req.body.fee : 0;

  // The transfer's season comes from the DESTINATION team's save (the
  // career this move is actually happening within) — a team with no save
  // (save_id null, e.g. today's demo teams) records a null season, same
  // reasoning as db.ts's column comment.
  const season = toTeam.save_id
    ? ((db.prepare("SELECT season FROM saves WHERE id = ?").get(toTeam.save_id) as { season: number } | undefined)
        ?.season ?? null)
    : null;

  const fromTeamId = player.team_id;
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO transfers (player_id, from_team_id, to_team_id, fee, season) VALUES (?, ?, ?, ?, ?)"
    ).run(player.id, fromTeamId, toTeamId, fee, season);
    db.prepare("UPDATE players SET team_id = ? WHERE id = ?").run(toTeamId, player.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.status(201).json(db.prepare("SELECT * FROM players WHERE id = ?").get(player.id));
});

app.get("/api/players/:id/transfers", (req, res) => {
  const transfers = db
    .prepare("SELECT * FROM transfers WHERE player_id = ? ORDER BY created_at DESC")
    .all(req.params.id);
  res.json(transfers);
});

app.get("/api/teams/:id/transfers", (req, res) => {
  const transfers = db
    .prepare("SELECT * FROM transfers WHERE from_team_id = ? OR to_team_id = ? ORDER BY created_at DESC")
    .all(req.params.id, req.params.id);
  res.json(transfers);
});

// --- Leagues ---

app.post("/api/saves/:id/leagues", (req, res) => {
  const save = db.prepare("SELECT * FROM saves WHERE id = ?").get(req.params.id) as
    | { id: number; season: number }
    | undefined;
  if (!save) {
    res.status(404).json({ error: "save not found" });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  // Defaults to the save's current season — a caller can still pass a
  // specific season explicitly (e.g. setting up next season's edition
  // ahead of time).
  const season = typeof req.body?.season === "number" ? req.body.season : save.season;
  const result = db.prepare("INSERT INTO leagues (save_id, name, season) VALUES (?, ?, ?)").run(
    req.params.id,
    name,
    season
  );
  res.status(201).json(db.prepare("SELECT * FROM leagues WHERE id = ?").get(result.lastInsertRowid));
});

app.get("/api/saves/:id/leagues", (req, res) => {
  const leagues = db.prepare("SELECT * FROM leagues WHERE save_id = ? ORDER BY season DESC").all(req.params.id);
  res.json(leagues);
});

app.get("/api/leagues/:id", (req, res) => {
  const league = db.prepare("SELECT * FROM leagues WHERE id = ?").get(req.params.id);
  if (!league) {
    res.status(404).json({ error: "league not found" });
    return;
  }
  res.json(league);
});

app.delete("/api/leagues/:id", (req, res) => {
  const result = db.prepare("DELETE FROM leagues WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "league not found" });
    return;
  }
  res.status(204).end();
});

// --- League membership ---

app.get("/api/leagues/:id/teams", (req, res) => {
  const teams = db
    .prepare(
      `SELECT teams.* FROM teams
       JOIN league_teams ON league_teams.team_id = teams.id
       WHERE league_teams.league_id = ?`
    )
    .all(req.params.id);
  res.json(teams);
});

app.post("/api/leagues/:id/teams", (req, res) => {
  const league = db.prepare("SELECT * FROM leagues WHERE id = ?").get(req.params.id) as
    | { id: number; save_id: number }
    | undefined;
  if (!league) {
    res.status(404).json({ error: "league not found" });
    return;
  }
  const teamId = req.body?.team_id;
  if (typeof teamId !== "number") {
    res.status(400).json({ error: "team_id is required" });
    return;
  }
  const team = db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId) as
    | { id: number; save_id: number | null }
    | undefined;
  if (!team) {
    res.status(404).json({ error: "team not found" });
    return;
  }
  if (team.save_id !== league.save_id) {
    res.status(400).json({ error: "team does not belong to this league's save" });
    return;
  }
  try {
    db.prepare("INSERT INTO league_teams (league_id, team_id) VALUES (?, ?)").run(req.params.id, teamId);
  } catch {
    res.status(400).json({ error: "team is already in this league" });
    return;
  }
  res.status(201).json({ league_id: Number(req.params.id), team_id: teamId });
});

app.delete("/api/leagues/:id/teams/:teamId", (req, res) => {
  const result = db
    .prepare("DELETE FROM league_teams WHERE league_id = ? AND team_id = ?")
    .run(req.params.id, req.params.teamId);
  if (result.changes === 0) {
    res.status(404).json({ error: "team is not in this league" });
    return;
  }
  res.status(204).end();
});

// --- Fixtures ---

app.post("/api/leagues/:id/generate-fixtures", (req, res) => {
  const league = db.prepare("SELECT id FROM leagues WHERE id = ?").get(req.params.id);
  if (!league) {
    res.status(404).json({ error: "league not found" });
    return;
  }
  const teamIds = (
    db.prepare("SELECT team_id FROM league_teams WHERE league_id = ?").all(req.params.id) as {
      team_id: number;
    }[]
  ).map((r) => r.team_id);
  if (teamIds.length < 2) {
    res.status(400).json({ error: "league needs at least 2 teams to generate fixtures" });
    return;
  }
  const pairs = generateRoundRobin(teamIds);

  // Regenerating replaces the existing list outright rather than appending
  // to it — the alternative (trying to merge/diff an edited fixture list)
  // isn't a requirement yet and would be real added complexity for no
  // current use.
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM fixtures WHERE league_id = ?").run(req.params.id);
    const insert = db.prepare(
      "INSERT INTO fixtures (league_id, round, home_team_id, away_team_id) VALUES (?, ?, ?, ?)"
    );
    for (const p of pairs) {
      insert.run(req.params.id, p.round, p.homeTeamId, p.awayTeamId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.status(201).json(db.prepare("SELECT * FROM fixtures WHERE league_id = ? ORDER BY round").all(req.params.id));
});

app.get("/api/leagues/:id/fixtures", (req, res) => {
  const fixtures = db
    .prepare("SELECT * FROM fixtures WHERE league_id = ? ORDER BY round, id")
    .all(req.params.id);
  res.json(fixtures);
});

app.patch("/api/fixtures/:id", (req, res) => {
  const homeScore = req.body?.home_score;
  const awayScore = req.body?.away_score;
  if (typeof homeScore !== "number" || typeof awayScore !== "number") {
    res.status(400).json({ error: "home_score and away_score are required" });
    return;
  }
  const result = db
    .prepare("UPDATE fixtures SET home_score = ?, away_score = ? WHERE id = ?")
    .run(homeScore, awayScore, req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "fixture not found" });
    return;
  }
  res.json(db.prepare("SELECT * FROM fixtures WHERE id = ?").get(req.params.id));
});

/**
 * Instantly resolves every still-unplayed fixture in one round of a league
 * via quickSim.ts, EXCEPT it never needs to special-case the player's own
 * fixture: the frontend always calls recordResult() for that one first
 * (via the real match engine), so by the time this runs it's no longer
 * home_score IS NULL and this query naturally skips it. This is what lets
 * a whole round advance in lockstep the moment the player finishes their
 * own match, instead of every other club's fixture sitting unplayed
 * forever.
 */
app.post("/api/leagues/:id/simulate-round", (req, res) => {
  const league = db.prepare("SELECT id FROM leagues WHERE id = ?").get(req.params.id);
  if (!league) {
    res.status(404).json({ error: "league not found" });
    return;
  }
  const round = req.body?.round;
  if (typeof round !== "number") {
    res.status(400).json({ error: "round is required" });
    return;
  }
  const unplayed = db
    .prepare("SELECT * FROM fixtures WHERE league_id = ? AND round = ? AND home_score IS NULL")
    .all(req.params.id, round) as {
    id: number;
    home_team_id: number;
    away_team_id: number;
  }[];

  const playersByTeam = db.prepare("SELECT * FROM players WHERE team_id = ?");
  const strengthFor = (teamId: number) => computeTeamStrength(playersByTeam.all(teamId) as unknown as PlayerAttrs[]);
  const updateFixture = db.prepare("UPDATE fixtures SET home_score = ?, away_score = ? WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const f of unplayed) {
      const { homeScore, awayScore } = simulateScore(strengthFor(f.home_team_id), strengthFor(f.away_team_id));
      updateFixture.run(homeScore, awayScore, f.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.json(
    db.prepare("SELECT * FROM fixtures WHERE league_id = ? AND round = ? ORDER BY id").all(req.params.id, round)
  );
});

/**
 * Once every fixture in a save's current (highest-season) league has a
 * recorded score, this creates the next season: a new league row for the
 * same teams with a fresh round-robin schedule. The finished league's row
 * (and its fixtures) is never touched or deleted — that's what makes it
 * "season history" for free, queryable later via the normal
 * GET /api/leagues/:id/standings on its own id.
 */
app.post("/api/saves/:id/advance-season", (req, res) => {
  const save = db.prepare("SELECT * FROM saves WHERE id = ?").get(req.params.id) as
    | { id: number; season: number }
    | undefined;
  if (!save) {
    res.status(404).json({ error: "save not found" });
    return;
  }
  const currentLeague = db
    .prepare("SELECT * FROM leagues WHERE save_id = ? ORDER BY season DESC LIMIT 1")
    .get(req.params.id) as { id: number; season: number } | undefined;
  if (!currentLeague) {
    res.status(400).json({ error: "save has no league yet" });
    return;
  }
  const unplayedCount = db
    .prepare("SELECT COUNT(*) AS n FROM fixtures WHERE league_id = ? AND home_score IS NULL")
    .get(currentLeague.id) as { n: number };
  if (unplayedCount.n > 0) {
    res.status(400).json({ error: "current season still has unplayed fixtures" });
    return;
  }

  const teamIds = (
    db.prepare("SELECT team_id FROM league_teams WHERE league_id = ?").all(currentLeague.id) as {
      team_id: number;
    }[]
  ).map((r) => r.team_id);

  const nextSeason = currentLeague.season + 1;
  let newLeagueId: number;
  db.exec("BEGIN");
  try {
    newLeagueId = Number(
      db
        .prepare("INSERT INTO leagues (save_id, name, season) VALUES (?, ?, ?)")
        .run(req.params.id, `Season ${nextSeason} League`, nextSeason).lastInsertRowid
    );
    const insertLeagueTeam = db.prepare("INSERT INTO league_teams (league_id, team_id) VALUES (?, ?)");
    for (const teamId of teamIds) insertLeagueTeam.run(newLeagueId, teamId);

    const pairs = generateRoundRobin(teamIds);
    const insertFixture = db.prepare(
      "INSERT INTO fixtures (league_id, round, home_team_id, away_team_id) VALUES (?, ?, ?, ?)"
    );
    for (const pair of pairs) insertFixture.run(newLeagueId, pair.round, pair.homeTeamId, pair.awayTeamId);

    db.prepare("UPDATE saves SET season = ? WHERE id = ?").run(nextSeason, req.params.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.status(201).json(db.prepare("SELECT * FROM leagues WHERE id = ?").get(newLeagueId));
});

// --- Standings ---
// Deliberately computed live from fixtures rather than stored as its own
// mutable table — there's no way for a standings row to drift out of sync
// with actual results if it's never stored in the first place.

interface StandingRow {
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

app.get("/api/leagues/:id/standings", (req, res) => {
  const league = db.prepare("SELECT id FROM leagues WHERE id = ?").get(req.params.id);
  if (!league) {
    res.status(404).json({ error: "league not found" });
    return;
  }
  const teams = db
    .prepare(
      `SELECT teams.id, teams.name FROM teams
       JOIN league_teams ON league_teams.team_id = teams.id
       WHERE league_teams.league_id = ?`
    )
    .all(req.params.id) as { id: number; name: string }[];

  const table = new Map<number, StandingRow>(
    teams.map((t) => [
      t.id,
      {
        team_id: t.id,
        team_name: t.name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goals_for: 0,
        goals_against: 0,
        goal_difference: 0,
        points: 0,
      },
    ])
  );

  const played = db
    .prepare(
      "SELECT * FROM fixtures WHERE league_id = ? AND home_score IS NOT NULL AND away_score IS NOT NULL"
    )
    .all(req.params.id) as {
    home_team_id: number;
    away_team_id: number;
    home_score: number;
    away_score: number;
  }[];

  for (const f of played) {
    const home = table.get(f.home_team_id);
    const away = table.get(f.away_team_id);
    if (!home || !away) continue; // a team removed from the league after this fixture was played
    home.played++;
    away.played++;
    home.goals_for += f.home_score;
    home.goals_against += f.away_score;
    away.goals_for += f.away_score;
    away.goals_against += f.home_score;
    if (f.home_score > f.away_score) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (f.home_score < f.away_score) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }

  const rows = [...table.values()].map((r) => ({ ...r, goal_difference: r.goals_for - r.goals_against }));
  rows.sort(
    (a, b) =>
      b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for || a.team_name.localeCompare(b.team_name)
  );
  res.json(rows);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
});
