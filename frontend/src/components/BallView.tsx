import type { Projector } from "../game/iso";
import type { Ball } from "../game/types";

const BALL_SIZE = 26;

export function BallView({ ball, projector }: { ball: Ball; projector: Projector }) {
  const base = projector.toIso(ball.pos.x + 0.5, ball.pos.y + 0.5);

  return (
    <g className="ball-wrapper" transform={`translate(${base.x}, ${base.y})`}>
      <ellipse cx={0} cy={0} rx={9} ry={4.5} className="ball-shadow" />
      <image
        href="/sprites/ball.png"
        x={-BALL_SIZE / 2}
        y={-BALL_SIZE - 6}
        width={BALL_SIZE}
        height={BALL_SIZE}
      />
    </g>
  );
}
