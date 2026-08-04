import { GRID_COLS, GRID_ROWS } from "./constants";
import { OOB_MARGIN } from "./iso";

/**
 * Stadium geometry: pure data + math, no rendering — MatchScene.ts turns
 * these into actual drawn shapes, the same data/algorithm split
 * formations.ts/formation.ts already established. A StandSection describes
 * one seating tier along one edge of the pitch; buildStandGeometry turns its
 * numbers into a flat list of 3D faces (world-space quads). This is
 * deliberately the seam a future stadium-builder UI would edit (construct or
 * adjust a StandSection's numbers) without touching the geometry or
 * rendering code at all — a bigger arena is bigger numbers on this same
 * shape, not a different code path.
 */

export type StandSide = "home_end" | "away_end" | "side_a" | "side_b";

export interface StandSection {
  side: StandSide;
  /** How far the stand extends outward from the pitch's out-of-bounds apron. */
  depth: number;
  /** Height of the low wall nearest the pitch (front of the seating tier). */
  frontHeight: number;
  /** Height at the back of the seating tier — the rake/incline is implied by (backHeight - frontHeight) over depth, not a separate angle parameter. */
  backHeight: number;
  /** How many seating rows the tier is broken into — this is what gives it a stepped, terraced silhouette instead of one smooth ramp. No chairs modeled — each row is just the flat step a row of seats would sit on. */
  rows: number;
}

// Symmetric, single-tier, no roof/lighting — the first stadium build, sized
// to prove the camera/rendering pipeline holds up with real 3D geometry
// beyond the flat pitch before adding roofs, lights, or per-side variation.
// Each side is left as its own independent StandSection (not merged into one
// shared config) even though they're identical today, since that's exactly
// the shape a future asymmetric stadium (bigger main stand, smaller ends)
// needs — only the numbers differ, not the structure.
export const STADIUM_MVP: StandSection[] = (["home_end", "away_end", "side_a", "side_b"] as StandSide[]).map(
  (side) => ({ side, depth: 8, frontHeight: 1.5, backHeight: 7, rows: 8 })
);

export interface WorldPoint {
  x: number;
  y: number;
  height: number;
}

/** Which base color the renderer should use before applying this face's shade — "structure" (grey concrete: walls, risers) vs "seating" (the tread a row of seats sits on). The actual color values live in MatchScene.ts (a rendering concern); this is just which one applies. */
export type StandMaterial = "structure" | "seating";

export interface StandFace {
  /** World-space (grid coordinates + height) — NOT yet projected to screen; the renderer projects each corner via the current camera projector. */
  corners: WorldPoint[];
  /** Flat shading multiplier (0-1), standing in for real lighting until that exists. */
  shade: number;
  material: StandMaterial;
  /**
   * Unit world-space direction this face's SOLID side faces (up for a
   * tread, toward the pitch for a riser/front wall, away from the pitch for
   * the back wall, sideways for an end cap). This is what lets the renderer
   * back-face cull — skip any face whose normal points away from the
   * camera, since you'd be looking at it from inside the stand's solid
   * mass. Set explicitly at construction (the corner winding order of
   * `corners` is NOT consistent enough to derive it from, which is also why
   * computeShade takes the abs of its dot product).
   */
  normal: WorldPoint;
  /**
   * A single ground-level (height 0) point the renderer uses to decide this
   * face's near/far visibility (see MatchScene.projectVisibleStandFace) —
   * deliberately NOT derived from this face's own corners. Every face that
   * belongs to the same along-position (front wall, back wall, every
   * tread/riser row at that slice) shares the EXACT same visibilityRef, so
   * they're always classified together — an end cap and the row-segment
   * sitting right next to it would otherwise occasionally disagree (one
   * judged near, one far) purely because their own corners differ in depth
   * or height, producing a visible seam where the end cap looks like a
   * disconnected wall floating apart from the actual steps.
   */
  visibilityRef: WorldPoint;
}

