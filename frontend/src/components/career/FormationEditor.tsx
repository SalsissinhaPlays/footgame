import { useEffect, useRef, useState } from "react";
import { PhaserGame } from "../../phaser/PhaserGame";
import type { MatchScene } from "../../phaser/MatchScene";
import { saveTeamLineup } from "../../game/careerApi";
import type { LineupSlot } from "../../game/formations";
import type { Pawn, PlayerDTO, Vec2 } from "../../game/types";
import { TILT_DEFAULT, VIEW_H, VIEW_W } from "../../game/iso";
import "./career.css";

export interface EditorSlot {
  position: string;
  pos: Vec2;
  playerId: number | null;
}

function pawnIdToPlayerId(pawnId: string): number {
  return Number(pawnId.slice("home-".length));
}

interface Props {
  teamId: number;
  players: PlayerDTO[];
  slots: EditorSlot[];
  onReposition: (playerId: number, point: Vec2) => void;
  onVacate: (playerId: number) => void;
  onFillNextOpenSlot: (player: PlayerDTO) => void;
}

// A fixed "coach's eye view" — rotated so the team's own goal sits at the
// BOTTOM of the screen and the attacking direction runs up it (verified via
// a throwaway script against iso.ts's projector: at rotation=-135, the home
// GK slot (4,20) and FWD slot (22,20) land on the exact same screen-x, with
// the GK strictly below — i.e. no left-right skew, purely "own goal nearer
// you, attacking direction away from you," the same orientation any real
// tactics board uses). Nobody plans a lineup upside down. Zoomed and focused
// on the formation's own area (not the whole pitch + empty opposing half)
// for the same "no point panning around, just set the team" reasoning the
// missing pan/rotate/zoom controls already reflect.
const FIXED_CAMERA = { zoom: 2.4, rotation: -135, tilt: TILT_DEFAULT, focusX: 15, focusY: 20 };

/**
 * The Formation page's pitch — see FormationTeamManagement's own doc
 * comment (formerly this file's) for the full interaction spec. This
 * component is now purely a Phaser pawn renderer + Save button: the
 * roster/bench list (and every slot-mutation function) lives in the parent
 * (`TeamManagement.tsx`) so it can be shared, unswapped, with the
 * Attributes page's own list — this component just turns raw MatchScene
 * pawn events into calls to the callback props the parent supplies.
 */
export function FormationEditor({ teamId, players, slots, onReposition, onVacate, onFillNextOpenSlot }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sceneRef = useRef<MatchScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const handlersRef = useRef<{ onPawnDragEnd: (id: string, p: Vec2) => void; onPawnRightClick: (id: string) => void }>({
    onPawnDragEnd: () => {},
    onPawnRightClick: () => {},
  });

  const byId = new Map(players.map((p) => [p.id, p]));
  const startingIds = new Set(slots.map((s) => s.playerId).filter((id): id is number => id != null));
  const openCount = slots.filter((s) => s.playerId == null).length;

  const pawns: Pawn[] = slots
    .filter((s) => s.playerId != null)
    .map((s) => {
      const player = byId.get(s.playerId!);
      if (!player) return null;
      const pawn: Pawn = {
        id: `home-${player.id}`,
        player,
        side: "home",
        pos: s.pos,
        plannedSteps: [],
        stance: null,
        plannedSprint: false,
        sprintCooldown: 0,
        plannedTackle: null,
        tackleCooldown: 0,
      };
      return pawn;
    })
    .filter((p): p is Pawn => p != null);

  useEffect(() => {
    handlersRef.current = {
      onPawnDragEnd: (pawnId, point) => {
        onReposition(pawnIdToPlayerId(pawnId), point);
        setSaved(false);
      },
      onPawnRightClick: (pawnId) => {
        onVacate(pawnIdToPlayerId(pawnId));
        setSaved(false);
      },
    };
  });

  function handleSceneReady(scene: MatchScene) {
    sceneRef.current = scene;
    scene.setCallbacks({
      onPawnClick: () => {},
      onFieldClick: () => {},
      onPawnPointerDown: () => {},
      onPawnDragEnd: (pawnId, point) => handlersRef.current.onPawnDragEnd(pawnId, point),
      onPawnRightClick: (pawnId) => handlersRef.current.onPawnRightClick(pawnId),
    });
    setSceneReady(true);
  }

  useEffect(() => {
    if (!sceneReady) return;
    sceneRef.current?.syncState({
      pawns,
      // Parked at the same point the camera is focused on (not the true
      // pitch-center BALL_START, which sits well outside this screen's
      // zoomed-in, formation-area view) — there's no kickoff here, just
      // somewhere unobtrusive for MatchScene's required ball sprite to sit.
      ball: { pos: { x: FIXED_CAMERA.focusX, y: FIXED_CAMERA.focusY } },
      ballHeight: 0,
      selectedId: null,
      reachRadius: null,
      kickMode: false,
      kickKind: "pass",
      controllingSide: "home",
      // Fixed — deliberately never touched by any pan/rotate/zoom control,
      // which is the whole "limited movement" point of this screen.
      camera: FIXED_CAMERA,
      pawnDragEnabled: true,
    });
  });

  async function handleSave() {
    if (openCount > 0) return;
    setSaving(true);
    setError(null);
    try {
      const toSave: LineupSlot[] = slots.map((s) => ({ position: s.position, pos: s.pos, playerId: s.playerId! }));
      await saveTeamLineup(teamId, toSave);
      setSaved(true);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function readDraggedPlayerId(e: React.DragEvent): PlayerDTO | null {
    const id = Number(e.dataTransfer.getData("text/player-id"));
    if (!id) return null;
    const player = byId.get(id);
    return player && !startingIds.has(id) ? player : null;
  }

  return (
    <div className="career-formation-pitch-col">
      <div
        className="career-formation-pitch field-viewport"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const incoming = readDraggedPlayerId(e);
          if (incoming) {
            onFillNextOpenSlot(incoming);
            setSaved(false);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <PhaserGame onSceneReady={handleSceneReady} />
        {!sceneReady && <p className="hint">Loading the pitch...</p>}
      </div>

      <div className="career-formation-actions">
        {error && <p className="career-error">{error}</p>}
        <button type="button" className="career-home-button" disabled={saving || openCount > 0} onClick={handleSave}>
          {saving ? "Saving…" : saved ? "Saved" : "Save Formation"}
        </button>
        {openCount > 0 && <p className="career-muted">Fill all {slots.length} spots before saving.</p>}
      </div>
    </div>
  );
}
