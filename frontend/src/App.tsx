import { useState } from "react";
import { Game } from "./components/Game";
import { MainMenu } from "./components/MainMenu";

type Screen = { name: "menu" } | { name: "match"; mode: "hotseat" | "ai" | "solo" };

function App() {
  const [screen, setScreen] = useState<Screen>({ name: "menu" });

  if (screen.name === "menu") {
    return (
      <MainMenu
        onStartHotseat={() => setScreen({ name: "match", mode: "hotseat" })}
        onStartAi={() => setScreen({ name: "match", mode: "ai" })}
        onStartSolo={() => setScreen({ name: "match", mode: "solo" })}
      />
    );
  }

  return <Game mode={screen.mode} onExitToMenu={() => setScreen({ name: "menu" })} />;
}

export default App;