// A stand's "along" axis is the direction it runs parallel to its pitch
// edge; its length matches that edge's own out-of-bounds extent (including
// the apron corners) so adjacent stands' ends line up with each other at
// the corners rather than leaving a jagged seam. The 4 corner regions
// themselves are left open (no corner-filling piece) — a deliberate MVP
// simplification, not an oversight; plenty of real small/mid stadiums have
// open corners too.
function alongRange(side: StandSide): [number, number] {
  return side === "home_end" || side === "away_end"
    ? [-OOB_MARGIN, GRID_ROWS + OOB_MARGIN]
    : [-OOB_MARGIN, GRID_COLS + OOB_MARGIN];
}

// The renderer's near/far visibility cull (see MatchScene.projectVisibleStandFace)
// decides per WHOLE FACE, not per fragment of one — so a face spanning a
// stand's entire length (60-70+ world units for the long side stands) can
// only be classified all-or-nothing. Viewed at an angle where that length
// runs roughly toward/away from the camera, one end of such a face is
// genuinely far and the other genuinely near, but it still gets drawn (or
// not) as one piece using its real, correct corner positions — which is what
// produced the tapering "bent wedge" look: a long shape drawn in full even
// though only part of it should have been visible. Slicing every
// length-spanning face into short segments lets the near/far cutoff fall
// cleanly partway along a stand instead of being all-or-nothing for the
// whole thing. Smaller = smoother cutoff, more faces to draw (still cheap:
// this is a static layer, redrawn only on camera rotate/tilt, not per frame).
const ALONG_SEGMENT_LENGTH = 4;

function alongSegments(alongStart: number, alongEnd: number): Array<[number, number]> {
  const total = alongEnd - alongStart;
  const count = Math.max(1, Math.ceil(total / ALONG_SEGMENT_LENGTH));
  const segLen = total / count;
  const segments: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    segments.push([alongStart + i * segLen, alongStart + (i + 1) * segLen]);
  }
  return segments;
}

// Fixed "sunlight" direction (mostly from above, angled slightly) used to
// derive each face's brightness from its TRUE 3D orientation, instead of a
// flat per-material-type lookup. A flat lookup (every tread always 1.0,
// every riser always 0.6, regardless of which way anything actually faces)
// carries NO real lighting information — every tread anywhere looks
// identical no matter its true orientation, and a viewer gets no occlusion
// cue either at grazing/edge-on camera angles (each row tiles cleanly next
// to its neighbor with nothing overlapping), so the whole tier reads as a
// flat painted pattern instead of a solid volume. Real diffuse/Lambertian
// shading (brightness = how directly a surface faces the light) is
// deliberately view-independent — it only depends on the light direction
// and the surface's own orientation, never on camera position — which is
// exactly why it can be computed once here in world space rather than
// per-frame in the renderer.
const LIGHT_DIR = normalizeVec({ x: -0.35, y: -0.5, height: 0.85 });
const MIN_SHADE = 0.45;
const MAX_SHADE = 1;

function normalizeVec(v: WorldPoint): WorldPoint {
  const len = Math.hypot(v.x, v.y, v.height) || 1;
  return { x: v.x / len, y: v.y / len, height: v.height / len };
}

/**
 * Derives a face's brightness from its actual 3D orientation: computes the
 * face's normal from its first three corners (any planar face's normal is
 * fully determined by two of its edges, and every StandFace here IS planar
 * by construction), then how directly that normal faces LIGHT_DIR. Uses
 * Math.abs on the dot product rather than a signed value — this is a
 * placeholder flat-shading pass, not physically-correct lighting, so a
 * back-lit face reading the same as a front-lit one at the same angle is an
 * acceptable simplification; what matters is that DIFFERENTLY-oriented
 * faces (a step's flat top vs. its vertical front vs. an end cap facing
 * sideways) get genuinely different brightness, which is what actually
 * reads as "3D volume" instead of a flat repeating pattern.
 */
function computeShade(corners: WorldPoint[]): number {
  const [c0, c1, c2] = corners;
  const e1 = { x: c1.x - c0.x, y: c1.y - c0.y, height: c1.height - c0.height };
  const e2 = { x: c2.x - c0.x, y: c2.y - c0.y, height: c2.height - c0.height };
  const nx = e1.y * e2.height - e1.height * e2.y;
  const ny = e1.height * e2.x - e1.x * e2.height;
  const nh = e1.x * e2.y - e1.y * e2.x;
  const len = Math.hypot(nx, ny, nh) || 1;
  const alignment = Math.abs((nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nh * LIGHT_DIR.height) / len);
  return MIN_SHADE + (MAX_SHADE - MIN_SHADE) * alignment;
}

