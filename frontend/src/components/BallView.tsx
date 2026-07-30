import { toIso } from "../game/iso";
import type { Ball } from "../game/types";

export function BallView({ ball }: { ball: Ball }) {
  const base = toIso(ball.pos.x + 0.5, ball.pos.y + 0.5);

  return (
    <g className="ball-wrapper" transform={`translate(${base.x}, ${base.y})`}>
      <ellipse cx={0} cy={0} rx={8} ry={4} className="ball-shadow" />
      <circle cy={-10} r={7} className="ball" />
    </g>
  );
}
