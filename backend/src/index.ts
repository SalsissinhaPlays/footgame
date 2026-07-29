import express from "express";
import cors from "cors";
import { db } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/teams", (_req, res) => {
  const teams = db.prepare("SELECT * FROM teams").all();
  res.json(teams);
});

app.get("/api/teams/:id/players", (req, res) => {
  const players = db
    .prepare("SELECT * FROM players WHERE team_id = ? ORDER BY jersey_number")
    .all(req.params.id);
  res.json(players);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
});
