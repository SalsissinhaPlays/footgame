import { useEffect, useMemo, useState } from "react";
import { fetchPlayers, fetchTeams } from "../game/api";
import { CELL_SIZE, GRID_COLS, GRID_ROWS, MOVE_RANGE } from "../game/constants";
import { buildFormation } from "../game/formation";
import { resolveTurn } from "../game/resolve";
import type { Pawn, TeamDTO, Vec2 } from "../game/types";
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

export function Game() {
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [pawns, setPawns] = useState<Pawn[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [turn, setTurn] = useState(1);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [events, setEvents] = useState<string[]>([]);

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

  const reachableCells = useMemo(() => {
    if (!selectedPawn) return new Set<string>();
    const cells = new Set<string>();
    for (let dx = -MOVE_RANGE; dx <= MOVE_RANGE; dx++) {
      for (let dy = -MOVE_RANGE; dy <= MOVE_RANGE; dy++) {
        const cell = { x: selectedPawn.pos.x + dx, y: selectedPawn.pos.y + dy };
        if (inBounds(cell) && chebyshevDistance(selectedPawn.pos, cell) <= MOVE_RANGE) {
          cells.add(`${cell.x},${cell.y}`);
        }
      }
    }
    return cells;
  }, [selectedPawn]);

  function handlePawnClick(pawn: Pawn) {
    if (resolving) return;
    if (pawn.side !== "home") return;
    setSelectedId((current) => (current === pawn.id ? null : pawn.id));
  }

  function handleCellClick(cell: Vec2) {
    if (resolving) return;
    if (!selectedPawn) return;
    if (!reachableCells.has(`${cell.x},${cell.y}`)) return;

    setPawns((prev) =>
      prev.map((p) =>
        p.id === selectedPawn.id
          ? { ...p, plannedPos: p.pos.x === cell.x && p.pos.y === cell.y ? null : cell }
          : p
      )
    );
    setSelectedId(null);
  }

  async function handleProceed() {
    if (resolving) return;
    setSelectedId(null);
    setResolving(true);
    setEvents([]);

    const { snapshots, events: turnEvents } = resolveTurn(pawns);
    for (const snapshot of snapshots) {
      setPawns(snapshot);
      await sleep(350);
    }

    setEvents(turnEvents);
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
          className={`cell ${isReachable ? "reachable" : ""}`}
          onClick={() => handleCellClick({ x, y })}
        />
      );
    }
  }

  if (loading) {
    return <p>Carregando times...</p>;
  }

  return (
    <div className="game-wrapper">
      <div className="game-header">
        <h1>
          {teams[0]?.name} <span className="vs">x</span> {teams[1]?.name}
        </h1>
        <div className="game-info">
          <span>Turno {turn}</span>
          <button type="button" onClick={handleProceed} disabled={resolving}>
            {resolving ? "Resolvendo..." : "Prosseguir"}
          </button>
        </div>
      </div>
      <p className="hint">
        Clique em um peão azul (seu time) e depois em uma casa destacada para planejar o
        movimento. Clique em "Prosseguir" para executar os movimentos planejados.
      </p>
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
