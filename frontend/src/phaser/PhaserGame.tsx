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
      scale: {
        // RESIZE (rather than FIT) makes the canvas always exactly match the
        // container's real pixel size — no letterbox bars from a CSS-scaled
        // fixed-resolution canvas. MatchScene handles fitting the fixed-size
        // isometric world into whatever that size turns out to be, so the
        // pitch fills any device's screen/window shape instead of always
        // rendering at one aspect ratio.
        mode: Phaser.Scale.RESIZE,
        width: containerRef.current.clientWidth || VIEW_W,
        height: containerRef.current.clientHeight || VIEW_H,
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Phaser's RESIZE scale mode only reacts to window 'resize' events on its
    // own — it doesn't notice the parent container changing size on its own
    // (e.g. entering fullscreen, or a CSS layout change with no window
    // resize). Watch the container directly and drive the resize ourselves.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        gameRef.current?.scale.resize(width, height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className="phaser-container" />;
});
