import Phaser from "phaser";
import {
  GOAL_ROW_MAX,
  GOAL_ROW_MIN,
  GRID_COLS,
  GRID_ROWS,
  OOB_CELLS,
} from "../game/constants";
import { createProjector, GOAL_NET_DEPTH, OOB_MARGIN, type Projector } from "../game/iso";
import type { Ball, Pawn, Side, Vec2 } from "../game/types";
import { EventBus } from "./EventBus";

export interface MatchSyncState {
  pawns: Pawn[];
  ball: Ball;
  selectedId: string | null;
  reachableCells: Set<string>;
  kickMode: boolean;
  controllingSide: Side;
  camera: { zoom: number; rotation: number; tilt: number };
}

export interface MatchCallbacks {
  onPawnClick: (pawnId: string) => void;
  onCellClick: (cell: Vec2) => void;
}

const SIX_YARD_DEPTH = 1.2;
const PENALTY_DEPTH = 2.6;
const PENALTY_PAD = 1.5;
const SPRITE_HEIGHT = 108;
const SPRITE_WIDTH = SPRITE_HEIGHT * 0.55;
const TWEEN_MS = 350;

function spriteKeyFor(pawn: Pawn): string {
  if (pawn.player.position === "GK") return "player_gk";
  return pawn.side === "home" ? "player_home" : "player_away";
}

interface PawnVisual {
  container: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  sprite: Phaser.GameObjects.Image;
  badgeBg: Phaser.GameObjects.Arc;
  badgeText: Phaser.GameObjects.Text;
  lastGridPos: Vec2;
}

export class MatchScene extends Phaser.Scene {
  private projector!: Projector;
  private fieldGfx!: Phaser.GameObjects.Graphics;
  private cellsGfx!: Phaser.GameObjects.Graphics;
  private cellZones = new Map<string, Phaser.GameObjects.Zone>();
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballSprite!: Phaser.GameObjects.Image;
  private lastBallPos: Vec2 = { x: -999, y: -999 };
  private pawnVisuals = new Map<string, PawnVisual>();

  private state: MatchSyncState | null = null;
  private callbacks: MatchCallbacks | null = null;
  private lastRotation: number | null = null;
  private lastTilt: number | null = null;

  constructor() {
    super("MatchScene");
  }

  preload() {
    this.load.image("player_home", "/sprites/player_home.png");
    this.load.image("player_away", "/sprites/player_away.png");
    this.load.image("player_gk", "/sprites/player_gk.png");
    this.load.image("ball", "/sprites/ball.png");
    this.load.image("grass_light", "/sprites/grass_light.png");
    this.load.image("grass_dark", "/sprites/grass_dark.png");
  }

  create() {
    this.projector = createProjector(0, 0);
    this.fieldGfx = this.add.graphics();
    this.cellsGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics();

    this.ballShadow = this.add.ellipse(0, 0, 18, 9, 0x000000, 0.4);
    this.ballSprite = this.add.image(0, 0, "ball").setDisplaySize(26, 26);

    this.buildCellZones();

    this.setCallbacks = this.setCallbacks.bind(this);
    EventBus.emit("current-scene-ready", this);
  }

  setCallbacks(callbacks: MatchCallbacks) {
    this.callbacks = callbacks;
  }

  /** Called by React whenever pawns/ball/selection/camera change. Safe to call every render. */
  syncState(state: MatchSyncState) {
    const cameraChanged =
      this.lastRotation !== state.camera.rotation || this.lastTilt !== state.camera.tilt;
    this.state = state;

    if (cameraChanged) {
      this.projector = createProjector(state.camera.rotation, state.camera.tilt);
      this.lastRotation = state.camera.rotation;
      this.lastTilt = state.camera.tilt;
      this.redrawField();
      this.rebuildCellZones();
    }

    this.cameras.main.setZoom(state.camera.zoom);
    this.updateCellHighlights();
    this.updatePawns();
    this.updateBall();
    this.updateOverlay();
  }

  // --- Static field ---

