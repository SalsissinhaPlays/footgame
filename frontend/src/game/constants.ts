export const GRID_COLS = 16;
export const GRID_ROWS = 12;
export const CELL_SIZE = 50;
export const MOVE_RANGE = 3;
export const KICK_RANGE = 10;
// Cells the ball covers per resolution tick once kicked — faster than a
// pawn's 1 cell/tick dash, so it arrives as soon as it covers the real
// distance instead of always stretching to fill every tick of the turn.
export const BALL_SPEED = 4;

export const TOTAL_TURNS = 12;

// Goal mouth: rows the ball must be in, at column 0 (home goal) or
// GRID_COLS - 1 (away goal), for a goal to count.
export const GOAL_ROW_MIN = 4;
export const GOAL_ROW_MAX = 7;

export const BALL_START = { x: Math.floor(GRID_COLS / 2), y: Math.floor(GRID_ROWS / 2) };

// Pawns (and the ball) may step one cell past the touchlines/goal lines into
// the out-of-bounds apron on any side, including inside the goal net itself.
export const OOB_CELLS = 1;

// Distance (grid units, continuous) within which a pawn can receive, contest,
// or carry the ball. Pawns still move cell-to-cell, but the ball's position
// during a kick is a real point along its flight path, not a grid cell — this
// is what lets a defender's positioning mid-flight (not just at the moment of
// the kick) matter for interceptions.
export const CAPTURE_RADIUS = 0.75;

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
export const ROLL_FRICTION = 0.45; // fraction of speed KEPT each tick
export const ROLL_STOP_EPS = 0.15; // below this speed the ball is considered stopped
