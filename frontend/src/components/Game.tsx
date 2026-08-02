import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import { fetchPlayers, fetchTeams } from "../game/api";
import {
  BALL_START,
  GRID_COLS,
  GRID_ROWS,
  KICK_RANGE,
  OOB_CELLS,
  PAWN_MOVE_BUDGET,
  SPRINT_COOLDOWN_TURNS,
  SPRINT_SPEED_MULTIPLIER,
} from "../game/constants";
import { planAiTurn } from "../game/ai";
import { buildFormation } from "../game/formation";
import { createProjector, TILT_DEFAULT, TILT_MAX, TILT_MIN, VIEW_H, VIEW_W } from "../game/iso";
import { resolveTurn } from "../game/resolve";
import type { Ball, Pawn, Stance, TeamDTO, Vec2 } from "../game/types";
import type { MatchCallbacks } from "../phaser/MatchScene";
import { MatchScene } from "../phaser/MatchScene";
import { PhaserGame } from "../phaser/PhaserGame";
import "./game.css";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nothingMoved(pawns: Pawn[], ballPos: Vec2, prevPawns: Pawn[], prevBallPos: Vec2): boolean {
  if (ballPos.x !== prevBallPos.x || ballPos.y !== prevBallPos.y) return false;
  return pawns.every((p, i) => p.pos.x === prevPawns[i].pos.x && p.pos.y === prevPawns[i].pos.y);
}

function euclideanDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function inBounds(pos: Vec2): boolean {
  return (
    pos.x >= -OOB_CELLS &&
    pos.x < GRID_COLS + OOB_CELLS &&
    pos.y >= -OOB_CELLS &&
    pos.y < GRID_ROWS + OOB_CELLS
  );
}

/**
 * Classifies an event log line by category so the log is scannable at a
 * glance (color/weight) rather than every line reading the same regardless
 * of whether it's a goal or a routine pass. Matched by substring against the
 * fixed phrasing resolve.ts's event strings always use, same approach the
 * project's own test scripts already use to check which event fired.
 */
function eventClass(e: string): string {
  if (e.includes("GOAL")) return "event-goal";
  if (e.includes("Interception:") || e.includes("Tackle:")) return "event-turnover";
  if (e.includes("half-tackles") || e.includes("half-blocks")) return "event-contested";
  if (e.includes("Pass:")) return "event-pass";
  if (e.includes("goes out of play") || e.includes("off target")) return "event-miss";
  return "";
}

// Two separate stance menus rather than one flat list — a GK's stances
// (positioning style) and an outfield pawn's (defensive orders) don't mean
// anything for the other position, so each only offers its own set (see
// stanceOptionsFor). Both share the same "None" entry/key.
const NONE_OPTION = { key: "none" as const, label: "None" };
const OUTFIELD_STANCE_OPTIONS = [
  NONE_OPTION,
  { key: "aggressive" as const, label: "Aggressive" },
  { key: "pressure" as const, label: "Pressure" },
  { key: "cover_passing" as const, label: "Cover passing" },
  { key: "man_mark" as const, label: "Man-mark" },
];
const GK_STANCE_OPTIONS = [
  NONE_OPTION,
  { key: "gk_on_line" as const, label: "On the line" },
  { key: "gk_aggressive" as const, label: "Aggressive" },
];
const ALL_STANCE_OPTIONS = [...OUTFIELD_STANCE_OPTIONS, ...GK_STANCE_OPTIONS];

function stanceOptionsFor(pawn: Pawn) {
  return pawn.player.position === "GK" ? GK_STANCE_OPTIONS : OUTFIELD_STANCE_OPTIONS;
}

