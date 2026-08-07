import { useState } from "react";
import { Game } from "../Game";
import { recordResult, simulateRound } from "../../game/careerApi";
import type { FixtureDTO, SaveDTO } from "../../game/careerTypes";
import type { TeamDTO } from "../../game/types";
import { CareerHome } from "./CareerHome";
import { SavesList } from "./SavesList";
import { NewGameName } from "./NewGameName";
import { ChooseTeam } from "./ChooseTeam";
import { TeamPreview } from "./TeamPreview";
import { ClubHome } from "./ClubHome";
import { TeamManagement } from "./TeamManagement";
import { Calendar } from "./Calendar";

/**
 * Owns navigation between the career screens as a small explicit stack —
 * same "tiny state machine, no router" approach App.tsx already uses for
 * menu/match, rather than pulling in a routing library. The "match" screen
 * reuses the SAME <Game> component the other match modes use (not a
 * career-specific copy) — career mode's only difference is which team ids
 * get loaded and what happens when the player is done, both passed as
 * props; see Game.tsx's homeTeamId/awayTeamId/onCareerMatchEnd.
 *
 * "home" is the Career landing screen (Continue / Load Game / New Game /
 * Return). New Game flow is name entry -> choose team -> team preview,
 * where only the preview's "Pick this team" button actually commits.
 * Once a team's picked, "clubHome" is the actual game hub — the old raw
 * Teams/Leagues admin screen (SaveDetail) is gone; the player was never
 * meant to hand-manage that.
 */
type CareerScreen =
  | { name: "home" }
  | { name: "loadGame" }
  | { name: "newGameName" }
  | { name: "chooseTeam"; save: SaveDTO }
  | { name: "teamPreview"; save: SaveDTO; team: TeamDTO }
  | { name: "clubHome"; saveId: number }
  | { name: "teamManagement"; saveId: number; teamId: number }
  | { name: "calendar"; saveId: number; leagueId: number }
  | { name: "match"; saveId: number; leagueId: number; fixture: FixtureDTO };

interface Props {
  onExitToMenu: () => void;
  /** Forwarded straight through to the internal "match" screen's <Game> — fullscreen is owned by App.tsx, see Game.tsx's Props comment. */
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

// A save's teams are all auto-generated on creation (see backend's POST
// /api/saves) — user_team_id is only ever null in the brief window before
// the player has made that one choice, never because a save has no teams
// yet. Routing here just decides which screen to land on based on whether
// that choice has already been made.
function openSave(save: SaveDTO, setScreen: (s: CareerScreen) => void) {
  if (save.user_team_id == null) {
    setScreen({ name: "chooseTeam", save });
  } else {
    setScreen({ name: "clubHome", saveId: save.id });
  }
}

export function Career({ onExitToMenu, isFullscreen, onToggleFullscreen }: Props) {
  const [screen, setScreen] = useState<CareerScreen>({ name: "home" });

  switch (screen.name) {
    case "home":
      return (
        <CareerHome
          onContinue={(save) => openSave(save, setScreen)}
          onLoadGame={() => setScreen({ name: "loadGame" })}
          onNewGame={() => setScreen({ name: "newGameName" })}
          onReturn={onExitToMenu}
        />
      );
    case "loadGame":
      return (
        <SavesList onBack={() => setScreen({ name: "home" })} onOpenSave={(save) => openSave(save, setScreen)} />
      );
    case "newGameName":
      return (
        <NewGameName
          onBack={() => setScreen({ name: "home" })}
          onCreated={(save) => setScreen({ name: "chooseTeam", save })}
        />
      );
    case "chooseTeam":
      return (
        <ChooseTeam
          save={screen.save}
          onBack={() => setScreen({ name: "home" })}
          onPickTeam={(team) => setScreen({ name: "teamPreview", save: screen.save, team })}
        />
      );
    case "teamPreview":
      return (
        <TeamPreview
          save={screen.save}
          team={screen.team}
          onBack={() => setScreen({ name: "chooseTeam", save: screen.save })}
          onPicked={(saveId) => setScreen({ name: "clubHome", saveId })}
        />
      );
    case "clubHome":
      return (
        <ClubHome
          saveId={screen.saveId}
          onOpenCalendar={(leagueId) => setScreen({ name: "calendar", saveId: screen.saveId, leagueId })}
          onOpenTeamManagement={(teamId) => setScreen({ name: "teamManagement", saveId: screen.saveId, teamId })}
          onPlayFixture={(fixture, leagueId) => setScreen({ name: "match", saveId: screen.saveId, leagueId, fixture })}
          onSave={() => setScreen({ name: "home" })}
          onExit={onExitToMenu}
        />
      );
    case "teamManagement":
      return (
        <TeamManagement
          saveId={screen.saveId}
          teamId={screen.teamId}
          onBack={() => setScreen({ name: "clubHome", saveId: screen.saveId })}
        />
      );
    case "calendar":
      return <Calendar leagueId={screen.leagueId} onBack={() => setScreen({ name: "clubHome", saveId: screen.saveId })} />;
    case "match": {
      const { saveId, leagueId, fixture } = screen;
      const backToClubHome = () => setScreen({ name: "clubHome", saveId });
      return (
        <Game
          mode="ai"
          homeTeamId={fixture.home_team_id}
          awayTeamId={fixture.away_team_id}
          onExitToMenu={backToClubHome}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          onCareerMatchEnd={async (homeScore, awayScore) => {
            await recordResult(fixture.id, homeScore, awayScore);
            // The player's own fixture is now scored, so this only ever
            // touches the OTHER clubs' still-unplayed fixtures in the same
            // round (see backend's simulate-round comment) — that's what
            // advances the whole league in lockstep instead of leaving
            // every other match sitting unplayed forever.
            await simulateRound(leagueId, fixture.round);
            backToClubHome();
          }}
        />
      );
    }
  }
}
