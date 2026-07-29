import { CELL_SIZE, GRID_COLS, GRID_ROWS } from "../game/constants";

const W = GRID_COLS * CELL_SIZE;
const H = GRID_ROWS * CELL_SIZE;

export function Field() {
  const lines = [];
  for (let c = 0; c <= GRID_COLS; c++) {
    lines.push(
      <line key={`v${c}`} x1={c * CELL_SIZE} y1={0} x2={c * CELL_SIZE} y2={H} className="grid-line" />
    );
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    lines.push(
      <line key={`h${r}`} x1={0} y1={r * CELL_SIZE} x2={W} y2={r * CELL_SIZE} className="grid-line" />
    );
  }

  const goalDepth = CELL_SIZE * 1.5;
  const goalHeight = CELL_SIZE * 3;
  const goalY = (H - goalHeight) / 2;

  return (
    <g>
      <rect x={0} y={0} width={W} height={H} className="pitch-bg" />
      {lines}
      <rect x={1} y={1} width={W - 2} height={H - 2} className="pitch-border" />
      <line x1={W / 2} y1={0} x2={W / 2} y2={H} className="pitch-border" />
      <circle cx={W / 2} cy={H / 2} r={CELL_SIZE * 1.5} className="pitch-border" fill="none" />
      <rect x={0} y={goalY} width={goalDepth} height={goalHeight} className="pitch-border" fill="none" />
      <rect x={W - goalDepth} y={goalY} width={goalDepth} height={goalHeight} className="pitch-border" fill="none" />
    </g>
  );
}
