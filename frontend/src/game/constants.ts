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

// Foul risk on a decisively lost tackle (see resolve.ts's tackle-challenge
// branch) — chance ramps from FOUL_CHANCE_AT_THRESHOLD right at
// DECISIVE_CONTEST_MARGIN up to FOUL_CHANCE_MAX as the loss gets more
// lopsided, over FOUL_CHANCE_MARGIN_RANGE. Aggressive stance adds a flat
// bonus on top — a real trade-off for its existing tackle-contest bonus,
// not a pure upside.
export const FOUL_CHANCE_AT_THRESHOLD = 0.12;
export const FOUL_CHANCE_MAX = 0.35;
export const FOUL_CHANCE_MARGIN_RANGE = 30;
export const FOUL_AGGRESSIVE_BONUS = 0.08;

// Fixed penalty-spot depth off the goal line (inside GK_PENALTY_DEPTH's
// 2.6-unit box) — real football's spot sits roughly 2/3 of the way through
// the box from the line; same proportion here, a starting point for
// playtesting like the rest of the GK tuning constants.
export const PENALTY_SPOT_DEPTH = 2.0;

// Loft (airborne kick) height, in the same meter-scale world units as
// everything else. A lofted flight's height follows a simple parabola
// (0 at kickoff, apex at the midpoint, back to 0 on landing) — see
// heightAlongFlight in resolve.ts. Apex scales with kick distance (a long
// cross arcs higher than a short chip) but is bounded on both ends so even
// a very short loft clears BALL_REACH_HEIGHT for at least a moment, and a
// very long cross doesn't arc absurdly high. Starting points for
// playtesting, expected to move together.
export const LOFT_APEX_HEIGHT_RATIO = 0.2; // apex as a fraction of total kick distance
export const LOFT_APEX_MIN = 2.5; // meters — always clears BALL_REACH_HEIGHT briefly
export const LOFT_APEX_MAX = 6; // meters — cap for a max-range KICK_RANGE cross

// Height, in meters, at or below which the ball is considered "reachable" —
// existing capture/interception rules apply unchanged. Above it, the ball
// is out of anyone's reach and the flight just sails on overhead, no matter
// who's standing underneath. Roughly a standing pawn's unaided reach
// (~2-2.5m); this is also the single seam a future header contest is meant
// to slot into (a pawn near a descending ball within this height winning it
// away via jump/head attributes) instead of "nobody can touch it" — do not
// add header-specific logic here, just keep this threshold honest.
export const BALL_REACH_HEIGHT = 2.2;

// Height, in meters, above which a descending ball becomes headable instead
// of fully untouchable — the second half of the seam BALL_REACH_HEIGHT's own
// doc comment describes. Between BALL_REACH_HEIGHT and this, checkHeader
// runs instead of checkCapture; above this, still fully untouchable (a
// well-lofted cross's peak stays uncontestable, only becoming headable as it
// descends — matches real crossing/heading play). ~3.2m comfortably covers a
// realistic jump+reach header height while staying well under LOFT_APEX_MAX
// (6m).
export const HEADER_REACH_HEIGHT = 3.2;

// How close a pawn must be to the ball's swept segment to contest a header —
// larger than CAPTURE_RADIUS (1.2): heading involves jumping/reaching with
// the head, more generous than trapping a grounded ball at the feet.
// Comparable to TACKLE_RADIUS (1.7), same "body reaching in" scale.
export const HEADER_RADIUS = 1.6;

// Baseline roll an UNCONTESTED header (exactly one eligible pawn — see
// checkHeader) must clear; a 2+-pawn header is a genuine
// resolveContestDetailed contest instead and doesn't use this. WEIGHTS.header
// (contest.ts) sums to 1.0 and RANDOM_SPREAD gives +/-15 noise, so a pawn
// whose weighted jumping/skill/pace average is X rolls X +/-15. At 36: an
// average pawn (~50) fails only ~3% of the time (noise < -14, i.e. the
// bottom 1/30 of the spread) — genuinely rare, as intended, not a coinflip
// the way SAVE_DIFFICULTY_THRESHOLD deliberately is for an average keeper.
// A below-average pawn (~40) fails much more often (~37%), which is the
// intended shape (weak headers of the ball being unreliable), not a bug.
export const HEADER_DIFFICULTY_THRESHOLD = 36;

// How far upfield (away from the winning pawn's own goal) an uncontested
// clearance header aims when pickHeaderTarget finds no shot and no open
// teammate — a point, not a specific pawn. Kept well under KICK_RANGE (24)
// so a clearance reads as a realistic punt, not a max-effort launch every
// time.
export const HEADER_CLEARANCE_DISTANCE = 14;

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
// Total real-distance reach for a single waypoint leg, used wherever planning
// (human click or AI) decides which destinations are reachable for the NEXT
// leg — not the whole turn any more, since a turn can now chain several legs
// (see the stamina/charge constants below and resolve.ts's chargesFor).
export const PAWN_MOVE_BUDGET = MOVE_RANGE * PAWN_SPEED_PER_TICK;

// A pawn's per-turn "charge" budget (see resolve.ts's chargesFor) — one
// waypoint leg costs one charge, capped at PAWN_MOVE_BUDGET distance each.
// Explicitly modeled after Divinity: Original Sin 2's charge system (a
// handful of charges per turn, each move costs one and covers up to a fixed
// distance) rather than a continuous fatigue meter — the `stamina` attribute
// (0-100) scales how many charges a pawn gets, so a fitter player can chain
// more legs in one turn, not just move faster within a single one.
// STAMINA_CHARGES_BASE guarantees every pawn keeps at least today's one
// full-budget move even at 0 stamina. Starting points for playtesting, like
// every other tunable here.
export const STAMINA_CHARGES_BASE = 2;
export const STAMINA_PER_BONUS_CHARGE = 25;

