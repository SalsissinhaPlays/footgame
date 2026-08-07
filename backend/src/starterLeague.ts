/**
 * Generates a ready-to-play 12-team league (12 players each) so creating a
 * save hands the user something to manage immediately, instead of an empty
 * shell they have to build by hand. Pure content generation — no DB access
 * here, index.ts's POST /api/saves is what actually inserts this.
 */

export interface GeneratedPlayer {
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  jersey_number: number;
  pace: number;
  stamina: number;
  skill: number;
  jumping: number;
  shot_stopping: number;
  reflexes: number;
  heading: number;
}

export interface GeneratedTeam {
  name: string;
  players: GeneratedPlayer[];
}

const TEAM_PREFIXES = [
  "North", "South", "East", "West", "Iron", "Silver", "Golden", "Crimson",
  "Royal", "Stone", "River", "Harbor",
];
const TEAM_SUFFIXES = ["United", "City", "Athletic", "Rovers", "Wanderers", "Albion", "Rangers", "Town"];

// Exported so managerGenerator.ts can build names from the same pool
// without a second, driftable copy — a manager's name has no other reason
// to look different from a player's.
export const FIRST_NAMES = [
  "Lucas", "Mateus", "Diego", "Rafael", "Bruno", "Thiago", "Gabriel", "Felipe",
  "Andre", "Carlos", "Marco", "Luca", "Antoine", "Kwame", "Amara", "Kofi",
  "Jamal", "Malik", "Sven", "Erik", "Viktor", "Dimitri", "Ivan", "Yusuf",
];
export const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Costa", "Pereira", "Rodrigues", "Almeida", "Nascimento",
  "Ferreira", "Souza", "Martins", "Rocha", "Dubois", "Mensah", "Osei", "Diallo",
  "Traore", "Larsson", "Berg", "Novak", "Petrov", "Volkov", "Demir", "Aksoy",
];

// 12 players: 2 GK, 4 DEF, 4 MID, 2 FWD — real depth beyond the 6 that
// actually take the pitch, deliberately so a future "pick your starting 6"
// step has something to choose FROM.
const POSITION_PLAN: GeneratedPlayer["position"][] = [
  "GK", "GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "FWD", "FWD",
];

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateTeamNames(count: number): string[] {
  const combos: string[] = [];
  for (const prefix of TEAM_PREFIXES) {
    for (const suffix of TEAM_SUFFIXES) combos.push(`${prefix} ${suffix}`);
  }
  return shuffle(combos).slice(0, count);
}

function generatePlayerName(usedNames: Set<string>): string {
  let name = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    name = `${FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[randInt(0, LAST_NAMES.length - 1)]}`;
    if (!usedNames.has(name)) break;
  }
  usedNames.add(name);
  return name;
}

/**
 * Attribute ranges by position archetype — same spirit as db.ts's
 * hand-tuned demoSquad (keeper specializes in shot_stopping/reflexes/jumping,
 * defenders/forwards skew toward heading, etc.) but randomized within each
 * range instead of one fixed value per position, so a generated squad's 4
 * defenders don't all play identically.
 */
function attributesFor(position: GeneratedPlayer["position"]): Omit<GeneratedPlayer, "name" | "position" | "jersey_number"> {
  switch (position) {
    case "GK":
      return {
        pace: randInt(35, 55),
        stamina: randInt(45, 65),
        skill: randInt(40, 60),
        jumping: randInt(60, 85),
        shot_stopping: randInt(60, 88),
        reflexes: randInt(58, 85),
        heading: randInt(30, 50),
      };
    case "DEF":
      return {
        pace: randInt(45, 70),
        stamina: randInt(55, 78),
        skill: randInt(42, 65),
        jumping: randInt(48, 70),
        shot_stopping: randInt(10, 25),
        reflexes: randInt(15, 32),
        heading: randInt(50, 75),
      };
    case "MID":
      return {
        pace: randInt(50, 75),
        stamina: randInt(60, 85),
        skill: randInt(55, 80),
        jumping: randInt(42, 62),
        shot_stopping: randInt(10, 22),
        reflexes: randInt(15, 28),
        heading: randInt(42, 62),
      };
    case "FWD":
      return {
        pace: randInt(58, 85),
        stamina: randInt(50, 72),
        skill: randInt(52, 80),
        jumping: randInt(45, 68),
        shot_stopping: randInt(8, 18),
        reflexes: randInt(12, 25),
        heading: randInt(52, 78),
      };
  }
}

export function generateStarterLeague(): GeneratedTeam[] {
  const teamNames = generateTeamNames(12);
  return teamNames.map((name) => {
    const usedNames = new Set<string>();
    const players: GeneratedPlayer[] = POSITION_PLAN.map((position, i) => ({
      name: generatePlayerName(usedNames),
      position,
      jersey_number: i + 1,
      ...attributesFor(position),
    }));
    return { name, players };
  });
}