  private redrawField() {
    const p = this.projector;
    const g = this.fieldGfx;
    g.clear();

    const apron = [
      p.toIso(-OOB_MARGIN, -OOB_MARGIN),
      p.toIso(GRID_COLS + OOB_MARGIN, -OOB_MARGIN),
      p.toIso(GRID_COLS + OOB_MARGIN, GRID_ROWS + OOB_MARGIN),
      p.toIso(-OOB_MARGIN, GRID_ROWS + OOB_MARGIN),
    ];
    g.fillStyle(0x2c6b31, 1);
    fillPoly(g, apron);

    // Goal net pockets (drawn before the pitch so the frame/pitch edge overlaps them cleanly).
    for (const atHome of [true, false]) {
      const lineX = atHome ? 0 : GRID_COLS;
      const netX = atHome ? -GOAL_NET_DEPTH : GRID_COLS + GOAL_NET_DEPTH;
      const box = [
        p.toIso(lineX, GOAL_ROW_MIN),
        p.toIso(netX, GOAL_ROW_MIN),
        p.toIso(netX, GOAL_ROW_MAX + 1),
        p.toIso(lineX, GOAL_ROW_MAX + 1),
      ];
      g.fillStyle(0x0a0c0a, 0.45);
      fillPoly(g, box);
    }

    const outer = [p.toIso(0, 0), p.toIso(GRID_COLS, 0), p.toIso(GRID_COLS, GRID_ROWS), p.toIso(0, GRID_ROWS)];
    g.fillStyle(0x327a37, 1);
    fillPoly(g, outer);

    for (let row = 0; row < GRID_ROWS; row++) {
      const band = [
        p.toIso(0, row),
        p.toIso(GRID_COLS, row),
        p.toIso(GRID_COLS, row + 1),
        p.toIso(0, row + 1),
      ];
      g.fillStyle(row % 2 === 0 ? 0x3b8a41 : 0x327a37, 1);
      fillPoly(g, band);
    }

    g.lineStyle(2.5, 0xf2f2f2, 0.9);
    strokePoly(g, outer, true);
    g.lineStyle(1.5, 0xffffff, 0.35);
    strokePoly(g, apron, true);

    const halfTop = p.toIso(GRID_COLS / 2, 0);
    const halfBottom = p.toIso(GRID_COLS / 2, GRID_ROWS);
    g.lineStyle(2, 0xf2f2f2, 0.9);
    g.lineBetween(halfTop.x, halfTop.y, halfBottom.x, halfBottom.y);

    const circlePts: Vec2[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      circlePts.push(p.toIso(GRID_COLS / 2 + Math.cos(a) * 1.7, GRID_ROWS / 2 + Math.sin(a) * 1.7));
    }
    strokePoly(g, circlePts, false);

    const centerSpot = p.toIso(GRID_COLS / 2, GRID_ROWS / 2);
    g.fillStyle(0xf2f2f2, 0.9);
    g.fillCircle(centerSpot.x, centerSpot.y, 2.5);

    function box(x0: number, depth: number, pad: number): Vec2[] {
      const x1 = x0 === 0 ? depth : GRID_COLS - depth;
      const yTop = GOAL_ROW_MIN - pad;
      const yBottom = GOAL_ROW_MAX + 1 + pad;
      return [p.toIso(x0, yTop), p.toIso(x1, yTop), p.toIso(x1, yBottom), p.toIso(x0, yBottom)];
    }

    for (const x0 of [0, GRID_COLS]) {
      g.lineStyle(2, 0xf2f2f2, 0.9);
      strokePoly(g, box(x0, PENALTY_DEPTH, PENALTY_PAD), true);
      strokePoly(g, box(x0, SIX_YARD_DEPTH, 0), true);
      const spotX = x0 === 0 ? PENALTY_DEPTH - 0.4 : GRID_COLS - PENALTY_DEPTH + 0.4;
      const spot = p.toIso(spotX, GRID_ROWS / 2);
      g.fillCircle(spot.x, spot.y, 2.5);
    }

    for (const atHome of [true, false]) {
      this.drawGoalFrame(g, atHome);
    }
  }

  private drawGoalFrame(g: Phaser.GameObjects.Graphics, atHome: boolean) {
    const p = this.projector;
    const lineX = atHome ? 0 : GRID_COLS;
    const rise = 34;
    const frontTop = p.toIso(lineX, GOAL_ROW_MIN);
    const frontBottom = p.toIso(lineX, GOAL_ROW_MAX + 1);
    const frontTopRise = { x: frontTop.x, y: frontTop.y - rise };
    const frontBottomRise = { x: frontBottom.x, y: frontBottom.y - rise };

    g.lineStyle(5, 0xf7f7f7, 1);
    g.lineBetween(frontTop.x, frontTop.y, frontTopRise.x, frontTopRise.y);
    g.lineBetween(frontBottom.x, frontBottom.y, frontBottomRise.x, frontBottomRise.y);
    g.lineStyle(4.5, 0xf7f7f7, 1);
    g.lineBetween(frontTopRise.x, frontTopRise.y, frontBottomRise.x, frontBottomRise.y);
  }