// Maps a stand-local (along, outward-depth, height) coordinate to world
// (gx, gy, height) — the one place that knows which world axis is "outward"
// for a given side, so buildStandGeometry itself stays side-agnostic.
function worldPoint(side: StandSide, along: number, d: number, height: number): WorldPoint {
  switch (side) {
    case "home_end":
      return { x: -OOB_MARGIN - d, y: along, height };
    case "away_end":
      return { x: GRID_COLS + OOB_MARGIN + d, y: along, height };
    case "side_a":
      return { x: along, y: -OOB_MARGIN - d, height };
    case "side_b":
      return { x: along, y: GRID_ROWS + OOB_MARGIN + d, height };
  }
}

/**
 * The seating tier's cross-section boundary, front-wall-top to back-top, as
 * a staircase rather than a straight diagonal: alternating flat treads (the
 * row of seats' own step) and vertical risers (the front of the next row
 * up), `rows` times. Returned as a flat list of (d, height) points tracing
 * the boundary in order — shared by buildStandGeometry (which pulls out
 * tread/riser quads from consecutive point pairs) and the end-cap face
 * (which needs the SAME stepped outline, not a smooth diagonal, so the side
 * of the stand doesn't visually contradict the stepped top).
 */
function stairProfile(depth: number, frontHeight: number, backHeight: number, rows: number): Array<[number, number]> {
  const stepDepth = depth / rows;
  const stepRise = (backHeight - frontHeight) / rows;
  const pts: Array<[number, number]> = [[0, frontHeight]];
  let d = 0;
  let h = frontHeight;
  for (let i = 0; i < rows; i++) {
    d += stepDepth;
    pts.push([d, h]); // end of this row's tread
    h += stepRise;
    pts.push([d, h]); // top of this row's riser
  }
  return pts;
}

/**
 * The actual geometry builder: a flat list of faces — a low front wall
 * facing the pitch, a staircase of seating rows (treads + risers, see
 * stairProfile) rising to the back, a tall back wall, and two end caps
 * (following that same stepped outline) closing off the sides. Still a
 * simple placeholder shape, not seat-by-seat detail — this is what makes it
 * read as an actual terrace rather than a smooth ramp, without needing
 * chairs modeled at all. Generic over `wp` (the along/depth/height → world
 * mapping) and the along range, so the exact same tier-building logic works
 * for both a straight stand (buildStandGeometry, wp from worldPoint) and a
 * diagonal corner-connecting piece (buildCornerGeometry, wp from a rotated
 * corner frame) — a corner is geometrically just another tier, oriented
 * diagonally instead of axis-aligned.
 */
