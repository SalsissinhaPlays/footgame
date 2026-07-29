import { useState } from "react";
import { Game } from "./components/Game";
import { MainMenu } from "./components/MainMenu";

type Screen = { name: "menu" } | { name: "match" };

function App() {
  const [screen, setScreen] = useState<Screen>({ name: "menu" });

  if (screen.name === "menu") {
    return <MainMenu onStartHotseat={() => setScreen({ name: "match" })} />;
  }

  return <Game onExitToMenu={() => setScreen({ name: "menu" })} />;
}

export default App;