  // --- Interactive grid cells ---

  private buildCellZones() {
    for (let x = -OOB_CELLS; x < GRID_COLS + OOB_CELLS; x++) {
      for (let y = -OOB_CELLS; y < GRID_ROWS + OOB_CELLS; y++) {
        const zone = this.add.zone(0, 0, 1, 1).setInteractive();
        zone.on("pointerdown", () => this.callbacks?.onCellClick({ x, y }));
        this.cellZones.set(`${x},${y}`, zone);
      }
    }
    this.rebuildCellZones();
  }

  private rebuildCellZones() {
    const p = this.projector;
    for (const [key, zone] of this.cellZones) {
      const [xs, ys] = key.split(",");
      const x = Number(xs);
      const y = Number(ys);
      const corners = [p.toIso(x, y), p.toIso(x + 1, y), p.toIso(x + 1, y + 1), p.toIso(x, y + 1)];
      const poly = new Phaser.Geom.Polygon(corners.flatMap((c) => [c.x, c.y]));
      const bounds = Phaser.Geom.Polygon.GetAABB(poly);
      zone.setPosition(0, 0);
      zone.setSize(1, 1);
      zone.input!.hitArea = poly;
      zone.input!.hitAreaCallback = Phaser.Geom.Polygon.Contains;
      zone.setData("bounds", bounds);
    }
  }

  private updateCellHighlights() {
    const g = this.cellsGfx;
    g.clear();
    if (!this.state) return;
    const { reachableCells, kickMode } = this.state;
    const p = this.projector;
    for (const key of reachableCells) {
      const [xs, ys] = key.split(",");
      const x = Number(xs);
      const y = Number(ys);
      const corners = [p.toIso(x, y), p.toIso(x + 1, y), p.toIso(x + 1, y + 1), p.toIso(x, y + 1)];
      g.fillStyle(kickMode ? 0xff8c00 : 0xffff64, kickMode ? 0.35 : 0.3);
      fillPoly(g, corners);
      g.lineStyle(1.5, kickMode ? 0xffa028 : 0xffff78, 0.9);
      strokePoly(g, corners, true);
    }
  }

  // --- Pawns ---

  private updatePawns() {
    if (!this.state) return;
    const { pawns, selectedId, controllingSide } = this.state;
    const seen = new Set<string>();

    for (const pawn of pawns) {
      seen.add(pawn.id);
      const visible = pawn.side === controllingSide ? pawn : { ...pawn, plannedPos: null, plannedKick: null };
      let visual = this.pawnVisuals.get(pawn.id);
      if (!visual) {
        visual = this.createPawnVisual(pawn);
        this.pawnVisuals.set(pawn.id, visual);
      }
      this.applyPawnPosition(visual, pawn.pos);
      visual.badgeText.setText(String(pawn.player.jersey_number));
      const selected = pawn.id === selectedId;
      visual.sprite.setTint(selected ? 0xfff2a0 : 0xffffff);
      visual.container.setData("pawn", visible);
    }

    for (const [id, visual] of this.pawnVisuals) {
      if (!seen.has(id)) {
        visual.container.destroy();
        this.pawnVisuals.delete(id);
      }
    }

    // Depth-sort so pawns further "south" on screen draw in front.
    const sorted = [...this.pawnVisuals.values()].sort((a, b) => a.container.y - b.container.y);
    sorted.forEach((v, i) => v.container.setDepth(10 + i));
  }

