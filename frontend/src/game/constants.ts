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