function buildTierFaces(
  wp: (along: number, d: number, h: number) => WorldPoint,
  alongStart: number,
  alongEnd: number,
  depth: number,
  frontHeight: number,
  backHeight: number,
  rows: number
): StandFace[] {
  const profile = stairProfile(depth, frontHeight, backHeight, rows);
  const segments = alongSegments(alongStart, alongEnd);

  // The wp frame's own world-space axes, recovered numerically (difference
  // of two mapped points) rather than hardcoded per side — this is what
  // keeps buildTierFaces fully generic over whatever frame wp encodes.
  const origin = wp(0, 0, 0);
  const alongAt1 = wp(1, 0, 0);
  const outAt1 = wp(0, 1, 0);
  const alongDir = normalizeVec({ x: alongAt1.x - origin.x, y: alongAt1.y - origin.y, height: 0 });
  const outwardDir = normalizeVec({ x: outAt1.x - origin.x, y: outAt1.y - origin.y, height: 0 });
  const inward: WorldPoint = { x: -outwardDir.x, y: -outwardDir.y, height: 0 };
  const up: WorldPoint = { x: 0, y: 0, height: 1 };

  // Every length-spanning face (front wall, back wall, each tread/riser) is
  // built once per segment rather than once for the whole stand — see
  // ALONG_SEGMENT_LENGTH above for why. visibilityRef is fixed at (segment
  // midpoint, d=0, h=0) regardless of this particular face's own d0/h0 — a
  // front-wall segment and a back-wall segment at the SAME along-position
  // must classify identically, which only holds if neither uses its own
  // (different) depth/height for the visibility test. shade comes from
  // computeShade (this face's true orientation vs. LIGHT_DIR), not a fixed
  // per-material value — see the comment above computeShade for why.
  function segmentedFace(
    d0: number,
    h0: number,
    d1: number,
    h1: number,
    material: StandMaterial,
    normal: WorldPoint
  ): StandFace[] {
    return segments.map(([a0, a1]) => {
      const corners = [wp(a0, d0, h0), wp(a1, d0, h0), wp(a1, d1, h1), wp(a0, d1, h1)];
      return {
        shade: computeShade(corners),
        material,
        corners,
        normal,
        visibilityRef: wp((a0 + a1) / 2, 0, 0),
      };
    });
  }

  const front = segmentedFace(0, 0, 0, frontHeight, "structure", inward);
  const back = segmentedFace(depth, 0, depth, backHeight, "structure", outwardDir);

  // Consecutive pairs of profile points alternate tread (constant height —
  // the seating material, a distinct color from the grey concrete
  // structure, which is the actual visual cue that reads as "seating" rather
  // than bare structure/scaffolding) and riser (constant depth — grey
  // concrete, like the rest of the structure). A tread's solid side faces
  // up; a riser's faces the pitch, same as the front wall.
  const steps: StandFace[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [d0, h0] = profile[i];
    const [d1, h1] = profile[i + 1];
    const isTread = i % 2 === 0;
    steps.push(...segmentedFace(d0, h0, d1, h1, isTread ? "seating" : "structure", isTread ? up : inward));
  }

  // Each end cap uses the EXACT SAME visibilityRef as the segment right next
  // to it (the first segment for endStart, the last for endEnd) — not its
  // own along position — so the two can never disagree on near/far. See
  // segmentedFace's comment and the StandFace.visibilityRef doc above.
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  const endStartRef = wp((firstSegment[0] + firstSegment[1]) / 2, 0, 0);
  const endEndRef = wp((lastSegment[0] + lastSegment[1]) / 2, 0, 0);

  // One simple polygon per end, tracing the exact same stepped profile the
  // rest of the stand is built from — NOT an invented cross-section
  // (earlier attempts tried per-row pillars, then thin banded edges, both
  // trying to make the end read as "the seating, viewed from the side").
  // That was solving the wrong problem: what actually matters is that each
  // bench row reaches the edge at its own correct, consistent height and
  // visually connects to its neighboring segment — which just requires the
  // SAME profile this whole stand already uses, correctly shaded and
  // aligned (via visibilityRef) with what's next to it. No separate
  // banding is needed for that.
  const endProfile: Array<[number, number]> = [[0, 0], ...profile, [depth, 0]];
  const endStartCorners = endProfile.map(([d, h]) => wp(alongStart, d, h));
  const endEndCorners = endProfile.map(([d, h]) => wp(alongEnd, d, h));
  const endStart: StandFace = {
    shade: computeShade(endStartCorners),
    material: "structure",
    corners: endStartCorners,
    normal: { x: -alongDir.x, y: -alongDir.y, height: 0 },
    visibilityRef: endStartRef,
  };
  const endEnd: StandFace = {
    shade: computeShade(endEndCorners),
    material: "structure",
    corners: endEndCorners,
    normal: alongDir,
    visibilityRef: endEndRef,
  };
  return [...front, ...back, ...steps, endStart, endEnd];
}

export function buildStandGeometry(section: StandSection): StandFace[] {
  const { side, depth, frontHeight, backHeight, rows } = section;
  const [alongStart, alongEnd] = alongRange(side);
  const wp = (along: number, d: number, h: number) => worldPoint(side, along, d, h);
  return buildTierFaces(wp, alongStart, alongEnd, depth, frontHeight, backHeight, rows);
}

export function buildStadiumGeometry(sections: StandSection[]): StandFace[] {
  return sections.flatMap(buildStandGeometry);
}
