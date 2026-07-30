import type { Projector } from "../game/iso";
import type { Pawn } from "../game/types";

interface Props {
  pawn: Pawn;
  selected: boolean;
  onClick: () => void;
  projector: Projector;
}

// Sprites are pre-cropped tight to the character (feet at the bottom edge,
// head at the top), at a fixed 0.55 width:height ratio — see the crop script
// used when the art was integrated.
const SPRITE_HEIGHT = 108;
const SPRITE_WIDTH = SPRITE_HEIGHT * 0.55;
// The art is a front-on studio render, not shot from the isometric camera
// angle, so its "feet" don't naturally read as touching a flat iso shadow.
// Nudging it down to overlap the shadow sells the contact better.
const SPRITE_OVERLAP = 10;

function spriteFor(pawn: Pawn): string {
  if (pawn.player.position === "GK") return "/sprites/player_gk.png";
  return pawn.side === "home" ? "/sprites/player_home.png" : "/sprites/player_away.png";
}

export function PawnView({ pawn, selected, onClick, projector }: Props) {
  const { toIso } = projector;
  const base = toIso(pawn.pos.x + 0.5, pawn.pos.y + 0.5);

  const planned = pawn.plannedPos
    ? toIso(pawn.plannedPos.x + 0.5, pawn.plannedPos.y + 0.5)
    : null;
  const kickTarget = pawn.plannedKick ? toIso(pawn.plannedKick.x + 0.5, pawn.plannedKick.y + 0.5) : null;

  const badgeY = -SPRITE_HEIGHT + SPRITE_OVERLAP - 6;

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

      <ellipse cx={0} cy={2} rx={24} ry={11} className="pawn-shadow" />
      {selected && <ellipse cx={0} cy={2} rx={30} ry={14} className="pawn-select-ring" />}

      <image
        href={spriteFor(pawn)}
        x={-SPRITE_WIDTH / 2}
        y={-SPRITE_HEIGHT + SPRITE_OVERLAP}
        width={SPRITE_WIDTH}
        height={SPRITE_HEIGHT}
        className="pawn-sprite"
        preserveAspectRatio="xMidYMax meet"
      />

      <circle cy={badgeY} r={9} className={`pawn-badge ${pawn.side}`} />
      <text y={badgeY} textAnchor="middle" dominantBaseline="central" className="pawn-number">
        {pawn.player.jersey_number}
      </text>
    </g>
  );
}
