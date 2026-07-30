import Phaser from "phaser";
import { forwardRef, useEffect, useLayoutEffect, useRef } from "react";
import { VIEW_H, VIEW_W } from "../game/iso";
import { EventBus } from "./EventBus";
import { MatchScene } from "./MatchScene";

export interface PhaserGameHandle {
  game: Phaser.Game | null;
}

interface Props {
  onSceneReady: (scene: MatchScene) => void;
}

export const PhaserGame = forwardRef<PhaserGameHandle, Props>(function PhaserGame(
  { onSceneReady },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useLayoutEffect(() => {
    if (gameRef.current || !containerRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      transparent: true,
      width: VIEW_W,
      height: VIEW_H,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [MatchScene],
    };
    gameRef.current = new Phaser.Game(config);

    if (typeof ref === "function") ref({ game: gameRef.current });
    else if (ref) ref.current = { game: gameRef.current };

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleSceneReady(scene: MatchScene) {
      onSceneReady(scene);
    }
    EventBus.on("current-scene-ready", handleSceneReady);
    return () => {
      EventBus.off("current-scene-ready", handleSceneReady);
    };
  }, [onSceneReady]);

  return <div ref={containerRef} className="phaser-container" />;
});
