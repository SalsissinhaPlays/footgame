import { GOAL_ROW_MAX, GOAL_ROW_MIN, GRID_COLS, GRID_ROWS } from "../game/constants";
import { isoCirclePath, pointsAttr, toIso } from "../game/iso";

const goalDepth = 1.4;

function goalBox(x0: number) {
  const x1 = x0 === 0 ? goalDepth : GRID_COLS - goalDepth;
  return [
    toIso(x0, GOAL_ROW_MIN),
    toIso(x1, GOAL_ROW_MIN),
    toIso(x1, GOAL_ROW_MAX + 1),
    toIso(x0, GOAL_ROW_MAX + 1),
  ];
}

function goalPosts(x0: number) {
  const top = toIso(x0, GOAL_ROW_MIN);
  const bottom = toIso(x0, GOAL_ROW_MAX + 1);
  const rise = 26;
  return (
    <g className="goal-frame">
      <line x1={top.x} y1={top.y} x2={top.x} y2={top.y - rise} />
      <line x1={bottom.x} y1={bottom.y} x2={bottom.x} y2={bottom.y - rise} />
      <line x1={top.x} y1={top.y - rise} x2={bottom.x} y2={bottom.y - rise} />
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
        className={`pitch-stripe ${row % 2 === 0 ? "light" : "dark"}`}
      />
    );
  }

  const centerTop = toIso(GRID_COLS / 2, 0);
  const centerBottom = toIso(GRID_COLS / 2, GRID_ROWS);

  return (
    <g>
      <defs>
        <radialGradient id="grass-shine" cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#5fb865" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#5fb865" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="pawn-body-home" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#4a90e2" />
          <stop offset="100%" stopColor="#0d3a75" />
        </radialGradient>
        <radialGradient id="pawn-body-away" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#e05252" />
          <stop offset="100%" stopColor="#7a0f0f" />
        </radialGradient>
      </defs>

      <polygon points={pointsAttr(outer)} className="pitch-base" />
      {stripes}
      <polygon points={pointsAttr(outer)} fill="url(#grass-shine)" />
      <polygon points={pointsAttr(outer)} className="pitch-border" />

      <line
        x1={centerTop.x}
        y1={centerTop.y}
        x2={centerBottom.x}
        y2={centerBottom.y}
        className="pitch-line"
      />
      <path d={isoCirclePath(GRID_COLS / 2, GRID_ROWS / 2, 1.6)} className="pitch-line" fill="none" />

      <polygon points={pointsAttr(goalBox(0))} className="goal-area" />
      <polygon points={pointsAttr(goalBox(GRID_COLS))} className="goal-area" />
      {goalPosts(0)}
      {goalPosts(GRID_COLS)}
    </g>
  );
}