  private createPawnVisual(pawn: Pawn): PawnVisual {
    const container = this.add.container(0, 0);
    const shadow = this.add.ellipse(0, 0, 40, 20, 0x000000, 0.4);
    const sprite = this.add
      .image(0, -SPRITE_HEIGHT / 2, spriteKeyFor(pawn))
      .setDisplaySize(SPRITE_WIDTH, SPRITE_HEIGHT)
      .setOrigin(0.5, 0.5);
    sprite.y = -SPRITE_HEIGHT / 2;
    const badgeBg = this.add.circle(0, -SPRITE_HEIGHT - 6, 9, pawn.side === "home" ? 0x1565c0 : 0xc62828);
    badgeBg.setStrokeStyle(1, 0x000000, 0.6);
    const badgeText = this.add
      .text(0, -SPRITE_HEIGHT - 6, String(pawn.player.jersey_number), {
        fontSize: "11px",
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5, 0.5);

    container.add([shadow, sprite, badgeBg, badgeText]);
    container.setSize(SPRITE_WIDTH, SPRITE_HEIGHT);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-SPRITE_WIDTH / 2, -SPRITE_HEIGHT, SPRITE_WIDTH, SPRITE_HEIGHT),
      Phaser.Geom.Rectangle.Contains
    );
    container.on("pointerdown", () => this.callbacks?.onPawnClick(pawn.id));

    return { container, shadow, sprite, badgeBg, badgeText, lastGridPos: { ...pawn.pos } };
  }

  private applyPawnPosition(visual: PawnVisual, gridPos: Vec2) {
    const target = this.projector.toIso(gridPos.x + 0.5, gridPos.y + 0.5);
    const moved = visual.lastGridPos.x !== gridPos.x || visual.lastGridPos.y !== gridPos.y;
    visual.lastGridPos = { ...gridPos };
    if (moved) {
      this.tweens.add({
        targets: visual.container,
        x: target.x,
        y: target.y,
        duration: TWEEN_MS,
        ease: "Linear",
      });
    } else {
      visual.container.setPosition(target.x, target.y);
    }
  }

  // --- Ball ---

  private updateBall() {
    if (!this.state) return;
    const { ball } = this.state;
    const target = this.projector.toIso(ball.pos.x + 0.5, ball.pos.y + 0.5);
    const moved = this.lastBallPos.x !== ball.pos.x || this.lastBallPos.y !== ball.pos.y;
    this.lastBallPos = { ...ball.pos };
    const doMove = () => {
      this.ballShadow.setPosition(target.x, target.y);
      this.ballSprite.setPosition(target.x, target.y - 10);
    };
    if (moved) {
      this.tweens.add({
        targets: [this.ballShadow],
        x: target.x,
        y: target.y,
        duration: TWEEN_MS,
        ease: "Linear",
      });
      this.tweens.add({
        targets: [this.ballSprite],
        x: target.x,
        y: target.y - 10,
        duration: TWEEN_MS,
        ease: "Linear",
      });
    } else {
      doMove();
    }
    this.ballShadow.setDepth(5);
    this.ballSprite.setDepth(1000);
  }

  // --- Planned-move ghosts/arrows ---

  private updateOverlay() {
    const g = this.overlayGfx;
    g.clear();
    if (!this.state) return;
    const p = this.projector;
    for (const pawn of this.state.pawns) {
      if (pawn.side !== this.state.controllingSide) continue;
      const base = p.toIso(pawn.pos.x + 0.5, pawn.pos.y + 0.5);
      if (pawn.plannedPos) {
        const planned = p.toIso(pawn.plannedPos.x + 0.5, pawn.plannedPos.y + 0.5);
        g.lineStyle(2.5, 0xffeb3b, 1);
        g.lineBetween(base.x, base.y, planned.x, planned.y);
        g.fillStyle(pawn.side === "home" ? 0x1565c0 : 0xc62828, 0.35);
        g.lineStyle(2, 0xffeb3b, 1);
        g.fillEllipse(planned.x, planned.y, 32, 16);
        g.strokeEllipse(planned.x, planned.y, 32, 16);
      }
      if (pawn.plannedKick) {
        const kick = p.toIso(pawn.plannedKick.x + 0.5, pawn.plannedKick.y + 0.5);
        g.lineStyle(3, 0xef6c00, 1);
        g.lineBetween(base.x, base.y, kick.x, kick.y);
        g.fillStyle(0xef6c00, 1);
        g.fillCircle(kick.x, kick.y, 7);
      }
    }
  }
}

function fillPoly(g: Phaser.GameObjects.Graphics, points: Vec2[]) {
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
  g.fillPath();
}

function strokePoly(g: Phaser.GameObjects.Graphics, points: Vec2[], closed: boolean) {
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  if (closed) g.closePath();
  g.strokePath();
}
