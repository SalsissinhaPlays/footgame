import { useEffect, useRef, useState } from "react";
import { PhaserGame } from "../../phaser/PhaserGame";
import type { MatchScene } from "../../phaser/MatchScene";
import { fetchPlayers } from "../../game/api";
import { fetchTeamLineup, saveTeamLineup } from "../../game/careerApi";
import type { LineupSlot } from "../../game/formations";
import { FORMATION_6V6_DEFAULT } from "../../game/formations";
import type { Pawn, PlayerDTO, Vec2 } from "../../game/types";
import { TILT_DEFAULT, VIEW_H, VIEW_W } from "../../game/iso";
import { GRID_COLS, GRID_ROWS, BALL_START } from "../../game/constants";
import "./career.css";

interface Props {
  teamId: number;
}

interface EditorSlot {
  position: string;
  pos: Vec2;
  playerId: number | null;
}

function pawnIdToPlayerId(pawnId: string): number {
  return Number(pawnId.slice("home-".length));
}

/**
 * The Team Management "Formation" page (reached via TeamManagement.tsx's
 * side arrows) — a static, non-match Phaser pitch showing this team's
 * saved base lineup, with the exact pawn-drag primitive the Team
 * Management sandbox (mode="solo") already uses for free-form pawn
 * placement, reused here to let the player set a real, persisted base
 * formation instead of a throwaway one. Deliberately reuses PhaserGame +
 * MatchScene wholesale rather than a second bespoke renderer — the camera
 * here just never gets any pan/rotate/zoom controls wired up (unlike
 * Game.tsx's match view), which is what gives the "limited movement, this
 * is about setting the team, not panning around" feel with zero MatchScene
 * changes.
 *
 * Interactions (all toggle/swap, never a straight add — the roster's 12
 * players are always exactly 6 starters + 6 bench, so bringing one on
 * always means benching another first, or swapping directly):
 * - Drag an on-pitch pawn: repositions them (MatchScene's own existing
 *   onPawnDragEnd, bounds-checked by MatchScene itself).
 * - Right-click an on-pitch pawn (new MatchScene onPawnRightClick, see
 *   that file) or a starter's row in the list: benches them.
 * - Right-click a bench row: brings them on, into the first open slot
 *   whose saved `position` matches theirs (falling back to any open slot).
 * - Drag a bench row onto the pitch canvas: same as right-clicking it.
 * - Drag a bench row onto a specific starter's row: a direct 1-for-1 swap
 *   into that exact slot, rather than "next open."
 */
