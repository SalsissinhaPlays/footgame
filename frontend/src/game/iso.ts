import { GRID_COLS, GRID_ROWS } from "./constants";

// Pure rendering math: projects grid coordinates (the same coordinates the
// game logic already uses) into an isometric screen space. Nothing here
// feeds back into gameplay — resolve.ts/ai.ts/formation.ts never import this.

export const TILE_W = 84;
export const TILE_H = 42;
export const TOKEN_RISE = 34; // how far a pawn's "body" sits above its ground point
const PADDING = 80;

export interface Point {
  x: number;
  y: number;
}

function project(gx: number, gy: number): Point {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

const corners = [
  project(0, 0),
  project(GRID_COLS, 0),
  project(GRID_COLS, GRID_ROWS),
  project(0, GRID_ROWS),
];
const minX = Math.min(...corners.map((c) => c.x));
const maxX = Math.max(...corners.map((c) => c.x));
const minY = Math.min(...corners.map((c) => c.y));
const maxY = Math.max(...corners.map((c) => c.y));

const OFFSET_X = -minX + PADDING;
const OFFSET_Y = -minY + PADDING + TOKEN_RISE;

export const VIEW_W = maxX - minX + PADDING * 2;
export const VIEW_H = maxY - minY + PADDING * 2 + TOKEN_RISE;

/** Grid coordinates (fractional cells allowed) -> isometric screen point. */
export function toIso(gx: number, gy: number): Point {
  const p = project(gx, gy);
  return { x: p.x + OFFSET_X, y: p.y + OFFSET_Y };
}

/** The four screen corners of the grid cell spanning (gx,gy) to (gx+1,gy+1). */
export function cellCorners(gx: number, gy: number): Point[] {
  return [toIso(gx, gy), toIso(gx + 1, gy), toIso(gx + 1, gy + 1), toIso(gx, gy + 1)];
}

export function pointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/** SVG path approximating a flat circle (grid-space center/radius) under the iso projection. */
export function isoCirclePath(cx: number, cy: number, r: number, segments = 40): string {
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push(toIso(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
  }
  return `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")} Z`;
}
