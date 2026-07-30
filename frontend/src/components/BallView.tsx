import { toIso } from "../game/iso";
import type { Ball } from "../game/types";

export function BallView({ ball }: { ball: Ball }) {
  const base = toIso(ball.pos.x + 0.5, ball.pos.y + 0.5);

  return (
    <g className="ball-wrapper" transform={`translate(${base.x}, ${base.y})`}>
      <ellipse cx={0} cy={0} rx={9} ry={4.5} className="ball-shadow" />
      <circle cy={-11} r={7.5} className="ball" />
      <path d="M -3 -14 L 3 -14 L 4 -9 L 0 -6 L -4 -9 Z" className="ball-pentagon" />
    </g>
  );
}
