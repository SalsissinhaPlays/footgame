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
            className={`pawn-ghost ${pawn.side}`}
          />
        </>
      )}
      {kickTarget && (
        <>
          <line x1={0} y1={0} x2={kickTarget.x - base.x} y2={kickTarget.y - base.y} className="kick-arrow" />
          <circle cx={kickTarget.x - base.x} cy={kickTarget.y - base.y} r={7} className="kick-target" />
        </>
      )}

      <ellipse cx={0} cy={0} rx={20} ry={10} className="pawn-shadow" />
      <line x1={0} y1={0} x2={0} y2={-TOKEN_RISE} className="pawn-neck" />
      <circle cy={-TOKEN_RISE} r={18} className={`pawn-body ${pawn.side} ${selected ? "selected" : ""}`} />
      <text y={-TOKEN_RISE} textAnchor="middle" dominantBaseline="central" className="pawn-number">
        {pawn.player.jersey_number}
      </text>
    </g>
  );
}