function stanceLabel(stance: Stance | null): string {
  const opt = ALL_STANCE_OPTIONS.find((o) => o.key === (stance?.kind ?? "none"));
  return opt?.label ?? "None";
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

// Scaled up along with the field-expansion pitch rescale — these were tuned
// for a 16x12 world where 2.5x already zoomed in close; on the ~4x-bigger
// pitch, reaching an equivalently close-up view needs an equivalently
// bigger zoom ceiling. Panning (below) is what makes a higher ceiling
// actually useful, rather than just zooming in on a fixed, centered view.
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 10;
// View-space units per second panned at zoom=1 (VIEW_W/H are ~6100x6400 at
// the current pitch scale) — divided by the user's zoom below so panning
// feels like a consistent speed on screen regardless of how zoomed in.
const PAN_SPEED = 2600;

export function Game({ mode, onExitToMenu }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MatchScene | null>(null);
  const handlersRef = useRef<MatchCallbacks>({ onPawnClick: () => {}, onFieldClick: () => {} });
  const rotateState = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startRotation: number;
    startTilt: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startRotation: 0,
    startTilt: TILT_DEFAULT,
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  // The camera's pan is tracked as a WORLD-space point to look at (grid
  // coordinates, defaulting to the pitch center) rather than a raw
  // view-space pixel offset — the latter is what made rotating/tilting
  // while panned swing the whole field around the pitch's fixed center
  // instead of around wherever the camera was actually focused (the
  // projection itself always keeps the pitch's OWN center pinned to the
  // same view-space point regardless of rotation, so a fixed view-space
  // offset stops meaning the same world location the moment the angle
  // changes). Re-projecting a world-space focus point through whatever the
  // current rotation/tilt is keeps that same spot centered through camera
  // moves, which is what "rotate around focus" actually requires.
  const [camera, setCamera] = useState({
    zoom: 1,
    rotation: 0,
    tilt: TILT_DEFAULT,
    focusX: GRID_COLS / 2,
    focusY: GRID_ROWS / 2,
  });
  const pressedKeys = useRef<Set<string>>(new Set());
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [pawns, setPawns] = useState<Pawn[]>([]);
  const [ball, setBall] = useState<Ball>({ pos: BALL_START });
  const [ballHeight, setBallHeight] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kickMode, setKickMode] = useState(false);
  const [kickLoft, setKickLoft] = useState(false);
  const [stanceMenuOpen, setStanceMenuOpen] = useState(false);
  // True while the player has picked "Man-mark" for the selected pawn and
  // is now expected to click an opponent pawn instead of a cell/destination.
  const [pickingMarkTarget, setPickingMarkTarget] = useState(false);
  const [controllingSide, setControllingSide] = useState<"home" | "away">("home");
  const [readySides, setReadySides] = useState<Set<"home" | "away">>(new Set());
  const [handoff, setHandoff] = useState(false);
  const [turn, setTurn] = useState(1);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
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

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // WASD pans the camera (screen-relative: W/S move the view up/down, A/D
  // left/right). The delta itself is still applied in view-space, same as
  // before — that's what keeps a key's direction meaning the same thing on
  // screen no matter how the camera is currently rotated — but the RESULT
  // is immediately converted back to a world-space focus point (via the
  // current rotation/tilt's projector) rather than staying a raw view-space
  // offset, so subsequent rotation/tilt changes re-center on the same real
  // pitch location instead of sliding back toward the pitch's fixed center.
  // Runs as an animation-frame loop rather than per-keydown steps so
  // holding a key pans smoothly and proportionally to real elapsed time.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        pressedKeys.current.add(key);
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      pressedKeys.current.delete(e.key.toLowerCase());
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    let raf = 0;
    let lastTime = performance.now();
    function tick(now: number) {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const keys = pressedKeys.current;
      if (keys.size > 0) {
        setCamera((c) => {
          const speed = (PAN_SPEED / c.zoom) * dt;
          let dx = 0;
          let dy = 0;
          if (keys.has("a")) dx -= speed;
          if (keys.has("d")) dx += speed;
          if (keys.has("w")) dy -= speed;
          if (keys.has("s")) dy += speed;
          const projector = createProjector(c.rotation, c.tilt);
          const currentView = projector.toIso(c.focusX, c.focusY);
          const nextFocus = projector.fromIso(currentView.x + dx, currentView.y + dy);
          return { ...c, focusX: nextFocus.x, focusY: nextFocus.y };
        });
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      cancelAnimationFrame(raf);
    };
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      wrapperRef.current?.requestFullscreen();
    }
  }

  function handleWheel(e: ReactWheelEvent) {
    e.preventDefault();
    setCamera((c) => {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom * factor));
      return { ...c, zoom };
    });
  }

  function handleViewportMouseDown(e: ReactMouseEvent) {
    // Middle button (1) or the side "back"/"forward" buttons (3/4) orbit the camera.
    if (e.button !== 1 && e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    rotateState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startRotation: camera.rotation,
      startTilt: camera.tilt,
    };
  }

  function handleViewportMouseMove(e: ReactMouseEvent) {
    if (!rotateState.current.active) return;
    e.preventDefault();
    const dx = e.clientX - rotateState.current.startX;
    const dy = e.clientY - rotateState.current.startY;
    const degrees = ((rotateState.current.startRotation - dx * 0.18) % 360 + 360) % 360;
    const tilt = Math.min(TILT_MAX, Math.max(TILT_MIN, rotateState.current.startTilt + dy * 0.06));
    setCamera((c) => ({ ...c, rotation: degrees, tilt }));
  }

  function stopRotating() {
    rotateState.current.active = false;
  }

  function resetCamera() {
    setCamera({ zoom: 1, rotation: 0, tilt: TILT_DEFAULT, focusX: GRID_COLS / 2, focusY: GRID_ROWS / 2 });
  }

  const selectedPawn = pawns.find((p) => p.id === selectedId) ?? null;
  const isCarrier = (pawn: Pawn) => pawn.pos.x === ball.pos.x && pawn.pos.y === ball.pos.y;
  const selectedIsCarrier = !!selectedPawn && isCarrier(selectedPawn);

  // How far (world units) the selected pawn can move/kick this turn — the
  // radius the reach-circle overlay draws, and the same budget a click has
  // to fall within to register. Both move and kick are plain Euclidean
  // circles now that targeting is continuous, not tied to grid cells.
  const moveBudget = selectedPawn?.plannedSprint ? PAWN_MOVE_BUDGET * SPRINT_SPEED_MULTIPLIER : PAWN_MOVE_BUDGET;
  const reachRadius = selectedPawn ? (kickMode && selectedIsCarrier ? KICK_RANGE : moveBudget) : null;

  // Clicking within this distance of the selected pawn's own position cancels
  // its planned move instead of setting a new one — the continuous
  // equivalent of "clicking the cell you're already standing on."
  const CANCEL_CLICK_EPS = 0.5;

  function handlePawnClick(pawn: Pawn) {
    if (resolving) return;
    if (pickingMarkTarget && selectedPawn && pawn.side !== controllingSide) {
      setPawns((prev) =>
        prev.map((p) =>
          p.id === selectedPawn.id ? { ...p, stance: { kind: "man_mark", targetId: pawn.id } } : p
        )
      );
      setPickingMarkTarget(false);
      setSelectedId(null);
      return;
    }
    if (pawn.side !== controllingSide) return;
    setKickMode(false);
    setKickLoft(false);
    setPickingMarkTarget(false);
    setStanceMenuOpen(false);
    setSelectedId((current) => (current === pawn.id ? null : pawn.id));
  }

  function handleFieldClick(point: Vec2) {
    if (resolving) return;
    if (!selectedPawn || reachRadius === null) return;
    if (!inBounds(point)) return;
    if (euclideanDistance(selectedPawn.pos, point) > reachRadius) return;

    if (kickMode && selectedIsCarrier) {
      setPawns((prev) =>
        prev.map((p) =>
          p.id === selectedPawn.id
            ? { ...p, plannedKick: point, plannedPos: null, plannedKickLoft: kickLoft }
            : p
        )
      );
    } else {
      const cancel = euclideanDistance(selectedPawn.pos, point) < CANCEL_CLICK_EPS;
      setPawns((prev) =>
        prev.map((p) =>
          p.id === selectedPawn.id
            ? { ...p, plannedPos: cancel ? null : point, plannedKick: null, plannedKickLoft: false }
            : p
        )
      );
    }
    setSelectedId(null);
    setKickMode(false);
    setKickLoft(false);
    setPickingMarkTarget(false);
  }

  /** Sets (or clears, with `null`) the selected pawn's stance for this turn. */
  function handleSetStance(stance: Stance | null) {
    if (!selectedPawn) return;
    setPawns((prev) => prev.map((p) => (p.id === selectedPawn.id ? { ...p, stance } : p)));
    setPickingMarkTarget(false);
  }

  /** Handles a click on one of the stance dropdown's options. Man-mark needs a target pawn picked next, so it doesn't set the stance directly. */
  function handleStanceOptionClick(key: (typeof ALL_STANCE_OPTIONS)[number]["key"]) {
    setStanceMenuOpen(false);
    if (key === "man_mark") {
      setPickingMarkTarget(true);
      return;
    }
    handleSetStance(key === "none" ? null : { kind: key });
  }

  /** Toggles the selected pawn's sprint order for this turn. Turning it off is always allowed; turning it on requires the cooldown to be clear. */
  function handleToggleSprint() {
    if (!selectedPawn) return;
    if (!selectedPawn.plannedSprint && selectedPawn.sprintCooldown > 0) return;
    setPawns((prev) =>
      prev.map((p) => (p.id === selectedPawn.id ? { ...p, plannedSprint: !p.plannedSprint } : p))
    );
  }

  // Keep the Phaser-facing callbacks stable (set once when the scene mounts)
  // while always delegating to the latest closures via this ref.
  useEffect(() => {
    handlersRef.current = {
      onPawnClick: (pawnId: string) => {
        const pawn = pawns.find((p) => p.id === pawnId);
        if (pawn) handlePawnClick(pawn);
      },
      onFieldClick: handleFieldClick,
    };
  });

  function handleSceneReady(scene: MatchScene) {
    sceneRef.current = scene;
    scene.setCallbacks({
      onPawnClick: (pawnId) => handlersRef.current.onPawnClick(pawnId),
      onFieldClick: (point) => handlersRef.current.onFieldClick(point),
    });
    setSceneReady(true);
  }

  useEffect(() => {
    sceneRef.current?.syncState({
      pawns,
      ball,
      ballHeight,
      selectedId,
      reachRadius,
      kickMode,
      controllingSide,
      camera,
    });
  });

  async function resolveWithPawns(inputPawns: Pawn[]) {
    setResolving(true);
    setEvents([]);

    const { snapshots, goal, deadBall } = resolveTurn(inputPawns, ball);
    let prevPawns = inputPawns;
    let prevBallPos = ball.pos;
    // Revealed tick-by-tick in step with the animation, rather than dumped
    // all at once after everything's already finished moving — otherwise
    // there's no way to tell which skill check/interception happened when.
    let revealedEvents: string[] = [];
    for (const snapshot of snapshots) {
      const stillMoving = !nothingMoved(snapshot.pawns, snapshot.ball, prevPawns, prevBallPos);
      setPawns(snapshot.pawns);
      setBall({ pos: snapshot.ball });
      setBallHeight(snapshot.ballHeight);
      if (snapshot.events.length > 0) {
        revealedEvents = [...revealedEvents, ...snapshot.events];
        setEvents(revealedEvents);
      }
      await sleep(stillMoving ? 350 : 80);
      prevPawns = snapshot.pawns;
      prevBallPos = snapshot.ball;
    }

    // A stance is a standing order for this turn only — resolve.ts relies on
    // it staying put across every tick of the turn it was set for (so a
    // man-marking pawn keeps re-aiming), but it shouldn't silently carry
    // over once planning for the NEXT turn begins. Sprint's cooldown is the
    // opposite: it's the one thing that DOES need to persist and evolve
    // turn-over-turn, computed here (not resolve.ts, which has no notion of
    // "next turn") in the same pass — a pawn that just sprinted resets to a
    // full cooldown, everyone else's existing cooldown ticks down by one.
    setPawns((prev) =>
      prev.map((p) => ({
        ...p,
        stance: p.stance ? null : p.stance,
        plannedSprint: false,
        sprintCooldown: p.plannedSprint ? SPRINT_COOLDOWN_TURNS : Math.max(0, p.sprintCooldown - 1),
      }))
    );

    if (goal) {
      if (goal === "home") setHomeScore((s) => s + 1);
      else setAwayScore((s) => s + 1);
      await sleep(600);
      setPawns((prev) => kickoffFormation(prev));
      setBall({ pos: BALL_START });
      setBallHeight(0);
    } else if (deadBall) {
      // Only the ball and the single pawn taking the restart move — everyone
      // else stays exactly where the run of play left them, unlike a goal's
      // full formation reset.
      setBall({ pos: deadBall.spot });
      setBallHeight(0);
      setPawns((prev) => {
        const eligible = prev.filter((p) => p.side === deadBall.side);
        if (eligible.length === 0) return prev;
        const nearest = eligible.reduce((best, p) =>
          euclideanDistance(p.pos, deadBall.spot) < euclideanDistance(best.pos, deadBall.spot) ? p : best
        );
        return prev.map((p) => (p.id === nearest.id ? { ...p, pos: { ...deadBall.spot } } : p));
      });
    }

    setTurn((t) => t + 1);
    setReadySides(new Set());
    setControllingSide("home");
    setResolving(false);
  }

  async function handleReady() {
    if (resolving) return;
    setSelectedId(null);
    setKickMode(false);
    setKickLoft(false);
    setPickingMarkTarget(false);

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

  if (loading) {
    return <p>Loading teams...</p>;
  }

  if (handoff) {
    const nextSideName = controllingSide === "home" ? teams[1]?.name : teams[0]?.name;
    return (
      <div className="game-wrapper handoff-screen" ref={wrapperRef}>
        <h2>Pass the computer</h2>
        <p>
          It's now <strong>{nextSideName}</strong>'s turn to plan their moves.
        </p>
        <button type="button" onClick={handleContinueHandoff}>
          Continue
        </button>
      </div>
    );
  }

  const controllingSideName = controllingSide === "home" ? teams[0]?.name : teams[1]?.name;

  return (
    <div className="game-wrapper" ref={wrapperRef}>
      <div className="hud">
        <div className="hud-top-row">
          <div className="hud-top-left">
            {selectedPawn ? (
              <div className="hud-panel pawn-info">
                <div className="pawn-info-name">
                  #{selectedPawn.player.jersey_number} {selectedPawn.player.name}
                </div>
                <div className="pawn-info-row">Stance: {stanceLabel(selectedPawn.stance)}</div>
                <div className="pawn-info-row">
                  Sprint:{" "}
                  {selectedPawn.plannedSprint
                    ? "Sprinting"
                    : selectedPawn.sprintCooldown > 0
                      ? `Cooldown (${selectedPawn.sprintCooldown})`
                      : "Ready"}
                </div>
                {selectedPawn.plannedKick && (
                  <div className="pawn-info-row">Kick: {selectedPawn.plannedKickLoft ? "Loft" : "Ground"}</div>
                )}
              </div>
            ) : (
              <div className="hud-panel pawn-info pawn-info-empty">No pawn selected</div>
            )}
          </div>

          <div className="hud-top-center">
            <div className="hud-panel scoreboard">
              <span className="team-name">{teams[0]?.name}</span>
              <span className="score">{homeScore}</span>
              <span className="vs">x</span>
              <span className="score">{awayScore}</span>
              <span className="team-name">{teams[1]?.name}</span>
            </div>
            <div className="turn-line">
              Turn {turn}
              {mode === "hotseat" && (
                <span className={`turn-indicator ${controllingSide}`}> — {controllingSideName}'s turn</span>
              )}
            </div>
            {pickingMarkTarget && <div className="hud-banner">Click an opponent pawn to mark.</div>}
          </div>

          <div className="hud-top-right">
            <button type="button" className="exit-button hud-menu-btn" onClick={onExitToMenu}>
              ← Menu
            </button>
            <button type="button" className="exit-button hud-menu-btn" onClick={toggleFullscreen}>
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
            <button type="button" className="continue-button" onClick={handleReady} disabled={resolving}>
              {resolving ? "Resolving..." : mode === "hotseat" ? "Ready" : "Continue"}
            </button>
          </div>
        </div>

        <div className="hud-bottom-row">
          <div className="hud-bottom-left">
            <div className="hud-panel events-log-panel">
              <div className="events-log-title">Events</div>
              <ul className={`events-log ${events.length > 0 ? "" : "empty"}`}>
                {events.map((e, i) => (
                  <li key={i} className={eventClass(e)}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="hud-bottom-right">
            {selectedPawn && (
              <div className="hud-panel action-panel">
                <div className="action-row">
                  <button type="button" className={!kickMode ? "active" : ""} onClick={() => setKickMode(false)}>
                    Move
                  </button>
                  <button
                    type="button"
                    className={kickMode ? "active" : ""}
                    disabled={!selectedIsCarrier}
                    onClick={() => setKickMode(true)}
                  >
                    Kick
                  </button>
                </div>
                {kickMode && selectedIsCarrier && (
                  <div className="action-row">
                    <button type="button" className={!kickLoft ? "active" : ""} onClick={() => setKickLoft(false)}>
                      Ground
                    </button>
                    <button type="button" className={kickLoft ? "active" : ""} onClick={() => setKickLoft(true)}>
                      Loft
                    </button>
                  </div>
                )}
                <div className="action-row stance-row">
                  <button
                    type="button"
                    className={`stance-toggle ${stanceMenuOpen ? "active" : ""}`}
                    onClick={() => setStanceMenuOpen((o) => !o)}
                  >
                    Stance: {stanceLabel(selectedPawn.stance)} {stanceMenuOpen ? "▲" : "▼"}
                  </button>
                  {stanceMenuOpen && (
                    <div className="stance-menu">
                      {stanceOptionsFor(selectedPawn).map((opt) => (
                        <button
                          type="button"
                          key={opt.key}
                          className={(selectedPawn.stance?.kind ?? "none") === opt.key ? "active" : ""}
                          onClick={() => handleStanceOptionClick(opt.key)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="action-row">
                  <button
                    type="button"
                    className={selectedPawn.plannedSprint ? "active" : ""}
                    disabled={!selectedPawn.plannedSprint && selectedPawn.sprintCooldown > 0}
                    onClick={handleToggleSprint}
                  >
                    {selectedPawn.sprintCooldown > 0 && !selectedPawn.plannedSprint
                      ? `Sprint (${selectedPawn.sprintCooldown})`
                      : "Sprint"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === "ai" ? (
        <p className="hint">
          Click a blue pawn, then a highlighted cell to plan its move. Whoever is standing on the
          ball carries it when they move. Click "Continue" to see what the computer-controlled
          opponent does.
        </p>
      ) : mode === "solo" ? (
        <p className="hint">
          Click a blue pawn, then a highlighted cell to plan its move. Whoever is standing on the
          ball carries it when they move. The opposing team stays put in this mode — it's just for
          testing the mechanics. Click "Continue" to run it.
        </p>
      ) : (
        <p className="hint">
          Click a pawn on the team in control, then a highlighted cell to plan its move. Whoever is
          standing on the ball carries it when they move. Click "Ready" when you're done planning —
          the other team can't see your moves until resolution.
        </p>
      )}
      <p className="camera-hint">
        Mouse wheel: zoom. Middle (or side) button + drag horizontally: rotate the camera.
        Drag vertically: adjust the tilt. WASD: pan around the pitch.
      </p>
      <div
        className="field-viewport"
        style={isFullscreen ? undefined : { aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        onWheel={handleWheel}
        onMouseDown={handleViewportMouseDown}
        onMouseMove={handleViewportMouseMove}
        onMouseUp={stopRotating}
        onMouseLeave={stopRotating}
        onAuxClick={(e) => e.preventDefault()}
      >
        {!sceneReady && <p className="hint">Loading the pitch...</p>}
        <PhaserGame onSceneReady={handleSceneReady} />
      </div>
      {(camera.zoom !== 1 ||
        camera.rotation !== 0 ||
        camera.tilt !== TILT_DEFAULT ||
        Math.abs(camera.focusX - GRID_COLS / 2) > 1e-6 ||
        Math.abs(camera.focusY - GRID_ROWS / 2) > 1e-6) && (
        <div className="camera-reset-wrap">
          <button type="button" className="exit-button camera-reset" onClick={resetCamera}>
            Reset camera
          </button>
        </div>
      )}
    </div>
  );
}
