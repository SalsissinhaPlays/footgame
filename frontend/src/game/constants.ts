export const GRID_COLS = 16;
export const GRID_ROWS = 10;
export const CELL_SIZE = 50;
export const MOVE_RANGE = 3;

export const TOTAL_TURNS = 12;

// Goal mouth: rows the ball must be in, at column 0 (home goal) or
// GRID_COLS - 1 (away goal), for a goal to count.
export const GOAL_ROW_MIN = 3;
export const GOAL_ROW_MAX = 6;

export const BALL_START = { x: Math.floor(GRID_COLS / 2), y: Math.floor(GRID_ROWS / 2) };
