export interface FixturePair {
  round: number;
  homeTeamId: number;
  awayTeamId: number;
}

/**
 * Full double round-robin: every team plays every other team twice, once
 * at each side's home ground — the standard shape of a real league season
 * (Premier League: 38 games = 19 opponents × 2), not just a single pass
 * through the fixture list. Built from the single-leg schedule below (the
 * "circle method") plus a mirrored second leg with home/away swapped and
 * round numbers offset past the first leg's — the standard, simplest way
 * to build a double round-robin, and it guarantees the second meeting is
 * never scheduled before every team has had its first.
 */
export function generateRoundRobin(teamIds: number[]): FixturePair[] {
  const firstLeg = generateSingleLegRoundRobin(teamIds);
  if (firstLeg.length === 0) return [];
  const roundsInFirstLeg = Math.max(...firstLeg.map((p) => p.round));
  const secondLeg = firstLeg.map((p) => ({
    round: p.round + roundsInFirstLeg,
    homeTeamId: p.awayTeamId,
    awayTeamId: p.homeTeamId,
  }));
  return [...firstLeg, ...secondLeg];
}

/**
 * One single-leg pass via the standard "circle method": fix one team,
 * rotate the rest around it for (n-1) rounds, pairing opposite positions
 * each round. Every team plays every other team exactly once. An odd team
 * count gets a synthetic bye slot (never scheduled) so the same rotation
 * still works — one team sits out each round rather than the algorithm
 * needing a separate odd-count case.
 *
 * Home/away here is flipped by round parity purely for fairness within
 * this one leg (so a team doesn't get all ITS games in this leg on the
 * same side) — generateRoundRobin's own second-leg mirroring is what
 * actually guarantees a true home-and-away pair across the full season.
 */
function generateSingleLegRoundRobin(teamIds: number[]): FixturePair[] {
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
