import { GOAL_ROW_MAX, GOAL_ROW_MIN, GRID_COLS, GRID_ROWS } from "../game/constants";
import { isoCirclePath, pointsAttr, toIso } from "../game/iso";

const SIX_YARD_DEPTH = 1.2;
const PENALTY_DEPTH = 2.6;
const PENALTY_PAD = 1.5; // extra rows above/below the goal mouth for the penalty box

function box(x0: number, depth: number, pad: number) {
  const x1 = x0 === 0 ? depth : GRID_COLS - depth;
  const yTop = GOAL_ROW_MIN - pad;
  const yBottom = GOAL_ROW_MAX + 1 + pad;
  return [toIso(x0, yTop), toIso(x1, yTop), toIso(x1, yBottom), toIso(x0, yBottom)];
}

function goalPosts(x0: number) {
  const top = toIso(x0, GOAL_ROW_MIN);
  const bottom = toIso(x0, GOAL_ROW_MAX + 1);
  const rise = 30;
  return (
    <g className="goal-frame">
      <line x1={top.x} y1={top.y} x2={top.x} y2={top.y - rise} />
      <line x1={bottom.x} y1={bottom.y} x2={bottom.x} y2={bottom.y - rise} />
      <line x1={top.x} y1={top.y - rise} x2={bottom.x} y2={bottom.y - rise} />
      <line x1={top.x} y1={top.y} x2={bottom.x} y2={bottom.y} className="goal-net-back" />
    </g>
  );
}

export function Field() {
  const outer = [toIso(0, 0), toIso(GRID_COLS, 0), toIso(GRID_COLS, GRID_ROWS), toIso(0, GRID_ROWS)];

  const stripes = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    const band = [toIso(0, row), toIso(GRID_COLS, row), toIso(GRID_COLS, row + 1), toIso(0, row + 1)];
    stripes.push(
      <polygon
        key={`stripe-${row}`}
        points={pointsAttr(band)}
        fill={row % 2 === 0 ? "url(#grass-light-tex)" : "url(#grass-dark-tex)"}
      />
    );
  }

  const halfTop = toIso(GRID_COLS / 2, 0);
  const halfBottom = toIso(GRID_COLS / 2, GRID_ROWS);
  const centerSpot = toIso(GRID_COLS / 2, GRID_ROWS / 2);

  return (
    <g>
      <defs>
        <linearGradient id="grass-vignette" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0a1f0c" stopOpacity="0.2" />
          <stop offset="15%" stopColor="#0a1f0c" stopOpacity="0" />
          <stop offset="85%" stopColor="#0a1f0c" stopOpacity="0" />
          <stop offset="100%" stopColor="#0a1f0c" stopOpacity="0.3" />
        </linearGradient>
        <pattern id="grass-light-tex" patternUnits="userSpaceOnUse" width="480" height="480">
          <image href="/sprites/grass_light.png" width="480" height="480" className="grass-image" />
        </pattern>
        <pattern id="grass-dark-tex" patternUnits="userSpaceOnUse" width="480" height="480">
          <image href="/sprites/grass_dark.png" width="480" height="480" className="grass-image" />
        </pattern>
      </defs>

      <polygon points={pointsAttr(outer)} className="pitch-base" />
      {stripes}
      <polygon points={pointsAttr(outer)} fill="url(#grass-vignette)" />
      <polygon points={pointsAttr(outer)} className="pitch-border" />

      <line x1={halfTop.x} y1={halfTop.y} x2={halfBottom.x} y2={halfBottom.y} className="pitch-line" />
      <path d={isoCirclePath(GRID_COLS / 2, GRID_ROWS / 2, 1.7)} className="pitch-line" fill="none" />
      <circle cx={centerSpot.x} cy={centerSpot.y} r={2.5} className="pitch-spot" />

      {[0, GRID_COLS].map((x0) => (
        <g key={`box-${x0}`}>
          <polygon points={pointsAttr(box(x0, PENALTY_DEPTH, PENALTY_PAD))} className="pitch-line" fill="none" />
          <polygon points={pointsAttr(box(x0, SIX_YARD_DEPTH, 0))} className="pitch-line" fill="none" />
          {(() => {
            const spotX = x0 === 0 ? PENALTY_DEPTH - 0.4 : GRID_COLS - PENALTY_DEPTH + 0.4;
            const spot = toIso(spotX, GRID_ROWS / 2);
            return <circle cx={spot.x} cy={spot.y} r={2.5} className="pitch-spot" />;
          })()}
        </g>
      ))}

      <polygon points={pointsAttr(box(0, SIX_YARD_DEPTH, 0))} className="goal-area" />
      <polygon points={pointsAttr(box(GRID_COLS, SIX_YARD_DEPTH, 0))} className="goal-area" />
      {goalPosts(0)}
      {goalPosts(GRID_COLS)}
    </g>
  );
}
