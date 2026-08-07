// Instant, non-interactive result generator for fixtures the player isn't
// part of. The real match engine (frontend/src/game/resolve.ts) has no
// notion of "let it run unattended and stop" — a match only ends when a
// human clicks "End Match" — so it can't be the thing that produces a
// season's other 65 results. This is a deliberately separate, much
// simpler statistical model: team strength derived from attribute
// averages, final score sampled from a Poisson distribution around an
// expected-goals figure. It has no ambition to reuse resolve.ts's contest
// math — it isn't simulating minutes, just producing a plausible final
// scoreline.

export interface PlayerAttrs {
  position: string;
  pace: number;
  skill: number;
  shot_stopping: number;
  reflexes: number;
}

export interface TeamStrength {
  attack: number;
  defense: number;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 50;
}

/**
 * attack = how well the team's forward-leaning players (FWD/MID) create
 * goals; defense = outfield defenders' contribution plus the goalkeeper's
 * shot-stopping, weighted so a good keeper meaningfully tightens things up
 * without single-handedly deciding it. Falls back to the whole outfield
 * when a position group is empty (a custom/edited roster might not follow
 * the usual GK/DEF/MID/FWD split).
 */
export function computeTeamStrength(players: PlayerAttrs[]): TeamStrength {
  const outfield = players.filter((p) => p.position !== "GK");
  const gks = players.filter((p) => p.position === "GK");
  const attackers = outfield.filter((p) => p.position === "FWD" || p.position === "MID");
  const defenders = outfield.filter((p) => p.position === "DEF" || p.position === "MID");

  const fallback = outfield.length ? outfield.map((p) => (p.skill + p.pace) / 2) : [50];
  const attack = average(attackers.length ? attackers.map((p) => (p.skill + p.pace) / 2) : fallback);
  const defenseOutfield = average(defenders.length ? defenders.map((p) => (p.skill + p.pace) / 2) : fallback);
  const gkDefense = average(gks.length ? gks.map((p) => (p.shot_stopping + p.reflexes) / 2) : [50]);

  return { attack, defense: defenseOutfield * 0.6 + gkDefense * 0.4 };
}

const BASE_EXPECTED_GOALS = 1.3;
const HOME_ADVANTAGE = 1.1;
const MIN_EXPECTED_GOALS = 0.2;
const MAX_EXPECTED_GOALS = 4.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function expectedGoals(attack: number, opposingDefense: number, homeAdvantage: number): number {
  const ratio = attack / Math.max(opposingDefense, 1);
  return clamp(BASE_EXPECTED_GOALS * ratio * homeAdvantage, MIN_EXPECTED_GOALS, MAX_EXPECTED_GOALS);
}

/** Knuth's algorithm — the standard simple way to sample a Poisson-distributed integer. */
function samplePoisson(lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > limit);
  return k - 1;
}

export function simulateScore(home: TeamStrength, away: TeamStrength): { homeScore: number; awayScore: number } {
  const homeLambda = expectedGoals(home.attack, away.defense, HOME_ADVANTAGE);
  const awayLambda = expectedGoals(away.attack, home.defense, 1);
  return { homeScore: samplePoisson(homeLambda), awayScore: samplePoisson(awayLambda) };
}
