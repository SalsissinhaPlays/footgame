export interface FixturePair {
  round: number;
  homeTeamId: number;
  awayTeamId: number;
}

/**
 * Single round-robin fixture list via the standard "circle method": fix one
 * team, rotate the rest around it for (n-1) rounds, pairing opposite
 * positions each round. Every team plays every other team exactly once. An
 * odd team count gets a synthetic bye slot (never scheduled) so the same
 * rotation still works — one team sits out each round rather than the
 * algorithm needing a separate odd-count case.
 *
 * Home/away is flipped by round parity purely for fairness (so a team
 * doesn't get all its games on the same side) — not a full "balanced
 * home/away distribution" scheduler, which isn't a requirement yet.
 */
export function generateRoundRobin(teamIds: number[]): FixturePair[] {
  if (teamIds.length < 2) return [];

  const BYE = -1;
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) teams.push(BYE);

  const n = teams.length;
  const pairs: FixturePair[] = [];
  const arr = [...teams];

  for (let round = 0; round < n - 1; round++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      const [home, away] = round % 2 === 0 ? [a, b] : [b, a];
      pairs.push({ round: round + 1, homeTeamId: home, awayTeamId: away });
    }
    // Rotate everyone except the fixed first slot.
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }

  return pairs;
}
