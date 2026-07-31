import Phaser from "phaser";
import { landingSpread } from "../game/aim";
import {
  CHECKER_CELL_SIZE,
  GOAL_ROW_MAX,
  GOAL_ROW_MIN,
  GRID_COLS,
  GRID_ROWS,
} from "../game/constants";
import {
  createProjector,
  GOAL_NET_DEPTH,
  OOB_MARGIN,
  VIEW_H,
  VIEW_W,
  type Projector,
} from "../game/iso";
import { classifyKickTarget, intentLabel, riskLabel } from "../game/kickIntent";
import type { Ball, Pawn, Side, Vec2 } from "../game/types";
import { EventBus } from "./EventBus";

export interface MatchSyncState {
  pawns: Pawn[];
  ball: Ball;
  selectedId: string | null;
  /** How far (world units) the selected pawn can move/kick this turn, or null if nothing's selected. */
  reachRadius: number | null;
  kickMode: boolean;
  controllingSide: Side;
  camera: { zoom: number; rotation: number; tilt: number };
}

export interface MatchCallbacks {
  onPawnClick: (pawnId: string) => void;
  onFieldClick: (point: Vec2) => void;
}

const SIX_YARD_DEPTH = 1.2;
const PENALTY_DEPTH = 2.6;
const PENALTY_PAD = 1.5;
// How far into the pitch the reach-highlight's "shot zone" tint extends from
// the goal line, and the radius of the "pass zone" halo drawn around each
// in-range teammate — purely visual, not gameplay radii.
const GOAL_TINT_DEPTH = 3;
const PASS_HALO_RADIUS = 2.2;
const SPRITE_HEIGHT = 90;
// The new pixel-art sprite set is narrower than the old set (~0.40-0.48
// width:height across the three files, vs. the old ~0.55) — this average
// keeps all three close to their real proportions instead of stretching them.
const SPRITE_WIDTH = SPRITE_HEIGHT * 0.44;
const TWEEN_MS = 350;

function spriteKeyFor(pawn: Pawn): string {
  if (pawn.player.position === "GK") return "player_gk";
  return pawn.side === "home" ? "player_home" : "player_away";
}

interface PawnVisual {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  badgeBg: Phaser.GameObjects.Arc;
  badgeText: Phaser.GameObjects.Text;
  lastGridPos: Vec2;
}

export class MatchScene extends Phaser.Scene {
  private projector!: Projector;
  private fieldGfx!: Phaser.GameObjects.Graphics;
  private linesGfx!: Phaser.GameObjects.Graphics;
  private cellsGfx!: Phaser.GameObjects.Graphics;
  private fieldZone!: Phaser.GameObjects.Zone;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private ballShadow!: Phaser.GameObjects.Ellipse;
  private ballSprite!: Phaser.GameObjects.Image;
  private lastBallPos: Vec2 = { x: -999, y: -999 };
  private pawnVisuals = new Map<string, PawnVisual>();
  // A single reusable label for the planned kick's aim-risk readout — at
  // most one pawn (the ball carrier) can have a plannedKick at a time, so
  // there's never a need for more than one of these.
  private kickLabelText!: Phaser.GameObjects.Text;

  private state: MatchSyncState | null = null;
  private callbacks: MatchCallbacks | null = null;
  private lastRotation: number | null = null;
  private lastTilt: number | null = null;
  // Scale needed to fit the fixed-size isometric world into the actual
  // canvas size, which now varies with the container (see PhaserGame.tsx's
  // RESIZE scale mode) instead of always matching VIEW_W/VIEW_H exactly.
  private fitZoom = 1;

  constructor() {
    super("MatchScene");
  }

  preload() {
    this.load.image("player_home", "/sprites/player_home.png");
    this.load.image("player_away", "/sprites/player_away.png");
    this.load.image("player_gk", "/sprites/player_gk.png");
    this.load.image("ball", "/sprites/ball.png");
  }

