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
    const container = containerRef.current;

    // React 18 StrictMode double-invokes this effect in dev (mount ->
    // cleanup -> mount) to surface missing-cleanup bugs. Phaser.Game creates
    // its canvas synchronously in the constructor (boot() runs immediately
    // since the document is already loaded by the time this effect fires),
    // but Game.destroy() is asynchronous BY DESIGN — per Phaser's own source,
    // it just sets a `pendingDestroy` flag and waits for that instance's own
    // render loop to notice on a later frame, and that loop doesn't even
    // start until that instance's own asset loading finishes. That's far
    // slower than StrictMode's synchronous double-invoke, so the first
    // (throwaway) instance's canvas is still sitting in the DOM by the time
    // this effect re-runs and creates a second instance — two canvases end
    // up stacked in the same container, and only one of them ever receives
    // live game-state updates, which is what made pawn selection feel like
    // it only worked in a seemingly arbitrary spot. Forcibly clearing any
    // stray canvas before creating a new game sidesteps that race instead of
    // depending on Phaser's own (slow, async) teardown for DOM cleanliness.
    container.querySelectorAll("canvas").forEach((c) => c.remove());

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: container,
      transparent: true,
      scale: {
        // RESIZE (rather than FIT) makes the canvas always exactly match the
        // container's real pixel size — no letterbox bars from a CSS-scaled
        // fixed-resolution canvas. MatchScene handles fitting the fixed-size
        // isometric world into whatever that size turns out to be, so the
        // pitch fills any device's screen/window shape instead of always
        // rendering at one aspect ratio.
        mode: Phaser.Scale.RESIZE,
        width: container.clientWidth || VIEW_W,
        height: container.clientHeight || VIEW_H,
      },
      // Phaser defaults to ALSO listening on the window (not just the
      // canvas) so a drag-release outside the canvas still registers — but
      // that means a click that starts AND ends on an HTML element floating
      // on top of the canvas (the HUD's action-panel buttons) still bubbles
      // up to Phaser's window listener and gets misread as a field click at
      // whatever pitch position happens to project to that pixel. Nothing
      // in this game needs off-canvas drag-release detection (camera orbit
      // is handled entirely by Game.tsx's own mouse handlers, not Phaser's
      // input), so scoping input strictly to the canvas fixes the HUD/pitch
      // click conflict with no loss of functionality.
      input: { windowEvents: false },
      scene: [MatchScene],
    };
    const game = new Phaser.Game(config);
    gameRef.current = game;

    if (typeof ref === "function") ref({ game });
    else if (ref) ref.current = { game };

    return () => {
      game.destroy(true);
      if (gameRef.current === game) gameRef.current = null;
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
