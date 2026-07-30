import { GOAL_ROW_MAX, GOAL_ROW_MIN, GRID_COLS, GRID_ROWS } from "../game/constants";
import { GOAL_NET_DEPTH, OOB_MARGIN, pointsAttr, type Projector } from "../game/iso";

const SIX_YARD_DEPTH = 1.2;
const PENALTY_DEPTH = 2.6;
const PENALTY_PAD = 1.5; // extra rows above/below the goal mouth for the penalty box

interface Props {
  projector: Projector;
}

export function Field({ projector }: Props) {
  const { toIso, isoCirclePath } = projector;

  function box(x0: number, depth: number, pad: number) {
    const x1 = x0 === 0 ? depth : GRID_COLS - depth;
    const yTop = GOAL_ROW_MIN - pad;
    const yBottom = GOAL_ROW_MAX + 1 + pad;
    return [toIso(x0, yTop), toIso(x1, yTop), toIso(x1, yBottom), toIso(x0, yBottom)];
  }

  /** The goal net pocket, sitting just past the goal line in the out-of-bounds strip. */
  function netBox(atHome: boolean) {
    const lineX = atHome ? 0 : GRID_COLS;
    const netX = atHome ? -GOAL_NET_DEPTH : GRID_COLS + GOAL_NET_DEPTH;
    return [
      toIso(lineX, GOAL_ROW_MIN),
      toIso(netX, GOAL_ROW_MIN),
      toIso(netX, GOAL_ROW_MAX + 1),
      toIso(lineX, GOAL_ROW_MAX + 1),
    ];
  }

  /** A proper 3D goal box: frame (posts + crossbar) at the goal line, net mesh on the back/sides/roof. */
  function goalStructure(atHome: boolean) {
    const lineX = atHome ? 0 : GRID_COLS;
    const netX = atHome ? -GOAL_NET_DEPTH : GRID_COLS + GOAL_NET_DEPTH;
    const rise = 34;

    const frontTop = toIso(lineX, GOAL_ROW_MIN);
    const frontBottom = toIso(lineX, GOAL_ROW_MAX + 1);
    const backTop = toIso(netX, GOAL_ROW_MIN);
    const backBottom = toIso(netX, GOAL_ROW_MAX + 1);

    const frontTopRise = { x: frontTop.x, y: frontTop.y - rise };
    const frontBottomRise = { x: frontBottom.x, y: frontBottom.y - rise };
    const backTopRise = { x: backTop.x, y: backTop.y - rise };
    const backBottomRise = { x: backBottom.x, y: backBottom.y - rise };

    return (
      <g className="goal-structure">
        <polygon
          points={pointsAttr([backTop, backBottom, backBottomRise, backTopRise])}
          className="goal-net-panel"
        />
        <polygon
          points={pointsAttr([frontTop, backTop, backTopRise, frontTopRise])}
          className="goal-net-panel"
        />
        <polygon
          points={pointsAttr([frontBottom, backBottom, backBottomRise, frontBottomRise])}
          className="goal-net-panel"
        />
        <polygon
          points={pointsAttr([frontTopRise, frontBottomRise, backBottomRise, backTopRise])}
          className="goal-net-panel"
        />

        <line x1={frontTop.x} y1={frontTop.y} x2={frontTopRise.x} y2={frontTopRise.y} className="goal-post" />
        <line
          x1={frontBottom.x}
          y1={frontBottom.y}
          x2={frontBottomRise.x}
          y2={frontBottomRise.y}
          className="goal-post"
        />
        <line
          x1={frontTopRise.x}
          y1={frontTopRise.y}
          x2={frontBottomRise.x}
          y2={frontBottomRise.y}
          className="goal-crossbar"
        />
      </g>
    );
  }

  const apron = [
    toIso(-OOB_MARGIN, -OOB_MARGIN),
    toIso(GRID_COLS + OOB_MARGIN, -OOB_MARGIN),
    toIso(GRID_COLS + OOB_MARGIN, GRID_ROWS + OOB_MARGIN),
    toIso(-OOB_MARGIN, GRID_ROWS + OOB_MARGIN),
  ];
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
        <pattern id="net-mesh" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="9" height="9" className="net-mesh-bg" />
          <line x1="0" y1="0" x2="0" y2="9" className="net-mesh-line" />
          <line x1="0" y1="0" x2="9" y2="0" className="net-mesh-line" />
        </pattern>
      </defs>

      <polygon points={pointsAttr(apron)} className="pitch-apron" />

      <polygon points={pointsAttr(netBox(true))} className="goal-net" />
      <polygon points={pointsAttr(netBox(false))} className="goal-net" />

      <polygon points={pointsAttr(outer)} className="pitch-base" />
      {stripes}
      <polygon points={pointsAttr(outer)} fill="url(#grass-vignette)" />
      <polygon points={pointsAttr(outer)} className="pitch-border" />
      <polygon points={pointsAttr(apron)} className="pitch-apron-border" />

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

      {goalStructure(true)}
      {goalStructure(false)}
    </g>
  );
}
