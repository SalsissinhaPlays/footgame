import { CELL_SIZE } from "../game/constants";
import type { Ball } from "../game/types";

export function BallView({ ball }: { ball: Ball }) {
  const cx = ball.pos.x * CELL_SIZE + CELL_SIZE / 2 + CELL_SIZE * 0.22;
  const cy = ball.pos.y * CELL_SIZE + CELL_SIZE / 2 + CELL_SIZE * 0.22;

  return (
    <g className="ball-wrapper" transform={`translate(${cx}, ${cy})`}>
      <circle r={CELL_SIZE * 0.14} className="ball" />
    </g>
  );
}
