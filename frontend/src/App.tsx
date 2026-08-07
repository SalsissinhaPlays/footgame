import { useEffect, useState } from "react";
import { Game } from "./components/Game";
import { MainMenu } from "./components/MainMenu";
import { Career } from "./components/career/Career";

type Screen = { name: "menu" } | { name: "match"; mode: "hotseat" | "ai" | "solo" } | { name: "career" };

function App() {
  const [screen, setScreen] = useState<Screen>({ name: "menu" });

  // Owned here, not inside Game.tsx, and targets document.documentElement
  // rather than any one screen's own wrapper div — that's what lets
  // fullscreen survive navigating between menu/career/match. The browser
  // auto-exits fullscreen the instant its target element unmounts, which
  // used to happen every time Game.tsx's own wrapper (fullscreen's old
  // target) got swapped out for a different screen.
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement != null);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  if (screen.name === "menu") {
    return (
      <MainMenu
        onStartHotseat={() => setScreen({ name: "match", mode: "hotseat" })}
        onStartAi={() => setScreen({ name: "match", mode: "ai" })}
        onStartSolo={() => setScreen({ name: "match", mode: "solo" })}
        onOpenCareer={() => setScreen({ name: "career" })}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    );
  }

  if (screen.name === "career") {
    return (
      <Career
        onExitToMenu={() => setScreen({ name: "menu" })}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    );
  }

  return (
    <Game
      mode={screen.mode}
      onExitToMenu={() => setScreen({ name: "menu" })}
      isFullscreen={isFullscreen}
      onToggleFullscreen={toggleFullscreen}
    />
  );
}

export default App;