// How close an opponent has to get to a dribbling ball carrier before they
// can attempt a tackle — a bit more generous than PAWN_COLLISION_RADIUS
// since this represents a boot reaching in, not the pawns' bodies overlapping.
export const TACKLE_RADIUS = 1.7;

// The visual checkerboard/speckle grid is drawn in tiles of this many world
// units per side, decoupled from gameplay scale — draw cost stays bounded
// regardless of pitch size (at 1:1 with world units, a 60x40 pitch would be
// 2400 individually-drawn tiles instead of the ~150 this gives).
export const CHECKER_CELL_SIZE = 4;

// Stance bonuses (see contest.ts's stanceBonus): small additive terms on top
// of a contest roll, scaled by the same attributes contest.ts's own weight
// tables use — a factor here times pawn.player.<attribute>, not a flat
// number, so these automatically read against whatever new attributes get
// added later instead of needing a redesign. Roll noise is +/-15 (contest.ts's
// RANDOM_SPREAD), so a factor of ~0.1-0.15 against a ~50-average attribute
// gives a bonus in the same ballpark as the random spread — a real edge,
// not a coin-flip override of the underlying attributes.
export const STANCE_AGGRESSIVE_PACE_FACTOR = 0.15;
export const STANCE_COVER_PASSING_SKILL_FACTOR = 0.15;
export const STANCE_MAN_MARK_SKILL_FACTOR = 0.1;
export const STANCE_MAN_MARK_PACE_FACTOR = 0.1;

// How strongly a man-marking pawn (with no explicit plannedSteps) is pulled
// toward its target's live position each tick — 1 would be a blind full
// chase; this keeps some positional discipline instead ("focus more, but
// not exclusively"). Recomputed fresh every tick against the target's
// current position, same as the loose-ball-chase re-aiming in resolve.ts.
export const MAN_MARK_PULL_WEIGHT = 0.7;

// "Pressure" stance: how close an opponent has to be to a pressuring pawn
// to have its effective per-tick speed cut, and the fraction of normal
// speed it's left with while inside that radius.
export const PRESSURE_RADIUS = 2.5;
export const PRESSURE_SLOW_FACTOR = 0.6;

// Sprint: a cooldown-gated skill rather than a freely-repeatable stance —
// there's no stamina-drain/fatigue resource to draw a numeric cost from yet,
// so the cooldown lockout itself is the physical cost. A 50% reach boost is
// enough to plausibly win a foot race without being an obviously-correct
// pick every turn; a 3-turn lockout is steep enough that spamming it every
// turn isn't viable but short enough to reuse within the same attacking move
// if timed well. Both are starting points, expected to move together in
// playtesting.
export const SPRINT_SPEED_MULTIPLIER = 1.5;
export const SPRINT_COOLDOWN_TURNS = 3;

// Goalkeeper's own box — shared by rendering (MatchScene's redrawField) and
// gameplay (GK auto-positioning, proactive claim eligibility, collision
// relief; see resolve.ts). Same numbers the pitch has always drawn; now a
// single source of truth instead of duplicated between draw code and logic.
export const GK_SIX_YARD_DEPTH = 1.2;
export const GK_PENALTY_DEPTH = 2.6;
export const GK_PENALTY_PAD = 1.5;

// GK save-contest tuning (see contest.ts's reachFactor/rollSaveAttempt and
// resolve.ts's attemptSave). jumping deliberately doesn't appear as a
// WEIGHTS.save entry in contest.ts — an additive bonus scaling with shot
// distance would let a maxed-jumping keeper dominate every roll regardless
// of distance. Instead it only widens GK_STRETCH_RANGE_BASE (the range of
// full shot_stopping/reflexes effectiveness); beyond that range,
// effectiveness falls off linearly over GK_REACH_FALLOFF_RANGE down to
// GK_MIN_REACH_FACTOR rather than to 0, so even a near-impossible stretch
// keeps a sliver of a chance. All starting points for playtesting, expected
// to move together.
export const GK_STRETCH_RANGE_BASE = 1.5; // world units of full-effectiveness reach even at jumping = 0
export const GK_STRETCH_RANGE_PER_JUMPING = 0.02; // extra full-effectiveness reach per point of jumping (0-100) — up to +2.0 at jumping=100
export const GK_REACH_FALLOFF_RANGE = 3; // world units beyond the stretch range over which effectiveness linearly decays to the floor
export const GK_MIN_REACH_FACTOR = 0.15; // floor — a near-impossible stretch still keeps a sliver of a chance
export const GK_HEIGHT_DISTANCE_WEIGHT = 0.6; // converts meters of ballHeight into "equivalent" lateral reach-distance — an aerial shot needs a real leap even if laterally close
export const SAVE_DIFFICULTY_THRESHOLD = 55; // baseline roll a shot "presents"; a specialist keeper (shot_stopping/reflexes ~70+) at full reach clears this comfortably, an average one (~50) is close to a coinflip

// GK claim/positioning tuning (see resolve.ts's checkCapture integration and
// gkAutoTarget).
export const GK_CLAIM_RADIUS = 5; // expanded reach for an Aggressive GK's proactive claim, vs. the generic CAPTURE_RADIUS (1.2) any defender gets
export const GK_ANCHOR_DEPTH = 0.8; // resting depth off the goal line for on-the-line/default auto-positioning
export const GK_AGGRESSIVE_THREAT_RANGE = 14; // distance from goal line within which an Aggressive GK considers advancing off his line at all