export function FormationEditor({ teamId }: Props) {
  const [roster, setRoster] = useState<PlayerDTO[]>([]);
  const [slots, setSlots] = useState<EditorSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sceneRef = useRef<MatchScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  // Same "attach once, stay fresh via a ref" shape Game.tsx's own
  // handlersRef uses — MatchScene's callbacks are wired once when the scene
  // mounts, but need to see this render's latest slots/roster.
  const handlersRef = useRef<{ onPawnDragEnd: (id: string, p: Vec2) => void; onPawnRightClick: (id: string) => void }>({
    onPawnDragEnd: () => {},
    onPawnRightClick: () => {},
  });

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchPlayers(teamId), fetchTeamLineup(teamId)])
      .then(([players, lineupDto]) => {
        setRoster(players);
        if (lineupDto.slots && lineupDto.slots.length > 0) {
          setSlots(lineupDto.slots.map((s) => ({ position: s.position, pos: s.pos, playerId: s.playerId })));
        } else {
          // No saved lineup yet — default to the same shape/matching rule
          // buildFormation's own assignSlots already uses, so an unsaved
          // team starts from a sensible shape instead of an empty pitch.
          const remaining = [...players];
          const defaultSlots: EditorSlot[] = FORMATION_6V6_DEFAULT.slots.map((slot) => {
            const matchIndex = remaining.findIndex((p) => p.position === slot.position);
            const index = matchIndex !== -1 ? matchIndex : 0;
            const [player] = remaining.length > 0 ? remaining.splice(index, 1) : [undefined];
            return { position: slot.position, pos: { ...slot.pos }, playerId: player?.id ?? null };
          });
          setSlots(defaultSlots);
        }
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [teamId]);

  const byId = new Map(roster.map((p) => [p.id, p]));
  const startingIds = new Set(slots.map((s) => s.playerId).filter((id): id is number => id != null));
  const bench = roster.filter((p) => !startingIds.has(p.id));
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

  function vacateSlotForPlayer(playerId: number) {
    setSlots((prev) => prev.map((s) => (s.playerId === playerId ? { ...s, playerId: null } : s)));
    setSaved(false);
  }

  function fillNextOpenSlot(player: PlayerDTO) {
    setSlots((prev) => {
      const positionMatch = prev.findIndex((s) => s.playerId == null && s.position === player.position);
      const index = positionMatch !== -1 ? positionMatch : prev.findIndex((s) => s.playerId == null);
      if (index === -1) return prev; // no open slot — full squad already selected
      return prev.map((s, i) => (i === index ? { ...s, playerId: player.id } : s));
    });
    setSaved(false);
  }

  function swapIntoSlot(targetPlayerId: number, incoming: PlayerDTO) {
    setSlots((prev) => prev.map((s) => (s.playerId === targetPlayerId ? { ...s, playerId: incoming.id } : s)));
    setSaved(false);
  }

  useEffect(() => {
    handlersRef.current = {
      onPawnDragEnd: (pawnId, point) => {
        const playerId = pawnIdToPlayerId(pawnId);
        setSlots((prev) => prev.map((s) => (s.playerId === playerId ? { ...s, pos: point } : s)));
        setSaved(false);
      },
      onPawnRightClick: (pawnId) => vacateSlotForPlayer(pawnIdToPlayerId(pawnId)),
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
      ball: { pos: BALL_START },
      ballHeight: 0,
      selectedId: null,
      reachRadius: null,
      kickMode: false,
      kickKind: "pass",
      controllingSide: "home",
      // Fixed — deliberately never touched by any pan/rotate/zoom control,
      // which is the whole "limited movement" point of this screen.
      camera: { zoom: 1, rotation: 0, tilt: TILT_DEFAULT, focusX: GRID_COLS / 2, focusY: GRID_ROWS / 2 },
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

  function handleDragOverAllow(e: React.DragEvent) {
    e.preventDefault();
  }

  function readDraggedPlayerId(e: React.DragEvent): PlayerDTO | null {
    const id = Number(e.dataTransfer.getData("text/player-id"));
    if (!id) return null;
    const player = byId.get(id);
    return player && !startingIds.has(id) ? player : null;
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div className="career-formation-editor">
      <div className="career-formation-roster">
        <p className="career-muted">
          {slots.length - openCount}/{slots.length} selected. Drag a bench name onto the pitch to bring them on, or
          onto a starter to swap directly. Right-click toggles a player on/off the pitch. Drag an on-pitch player to
          reposition them.
        </p>

        {slots.map((s, i) =>
          s.playerId != null ? (
            <div
              key={`slot-${i}`}
              className="career-formation-row starter"
              onDragOver={handleDragOverAllow}
              onDrop={(e) => {
                e.preventDefault();
                const incoming = readDraggedPlayerId(e);
                if (incoming) swapIntoSlot(s.playerId!, incoming);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                vacateSlotForPlayer(s.playerId!);
              }}
            >
              <span className="career-formation-pos">{byId.get(s.playerId)?.position}</span>
              <span className="career-formation-name">
                #{byId.get(s.playerId)?.jersey_number} {byId.get(s.playerId)?.name}
              </span>
            </div>
          ) : (
            <div key={`slot-${i}`} className="career-formation-row empty">
              <span className="career-formation-pos">{s.position}</span>
              <span className="career-formation-name career-muted">Open spot</span>
            </div>
          )
        )}

        <div className="career-formation-bench-label">Bench</div>
        {bench.map((p) => (
          <div
            key={p.id}
            className="career-formation-row bench"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/player-id", String(p.id))}
            onContextMenu={(e) => {
              e.preventDefault();
              fillNextOpenSlot(p);
            }}
          >
            <span className="career-formation-pos">{p.position}</span>
            <span className="career-formation-name">
              #{p.jersey_number} {p.name}
            </span>
          </div>
        ))}
      </div>

      <div className="career-formation-pitch-col">
        <div
          className="career-formation-pitch field-viewport"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
          onDragOver={handleDragOverAllow}
          onDrop={(e) => {
            e.preventDefault();
            const incoming = readDraggedPlayerId(e);
            if (incoming) fillNextOpenSlot(incoming);
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
    </div>
  );
}
