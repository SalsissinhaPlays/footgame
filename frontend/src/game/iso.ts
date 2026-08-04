import { GRID_COLS, GRID_ROWS } from "./constants";

// Pure rendering math: projects grid coordinates (the same coordinates the
// game logic already uses) into an isometric screen space. Nothing here
// feeds back into gameplay — resolve.ts/ai.ts/formation.ts never import this.
//
// The camera can orbit freely around the vertical axis and adjust its tilt
// (like Ragnarok Online's fixed-but-adjustable isometric camera), so
// projection depends on runtime rotation + tilt angles. Use
// createProjector(rotationDeg, tiltDeg) to get projection helpers bound to
// the current camera; VIEW_W/VIEW_H/TILE_W stay fixed regardless of camera
// so the canvas never resizes as you spin or tilt.

export const TILE_W = 96;
// sin(TILT_DEFAULT) = 0.5, matching the classic 2:1 pixel-art isometric look
// (see projectAt below for why this is sin, not tan, of the tilt angle).
export const TILT_DEFAULT = (Math.asin(0.5) * 180) / Math.PI;
export const TILT_MIN = 14;
export const TILT_MAX = 46;
export const TOKEN_RISE = 46; // how far a pawn's body sits above its ground point
const PADDING = 90;

// Extra strip rendered beyond the pitch on all four sides, and how far the
// goal net pocket pokes out past the goal line within that strip. Scoring
// requires the ball to actually reach this out-of-bounds net area now.
// Scaled proportionally with OOB_CELLS (the walkable apron) so the rendered
// strip stays just beyond where a pawn can actually stand.
export const OOB_MARGIN = 5.6;
export const GOAL_NET_DEPTH = 5.6;

export interface Point {
  x: number;
  y: number;
}

const CENTER_X = GRID_COLS / 2;
const CENTER_Z = GRID_ROWS / 2;

// The classic isometric "diamond" look (each ground axis running diagonally
// across the screen, like Ragnarok Online / most iso RPGs) is what you get
// when the camera's yaw sits at 45deg to the ground axes — NOT at 0deg. The
// old (buggy) formula happened to produce that diamond look at its rot=0
// because its shear matrix itself baked in an implicit 45deg rotation as
// part of the (now-removed) bug. This constant restores that same default
// look on the corrected, rotation-invariant formula: rotationDeg=0 (the
// game's default camera) still renders as the familiar diamond, and every
// other angle now genuinely rotates around that reference, deformation-free.
const ISO_YAW_OFFSET = Math.PI / 4;

// True orbit-camera orthographic projection: yaw (rotRad) rotates the world
// around the vertical axis, then a FIXED (screen-relative, not
// yaw-dependent) anisotropic scale renders depth/height. This is what makes
// rotating the camera a rigid rotation of the pitch's on-screen shape rather
// than a shear that morphs between a diamond and an axis-aligned rectangle
// as rot sweeps 0-45deg (the old formula rotated first, then applied a
// tilt-derived shear IN THE ALREADY-ROTATED frame, so the "which axis gets
// foreshortened" direction rotated along with yaw instead of staying locked
// to the screen — that was the actual cause of the reported deformation).
//
// `right` is the camera's horizontal screen-x axis: purely a function of
// yaw, independent of tilt, since yaw rotates around the vertical axis and
// never touches height. `depth` is the horizontal ground-plane component
// that recedes "into the screen" — it gets foreshortened by sin(tilt) the
// same way regardless of yaw. `height` (world-space, same units as
// gx/gy — see toIso) is scaled by cos(tilt) and SUBTRACTED from screen y
// (up is negative-y), consistent with depth's sin(tilt): together they're
// the two halves of one orthographic camera basis, not two independently
// tuned knobs, which is what makes real height (toIso's third argument)
// behave correctly at every tilt instead of needing a separate faked pixel
// offset per call site.
function projectAt(gx: number, gy: number, height: number, rotRad: number, tiltRad: number): Point {
  const wx = gx - CENTER_X;
  const wz = gy - CENTER_Z;
  const effectiveRot = rotRad + ISO_YAW_OFFSET;
  const cosR = Math.cos(effectiveRot);
  const sinR = Math.sin(effectiveRot);
  const cosT = Math.cos(tiltRad);
  const sinT = Math.sin(tiltRad);
  const right = wx * cosR - wz * sinR;
  const depth = wx * sinR + wz * cosR;
  return {
    x: right * (TILE_W / 2),
    y: (depth * sinT - height * cosT) * (TILE_W / 2),
  };
}