  create() {
    this.projector = createProjector(0, 0);
    this.fieldGfx = this.add.graphics();
    this.linesGfx = this.add.graphics();
    this.cellsGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics();

    this.ballShadow = this.add.ellipse(0, 0, 18, 9, 0x000000, 0.4);
    this.ballSprite = this.add.image(0, 0, "ball").setDisplaySize(26, 26);

    this.kickLabelText = this.add
      .text(0, 0, "", {
        fontSize: "13px",
        fontStyle: "bold",
        color: "#ffffff",
        backgroundColor: "#00000099",
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(2000)
      .setVisible(false);

    // A single static hit zone covering the whole fixed-size world, rather
    // than one Zone per grid cell — its own geometry is camera-independent
    // (unlike the old per-cell zones, it never needs rebuilding on rotation),
    // since the click's world position is recovered afterward via the
    // current projector's fromIso. Pawns still get click priority over it
    // via depth (set below in updatePawns), same as the old per-cell zones.
    this.fieldZone = this.add
      .zone(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H)
      .setInteractive()
      .setDepth(-1);
    this.fieldZone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const point = this.projector.fromIso(pointer.worldX, pointer.worldY);
      this.callbacks?.onFieldClick(point);
    });

    this.handleResize(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });

    this.setCallbacks = this.setCallbacks.bind(this);
    EventBus.emit("current-scene-ready", this);
  }

  setCallbacks(callbacks: MatchCallbacks) {
    this.callbacks = callbacks;
  }

  /** Keeps the fixed-size isometric world fitted and centered as the real canvas size changes. */
  private handleResize(gameSize: { width: number; height: number }) {
    this.fitZoom = Math.min(gameSize.width / VIEW_W, gameSize.height / VIEW_H);
    this.cameras.main.setZoom(this.fitZoom * (this.state?.camera.zoom ?? 1));
    this.cameras.main.centerOn(VIEW_W / 2, VIEW_H / 2);
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
    }

    this.cameras.main.setZoom(this.fitZoom * state.camera.zoom);
    this.updateReachHighlight();
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

    const lg = this.linesGfx;
    lg.clear();

    // Checkerboard fill (alternating per tile, not per row) plus a scatter of
    // small, fixed-position speckles per tile to fake grass-blade texture —
    // both computed directly from this tile's own already-rotated corner
    // points (via bilinear), the same ones the checker/outline/lines below
    // use, so this can never drift out of sync with the rest of the field
    // under rotation (unlike the earlier masked-texture attempt). Tiles are
    // CHECKER_CELL_SIZE world units per side, decoupled from gameplay scale
    // so draw cost stays bounded regardless of pitch size.
    const SPECKS_PER_TILE = 5;
    const tileCols = GRID_COLS / CHECKER_CELL_SIZE;
    const tileRows = GRID_ROWS / CHECKER_CELL_SIZE;
    for (let row = 0; row < tileRows; row++) {
      for (let col = 0; col < tileCols; col++) {
        const x0 = col * CHECKER_CELL_SIZE;
        const y0 = row * CHECKER_CELL_SIZE;
        const tile = [
          p.toIso(x0, y0),
          p.toIso(x0 + CHECKER_CELL_SIZE, y0),
          p.toIso(x0 + CHECKER_CELL_SIZE, y0 + CHECKER_CELL_SIZE),
          p.toIso(x0, y0 + CHECKER_CELL_SIZE),
        ];
        lg.fillStyle((row + col) % 2 === 0 ? 0x3b8a41 : 0x327a37, 1);
        fillPoly(lg, tile);

        for (let i = 0; i < SPECKS_PER_TILE; i++) {
          const seed = row * 1000 + col * 17 + i * 3.7;
          const u = seededRandom(seed);
          const v = seededRandom(seed + 0.5);
          const pt = bilinear(tile, u, v);
          const darker = seededRandom(seed + 1.5) > 0.5;
          const radius = 1.2 + seededRandom(seed + 2) * 1.6;
          lg.fillStyle(darker ? 0x0d2410 : 0x5ca865, 0.1);
          lg.fillCircle(pt.x, pt.y, radius);
        }
      }
    }

    lg.lineStyle(2.5, 0xf2f2f2, 0.9);
    strokePoly(lg, outer, true);
    lg.lineStyle(1.5, 0xffffff, 0.35);
    strokePoly(lg, apron, true);

    const halfTop = p.toIso(GRID_COLS / 2, 0);
    const halfBottom = p.toIso(GRID_COLS / 2, GRID_ROWS);
    lg.lineStyle(2, 0xf2f2f2, 0.9);
    lg.lineBetween(halfTop.x, halfTop.y, halfBottom.x, halfBottom.y);

    const circlePts: Vec2[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      circlePts.push(p.toIso(GRID_COLS / 2 + Math.cos(a) * 1.7, GRID_ROWS / 2 + Math.sin(a) * 1.7));
    }
    strokePoly(lg, circlePts, false);

    const centerSpot = p.toIso(GRID_COLS / 2, GRID_ROWS / 2);
    lg.fillStyle(0xf2f2f2, 0.9);
    lg.fillCircle(centerSpot.x, centerSpot.y, 2.5);

    function box(x0: number, depth: number, pad: number): Vec2[] {
      const x1 = x0 === 0 ? depth : GRID_COLS - depth;
      const yTop = GOAL_ROW_MIN - pad;
      const yBottom = GOAL_ROW_MAX + 1 + pad;
      return [p.toIso(x0, yTop), p.toIso(x1, yTop), p.toIso(x1, yBottom), p.toIso(x0, yBottom)];
    }

    for (const x0 of [0, GRID_COLS]) {
      lg.lineStyle(2, 0xf2f2f2, 0.9);
      strokePoly(lg, box(x0, PENALTY_DEPTH, PENALTY_PAD), true);
      strokePoly(lg, box(x0, SIX_YARD_DEPTH, 0), true);
      const spotX = x0 === 0 ? PENALTY_DEPTH - 0.4 : GRID_COLS - PENALTY_DEPTH + 0.4;
      const spot = p.toIso(spotX, GRID_ROWS / 2);
      lg.fillCircle(spot.x, spot.y, 2.5);
    }

    for (const atHome of [true, false]) {
      this.drawGoalFrame(lg, atHome);
    }
  }

  /**
   * Posts + crossbar at the goal line. A filled 3D net box was tried here
   * (back wall/sides/roof panels) but rendered as a solid dark wedge cutting
   * across the pitch instead of reading as a box — reverted rather than
   * iterating on it blind (this scene's visual output can't be reliably
   * checked from this environment). Keeping this simple and just making the
   * frame itself bigger/thicker is the safer bet.
   */
  private drawGoalFrame(g: Phaser.GameObjects.Graphics, atHome: boolean) {
    const p = this.projector;
    const lineX = atHome ? 0 : GRID_COLS;
    const rise = 46;

    const frontTop = p.toIso(lineX, GOAL_ROW_MIN);
    const frontBottom = p.toIso(lineX, GOAL_ROW_MAX + 1);
    const frontTopRise = { x: frontTop.x, y: frontTop.y - rise };
    const frontBottomRise = { x: frontBottom.x, y: frontBottom.y - rise };

    g.lineStyle(6, 0xf7f7f7, 1);
    g.lineBetween(frontTop.x, frontTop.y, frontTopRise.x, frontTopRise.y);
    g.lineBetween(frontBottom.x, frontBottom.y, frontBottomRise.x, frontBottomRise.y);
    g.lineStyle(5.5, 0xf7f7f7, 1);
    g.lineBetween(frontTopRise.x, frontTopRise.y, frontBottomRise.x, frontBottomRise.y);
  }

  // --- Reach-area highlight ---

  /**
   * Replaces the old per-cell highlight grid: a single filled circle around
   * the selected pawn at its real move/kick reach, plus (in kick mode) the
   * opponent's goal mouth tinted red when it's within reach and a green
   * halo around each in-range teammate — these are already well-defined,
   * fixed-shape regions, so tinting them directly reads better than the old
   * per-cell approach did once cells stopped being the unit of precision.
   */
  private updateReachHighlight() {
    const g = this.cellsGfx;
    g.clear();
    if (!this.state) return;
    const { reachRadius, kickMode, pawns, selectedId } = this.state;
    if (reachRadius === null || !selectedId) return;
    const selectedPawn = pawns.find((pw) => pw.id === selectedId);
    if (!selectedPawn) return;
    const p = this.projector;
    const cx = selectedPawn.pos.x + 0.5;
    const cy = selectedPawn.pos.y + 0.5;
    const reachPts = isoCircle(p, cx, cy, reachRadius);

    if (!kickMode) {
      g.fillStyle(0xffff64, 0.28);
      fillPoly(g, reachPts);
      g.lineStyle(1.5, 0xffff78, 0.9);
      strokePoly(g, reachPts, true);
      return;
    }

    // Base "clear" tint over the whole reach circle; shot/pass zones layer on top.
    g.fillStyle(0xff8c00, 0.22);
    fillPoly(g, reachPts);
    g.lineStyle(1.5, 0xffa028, 0.9);
    strokePoly(g, reachPts, true);

    const goalLineX = selectedPawn.side === "home" ? GRID_COLS : 0;
    const goalYTop = GOAL_ROW_MIN;
    const goalYBottom = GOAL_ROW_MAX + 1;
    const closestGoalY = Math.max(goalYTop, Math.min(goalYBottom, selectedPawn.pos.y));
    const distToGoal = Math.hypot(goalLineX - selectedPawn.pos.x, closestGoalY - selectedPawn.pos.y);
    if (distToGoal <= reachRadius) {
      const depth = selectedPawn.side === "home" ? -GOAL_TINT_DEPTH : GOAL_TINT_DEPTH;
      const shotZone = [
        p.toIso(goalLineX, goalYTop),
        p.toIso(goalLineX + depth, goalYTop),
        p.toIso(goalLineX + depth, goalYBottom),
        p.toIso(goalLineX, goalYBottom),
      ];
      g.fillStyle(0xe53935, 0.32);
      fillPoly(g, shotZone);
      g.lineStyle(1.5, 0xff6659, 0.9);
      strokePoly(g, shotZone, true);
    }

    for (const mate of pawns) {
      if (mate.side !== selectedPawn.side || mate.id === selectedPawn.id) continue;
      if (Math.hypot(mate.pos.x - selectedPawn.pos.x, mate.pos.y - selectedPawn.pos.y) > reachRadius) continue;
      const haloPts = isoCircle(p, mate.pos.x + 0.5, mate.pos.y + 0.5, PASS_HALO_RADIUS);
      g.fillStyle(0x43a047, 0.4);
      fillPoly(g, haloPts);
      g.lineStyle(1.5, 0x76d275, 0.9);
      strokePoly(g, haloPts, true);
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
    // Two soft, stacked ellipses (rather than one hard-edged shape) approximate
    // a blurred contact shadow directly under the sprite's feet — this is the
    // main cue that reads as "standing on the ground" for a flat billboard
    // sprite over an isometric plane; without it the pitch's texture/checker
    // pattern alone isn't enough to sell the contact point.
    const shadowOuter = this.add.ellipse(0, 0, 34, 14, 0x000000, 0.16);
    const shadowInner = this.add.ellipse(0, 0, 20, 8, 0x000000, 0.22);
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

    container.add([shadowOuter, shadowInner, sprite, badgeBg, badgeText]);
    container.setSize(SPRITE_WIDTH, SPRITE_HEIGHT);
    // The hit rectangle deliberately overshoots the sprite's own bounding box:
    // it used to end flush at y=0 (the ground point), which cut off the
    // contact shadow and the lower few pixels of the feet — exactly where
    // people instinctively click first — leaving only the chest/head
    // reliably clickable. Padding it out (sides too, for a bit of forgiveness)
    // makes the whole visible token clickable, not just its upper half.
    const HIT_PAD_SIDE = 10;
    const HIT_PAD_BOTTOM = 16;
    // Phaser.GameObjects.Container hard-codes displayOriginX/Y to width/2 and
    // height/2 (from setSize above), and the input manager adds that origin
    // into the pointer's local coordinate before testing a custom hitArea —
    // unlike a plain Image/Sprite, a Container's hit rectangle isn't tested
    // in the same local space its children are drawn in. Without correcting
    // for it, the whole hit rectangle is shifted up-left by exactly half the
    // sprite's width/height, which is why only the top of the sprite used to
    // be clickable. Adding displayOriginX/Y back cancels that shift out.
    container.setInteractive(
      new Phaser.Geom.Rectangle(
        -SPRITE_WIDTH / 2 - HIT_PAD_SIDE + container.displayOriginX,
        -SPRITE_HEIGHT + container.displayOriginY,
        SPRITE_WIDTH + HIT_PAD_SIDE * 2,
        SPRITE_HEIGHT + HIT_PAD_BOTTOM
      ),
      Phaser.Geom.Rectangle.Contains
    );
    container.on("pointerdown", () => this.callbacks?.onPawnClick(pawn.id));

    return { container, sprite, badgeBg, badgeText, lastGridPos: { ...pawn.pos } };
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
    let labelShown = false;
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

        // Aim-spread preview: a ring around the target sized by how precise
        // this exact kick actually is (distance + the kicker's skill), using
        // the same formula the resolution engine samples the real landing
        // point from — a true preview of risk, not a separate guess. A
        // small ring means a safe, reliable kick; a large one means it could
        // land well off where you clicked.
        const kickDist = Math.hypot(pawn.plannedKick.x - pawn.pos.x, pawn.plannedKick.y - pawn.pos.y);
        const sigma = landingSpread(kickDist, pawn.player.skill);
        const spreadPts: Vec2[] = [];
        const RING_SEGMENTS = 28;
        for (let i = 0; i <= RING_SEGMENTS; i++) {
          const angle = (i / RING_SEGMENTS) * Math.PI * 2;
          spreadPts.push(
            p.toIso(
              pawn.plannedKick.x + 0.5 + Math.cos(angle) * sigma,
              pawn.plannedKick.y + 0.5 + Math.sin(angle) * sigma
            )
          );
        }
        g.lineStyle(1.5, 0xef6c00, 0.5);
        strokePoly(g, spreadPts, true);

        // Plain-language readout next to the ring: what kind of kick this is
        // and how risky it actually is, instead of leaving the ring's size
        // to speak for itself.
        const intent = classifyKickTarget(pawn.plannedKick, pawn.side, pawn.id, this.state.pawns);
        this.kickLabelText.setText(`${intentLabel(intent)}: ${riskLabel(sigma)}`);
        this.kickLabelText.setPosition(kick.x, kick.y - 26);
        this.kickLabelText.setVisible(true);
        labelShown = true;
      }
    }
    if (!labelShown) this.kickLabelText.setVisible(false);
  }
}

/** World-space circle (center cx,cy, radius r) sampled and projected through `p` — renders as an ellipse under tilt/rotation, same technique used for the center circle and aim-ring. */
function isoCircle(p: Projector, cx: number, cy: number, r: number, segments = 32): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push(p.toIso(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
  }
  return pts;
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

// Deterministic pseudo-random in [0, 1) — same seed always gives the same
// value, so the grass speckle pattern below is stable across redraws
// (camera rotation/tilt changes) instead of re-randomizing and shimmering.
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

function lerpPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Maps a (u, v) point in a cell's local [0,1]x[0,1] space to screen space via
// the cell's four already-projected (rotated/tilted) isometric corners —
// this is what lets speckles sit correctly inside a skewed diamond cell
// under any camera angle, using the exact same projected points as the
// checkerboard/outline drawing, so it can never fall out of sync with them.
function bilinear(corners: Vec2[], u: number, v: number): Vec2 {
  const top = lerpPoint(corners[0], corners[1], u);
  const bottom = lerpPoint(corners[3], corners[2], u);
  return lerpPoint(top, bottom, v);
}
