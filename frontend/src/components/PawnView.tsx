import { CELL_SIZE } from "../game/constants";
import type { Pawn } from "../game/types";

interface Props {
  pawn: Pawn;
  selected: boolean;
  onClick: () => void;
}

export function PawnView({ pawn, selected, onClick }: Props) {
  const cx = pawn.pos.x * CELL_SIZE + CELL_SIZE / 2;
  const cy = pawn.pos.y * CELL_SIZE + CELL_SIZE / 2;

  return (
    <g onClick={onClick} className="pawn" transform={`translate(${cx}, ${cy})`}>
      {pawn.plannedPos && (
        <>
          <line
            x1={0}
            y1={0}
            x2={(pawn.plannedPos.x - pawn.pos.x) * CELL_SIZE}
            y2={(pawn.plannedPos.y - pawn.pos.y) * CELL_SIZE}
            className="move-arrow"
          />
          <circle
            cx={(pawn.plannedPos.x - pawn.pos.x) * CELL_SIZE}
            cy={(pawn.plannedPos.y - pawn.pos.y) * CELL_SIZE}
            r={CELL_SIZE * 0.25}
            className={`pawn-ghost ${pawn.side}`}
          />
        </>
      )}
      <circle
        r={CELL_SIZE * 0.38}
        className={`pawn-circle ${pawn.side} ${selected ? "selected" : ""}`}
      />
      <text textAnchor="middle" dominantBaseline="central" className="pawn-number">
        {pawn.player.jersey_number}
      </text>
    </g>
  );
}