// A generous, fixed envelope for external stadium structures (stands,
// roofs, floodlights) built beyond the pitch's own out-of-bounds apron.
// iso.ts doesn't import stadium.ts's actual stand data (that would make a
// circular dependency, since stadium.ts imports OOB_MARGIN from here) — this
// is deliberately sized comfortably past what today's stands need (depth 8,
// height 7) so VIEW_W/VIEW_H doesn't need touching again for a while. Bump
// these, not the stand data itself, if a future piece (e.g. a tall
// floodlight mast) exceeds this envelope.
const STRUCTURE_ENVELOPE_DEPTH = 15;
const STRUCTURE_ENVELOPE_HEIGHT = 12;

// A rotation/tilt-invariant bounding box: sample the out-of-bounds apron's
// corners (at ground level) AND a wider envelope's corners (at ground level
// and at STRUCTURE_ENVELOPE_HEIGHT) across every angle and both tilt
// extremes, so the canvas is big enough to hold the pitch AND any stadium
// structure under any camera the user picks.
function computeBounds() {
  const apronCorners: Array<[number, number]> = [
    [-OOB_MARGIN, -OOB_MARGIN],
    [GRID_COLS + OOB_MARGIN, -OOB_MARGIN],
    [GRID_COLS + OOB_MARGIN, GRID_ROWS + OOB_MARGIN],
    [-OOB_MARGIN, GRID_ROWS + OOB_MARGIN],
  ];
  const structureMargin = OOB_MARGIN + STRUCTURE_ENVELOPE_DEPTH;
  const structureCorners: Array<[number, number]> = [
    [-structureMargin, -structureMargin],
    [GRID_COLS + structureMargin, -structureMargin],
    [GRID_COLS + structureMargin, GRID_ROWS + structureMargin],
    [-structureMargin, GRID_ROWS + structureMargin],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let deg = 0; deg < 360; deg += 5) {
    const rot = (deg * Math.PI) / 180;
    for (const tiltDeg of [TILT_MIN, TILT_MAX]) {
      const tilt = (tiltDeg * Math.PI) / 180;
      for (const [gx, gy] of apronCorners) {
        const p = projectAt(gx, gy, 0, rot, tilt);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      for (const [gx, gy] of structureCorners) {
        for (const h of [0, STRUCTURE_ENVELOPE_HEIGHT]) {
          const p = projectAt(gx, gy, h, rot, tilt);
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

const bounds = computeBounds();
const OFFSET_X = -bounds.minX + PADDING;
const OFFSET_Y = -bounds.minY + PADDING + TOKEN_RISE;

export const VIEW_W = bounds.maxX - bounds.minX + PADDING * 2;
export const VIEW_H = bounds.maxY - bounds.minY + PADDING * 2 + TOKEN_RISE;

export function pointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

export interface Projector {
  /** height is world-space (same units as gx/gy, e.g. the ball's meters-above-ground) — defaults to 0 (ground plane). */
  toIso(gx: number, gy: number, height?: number): Point;
  /** Inverse of toIso at height 0: maps a screen-space point back to world (grid) coordinates. */
  fromIso(sx: number, sy: number): Point;
  cellCorners(gx: number, gy: number): Point[];
  isoCirclePath(cx: number, cy: number, r: number, segments?: number): string;
  /**
   * The screen-space vertical pixel offset a world-space height of this many
   * units produces at this projector's tilt — position-independent, since
   * height contributes as a pure additive term in this projection (see
   * projectAt). Equivalent to `toIso(gx, gy, height).y - toIso(gx, gy, 0).y`
   * for any gx/gy, but doesn't need a ground position: use this for
   * screen-space-only bulges (e.g. a kick-preview arc between two already-
   * projected points) that need to match the real ball-height scale without
   * re-deriving it.
   */
  heightOffset(height: number): number;
  /**
   * Unit world-space direction the camera looks along (from the camera into
   * the scene), including the height axis. Derived from the same
   * effectiveRot/tilt the projection itself uses, so it's exactly consistent
   * with what's on screen: moving a world point along this vector produces
   * ZERO screen displacement (the defining property of an orthographic view
   * axis). Used for back-face culling: a face whose outward normal has a
   * non-negative dot product with this vector faces away from the camera
   * and can never be visible.
   */
  viewForward(): { x: number; y: number; height: number };
  /**
   * Distance of a world point along viewForward — larger = farther from the
   * camera. Position-only ordering (orthographic camera, so there's no
   * perspective divide): use it as the painter's-algorithm sort key, drawing
   * larger (farther) depths first so nearer faces correctly cover them.
   */
  viewDepth(gx: number, gy: number, height?: number): number;
}

/** Builds projection helpers bound to a fixed camera rotation/tilt (degrees). */
export function createProjector(rotationDeg: number, tiltDeg: number): Projector {
  const rot = (rotationDeg * Math.PI) / 180;
  const effectiveRot = rot + ISO_YAW_OFFSET;
  const tilt = (tiltDeg * Math.PI) / 180;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const sinR = Math.sin(effectiveRot);
  const cosR = Math.cos(effectiveRot);

  function heightOffset(height: number): number {
    return height * cosT * (TILE_W / 2);
  }

  // Sign convention check for both functions below: in projectAt, larger
  // `depth` (= wx*sinR + wz*cosR) lands LOWER on screen, i.e. NEARER the
  // camera, and larger height is also nearer (the camera sits above,
  // looking down at `tilt`). So the into-the-scene view axis is the
  // NEGATIVE of both — and moving a point along viewForward provably keeps
  // its toIso screen position unchanged (right-component delta and screen-y
  // delta both cancel exactly; verified by the throwaway-script pattern).
  function viewForward(): { x: number; y: number; height: number } {
    return { x: -sinR * cosT, y: -cosR * cosT, height: -sinT };
  }

  function viewDepth(gx: number, gy: number, height = 0): number {
    const wx = gx - CENTER_X;
    const wz = gy - CENTER_Z;
    return -((wx * sinR + wz * cosR) * cosT + height * sinT);
  }

  function toIso(gx: number, gy: number, height = 0): Point {
    const p = projectAt(gx, gy, height, rot, tilt);
    return { x: p.x + OFFSET_X, y: p.y + OFFSET_Y };
  }

  // Algebraic inverse of projectAt (at height 0) + the OFFSET_X/Y
  // translation: undo the offset and the sin(tilt) depth scale to recover
  // (right, depth), then invert the yaw rotation to recover (wx, wz).
  // tiltRad is bounded away from 0/90 degrees by TILT_MIN/TILT_MAX, so sinT
  // is never 0 and this never divides by zero.
  function fromIso(sx: number, sy: number): Point {
    const rawX = sx - OFFSET_X;
    const rawY = sy - OFFSET_Y;
    const right = rawX / (TILE_W / 2);
    const depth = rawY / (TILE_W / 2) / sinT;
    const wx = right * Math.cos(effectiveRot) + depth * Math.sin(effectiveRot);
    const wz = -right * Math.sin(effectiveRot) + depth * Math.cos(effectiveRot);
    return { x: wx + CENTER_X, y: wz + CENTER_Z };
  }

  function cellCorners(gx: number, gy: number): Point[] {
    return [toIso(gx, gy), toIso(gx + 1, gy), toIso(gx + 1, gy + 1), toIso(gx, gy + 1)];
  }

  function isoCirclePath(cx: number, cy: number, r: number, segments = 40): string {
    const pts: Point[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      pts.push(toIso(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
    }
    return `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")} Z`;
  }

  return { toIso, fromIso, cellCorners, isoCirclePath, heightOffset, viewForward, viewDepth };
}
