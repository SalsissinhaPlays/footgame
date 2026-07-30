import { TOKEN_RISE, toIso } from "../game/iso";
import type { Pawn } from "../game/types";

interface Props {
  pawn: Pawn;
  selected: boolean;
  onClick: () => void;
}

export function PawnView({ pawn, selected, onClick }: Props) {
  const base = toIso(pawn.pos.x + 0.5, pawn.pos.y + 0.5);

  const planned = pawn.plannedPos
    ? toIso(pawn.plannedPos.x + 0.5, pawn.plannedPos.y + 0.5)
    : null;
  const kickTarget = pawn.plannedKick ? toIso(pawn.plannedKick.x + 0.5, pawn.plannedKick.y + 0.5) : null;

  const side = pawn.side;
  const legTop = -TOKEN_RISE * 0.35;
  const torsoTop = -TOKEN_RISE * 0.85;
  const headY = -TOKEN_RISE;

  return (
    <g onClick={onClick} className="pawn" transform={`translate(${base.x}, ${base.y})`}>
      {planned && (
        <>
          <line x1={0} y1={0} x2={planned.x - base.x} y2={planned.y - base.y} className="move-arrow" />
          <ellipse
            cx={planned.x - base.x}
            cy={planned.y - base.y}
            rx={16}
            ry={8}
            className={`pawn-ghost ${side}`}
          />
        </>
      )}
      {kickTarget && (
        <>
          <line x1={0} y1={0} x2={kickTarget.x - base.x} y2={kickTarget.y - base.y} className="kick-arrow" />
          <circle cx={kickTarget.x - base.x} cy={kickTarget.y - base.y} r={7} className="kick-target" />
        </>
      )}

      <ellipse cx={0} cy={0} rx={19} ry={9} className="pawn-shadow" />

      {/* legs */}
      <rect x={-9} y={legTop} width={7} height={-legTop} rx={2.5} className={`pawn-leg ${side}`} />
      <rect x={2} y={legTop} width={7} height={-legTop} rx={2.5} className={`pawn-leg ${side}`} />

      {/* torso (jersey) */}
      <path
        d={`M -13 ${legTop} Q -15 ${torsoTop} -10 ${torsoTop} L 10 ${torsoTop} Q 15 ${torsoTop} 13 ${legTop} Z`}
        className={`pawn-torso ${side} ${selected ? "selected" : ""}`}
      />
      <text y={(legTop + torsoTop) / 2 + 1} textAnchor="middle" dominantBaseline="central" className="pawn-number">
        {pawn.player.jersey_number}
      </text>

      {/* head */}
      <circle cy={headY} r={8.5} className="pawn-head" />
      {selected && <circle cy={headY} r={13} className="pawn-select-ring" />}
    </g>
  );
}
