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
import { planAiTurn } from "../game/ai";
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

interface Props {
  mode: "hotseat" | "ai" | "solo";
  onExitToMenu: () => void;
}

export function Game({ mode, onExitToMenu }: Props) {
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [pawns, setPawns] = useState<Pawn[]>([]);
  const [ball, setBall] = useState<Ball>({ pos: BALL_START });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kickMode, setKickMode] = useState(false);
  const [controllingSide, setControllingSide] = useState<"home" | "away">("home");
  const [readySides, setReadySides] = useState<Set<"home" | "away">>(new Set());
  const [handoff, setHandoff] = useState(false);
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
    if (pawn.side !== controllingSide) return;
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

  async function resolveWithPawns(inputPawns: Pawn[]) {
    setResolving(true);
    setEvents([]);

    const { snapshots, events: turnEvents, goal } = resolveTurn(inputPawns, ball);
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
    setReadySides(new Set());
    setControllingSide("home");
    setResolving(false);
  }

  async function handleReady() {
    if (resolving || matchOver) return;
    setSelectedId(null);
    setKickMode(false);

    if (mode === "ai") {
      const withAiMoves = planAiTurn(pawns, ball, "away");
      await resolveWithPawns(withAiMoves);
      return;
    }

    if (mode === "solo") {
      // No opponent to plan for — the away side just never gets a plannedPos/plannedKick.
      await resolveWithPawns(pawns);
      return;
    }

    const next = new Set(readySides);
    next.add(controllingSide);
    setReadySides(next);

    if (next.size < 2) {
      setHandoff(true);
    } else {
      await resolveWithPawns(pawns);
    }
  }

  function handleContinueHandoff() {
    setControllingSide((side) => (side === "home" ? "away" : "home"));
    setHandoff(false);
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

  if (handoff) {
    const nextSideName = controllingSide === "home" ? teams[1]?.name : teams[0]?.name;
    return (
      <div className="game-wrapper handoff-screen">
        <h2>Passe o computador</h2>
        <p>
          Agora é a vez do <strong>{nextSideName}</strong> planejar seus movimentos.
        </p>
        <button type="button" onClick={handleContinueHandoff}>
          Continuar
        </button>
      </div>
    );
  }

  const controllingSideName = controllingSide === "home" ? teams[0]?.name : teams[1]?.name;
  const visiblePawns = pawns.map((p) =>
    p.side === controllingSide ? p : { ...p, plannedPos: null, plannedKick: null }
  );

  return (
    <div className="game-wrapper">
      <div className="game-header">
        <button type="button" className="exit-button" onClick={onExitToMenu}>
          ← Menu
        </button>
        <h1>
          {teams[0]?.name} <span className="score">{homeScore}</span>
          <span className="vs">x</span>
          <span className="score">{awayScore}</span> {teams[1]?.name}
        </h1>
        <div className="game-info">
          <span>
            Turno {Math.min(turn, TOTAL_TURNS)} / {TOTAL_TURNS}
          </span>
          <button type="button" onClick={handleReady} disabled={resolving || matchOver}>
            {resolving ? "Resolvendo..." : mode === "hotseat" ? "Pronto" : "Prosseguir"}
          </button>
        </div>
      </div>
      {!matchOver && mode === "hotseat" && (
        <p className={`turn-indicator ${controllingSide}`}>Vez de: {controllingSideName}</p>
      )}
      {matchOver ? (
        <p className="result-banner">{resultText}</p>
      ) : mode === "ai" ? (
        <p className="hint">
          Clique em um peão azul e depois em uma casa destacada para planejar o movimento. Quem
          estiver em cima da bola a carrega ao se mover. Clique em "Prosseguir" para ver o que o
          adversário (controlado pelo computador) faz.
        </p>
      ) : mode === "solo" ? (
        <p className="hint">
          Clique em um peão azul e depois em uma casa destacada para planejar o movimento. Quem
          estiver em cima da bola a carrega ao se mover. O time adversário fica parado neste modo
          — é só para testar a mecânica. Clique em "Prosseguir" para executar.
        </p>
      ) : (
        <p className="hint">
          Clique em um peão do time em controle e depois em uma casa destacada para planejar o
          movimento. Quem estiver em cima da bola a carrega ao se mover. Clique em "Pronto" quando
          terminar de planejar — o outro time não vê suas jogadas até a resolução.
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
        {visiblePawns.map((pawn) => (
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
