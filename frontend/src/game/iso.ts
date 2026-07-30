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
// tan(TILT_DEFAULT) = 0.5, matching the classic 2:1 pixel-art isometric look.
export const TILT_DEFAULT = (Math.atan(0.5) * 180) / Math.PI;
export const TILT_MIN = 14;
export const TILT_MAX = 46;
export const TOKEN_RISE = 46; // how far a pawn's body sits above its ground point
const PADDING = 90;

// Extra strip rendered beyond the pitch on all four sides, and how far the
// goal net pocket pokes out past the goal line within that strip. Scoring
// requires the ball to actually reach this out-of-bounds net area now.
export const OOB_MARGIN = 1.4;
export const GOAL_NET_DEPTH = 1.4;

export interface Point {
  x: number;
  y: number;
}

const CENTER_X = GRID_COLS / 2;
const CENTER_Z = GRID_ROWS / 2;

function projectAt(gx: number, gy: number, rotRad: number, tiltRad: number): Point {
  const wx = gx - CENTER_X;
  const wz = gy - CENTER_Z;
  const rx = wx * Math.cos(rotRad) - wz * Math.sin(rotRad);
  const rz = wx * Math.sin(rotRad) + wz * Math.cos(rotRad);
  const heightScale = Math.tan(tiltRad);
  return {
    x: (rx - rz) * (TILE_W / 2),
    y: (rx + rz) * (TILE_W / 2) * heightScale,
  };
}

// A rotation/tilt-invariant bounding box: sample the out-of-bounds apron's
// corners across every angle and both tilt extremes so the canvas is big
// enough to hold the pitch under any camera the user picks.
function computeBounds() {
  const corners: Array<[number, number]> = [
    [-OOB_MARGIN, -OOB_MARGIN],
    [GRID_COLS + OOB_MARGIN, -OOB_MARGIN],
    [GRID_COLS + OOB_MARGIN, GRID_ROWS + OOB_MARGIN],
    [-OOB_MARGIN, GRID_ROWS + OOB_MARGIN],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let deg = 0; deg < 360; deg += 5) {
    const rot = (deg * Math.PI) / 180;
    for (const tiltDeg of [TILT_MIN, TILT_MAX]) {
      const tilt = (tiltDeg * Math.PI) / 180;
      for (const [gx, gy] of corners) {
        const p = projectAt(gx, gy, rot, tilt);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
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
  toIso(gx: number, gy: number): Point;
  cellCorners(gx: number, gy: number): Point[];
  isoCirclePath(cx: number, cy: number, r: number, segments?: number): string;
}

/** Builds projection helpers bound to a fixed camera rotation/tilt (degrees). */
export function createProjector(rotationDeg: number, tiltDeg: number): Projector {
  const rot = (rotationDeg * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;

  function toIso(gx: number, gy: number): Point {
    const p = projectAt(gx, gy, rot, tilt);
    return { x: p.x + OFFSET_X, y: p.y + OFFSET_Y };
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

  return { toIso, cellCorners, isoCirclePath };
}
