import { useEffect, useMemo, useState } from "react";
import { fetchPlayers, fetchTeams } from "../game/api";
import {
  BALL_START,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  KICK_RANGE,
  MOVE_RANGE,
  TOTAL_TURNS,
} from "../game/constants";
import { buildFormation } from "../game/formation";
import { resolveTurn } from "../game/resolve";
import type { Ball, Pawn, TeamDTO, Vec2 } from "../game/types";
import { BallView } from "./BallView";
import { Field } from "./Field";
import { PawnView } from "./PawnView";
import "./game.css";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chebyshevDistance(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function inBounds(pos: Vec2): boolean {
  return pos.x >= 0 && pos.x < GRID_COLS && pos.y >= 0 && pos.y < GRID_ROWS;
}

function kickoffFormation(pawns: Pawn[]): Pawn[] {
  const homePlayers = pawns.filter((p) => p.side === "home").map((p) => p.player);
  const awayPlayers = pawns.filter((p) => p.side === "away").map((p) => p.player);
  return [...buildFormation(homePlayers, "home"), ...buildFormation(awayPlayers, "away")];
}

export function Game() {
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [pawns, setPawns] = useState<Pawn[]>([]);
  const [ball, setBall] = useState<Ball>({ pos: BALL_START });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kickMode, setKickMode] = useState(false);
  const [turn, setTurn] = useState(1);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

  const matchOver = turn > TOTAL_TURNS;

  useEffect(() => {
    async function load() {
      const fetchedTeams = await fetchTeams();
      const [home, away] = fetchedTeams;
      const homePlayers = await fetchPlayers(home.id);
      const awayPlayers = await fetchPlayers(away.id);
      setTeams(fetchedTeams);
      setPawns([...buildFormation(homePlayers, "home"), ...buildFormation(awayPlayers, "away")]);
      setLoading(false);
    }
    load();
  }, []);

  const selectedPawn = pawns.find((p) => p.id === selectedId) ?? null;
  const isCarrier = (pawn: Pawn) => pawn.pos.x === ball.pos.x && pawn.pos.y === ball.pos.y;
  const selectedIsCarrier = !!selectedPawn && isCarrier(selectedPawn);

  const reachableCells = useMemo(() => {
    if (!selectedPawn) return new Set<string>();
    const range = kickMode && selectedIsCarrier ? KICK_RANGE : MOVE_RANGE;
    const cells = new Set<string>();
    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        const cell = { x: selectedPawn.pos.x + dx, y: selectedPawn.pos.y + dy };
        if (inBounds(cell) && chebyshevDistance(selectedPawn.pos, cell) <= range) {
          cells.add(`${cell.x},${cell.y}`);
        }
      }
    }
    return cells;
  }, [selectedPawn, kickMode, selectedIsCarrier]);

  function handlePawnClick(pawn: Pawn) {
    if (resolving || matchOver) return;
    if (pawn.side !== "home") return;
    setKickMode(false);
    setSelectedId((current) => (current === pawn.id ? null : pawn.id));
  }

  function handleCellClick(cell: Vec2) {
    if (resolving || matchOver) return;
    if (!selectedPawn) return;
    if (!reachableCells.has(`${cell.x},${cell.y}`)) return;

    if (kickMode && selectedIsCarrier) {
      setPawns((prev) =>
        prev.map((p) =>
          p.id === selectedPawn.id ? { ...p, plannedKick: cell, plannedPos: null } : p
        )
      );
    } else {
      setPawns((prev) =>
        prev.map((p) =>
          p.id === selectedPawn.id
            ? {
                ...p,
                plannedPos: p.pos.x === cell.x && p.pos.y === cell.y ? null : cell,
                plannedKick: null,
              }
            : p
        )
      );
    }
    setSelectedId(null);
    setKickMode(false);
  }

  async function handleProceed() {
    if (resolving || matchOver) return;
    setSelectedId(null);
    setKickMode(false);
    setResolving(true);
    setEvents([]);

    const { snapshots, events: turnEvents, goal } = resolveTurn(pawns, ball);
    for (const snapshot of snapshots) {
      setPawns(snapshot.pawns);
      setBall({ pos: snapshot.ball });
      await sleep(350);
    }

    setEvents(turnEvents);

    if (goal) {
      if (goal === "home") setHomeScore((s) => s + 1);
      else setAwayScore((s) => s + 1);
      await sleep(600);
      setPawns((prev) => kickoffFormation(prev));
      setBall({ pos: BALL_START });
    }

    setTurn((t) => t + 1);
    setResolving(false);
  }

  const cells = [];
  for (let x = 0; x < GRID_COLS; x++) {
    for (let y = 0; y < GRID_ROWS; y++) {
      const isReachable = reachableCells.has(`${x},${y}`);
      cells.push(
        <rect
          key={`cell-${x}-${y}`}
          x={x * CELL_SIZE}
          y={y * CELL_SIZE}
          width={CELL_SIZE}
          height={CELL_SIZE}
          className={`cell ${isReachable ? "reachable" : ""} ${isReachable && kickMode ? "kicking" : ""}`}
          onClick={() => handleCellClick({ x, y })}
        />
      );
    }
  }

  if (loading) {
    return <p>Carregando times...</p>;
  }

  let resultText: string | null = null;
  if (matchOver) {
    if (homeScore > awayScore) resultText = `${teams[0]?.name} venceu!`;
    else if (awayScore > homeScore) resultText = `${teams[1]?.name} venceu!`;
    else resultText = "Empate!";
  }

  return (
    <div className="game-wrapper">
      <div className="game-header">
        <h1>
          {teams[0]?.name} <span className="score">{homeScore}</span>
          <span className="vs">x</span>
          <span className="score">{awayScore}</span> {teams[1]?.name}
        </h1>
        <div className="game-info">
          <span>
            Turno {Math.min(turn, TOTAL_TURNS)} / {TOTAL_TURNS}
          </span>
          <button type="button" onClick={handleProceed} disabled={resolving || matchOver}>
            {resolving ? "Resolvendo..." : "Prosseguir"}
          </button>
        </div>
      </div>
      {matchOver ? (
        <p className="result-banner">{resultText}</p>
      ) : (
        <p className="hint">
          Clique em um peão azul (seu time) e depois em uma casa destacada para planejar o
          movimento. Quem estiver em cima da bola a carrega ao se mover. Clique em "Prosseguir"
          para executar os movimentos planejados.
        </p>
      )}
      {selectedIsCarrier && !matchOver && (
        <div className="kick-toggle">
          <span>Peão com a bola — escolha a ação:</span>
          <button
            type="button"
            className={kickMode ? "" : "active"}
            onClick={() => setKickMode(false)}
          >
            Mover
          </button>
          <button
            type="button"
            className={kickMode ? "active" : ""}
            onClick={() => setKickMode(true)}
          >
            Chutar
          </button>
        </div>
      )}
      {events.length > 0 && (
        <ul className="events-log">
          {events.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <svg
        viewBox={`0 0 ${GRID_COLS * CELL_SIZE} ${GRID_ROWS * CELL_SIZE}`}
        className="field-svg"
      >
        <Field />
        {cells}
        <BallView ball={ball} />
        {pawns.map((pawn) => (
          <PawnView
            key={pawn.id}
            pawn={pawn}
            selected={pawn.id === selectedId}
            onClick={() => handlePawnClick(pawn)}
          />
        ))}
      </svg>
    </div>
  );
}
