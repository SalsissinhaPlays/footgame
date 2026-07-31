// World units are meters on a small-sided pitch, not literal grid cells —
// the "GRID_"/"_CELLS" naming predates continuous movement/aim (stages 1
// and 7) and was kept to avoid a pure renaming churn once those landed.
// Every distance constant below is scaled off this pitch size; see git
// history for the field-expansion project that derived them (they were
// previously tuned for a cramped 16x12 world where a kick across half the
// pitch barely widened the aim spread).
export const GRID_COLS = 60;
export const GRID_ROWS = 40;
// Ticks per turn. Raised from the pitch-expansion project's original 3 so
// each tick's movement/ball-travel is a smaller, more legible slice of the
// turn — a turn now plays out over more, smaller steps instead of a few
// big leaps, which is also what gives a kick's flight (below) room to
// finish inside a turn without needing an oversized BALL_SPEED.
export const MOVE_RANGE = 6;
export const KICK_RANGE = 24;
// Units the ball covers per resolution tick once kicked — faster than a
// pawn's dash, so it arrives as soon as it covers the real distance instead
// of always stretching to fill every tick of the turn. Must stay high enough
// that BALL_SPEED * MOVE_RANGE comfortably clears KICK_RANGE, or a max-range
// kick would run out of ticks mid-flight and just stop dead in open space.
export const BALL_SPEED = 5;

export const TOTAL_TURNS = 12;

// Goal mouth: rows the ball must be in, at column 0 (home goal) or
// GRID_COLS - 1 (away goal), for a goal to count.
export const GOAL_ROW_MIN = 17;
export const GOAL_ROW_MAX = 23;

export const BALL_START = { x: Math.floor(GRID_COLS / 2), y: Math.floor(GRID_ROWS / 2) };

// Pawns (and the ball) may step past the touchlines/goal lines into the
// out-of-bounds apron on any side, including inside the goal net itself.
export const OOB_CELLS = 4;

// Distance (continuous world units) within which a pawn can receive, contest,
// or carry the ball — the ball's position during a kick is a real point
// along its flight path, not a grid cell, which is what lets a defender's
// positioning mid-flight (not just at the moment of the kick) matter for
// interceptions. Kept close to a real "personal space" size regardless of
// how big the pitch itself is — this and the other interaction radii below
// were originally scaled up 4x along with the pitch dimensions, which made
// a pawn's zone of control a huge fraction of the field (forcing exaggerated
// detours around opponents); shrinking them back down is what makes the
// bigger pitch actually feel bigger, rather than just as crowded as before.
export const CAPTURE_RADIUS = 1.2;

// A contest's margin (winner's roll minus runner-up's, see contest.ts) has to
// clear this to count as a commanding win rather than a close one decided
// mostly by the luck of the roll. Below it, an interception attempt becomes
// a scrappy deflection (ball squirts loose) instead of a clean, instant
// takeover.
export const DECISIVE_CONTEST_MARGIN = 15;

// Post-landing ball physics: an unopposed kick or a scrappy (non-decisive)
// challenge doesn't stop the ball dead — it keeps a bit of momentum and
// rolls on, losing speed each tick until it settles or someone reaches it.
export const ROLL_START_SPEED = BALL_SPEED * 0.35;
export const DEFLECTION_SPEED = BALL_SPEED * 0.5;
// A deflection isn't a clean redirect — it comes off at a wide, unpredictable
// angle from the original flight direction (in either direction), which is
// the whole "spills off in an unexpected direction" feel.
export const DEFLECTION_ANGLE_SPREAD = (100 * Math.PI) / 180;
// Fraction of speed KEPT each tick — lowered so a loose ball sheds momentum
// noticeably faster (loses force in fewer ticks) instead of coasting on.
export const ROLL_FRICTION = 0.35;
export const ROLL_STOP_EPS = 0.3; // below this speed the ball is considered stopped

// How close a loose ball has to roll to a pawn before they even get a
// chance to react to it (see reactions.ts) and consider abandoning their
// planned move to chase it down instead.
export const REACT_RADIUS = 4.5;

// Pawn movement: real distance per tick in any direction, not a grid-cell
// step in one of 8 compass headings. MOVE_RANGE stays "ticks per turn" (the
// ball's flight/roll loop also iterates that many times); this is what
// decouples "how many ticks resolve" from "how far a pawn can actually
// travel."
export const PAWN_SPEED_PER_TICK = 1;
// Minimum distance kept between any two pawns.
export const PAWN_COLLISION_RADIUS = 1.4;
// Total real-distance reach for a turn's move, used wherever planning
// (human click or AI) decides which destinations are reachable this turn.
export const PAWN_MOVE_BUDGET = MOVE_RANGE * PAWN_SPEED_PER_TICK;

// How close an opponent has to get to a dribbling ball carrier before they
// can attempt a tackle — a bit more generous than PAWN_COLLISION_RADIUS
// since this represents a boot reaching in, not the pawns' bodies overlapping.
export const TACKLE_RADIUS = 1.7;

// The visual checkerboard/speckle grid is drawn in tiles of this many world
// units per side, decoupled from gameplay scale — draw cost stays bounded
// regardless of pitch size (at 1:1 with world units, a 60x40 pitch would be
// 2400 individually-drawn tiles instead of the ~150 this gives).
export const CHECKER_CELL_SIZE = 4;
