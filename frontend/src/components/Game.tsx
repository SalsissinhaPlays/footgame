import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import { fetchPlayers, fetchTeam, fetchTeams } from "../game/api";
import { fetchCornerPreset, fetchTeamTactics, saveCornerPreset, toTacticalProfile } from "../game/careerApi";
import type { CornerOffset } from "../game/careerApi";
import { DEFAULT_TACTICAL_PROFILE } from "../game/tacticalProfile";
import type { TacticalProfile } from "../game/tacticalProfile";
import {
  BALL_START,
  GRID_COLS,
  GRID_ROWS,
  KICK_CHARGE_COST,
  KICK_RANGE,
  OOB_CELLS,
  PASS_RANGE,
  PAWN_MOVE_BUDGET,
  SPRINT_COOLDOWN_TURNS,
  SPRINT_SPEED_MULTIPLIER,
  TACKLE_COOLDOWN_TURNS,
} from "../game/constants";
import { planAiTurn } from "../game/ai";
import { buildFormation } from "../game/formation";
import { createProjector, TILT_DEFAULT, TILT_MAX, TILT_MIN, VIEW_H, VIEW_W } from "../game/iso";
import { chargesFor, resolveTurn } from "../game/resolve";
import type { DeadBallResult, GoalScorer } from "../game/resolve";
import { resolveSetupTurn, SETUP_TURNS_BY_TYPE } from "../game/restartSetup";
import type { Ball, Pawn, PlannedStep, PlayerDTO, Side, Stance, TeamDTO, Vec2 } from "../game/types";
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

/** Cumulative distance from `from` through every MOVEMENT leg in `steps`, in order — how much of a pawn's fixed PAWN_MOVE_BUDGET a chain-so-far has already spent. Kick steps don't move the pawn, so they're skipped (see PlannedStep). */
function totalPlannedDistance(from: Vec2, steps: PlannedStep[]): number {
  let total = 0;
  let cursor = from;
  for (const step of steps) {
    if (step.kick) continue;
    total += euclideanDistance(cursor, step.pos);
    cursor = step.pos;
  }
  return total;
}

/** Where the chain currently leaves the pawn standing — the last MOVEMENT leg's destination, or `from` if the chain is empty or only kicks so far (a kick doesn't move the pawn). */
function chainEndPosition(from: Vec2, steps: PlannedStep[]): Vec2 {
  let cursor = from;
  for (const step of steps) {
    if (!step.kick) cursor = step.pos;
  }
  return cursor;
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
  if (e.startsWith("Turn ")) return "event-turn-marker";
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
  { key: "pressure" as const, label: "Pressure" },
  { key: "cover_passing" as const, label: "Cover passing" },
  { key: "man_mark" as const, label: "Man-mark" },
  { key: "expecting_header" as const, label: "Expecting header" },
  { key: "auto_tackle" as const, label: "Auto-tackle" },
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

const RESTART_TYPE_LABEL: Record<DeadBallResult["type"], string> = {
  throw_in: "Throw-in",
  corner: "Corner",
  goal_kick: "Goal kick",
  free_kick: "Free kick",
  penalty: "Penalty",
};

const KICK_KIND_LABEL: Record<"shot" | "pass" | "cross", string> = {
  shot: "Shot",
  pass: "Pass",
  cross: "Cross",
};

const TACKLE_KIND_LABEL: Record<"clean" | "hard", string> = {
  clean: "Clean",
  hard: "Hard",
};

function kickoffFormation(pawns: Pawn[]): Pawn[] {
  const homePlayers = pawns.filter((p) => p.side === "home").map((p) => p.player);
  const awayPlayers = pawns.filter((p) => p.side === "away").map((p) => p.player);
  return [...buildFormation(homePlayers, "home"), ...buildFormation(awayPlayers, "away")];
}

/**
 * Converts a world position into a corner-relative offset: `alongAttack` is
 * distance out from the goal line into the pitch (always positive for a
 * pawn actually on the pitch), `alongTouch` is distance toward the pitch's
 * CENTER from the corner's own near touchline (also always positive for a
 * sane setup position). Both signs are derived from which side is taking
 * the corner and which of the two same-end corners `spot` is at, which is
 * what lets one saved preset correctly re-apply at either corner of a
 * team's attacking end, and in either home/away orientation — see
 * db.ts's team_corner_presets comment for why this frame, not raw x/y.
 */
function cornerPresetOffset(pos: Vec2, deadBall: DeadBallResult): CornerOffset {
  const attackSign = deadBall.side === "home" ? 1 : -1;
  const centerSign = deadBall.spot.y < GRID_ROWS / 2 ? 1 : -1;
  return {
    alongAttack: attackSign * (deadBall.spot.x - pos.x),
    alongTouch: centerSign * (pos.y - deadBall.spot.y),
  };
}

/** The inverse of cornerPresetOffset — turns a saved offset back into a world position for THIS specific corner. */
function applyCornerOffset(offset: CornerOffset, deadBall: DeadBallResult): Vec2 {
  const attackSign = deadBall.side === "home" ? 1 : -1;
  const centerSign = deadBall.spot.y < GRID_ROWS / 2 ? 1 : -1;
  return {
    x: deadBall.spot.x - attackSign * offset.alongAttack,
    y: deadBall.spot.y + centerSign * offset.alongTouch,
  };
}

/**
 * Everything that constitutes "the match" as a single serializable object —
 * what a save/load or a future network sync would need to reconstruct play
 * exactly where it stood. Deliberately does NOT include per-viewer UI/input
 * state (camera, fullscreen, which action-panel toggle is open, which pawn
 * is currently selected) — that's real state too, but it's local-viewer
 * state, not shared match truth, so it stays as its own useState hooks below
 * rather than being folded in here.
 */
interface MatchState {
  pawns: Pawn[];
  ball: Ball;
  ballHeight: number;
  turn: number;
  homeScore: number;
  awayScore: number;
  controllingSide: "home" | "away";
  readySides: Set<"home" | "away">;
  pendingRestart: DeadBallResult | null;
  restartSetup: { deadBall: DeadBallResult; turnsRemaining: number } | null;
  events: string[];
  resolving: boolean;
  /** Every identified goal this match, in order — accumulated across the whole match the same way `events` already is, not reset per turn. Reported to onCareerMatchEnd for top-scorer tracking (see careerApi.ts's recordResult). */
  scorers: GoalScorer[];
}

function initialMatchState(humanSide: Side): MatchState {
  return {
    pawns: [],
    ball: { pos: BALL_START },
    ballHeight: 0,
    turn: 1,
    homeScore: 0,
    awayScore: 0,
    controllingSide: humanSide,
    readySides: new Set(),
    pendingRestart: null,
    restartSetup: null,
    events: [],
    resolving: false,
    scorers: [],
  };
}

interface Props {
  mode: "hotseat" | "ai" | "solo";
  onExitToMenu: () => void;
  /**
   * Career mode only: load these specific teams' real rosters instead of
   * the default demo teams fetchTeams() always returns. Both or neither —
   * there's no meaningful "one real team, one demo team" case. These are
   * the fixture's REAL home/away designation — unlike the earlier design,
   * the human is not forced into "home" anymore (see humanSide below).
   */
  homeTeamId?: number;
  awayTeamId?: number;
  /**
   * Career mode only ("ai" mode's default is "home", preserving the
   * non-career "Play against AI" menu option's behavior unchanged): which
   * pitch side the human actually plays. A league fixture is home for one
   * team and away for the other regardless of who's human-controlled — a
   * real season alternates roughly 50/50, and always forcing the human into
   * "home" (the previous design) meant the away-kit/away-perspective side of
   * the game never happened, and would silently break any future mechanic
   * keyed off home/away (e.g. a home-advantage bonus). The AI always takes
   * whichever side isn't humanSide.
   */
  humanSide?: Side;
  /**
   * Career mode only: exactly which of the human's roster players actually
   * take the pitch — see Career.tsx's LineupSelect screen. When omitted,
   * buildFormation's own fallback applies (the roster's first players in
   * jersey_number order, per position). Only ever meaningful for the human
   * side — the AI opponent doesn't get a lineup choice.
   */
  humanStartingPlayerIds?: number[];
  /**
   * Career mode only: renders an "End Match & Record Result" button that
   * calls this with the current score instead of just exiting. Matches here
   * have no built-in end condition (see resolve.ts's removed TOTAL_TURNS) —
   * this is what lets the player decide "this fixture is done" and hand the
   * result back to the league it came from.
   */
  onCareerMatchEnd?: (homeScore: number, awayScore: number, scorers: GoalScorer[]) => void;
  /**
   * Fullscreen is owned by App.tsx now (targets document.documentElement,
   * not any one screen's wrapper div) so it survives navigating between
   * menu/career/match — the browser auto-exits fullscreen the instant its
   * target element unmounts, which used to happen here every time this
   * component's own wrapper (fullscreen's old target) got swapped out for a
   * different screen.
   */
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
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
// Degrees per second Q/E rotate the camera — a keyboard alternative to the
// middle/side-mouse-button drag, since not every mouse has those buttons.
const ROTATE_KEY_SPEED = 90;

export function Game({
  mode,
  onExitToMenu,
  homeTeamId,
  awayTeamId,
  humanSide: humanSideProp,
  humanStartingPlayerIds,
  onCareerMatchEnd,
  isFullscreen,
  onToggleFullscreen,
}: Props) {
  // Defaults to "home" for every non-career caller (hotseat/solo/the plain
  // "Play against AI" menu option never pass humanSide) — only Career.tsx's
  // match screen ever passes "away", matching a fixture's real designation.
  const humanSide: Side = humanSideProp ?? "home";
  const aiSide: Side = humanSide === "home" ? "away" : "home";
  const sceneRef = useRef<MatchScene | null>(null);
  const handlersRef = useRef<MatchCallbacks>({
    onPawnClick: () => {},
    onFieldClick: () => {},
    onPawnPointerDown: () => {},
    onPawnDragEnd: () => {},
  });
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
  // Left-click-drag panning — "grab the field and move it." Tracks the
  // camera's focus at drag-start rather than accumulating per-frame deltas,
  // same reasoning as rotateState: recomputing from a fixed start avoids
  // drift over a long drag.
  const panState = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startFocusX: number;
    startFocusY: number;
  }>({ active: false, startX: 0, startY: 0, startFocusX: 0, startFocusY: 0 });
  // Team Management sandbox only — set synchronously by MatchScene's
  // onPawnPointerDown callback, which (per the event-ordering this whole
  // click/drag system already relies on) fires before this component's own
  // mousedown handler below runs, so that handler can tell "this gesture
  // started on a pawn" and skip starting a camera pan for it. MatchScene
  // owns the actual drag visuals/drop entirely on its own; this ref exists
  // purely to keep the two systems from fighting over the same gesture.
  const draggingPawnRef = useRef<string | null>(null);
  // Escape needs to fire an action defined further down (deselectPawn, which
  // closes over match/selectedPawn) from a keydown listener that's only ever
  // attached once (mount-only effect, empty deps) — same
  // attach-once-but-stay-fresh problem handlersRef already solves for
  // Phaser's click callbacks, solved the same way here.
  const keyActionsRef = useRef<{ deselect: () => void }>({ deselect: () => {} });
  const eventsLogRef = useRef<HTMLUListElement>(null);
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
  // The match's shared truth — see MatchState's own doc comment above for
  // what belongs here vs. in the standalone UI hooks below.
  const [match, setMatch] = useState<MatchState>(() => initialMatchState(humanSide));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kickMode, setKickMode] = useState(false);
  const [kickLoft, setKickLoft] = useState(false);
  // The player's own explicit declaration of what a queued kick is for —
  // shot/pass resolve identically to each other, only cross changes the
  // engine's actual accuracy (see aim.ts's landingSpread). Mostly
  // independent of kickLoft (a chipped shot, a lofted pass, ...) except for
  // cross, which always forces loft — crossing means flighting the ball in,
  // not rolling it (see resolve.ts's startFlight and the Ground/Loft row
  // below, hidden when kickKind is "cross").
  const [kickKind, setKickKind] = useState<"shot" | "pass" | "cross">("pass");
  // Declaring a tackle isn't a click-target mode the way Kick is (it's not
  // aimed anywhere) — it's a pure button action, like Sprint, just with a
  // Clean/Hard sub-choice revealed while open. Toggling it off (or picking
  // the already-active kind again) clears the declaration.
  const [tackleMode, setTackleMode] = useState(false);
  // Solo mode's sandbox tool — the first version of the future Team
  // Management window (see CLAUDE.md). All session-only, local UI state;
  // nothing here is persisted to the backend.
  const [teamManagementOpen, setTeamManagementOpen] = useState(false);
  const [awayAiEnabled, setAwayAiEnabled] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
  // Set by "+ Add Player"; consumed by the next field click, which places
  // the new pawn there instead of doing anything else (see handleFieldClick).
  const [placingPawnSide, setPlacingPawnSide] = useState<Side | null>(null);
  // Starts well above any real backend player id so a synthetic PlayerDTO
  // can never collide with one fetched from the database.
  const nextCustomPlayerId = useRef(100000);
  const [stanceMenuOpen, setStanceMenuOpen] = useState(false);
  // True while the player has picked "Man-mark" for the selected pawn and
  // is now expected to click an opponent pawn instead of a cell/destination.
  const [pickingMarkTarget, setPickingMarkTarget] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [loading, setLoading] = useState(true);
  // Career mode only: whoever LineupSelect left out of the starting 6 —
  // populated once in the load effect below, then only ever moves between
  // this list and match.pawns via handleSubstitute. Empty (and the whole
  // Bench UI hidden) for every other mode, since only a career match with
  // an explicit lineup choice has a real bench to draw from.
  const [benchedPlayers, setBenchedPlayers] = useState<PlayerDTO[]>([]);
  // The benched player about to come on, once the player clicks their name
  // in the Bench panel — the next home-side pawn clicked is who they
  // replace. Mirrors pickingMarkTarget's own "arm a mode, then click the
  // target on the pitch" shape.
  const [subReplacement, setSubReplacement] = useState<PlayerDTO | null>(null);
  // The AI-controlled side's saved tactical identity (see TeamTactics.tsx)
  // — a team with no saved row just plays under this same default, so this
  // state never needs a "not loaded yet" distinction from "genuinely
  // default." Whichever side that is depends on humanSide/aiSide, not a
  // fixed "away" — see the load effect below.
  const [aiTacticalProfile, setAiTacticalProfile] = useState<TacticalProfile>(DEFAULT_TACTICAL_PROFILE);

  useEffect(() => {
    async function load() {
      // Career mode passes explicit team ids (a specific league fixture's
      // real teams) — load exactly those instead of always taking the first
      // two rows off the unscoped demo-team list.
      const [home, away] =
        homeTeamId != null && awayTeamId != null
          ? await Promise.all([fetchTeam(homeTeamId), fetchTeam(awayTeamId)])
          : await fetchTeams();
      const homePlayers = await fetchPlayers(home.id);
      const awayPlayers = await fetchPlayers(away.id);
      setTeams([home, away]);
      const aiTeamId = aiSide === "home" ? home.id : away.id;
      fetchTeamTactics(aiTeamId)
        .then((dto) => setAiTacticalProfile(toTacticalProfile(dto)))
        .catch(() => setAiTacticalProfile(DEFAULT_TACTICAL_PROFILE));
      // A career lineup choice (LineupSelect) filters the roster down to
      // exactly the chosen starters before it ever reaches buildFormation —
      // whoever isn't in this list simply never becomes a pawn, same as any
      // other roster surplus (see formation.ts's assignSlots). Falls back to
      // the full roster (buildFormation's own default ordering) whenever no
      // lineup was chosen, e.g. hotseat/AI/solo modes that never pass this.
      // Applies to whichever side is humanSide, not always "home" — the AI
      // side never gets a lineup choice regardless of which pitch side it's on.
      const humanRoster = humanSide === "home" ? homePlayers : awayPlayers;
      const startingHumanPlayers =
        humanStartingPlayerIds && humanStartingPlayerIds.length > 0
          ? humanRoster.filter((p) => humanStartingPlayerIds.includes(p.id))
          : humanRoster;
      const finalHomePlayers = humanSide === "home" ? startingHumanPlayers : homePlayers;
      const finalAwayPlayers = humanSide === "away" ? startingHumanPlayers : awayPlayers;
      const homeFormation = buildFormation(finalHomePlayers, "home");
      const awayFormation = buildFormation(finalAwayPlayers, "away");
      setBenchedPlayers(
        humanStartingPlayerIds && humanStartingPlayerIds.length > 0
          ? humanRoster.filter((p) => !humanStartingPlayerIds.includes(p.id))
          : []
      );
      // Coin toss for the match's TRUE opening kickoff only — resolve.ts's
      // carrier is whoever starts within CAPTURE_RADIUS of the ball, and
      // both sides' formation forwards sit well outside that radius (a
      // symmetric, neutral kickoff), so without this every opening kickoff
      // would just be an unclaimed scramble every pawn is equally far from.
      // The coin-toss winner's central forward (the formation's last slot —
      // FWD in FORMATION_6V6_DEFAULT) is teleported exactly onto the ball,
      // matching how a real kickoff always starts in someone's possession.
      // Deliberately scoped to this one initial load only — post-goal
      // restarts (kickoffFormation, below) are untouched and stay a neutral
      // scramble; a coin toss is a pre-match ritual, not a per-goal one.
      const kickoffSide: Side = Math.random() < 0.5 ? "home" : "away";
      const placeOnBall = (formation: Pawn[]): Pawn[] =>
        formation.map((p, i) => (i === formation.length - 1 ? { ...p, pos: { ...BALL_START } } : p));
      setMatch((prev) => ({
        ...prev,
        pawns: [
          ...(kickoffSide === "home" ? placeOnBall(homeFormation) : homeFormation),
          ...(kickoffSide === "away" ? placeOnBall(awayFormation) : awayFormation),
        ],
      }));
      setLoading(false);
    }
    load();
    // homeTeamId/awayTeamId/humanSide/humanStartingPlayerIds only ever
    // change across a full unmount/remount (Career.tsx's screen switch
    // always passes through a non-"match" screen in between two different
    // fixtures — see Career.tsx), never as a live prop update on an
    // already-mounted Game, so including them here doesn't introduce a real
    // re-fetch risk mid-match; it's just what satisfies exhaustive-deps
    // honestly instead of suppressing it.
  }, [homeTeamId, awayTeamId, humanSide, aiSide, humanStartingPlayerIds]);

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
      if (e.key === "Escape") {
        keyActionsRef.current.deselect();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "w" || key === "a" || key === "s" || key === "d" || key === "q" || key === "e") {
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
          let rotation = c.rotation;
          if (keys.has("q")) rotation -= ROTATE_KEY_SPEED * dt;
          if (keys.has("e")) rotation += ROTATE_KEY_SPEED * dt;
          rotation = ((rotation % 360) + 360) % 360;
          const projector = createProjector(rotation, c.tilt);
          const currentView = projector.toIso(c.focusX, c.focusY);
          const nextFocus = projector.fromIso(currentView.x + dx, currentView.y + dy);
          return { ...c, rotation, focusX: nextFocus.x, focusY: nextFocus.y };
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

  function handleWheel(e: ReactWheelEvent) {
    e.preventDefault();
    setCamera((c) => {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom * factor));
      return { ...c, zoom };
    });
  }

  function handleViewportMouseDown(e: ReactMouseEvent) {
    // Left button (0) grabs and pans the field. A genuine click (select a
    // pawn, plan a waypoint/kick) is decided independently over in
    // MatchScene's own pointerdown/pointerup — it only fires if the pointer
    // never traveled past CLICK_DRAG_THRESHOLD, so starting a pan-drag here
    // unconditionally on every left mousedown never steals an actual click.
    if (e.button === 0) {
      // Team Management sandbox only: this same mousedown already told
      // MatchScene "start dragging this pawn" (see draggingPawnRef's own
      // comment for the event-ordering this depends on) — hand the whole
      // gesture to that drag instead of also panning the camera under it.
      if (draggingPawnRef.current) return;
      e.preventDefault();
      panState.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        startFocusX: camera.focusX,
        startFocusY: camera.focusY,
      };
      return;
    }
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
    if (panState.current.active) {
      e.preventDefault();
      const dx = e.clientX - panState.current.startX;
      const dy = e.clientY - panState.current.startY;
      // The actual on-screen zoom (fitZoom * the user's own zoom) — reading
      // it straight from Phaser's camera is what makes a drag track the
      // cursor 1:1 regardless of how zoomed in/out the view currently is,
      // rather than guessing at a screen-pixel-to-world-unit ratio here.
      const zoom = sceneRef.current?.cameras.main.zoom || 1;
      const dxView = dx / zoom;
      const dyView = dy / zoom;
      setCamera((c) => {
        const projector = createProjector(c.rotation, c.tilt);
        const startView = projector.toIso(panState.current.startFocusX, panState.current.startFocusY);
        // Subtracting (not adding) the delta is what makes the field follow
        // the cursor like it's actually being grabbed: dragging right reveals
        // what was to the left, which means the camera's own focus moves left.
        const nextFocus = projector.fromIso(startView.x - dxView, startView.y - dyView);
        return { ...c, focusX: nextFocus.x, focusY: nextFocus.y };
      });
      return;
    }
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
    panState.current.active = false;
    draggingPawnRef.current = null;
  }

  function resetCamera() {
    setCamera({ zoom: 1, rotation: 0, tilt: TILT_DEFAULT, focusX: GRID_COLS / 2, focusY: GRID_ROWS / 2 });
  }

  const selectedPawn = match.pawns.find((p) => p.id === selectedId) ?? null;

  // A pawn's WHOLE-turn move budget — unchanged in total amount by chaining
  // waypoints, same as it always was for a single destination. Charges (see
  // resolve.ts's chargesFor) gate how many separate ACTIONS (movement legs
  // OR kicks) the turn can be split into; only movement legs spend any of
  // the distance budget — a kick is an action, not a place walked to.
  const moveBudget = selectedPawn?.plannedSprint ? PAWN_MOVE_BUDGET * SPRINT_SPEED_MULTIPLIER : PAWN_MOVE_BUDGET;
  const totalCharges = selectedPawn ? chargesFor(selectedPawn.player) : 0;
  const chargesUsed = selectedPawn
    ? selectedPawn.plannedSteps.reduce((sum, s) => sum + (s.kick ? KICK_CHARGE_COST : 1), 0)
    : 0;
  const chargesRemaining = totalCharges - chargesUsed;
  const distanceUsed = selectedPawn ? totalPlannedDistance(selectedPawn.pos, selectedPawn.plannedSteps) : 0;
  const distanceRemaining = moveBudget - distanceUsed;
  // Wherever the chain currently leaves the pawn standing — a kick step
  // doesn't move them, so it doesn't advance this; only a movement leg does.
  const chainEnd = selectedPawn ? chainEndPosition(selectedPawn.pos, selectedPawn.plannedSteps) : null;
  // The reach-circle overlay draws at whatever's left of the relevant
  // budget, from wherever the chain currently ends — a kick doesn't require
  // ALREADY holding the ball (a chain can walk to it first; see resolve.ts's
  // tick loop for how a kick step silently fizzles if that bet doesn't pay
  // off), so Kick mode is only gated by having a spare charge, same as Move.
  // A pass's reach is genuinely shorter than a shot/cross's — see
  // constants.ts's PASS_RANGE for why — so the reach circle (and the click
  // gate below) has to know which kind is currently selected, not just
  // whether a charge is available.
  const kickRangeForKind = kickKind === "pass" ? PASS_RANGE : KICK_RANGE;
  const reachRadius = selectedPawn
    ? kickMode
      ? chargesRemaining >= KICK_CHARGE_COST
        ? kickRangeForKind
        : null
      : chargesRemaining > 0 && distanceRemaining > 0
        ? distanceRemaining
        : null
    : null;

  // Clicking within this distance of the chain's current end (or the pawn's
  // own position, with no waypoints yet) undoes the last step instead of
  // adding a new one — the continuous equivalent of "clicking the cell
  // you're already standing on." 0.5 (the original single-destination-era
  // value, when this only ever had to catch a click on the pawn's own
  // sprite) turned out too tight to reliably hit once waypoint markers
  // became small on-field dots rather than the pawn itself — bumped up to a
  // "personal space"-scale radius (matching CAPTURE_RADIUS) so an undo
  // click doesn't require pixel-perfect precision through the isometric
  // projection.
  const CANCEL_CLICK_EPS = 1.2;

  // Swaps a benched player onto the pitch in place of an on-pitch pawn —
  // immediate, not a planned/queued action, since a substitution happens
  // at a stoppage in real football, not something resolved tick-by-tick.
  // Constructs the incoming Pawn the same way buildFormation does (fresh
  // planning/stance/cooldown state, id = `${side}-${player.id}`) at the
  // OUTGOING pawn's current position — a sub takes over exactly where they
  // stood, not a formation slot, since the match may be well underway.
  function performSubstitution(outgoing: Pawn, incoming: PlayerDTO) {
    const newPawn: Pawn = {
      id: `${outgoing.side}-${incoming.id}`,
      player: incoming,
      side: outgoing.side,
      pos: outgoing.pos,
      plannedSteps: [],
      stance: null,
      plannedSprint: false,
      sprintCooldown: 0,
      plannedTackle: null,
      tackleCooldown: 0,
    };
    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) => (p.id === outgoing.id ? newPawn : p)),
    }));
    setBenchedPlayers((prev) => [...prev.filter((p) => p.id !== incoming.id), outgoing.player]);
    setSubReplacement(null);
    if (selectedId === outgoing.id) setSelectedId(null);
  }

  function handlePawnClick(pawn: Pawn) {
    if (match.resolving) return;
    // Placing a new pawn exactly where an existing one stands is legitimate
    // (testing a crowded box, a deliberate overlap) — same reasoning as the
    // kick-mode redirect below: without this, clicking an existing pawn
    // would just select/deselect it instead of placing the new one there.
    if (placingPawnSide) {
      handleFieldClick(pawn.pos);
      return;
    }
    // Substitution target: the next human-side pawn clicked is who the
    // armed bench player replaces. Gated on humanSide specifically, not
    // match.controllingSide — a bench only ever exists for the human's own
    // career-mode team (see benchedPlayers above), regardless of mode.
    if (subReplacement && pawn.side === humanSide) {
      performSubstitution(pawn, subReplacement);
      return;
    }
    if (pickingMarkTarget && selectedPawn && pawn.side !== match.controllingSide) {
      setMatch((prev) => ({
        ...prev,
        pawns: prev.pawns.map((p) =>
          p.id === selectedPawn.id ? { ...p, stance: { kind: "man_mark", targetId: pawn.id } } : p
        ),
      }));
      setPickingMarkTarget(false);
      setSelectedId(null);
      return;
    }
    // A kick's aim target is very often exactly where a player is standing
    // — a cross aimed at a teammate's head, a shot past a keeper — but
    // Phaser's default topOnly input means a click that lands on a pawn's
    // own hit area never reaches the field zone underneath it. Without this,
    // aiming at a pawn while in kick mode silently hijacked the click into
    // reselecting (or deselecting) that pawn instead of placing the kick.
    if (kickMode && selectedPawn) {
      handleFieldClick(pawn.pos);
      return;
    }
    if (pawn.side !== match.controllingSide) return;
    setKickMode(false);
    setKickLoft(false);
    setKickKind("pass");
    setTackleMode(false);
    setPickingMarkTarget(false);
    setStanceMenuOpen(false);
    setSelectedId((current) => (current === pawn.id ? null : pawn.id));
  }

  function handleFieldClick(point: Vec2) {
    if (match.resolving) return;
    if (placingPawnSide) {
      if (!inBounds(point)) return;
      const side = placingPawnSide;
      const maxJersey = match.pawns
        .filter((p) => p.side === side)
        .reduce((max, p) => Math.max(max, p.player.jersey_number), 0);
      const id = nextCustomPlayerId.current++;
      // Generic mid-range defaults — the whole point of this tool is to
      // immediately tweak them via the Team Management panel's edit fields.
      const newPlayer: PlayerDTO = {
        id,
        team_id: (side === "home" ? teams[0]?.id : teams[1]?.id) ?? 0,
        name: "New Player",
        position: "MID",
        jersey_number: maxJersey + 1,
        pace: 50,
        stamina: 50,
        skill: 50,
        jumping: 50,
        shot_stopping: 50,
        reflexes: 50,
        heading: 50,
      };
      const newPawn: Pawn = {
        id: `custom-${id}`,
        player: newPlayer,
        side,
        pos: point,
        plannedSteps: [],
        stance: null,
        plannedSprint: false,
        sprintCooldown: 0,
        plannedTackle: null,
        tackleCooldown: 0,
      };
      setMatch((prev) => ({ ...prev, pawns: [...prev.pawns, newPawn] }));
      setSelectedId(newPawn.id);
      setPlacingPawnSide(null);
      return;
    }
    if (!selectedPawn || !chainEnd) return;
    if (!inBounds(point)) return;

    if (kickMode) {
      if (reachRadius === null) {
        // Not even one charge left to spend on a kick — a field click can't
        // do anything useful anymore, so treat it as "I'm done with this
        // pawn" instead of a silent no-op that leaves it stuck selected.
        if (chargesRemaining <= 0) deselectPawn();
        return;
      }
      // A click beyond the kick's actual reach still aims it — just clamped
      // to the edge of that reach, in the direction clicked, matching the
      // exact same "clamp instead of ignore" treatment a move click beyond
      // distanceRemaining already gets below. The live aim-ring preview
      // (MatchScene's updateOverlay) already visually clamps to this same
      // edge, so this just makes clicking there actually register instead
      // of silently doing nothing.
      const kickClickDistance = euclideanDistance(chainEnd, point);
      const aimPoint =
        kickClickDistance > reachRadius
          ? {
              x: chainEnd.x + ((point.x - chainEnd.x) * reachRadius) / kickClickDistance,
              y: chainEnd.y + ((point.y - chainEnd.y) * reachRadius) / kickClickDistance,
            }
          : point;
      // A cross is airborne by definition — always lofted regardless of the
      // Ground/Loft toggle (which stays a real choice for shot/pass). Also
      // enforced defensively in resolve.ts's startFlight, so this isn't the
      // only thing keeping the two in sync.
      const loft = kickKind === "cross" ? true : kickLoft;
      setMatch((prev) => ({
        ...prev,
        pawns: prev.pawns.map((p) =>
          p.id === selectedPawn.id
            ? {
                ...p,
                // At most one kick per turn's plan — a pawn wouldn't have
                // the ball for a second one anyway. Setting a new kick
                // (a different type, or the same type aimed elsewhere)
                // means the player is reconsidering, not adding a second
                // kick action, so it replaces whichever kick was already
                // queued instead of stacking a second one.
                plannedSteps: [...p.plannedSteps.filter((s) => !s.kick), { pos: aimPoint, kick: { loft, kind: kickKind } }],
              }
            : p
        ),
      }));
      // Back to Move for whatever comes next — a pawn can't queue a second
      // kick right behind the first (they no longer have the ball once this
      // one fires), but they can still plan movement afterward, so the pawn
      // stays selected rather than ending the turn here.
      setKickMode(false);
      setKickLoft(false);
      setKickKind("pass");
      return;
    }

    // Move mode: building a waypoint chain one click at a time. Each leg
    // extends from wherever the chain currently ends, not from the pawn's
    // real position — that's what lets repeated clicks keep chaining rather
    // than always replacing a single destination.
    const steps = selectedPawn.plannedSteps;

    if (euclideanDistance(chainEnd, point) < CANCEL_CLICK_EPS) {
      if (steps.length > 0) {
        setMatch((prev) => ({
          ...prev,
          pawns: prev.pawns.map((p) => (p.id === selectedPawn.id ? { ...p, plannedSteps: p.plannedSteps.slice(0, -1) } : p)),
        }));
      }
      return;
    }

    if (chargesRemaining <= 0 || distanceRemaining <= 0) {
      // Nothing left in this pawn's move budget — a further field click
      // can't plan anything else, so it deselects instead of doing nothing.
      // This is what makes "spend the whole turn, then click elsewhere"
      // enough to move on to the next pawn, without having to right-click
      // through every queued step first just to get back to unselected.
      deselectPawn();
      return;
    }
    // A click beyond the reachable distance still plans a waypoint — just
    // clamped to the edge of what's actually reachable, in the direction
    // clicked, rather than silently doing nothing.
    const clickDistance = euclideanDistance(chainEnd, point);
    const target =
      clickDistance > distanceRemaining
        ? {
            x: chainEnd.x + ((point.x - chainEnd.x) * distanceRemaining) / clickDistance,
            y: chainEnd.y + ((point.y - chainEnd.y) * distanceRemaining) / clickDistance,
          }
        : point;

    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) => (p.id === selectedPawn.id ? { ...p, plannedSteps: [...p.plannedSteps, { pos: target }] } : p)),
    }));
    // Deliberately stays selected — the pawn keeps taking clicks to extend
    // its chain until the player selects someone/something else.
  }

  /**
   * Deselects whatever pawn is currently selected and clears every
   * planning-mode toggle that goes with it — shared by right-click and the
   * Escape key (see below) so both have one definition of "deselect" to stay
   * in sync. Undoing a planned step is a separate action now (still
   * available via clicking back near the chain's current end — see
   * handleFieldClick's CANCEL_CLICK_EPS check); right-click no longer tries
   * to undo first, since that made a right-click that expected an immediate
   * deselect look like it "didn't do anything" whenever the pawn still had
   * queued steps.
   */
  function deselectPawn() {
    setPlacingPawnSide(null);
    setSubReplacement(null);
    if (match.resolving || !selectedPawn) return;
    setSelectedId(null);
    setKickMode(false);
    setKickLoft(false);
    setKickKind("pass");
    setTackleMode(false);
    setPickingMarkTarget(false);
    setStanceMenuOpen(false);
  }

  /**
   * Right-click undoes the selected pawn's last planned step when it has
   * one — a reliable, position-independent alternative to clicking back
   * near the chain's current end (handleFieldClick's CANCEL_CLICK_EPS
   * check), which still requires some precision. Deselecting the pawn
   * entirely is the LAST thing right-click does, once there's nothing left
   * to undo — not the first, so a right-click never silently throws away a
   * whole queued plan in one click. (Escape, above, is the instant
   * full-deselect instead.) Also suppresses the browser's native
   * right-click context menu on the canvas, which otherwise pops up and
   * blocks the view — nothing in this game uses right click for anything
   * else. (MatchScene's own pointerdown handlers ignore any button but the
   * left one, so this reaches here undisturbed instead of also
   * re-triggering a pawn/field click the way it used to.)
   */
  function handleViewportContextMenu(e: ReactMouseEvent) {
    e.preventDefault();
    if (match.resolving || !selectedPawn) return;
    if (selectedPawn.plannedSteps.length > 0) {
      setMatch((prev) => ({
        ...prev,
        pawns: prev.pawns.map((p) => (p.id === selectedPawn.id ? { ...p, plannedSteps: p.plannedSteps.slice(0, -1) } : p)),
      }));
      return;
    }
    deselectPawn();
  }

  /** Sets (or clears, with `null`) the selected pawn's stance for this turn. */
  function handleSetStance(stance: Stance | null) {
    if (!selectedPawn) return;
    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) => (p.id === selectedPawn.id ? { ...p, stance } : p)),
    }));
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
    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) => (p.id === selectedPawn.id ? { ...p, plannedSprint: !p.plannedSprint } : p)),
    }));
  }

  /**
   * Declares (or, clicking the already-active kind again, clears) the
   * selected pawn's tackle attempt for this turn — a pure button action like
   * Sprint, not a click-target mode like Kick, since a tackle isn't aimed
   * anywhere: it just fires against whoever's carrying the ball, the moment
   * this pawn gets within range (see resolve.ts's tackle-challenge filter).
   * Gated by cooldown the same way Sprint is.
   */
  function handleSetTackle(kind: "clean" | "hard") {
    if (!selectedPawn) return;
    if (!selectedPawn.plannedTackle && selectedPawn.tackleCooldown > 0) return;
    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) =>
        p.id === selectedPawn.id
          ? { ...p, plannedTackle: p.plannedTackle?.kind === kind ? null : { kind } }
          : p
      ),
    }));
    setTackleMode(false);
  }

  /**
   * Selects a pawn from the Team Management roster list, bypassing
   * handlePawnClick's `pawn.side !== match.controllingSide` gate — unlike
   * normal play, this sandbox lets you select (and therefore edit, or even
   * manually plan a move for) either side's pawns, not just the turn's
   * controlling side. AI, when enabled, still overwrites away's plan
   * wholesale at Continue time regardless of anything planned here by hand.
   */
  function handleSelectFromRoster(pawn: Pawn) {
    setKickMode(false);
    setKickLoft(false);
    setKickKind("pass");
    setTackleMode(false);
    setPickingMarkTarget(false);
    setStanceMenuOpen(false);
    setSelectedId((current) => (current === pawn.id ? null : pawn.id));
  }

  /** Arms placement mode for a new pawn on `side` — the next field click (see handleFieldClick) actually creates and places it. */
  function handleAddPlayer(side: Side) {
    setPlacingPawnSide(side);
  }

  function handleDeletePlayer(pawnId: string) {
    setMatch((prev) => ({ ...prev, pawns: prev.pawns.filter((p) => p.id !== pawnId) }));
    setSelectedId((current) => (current === pawnId ? null : current));
  }

  /** Edits one attribute/field on a pawn's underlying PlayerDTO — always an immutable spread, never mutating the fetched object in place. */
  function handleEditPlayerField<K extends keyof PlayerDTO>(pawnId: string, field: K, value: PlayerDTO[K]) {
    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) => (p.id === pawnId ? { ...p, player: { ...p.player, [field]: value } } : p)),
    }));
  }

  /**
   * Commits a Team Management drag-drop — MatchScene has already done its
   * own bounds check (see its pointerup handler) by the time this fires, so
   * `point` here is always valid; this only ever hears about accepted
   * drops. Clears plannedSteps since a queued waypoint chain computed from
   * the pawn's old position doesn't mean anything once it's been teleported
   * — nothing else about the pawn (stance, tackle state, ...) changes.
   */
  function handlePawnDragEnd(pawnId: string, point: Vec2) {
    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) => (p.id === pawnId ? { ...p, pos: point, plannedSteps: [] } : p)),
    }));
  }

  // Same stale-closure fix as handlersRef just below, for the mount-once
  // Escape key listener instead of Phaser's callbacks.
  useEffect(() => {
    keyActionsRef.current = { deselect: deselectPawn };
  });

  // Keep the Phaser-facing callbacks stable (set once when the scene mounts)
  // while always delegating to the latest closures via this ref.
  useEffect(() => {
    handlersRef.current = {
      onPawnClick: (pawnId: string) => {
        const pawn = match.pawns.find((p) => p.id === pawnId);
        if (pawn) handlePawnClick(pawn);
      },
      onFieldClick: handleFieldClick,
      onPawnPointerDown: (pawnId: string) => {
        draggingPawnRef.current = pawnId;
      },
      onPawnDragEnd: handlePawnDragEnd,
    };
  });

  function handleSceneReady(scene: MatchScene) {
    sceneRef.current = scene;
    scene.setCallbacks({
      onPawnClick: (pawnId) => handlersRef.current.onPawnClick(pawnId),
      onFieldClick: (point) => handlersRef.current.onFieldClick(point),
      onPawnPointerDown: (pawnId) => handlersRef.current.onPawnPointerDown(pawnId),
      onPawnDragEnd: (pawnId, point) => handlersRef.current.onPawnDragEnd(pawnId, point),
    });
    setSceneReady(true);
  }

  // Keeps the newest line in view as the log grows — without this, once the
  // log holds more than a screenful of history, a turn's new events would
  // stream in below the visible area instead of where the player is looking.
  useEffect(() => {
    const el = eventsLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [match.events]);

  useEffect(() => {
    sceneRef.current?.syncState({
      pawns: match.pawns,
      ball: match.ball,
      ballHeight: match.ballHeight,
      selectedId,
      reachRadius,
      kickMode,
      kickKind,
      controllingSide: match.controllingSide,
      camera,
      // Dragging an existing pawn is disabled while a NEW pawn's placement
      // is armed (placingPawnSide) — otherwise a press on an existing pawn
      // would be ambiguous between "reposition this one" and "place the new
      // one here" (the latter is handlePawnClick's existing redirect).
      pawnDragEnabled: mode === "solo" && !placingPawnSide,
    });
  });

  async function resolveWithPawns(inputPawns: Pawn[]) {
    // The event log used to reset every turn — it now keeps the whole
    // match's history (scrollable, see game.css), with a plain divider line
    // marking where each new turn's events start.
    const historyBeforeTurn = [...match.events, `Turn ${match.turn}`];
    setMatch((prev) => ({ ...prev, resolving: true, events: historyBeforeTurn }));

    // An active "extended setup" period: this turn is pure repositioning,
    // not a live resolveTurn — no kicks/captures/tackles/saves are possible
    // since the ball is dead at a fixed spot for the whole turn. See
    // restartSetup.ts's own doc comment for why this is a separate function
    // rather than a mode of resolveTurn.
    const restartSetup = match.restartSetup;
    if (restartSetup) {
      const snapshots = resolveSetupTurn(inputPawns, restartSetup.deadBall.spot);
      let prevPawns = inputPawns;
      let prevBallPos = restartSetup.deadBall.spot;
      for (const snapshot of snapshots) {
        const stillMoving = !nothingMoved(snapshot.pawns, snapshot.ball, prevPawns, prevBallPos);
        setMatch((prev) => ({
          ...prev,
          pawns: snapshot.pawns,
          ball: { pos: snapshot.ball },
          ballHeight: snapshot.ballHeight,
        }));
        await sleep(stillMoving ? 350 : 80);
        prevPawns = snapshot.pawns;
        prevBallPos = snapshot.ball;
      }

      const turnsRemaining = restartSetup.turnsRemaining - 1;
      setMatch((prev) => ({
        ...prev,
        pawns: prev.pawns.map((p) => ({
          ...p,
          // Same auto_tackle exception as the live-turn path below. No
          // tackle is ever attempted during a dead-ball setup turn (the ball
          // is dead the whole time — resolveSetupTurn has no notion of
          // tackling at all), so tackleCooldown just decrements.
          stance: p.stance?.kind === "auto_tackle" ? p.stance : p.stance ? null : p.stance,
          plannedSprint: false,
          sprintCooldown: p.plannedSprint ? SPRINT_COOLDOWN_TURNS : Math.max(0, p.sprintCooldown - 1),
          plannedTackle: null,
          tackleCooldown: Math.max(0, p.tackleCooldown - 1),
        })),
        restartSetup: turnsRemaining > 0 ? { ...restartSetup, turnsRemaining } : null,
        turn: prev.turn + 1,
        readySides: new Set(),
        controllingSide: humanSide,
        resolving: false,
      }));
      return;
    }

    const { snapshots, goal, scorer, deadBall, tacklesAttempted } = resolveTurn(inputPawns, match.ball);
    let prevPawns = inputPawns;
    let prevBallPos = match.ball.pos;
    // Revealed tick-by-tick in step with the animation, rather than dumped
    // all at once after everything's already finished moving — otherwise
    // there's no way to tell which skill check/interception happened when.
    let revealedEvents: string[] = [];
    for (const snapshot of snapshots) {
      const stillMoving = !nothingMoved(snapshot.pawns, snapshot.ball, prevPawns, prevBallPos);
      if (snapshot.events.length > 0) {
        revealedEvents = [...revealedEvents, ...snapshot.events];
      }
      setMatch((prev) => ({
        ...prev,
        pawns: snapshot.pawns,
        ball: { pos: snapshot.ball },
        ballHeight: snapshot.ballHeight,
        events: [...historyBeforeTurn, ...revealedEvents],
      }));
      await sleep(stillMoving ? 350 : 80);
      prevPawns = snapshot.pawns;
      prevBallPos = snapshot.ball;
    }

    // A stance is a standing order for this turn only — resolve.ts relies on
    // it staying put across every tick of the turn it was set for (so a
    // man-marking pawn keeps re-aiming), but it shouldn't silently carry
    // over once planning for the NEXT turn begins. auto_tackle is the one
    // deliberate exception (see types.ts's Stance doc comment) — it stays
    // set until the player explicitly changes it, unlike every other stance.
    // Sprint's cooldown is the opposite of a turn-scoped order: it's one of
    // the things that DOES need to persist and evolve turn-over-turn,
    // computed here (not resolve.ts, which has no notion of "next turn") in
    // the same pass — a pawn that just sprinted resets to a full cooldown,
    // everyone else's existing cooldown ticks down by one. tackleCooldown
    // works the same way, driven by ResolveResult.tacklesAttempted rather
    // than a pre-turn field, since whether an attempt actually happened
    // (not just whether one was declared) depends on resolution.
    setMatch((prev) => ({
      ...prev,
      pawns: prev.pawns.map((p) => ({
        ...p,
        stance: p.stance?.kind === "auto_tackle" ? p.stance : p.stance ? null : p.stance,
        plannedSprint: false,
        sprintCooldown: p.plannedSprint ? SPRINT_COOLDOWN_TURNS : Math.max(0, p.sprintCooldown - 1),
        plannedTackle: null,
        tackleCooldown: tacklesAttempted.includes(p.id) ? TACKLE_COOLDOWN_TURNS : Math.max(0, p.tackleCooldown - 1),
      })),
    }));

    if (goal) {
      setMatch((prev) => ({
        ...prev,
        homeScore: goal === "home" ? prev.homeScore + 1 : prev.homeScore,
        awayScore: goal === "away" ? prev.awayScore + 1 : prev.awayScore,
        scorers: scorer ? [...prev.scorers, scorer] : prev.scorers,
      }));
      await sleep(600);
      setMatch((prev) => ({
        ...prev,
        // The Team Management sandbox's custom roster (extra/edited/moved
        // pawns) would otherwise be silently wiped by the standard 6-pawn
        // kickoff reset the instant anyone scores — skip it here and just
        // recenter the ball, leaving the roster exactly as the player built it.
        pawns: mode === "solo" ? prev.pawns : kickoffFormation(prev.pawns),
        ball: { pos: BALL_START },
        ballHeight: 0,
      }));
    } else if (deadBall) {
      // Only the ball and the single pawn taking the restart move — everyone
      // else stays exactly where the run of play left them, unlike a goal's
      // full formation reset.
      setMatch((prev) => {
        const eligible = prev.pawns.filter((p) => p.side === deadBall.side);
        const pawns =
          eligible.length === 0
            ? prev.pawns
            : (() => {
                const nearest = eligible.reduce((best, p) =>
                  euclideanDistance(p.pos, deadBall.spot) < euclideanDistance(best.pos, deadBall.spot) ? p : best
                );
                return prev.pawns.map((p) => (p.id === nearest.id ? { ...p, pos: { ...deadBall.spot } } : p));
              })();
        return { ...prev, ball: { pos: deadBall.spot }, ballHeight: 0, pawns };
      });

      // Only the restarting side gets a say in quick-vs-extended — no human
      // to ask when it falls to an AI-controlled or never-planned (solo away)
      // side, so those always take it quickly, matching today's behavior. A
      // penalty never gets the prompt at all, regardless of side/mode — a
      // 1-on-1 penalty has no "organize a wall" concept to opt into.
      const humanControlsRestart =
        deadBall.type !== "penalty" &&
        (mode === "hotseat" ||
          (mode === "ai" && deadBall.side === humanSide) ||
          (mode === "solo" && deadBall.side === humanSide));
      if (humanControlsRestart) setMatch((prev) => ({ ...prev, pendingRestart: deadBall }));
    }

    setMatch((prev) => ({
      ...prev,
      turn: prev.turn + 1,
      readySides: new Set(),
      controllingSide: humanSide,
      resolving: false,
    }));
  }

  function handleQuickRestart() {
    setMatch((prev) => ({ ...prev, pendingRestart: null }));
  }

  function handleExtendedSetup() {
    if (!match.pendingRestart) return;
    const pendingRestart = match.pendingRestart;
    setMatch((prev) => ({
      ...prev,
      restartSetup: { deadBall: pendingRestart, turnsRemaining: SETUP_TURNS_BY_TYPE[pendingRestart.type] },
      pendingRestart: null,
    }));
  }

  // Both only ever act on the CURRENT corner's setup (match.restartSetup),
  // and only ever for the human's own side — see the Tactics/corner-preset
  // buttons' own gating below for why (a saved preset only makes sense for
  // a team's own attacking corner, never a defensive setup). Uses the
  // human's real team id (whichever of teams[0]/teams[1] that is), not
  // always teams[0] — a preset belongs to the player's club, not to
  // whichever pitch side they happened to be on this particular fixture.
  async function handleSaveCornerPreset() {
    const restartSetup = match.restartSetup;
    const humanTeamId = humanSide === "home" ? teams[0]?.id : teams[1]?.id;
    if (!restartSetup || !humanTeamId) return;
    const offsets = match.pawns
      .filter((p) => p.side === humanSide)
      .map((p) => cornerPresetOffset(p.pos, restartSetup.deadBall));
    try {
      await saveCornerPreset(humanTeamId, offsets);
    } catch {
      // Best-effort — no dedicated error UI for this yet, matching the
      // low-stakes nature of a convenience preset (worst case, the player
      // just repositions manually like before this existed).
    }
  }

  async function handleApplyCornerPreset() {
    const restartSetup = match.restartSetup;
    const humanTeamId = humanSide === "home" ? teams[0]?.id : teams[1]?.id;
    if (!restartSetup || !humanTeamId) return;
    try {
      const { offsets } = await fetchCornerPreset(humanTeamId);
      if (!offsets || offsets.length === 0) return;
      const deadBall = restartSetup.deadBall;
      setMatch((prev) => {
        const humanPawns = prev.pawns.filter((p) => p.side === humanSide);
        const offsetById = new Map(
          humanPawns.map((p, i) => [p.id, offsets[i]] as const).filter((entry): entry is [string, CornerOffset] => entry[1] !== undefined)
        );
        return {
          ...prev,
          pawns: prev.pawns.map((p) => {
            const offset = offsetById.get(p.id);
            if (!offset) return p;
            return { ...p, plannedSteps: [{ pos: applyCornerOffset(offset, deadBall) }] };
          }),
        };
      });
    } catch {
      // Best-effort, same reasoning as handleSaveCornerPreset above.
    }
  }

  async function handleReady() {
    if (match.resolving) return;
    setSelectedId(null);
    setKickMode(false);
    setKickLoft(false);
    setKickKind("pass");
    setTackleMode(false);
    setPickingMarkTarget(false);
    setPlacingPawnSide(null);

    if (mode === "ai") {
      const withAiMoves = planAiTurn(match.pawns, match.ball, aiSide, aiTacticalProfile);
      await resolveWithPawns(withAiMoves);
      return;
    }

    if (mode === "solo") {
      // The Team Management sandbox's AI toggle — off by default (matching
      // solo's original "away never gets a plan" meaning), on demand when
      // the player wants to see how their custom roster actually plays
      // against the AI instead of just standing still. Solo never sets
      // humanSide, so aiSide is always "away" here, unchanged from before.
      const pawnsForTurn = awayAiEnabled ? planAiTurn(match.pawns, match.ball, aiSide, aiTacticalProfile) : match.pawns;
      await resolveWithPawns(pawnsForTurn);
      return;
    }

    const next = new Set(match.readySides);
    next.add(match.controllingSide);

    if (next.size < 2) {
      setMatch((prev) => ({ ...prev, readySides: next }));
      setHandoff(true);
    } else {
      setMatch((prev) => ({ ...prev, readySides: next }));
      await resolveWithPawns(match.pawns);
    }
  }

  function handleContinueHandoff() {
    setMatch((prev) => ({ ...prev, controllingSide: prev.controllingSide === "home" ? "away" : "home" }));
    setHandoff(false);
  }

  if (loading) {
    return <p>Loading teams...</p>;
  }

  if (match.pendingRestart) {
    const pendingRestart = match.pendingRestart;
    const sideName = pendingRestart.side === "home" ? teams[0]?.name : teams[1]?.name;
    const bonusTurns = SETUP_TURNS_BY_TYPE[pendingRestart.type];
    return (
      <div className="game-wrapper handoff-screen">
        <h2>
          {RESTART_TYPE_LABEL[pendingRestart.type]} for {sideName}
        </h2>
        <p>Take it now, or call for extended setup to get organized first?</p>
        <div className="restart-choice-actions">
          <button type="button" onClick={handleQuickRestart}>
            Take it quickly
          </button>
          <button type="button" onClick={handleExtendedSetup}>
            Call for extended setup ({bonusTurns} turn{bonusTurns > 1 ? "s" : ""})
          </button>
        </div>
      </div>
    );
  }

  if (handoff) {
    const nextSideName = match.controllingSide === "home" ? teams[1]?.name : teams[0]?.name;
    return (
      <div className="game-wrapper handoff-screen">
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

  const controllingSideName = match.controllingSide === "home" ? teams[0]?.name : teams[1]?.name;

  return (
    <div className={`game-wrapper ${isFullscreen ? "is-fullscreen" : ""}`}>
      <div className="hud">
        <div className="hud-top-row">
          <div className="hud-top-left">
            {selectedPawn ? (
              <div className="hud-panel pawn-info">
                <div className={`pawn-info-name ${selectedPawn.side}`}>
                  #{selectedPawn.player.jersey_number} {selectedPawn.player.name}
                </div>
                <div className="pawn-info-row">Stance: {stanceLabel(selectedPawn.stance)}</div>
                <div className="pawn-info-row">
                  Charges: {chargesRemaining}/{totalCharges}
                </div>
                <div className="pawn-info-row">
                  Sprint:{" "}
                  {selectedPawn.plannedSprint
                    ? "Sprinting"
                    : selectedPawn.sprintCooldown > 0
                      ? `Cooldown (${selectedPawn.sprintCooldown})`
                      : "Ready"}
                </div>
                {selectedPawn.plannedSteps.some((s) => s.kick) &&
                  (() => {
                    const kick = selectedPawn.plannedSteps.find((s) => s.kick)!.kick!;
                    return (
                      <div className="pawn-info-row">
                        Kick: {KICK_KIND_LABEL[kick.kind]}, {kick.loft ? "Loft" : "Ground"}
                      </div>
                    );
                  })()}
                {(selectedPawn.plannedTackle || selectedPawn.tackleCooldown > 0) && (
                  <div className="pawn-info-row">
                    Tackle:{" "}
                    {selectedPawn.plannedTackle
                      ? TACKLE_KIND_LABEL[selectedPawn.plannedTackle.kind]
                      : `Cooldown (${selectedPawn.tackleCooldown})`}
                  </div>
                )}
              </div>
            ) : (
              <div className="hud-panel pawn-info pawn-info-empty">No pawn selected</div>
            )}
          </div>

          <div className="hud-top-center">
            <div className="hud-panel scoreboard">
              <span className="team-name">{teams[0]?.name}</span>
              <span className="score">{match.homeScore}</span>
              <span className="vs">x</span>
              <span className="score">{match.awayScore}</span>
              <span className="team-name">{teams[1]?.name}</span>
            </div>
            <div className="turn-line">
              Turn {match.turn}
              {mode === "hotseat" && (
                <span className={`turn-indicator ${match.controllingSide}`}> — {controllingSideName}'s turn</span>
              )}
            </div>
            {pickingMarkTarget && <div className="hud-banner">Click an opponent pawn to mark.</div>}
            {subReplacement && <div className="hud-banner">Click a pawn to bring on {subReplacement.name}.</div>}
            {match.restartSetup && (
              <div className="hud-banner">
                Setting up for a {RESTART_TYPE_LABEL[match.restartSetup.deadBall.type].toLowerCase()} —{" "}
                {match.restartSetup.turnsRemaining} turn{match.restartSetup.turnsRemaining > 1 ? "s" : ""} left
                {match.restartSetup.deadBall.type === "corner" && match.restartSetup.deadBall.side === humanSide && (
                  <span className="corner-preset-actions">
                    <button type="button" className="corner-preset-btn" onClick={handleApplyCornerPreset}>
                      Apply my preset
                    </button>
                    <button type="button" className="corner-preset-btn" onClick={handleSaveCornerPreset}>
                      Save as my preset
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="hud-top-right">
            <button type="button" className="exit-button hud-menu-btn" onClick={onExitToMenu}>
              ← Menu
            </button>
            <button type="button" className="exit-button fullscreen-toggle-btn" onClick={onToggleFullscreen}>
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </button>
            {mode === "solo" && (
              <button
                type="button"
                className={`exit-button ${teamManagementOpen ? "active" : ""}`}
                onClick={() => setTeamManagementOpen((o) => !o)}
              >
                Team Management
              </button>
            )}
            {benchedPlayers.length > 0 && (
              <button
                type="button"
                className={`exit-button ${benchOpen ? "active" : ""}`}
                onClick={() => setBenchOpen((o) => !o)}
              >
                Bench ({benchedPlayers.length})
              </button>
            )}
            {onCareerMatchEnd && (
              <button
                type="button"
                className="exit-button"
                onClick={() => onCareerMatchEnd(match.homeScore, match.awayScore, match.scorers)}
              >
                End Match & Record Result
              </button>
            )}
            <button type="button" className="continue-button" onClick={handleReady} disabled={match.resolving}>
              {match.resolving ? "Resolving..." : mode === "hotseat" ? "Ready" : "Continue"}
            </button>
          </div>
        </div>

        {benchOpen && benchedPlayers.length > 0 && (
          <div className="hud-middle-row">
            <div className="hud-panel bench-panel">
              <div className="team-management-header">Bench</div>
              <ul className="bench-list">
                {benchedPlayers.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="bench-list-item"
                      onClick={() => {
                        setSubReplacement(p);
                        setBenchOpen(false);
                      }}
                    >
                      <span className="bench-list-pos">{p.position}</span>
                      <span className="bench-list-name">
                        #{p.jersey_number} {p.name}
                      </span>
                      <span className="bench-list-action">Bring on</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {mode === "solo" && teamManagementOpen && (
          <div className="hud-middle-row">
            <div className="hud-panel team-management-panel">
              <div className="team-management-header">Team Management (testing)</div>
              {placingPawnSide && (
                <div className="hud-banner">Click the pitch to place the new player.</div>
              )}
              <div className="team-management-columns">
                {(["home", "away"] as const).map((side) => {
                  const roster = match.pawns.filter((p) => p.side === side);
                  const sideName = side === "home" ? teams[0]?.name : teams[1]?.name;
                  return (
                    <div className="team-management-column" key={side}>
                      <div className="team-management-column-header">
                        <span>{sideName}</span>
                        {side === "away" && (
                          <label className="ai-toggle">
                            <input
                              type="checkbox"
                              checked={awayAiEnabled}
                              onChange={(e) => setAwayAiEnabled(e.target.checked)}
                            />
                            AI
                          </label>
                        )}
                      </div>
                      <ul className="roster-list">
                        {roster.map((p) => (
                          <li key={p.id} className={p.id === selectedId ? "active" : ""}>
                            <button type="button" onClick={() => handleSelectFromRoster(p)}>
                              #{p.player.jersey_number} {p.player.name} ({p.player.position})
                            </button>
                            <button
                              type="button"
                              className="roster-delete"
                              onClick={() => handleDeletePlayer(p.id)}
                              title="Delete player"
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="team-management-add-btn"
                        onClick={() => handleAddPlayer(side)}
                        disabled={placingPawnSide !== null}
                      >
                        + Add Player
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectedPawn && (
                <div className="team-management-edit">
                  <div className="team-management-edit-header">Edit: {selectedPawn.player.name}</div>
                  <label>
                    Name
                    <input
                      type="text"
                      value={selectedPawn.player.name}
                      onChange={(e) => handleEditPlayerField(selectedPawn.id, "name", e.target.value)}
                    />
                  </label>
                  <label>
                    Jersey #
                    <input
                      type="number"
                      value={selectedPawn.player.jersey_number}
                      onChange={(e) =>
                        handleEditPlayerField(selectedPawn.id, "jersey_number", Number(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    Position
                    <select
                      value={selectedPawn.player.position}
                      onChange={(e) => handleEditPlayerField(selectedPawn.id, "position", e.target.value)}
                    >
                      <option value="GK">GK</option>
                      <option value="DEF">DEF</option>
                      <option value="MID">MID</option>
                      <option value="FWD">FWD</option>
                    </select>
                  </label>
                  {(
                    ["pace", "stamina", "skill", "jumping", "shot_stopping", "reflexes", "heading"] as const
                  ).map((attr) => (
                    <label key={attr}>
                      {attr.replace("_", " ")}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={selectedPawn.player[attr]}
                        onChange={(e) => handleEditPlayerField(selectedPawn.id, attr, Number(e.target.value))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="hud-bottom-row">
          <div className="hud-bottom-left">
            <div className="hud-panel events-log-panel">
              <div className="events-log-title">Events</div>
              <ul ref={eventsLogRef} className={`events-log ${match.events.length > 0 ? "" : "empty"}`}>
                {match.events.map((e, i) => (
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
                    disabled={chargesRemaining < KICK_CHARGE_COST || match.restartSetup !== null}
                    onClick={() => {
                      setKickMode(true);
                      setTackleMode(false);
                    }}
                  >
                    Kick
                  </button>
                </div>
                {/* A cross is always airborne (see resolve.ts's startFlight) — the
                    Ground/Loft choice only means anything for shot/pass. */}
                {kickMode && kickKind !== "cross" && (
                  <div className="action-row">
                    <button type="button" className={!kickLoft ? "active" : ""} onClick={() => setKickLoft(false)}>
                      Ground
                    </button>
                    <button type="button" className={kickLoft ? "active" : ""} onClick={() => setKickLoft(true)}>
                      Loft
                    </button>
                  </div>
                )}
                {kickMode && (
                  <div className="action-row">
                    <button
                      type="button"
                      className={kickKind === "shot" ? "active" : ""}
                      onClick={() => setKickKind("shot")}
                    >
                      Shot
                    </button>
                    <button
                      type="button"
                      className={kickKind === "pass" ? "active" : ""}
                      onClick={() => setKickKind("pass")}
                    >
                      Pass
                    </button>
                    <button
                      type="button"
                      className={kickKind === "cross" ? "active" : ""}
                      onClick={() => setKickKind("cross")}
                    >
                      Cross
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
                <div className="action-row">
                  <button
                    type="button"
                    className={selectedPawn.plannedTackle || tackleMode ? "active" : ""}
                    disabled={!selectedPawn.plannedTackle && selectedPawn.tackleCooldown > 0}
                    onClick={() => {
                      const next = !tackleMode;
                      setTackleMode(next);
                      if (next) setKickMode(false);
                    }}
                  >
                    {selectedPawn.plannedTackle
                      ? `Tackle: ${TACKLE_KIND_LABEL[selectedPawn.plannedTackle.kind]}`
                      : selectedPawn.tackleCooldown > 0
                        ? `Tackle (${selectedPawn.tackleCooldown})`
                        : "Tackle"}
                  </button>
                </div>
                {tackleMode && (
                  <div className="action-row">
                    <button
                      type="button"
                      className={selectedPawn.plannedTackle?.kind === "clean" ? "active" : ""}
                      onClick={() => handleSetTackle("clean")}
                    >
                      Clean
                    </button>
                    <button
                      type="button"
                      className={selectedPawn.plannedTackle?.kind === "hard" ? "active" : ""}
                      onClick={() => handleSetTackle("hard")}
                    >
                      Hard
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === "ai" ? (
        <p className="hint">
          Click a blue pawn, then keep clicking to chain waypoints for its move — each pawn has a
          limited number of charges per turn. Whoever is standing on the ball carries it when they
          move. Click "Continue" to see what the computer-controlled opponent does.
        </p>
      ) : mode === "solo" ? (
        <p className="hint">
          Click a blue pawn, then keep clicking to chain waypoints for its move — each pawn has a
          limited number of charges per turn. Whoever is standing on the ball carries it when they
          move. The opposing team stays put in this mode — it's just for testing the mechanics.
          Click "Continue" to run it.
        </p>
      ) : (
        <p className="hint">
          Click a pawn on the team in control, then keep clicking to chain waypoints for its move —
          each pawn has a limited number of charges per turn. Whoever is standing on the ball
          carries it when they move. Click "Ready" when you're done planning — the other team can't
          see your moves until resolution.
        </p>
      )}
      <p className="camera-hint">
        Mouse wheel: zoom. Middle (or side) button + drag horizontally: rotate the camera.
        Drag vertically: adjust the tilt. WASD: pan around the pitch. Right-click: undo the
        selected pawn's last waypoint.
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
        onContextMenu={handleViewportContextMenu}
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
