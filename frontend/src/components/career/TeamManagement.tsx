import { useEffect, useState } from "react";
import { fetchPlayers } from "../../game/api";
import { createPlayer, deletePlayer, fetchSaveTeams, fetchTeamLineup, transferPlayer, updatePlayer } from "../../game/careerApi";
import { FORMATION_7V7_DEFAULT } from "../../game/formations";
import type { PlayerDTO, TeamDTO } from "../../game/types";
import { FormationEditor } from "./FormationEditor";
import type { EditorSlot } from "./FormationEditor";
import "./career.css";

type TeamManagementPage = "attributes" | "formation";
const PAGES: TeamManagementPage[] = ["attributes", "formation"];

const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const ATTRS: Array<{ key: keyof PlayerDTO & string; label: string }> = [
  { key: "pace", label: "Pace" },
  { key: "stamina", label: "Stamina" },
  { key: "skill", label: "Skill" },
  { key: "jumping", label: "Jumping" },
  { key: "shot_stopping", label: "Shot stopping" },
  { key: "reflexes", label: "Reflexes" },
  { key: "heading", label: "Heading" },
];

interface Props {
  saveId: number;
  teamId: number;
  onBack: () => void;
}

/**
 * Two-pane, two-PAGE screen: player names always on the left (never
 * remounted by paging — only its sort order and interaction set change),
 * the right pane paged via side arrows between "Attributes" (a selected
 * player's full attribute breakdown — the original, only page this screen
 * had) and "Formation" (the pitch — see FormationEditor.tsx). The list is
 * shared rather than each page owning its own, per an explicit user call:
 * switching pages should feel like changing what you're looking AT, not
 * navigating to a different screen — and a player's starting/bench status
 * (this component's own `slots` state, not FormationEditor's) is relevant
 * context on BOTH pages, not just Formation's, so starters always sort to
 * the top of the list regardless of which page is showing.
 */
export function TeamManagement({ saveId, teamId, onBack }: Props) {
  const [players, setPlayers] = useState<PlayerDTO[]>([]);
  const [otherTeams, setOtherTeams] = useState<TeamDTO[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [page, setPage] = useState<TeamManagementPage>("attributes");
  const pageIndex = PAGES.indexOf(page);
  // The base lineup/formation (see FormationEditor.tsx) — lives here, not in
  // FormationEditor itself, specifically so the shared list above can read
  // and mutate it too (right-click/drag on a list row has to reach the same
  // state the pitch's own drag/right-click reaches).
  const [slots, setSlots] = useState<EditorSlot[]>([]);

  // Defaults to true: on mount selectedId is still null, and no player ever
  // has id === null, so the fallback to list[0] below fires correctly
  // regardless — letting the mount effect call this with no argument keeps
  // it eligible for the same `useEffect(reload, [deps])` shape the rest of
  // this codebase uses (passing the function directly, not a wrapper
  // closure, sidesteps the exhaustive-deps lint on a same-render function
  // reference).
  function reload(keepSelection: boolean = true) {
    fetchPlayers(teamId)
      .then((list) => {
        setPlayers(list);
        setSelectedId((current) => (keepSelection && list.some((p) => p.id === current) ? current : (list[0]?.id ?? null)));
      })
      .catch((e) => setError(String(e.message ?? e)));
    fetchSaveTeams(saveId)
      .then((teams) => setOtherTeams(teams.filter((t) => t.id !== teamId)))
      .catch((e) => setError(String(e.message ?? e)));
  }

  useEffect(reload, [saveId, teamId]);

  // The saved lineup only ever needs (re)loading once per team, unlike
  // `reload` above (which also re-runs after routine player edits) — a
  // player editing an attribute shouldn't discard in-progress, unsaved
  // formation edits.
  useEffect(() => {
    fetchPlayers(teamId).then((roster) => {
      fetchTeamLineup(teamId)
        .then((dto) => {
          if (dto.slots && dto.slots.length > 0) {
            setSlots(dto.slots.map((s) => ({ position: s.position, pos: s.pos, playerId: s.playerId })));
          } else {
            // No saved lineup yet — default to the same shape/matching rule
            // buildFormation's own assignSlots already uses, so an unsaved
            // team starts from a sensible shape instead of an empty pitch.
            const remaining = [...roster];
            setSlots(
              FORMATION_7V7_DEFAULT.slots.map((slot) => {
                const matchIndex = remaining.findIndex((p) => p.position === slot.position);
                const index = matchIndex !== -1 ? matchIndex : 0;
                const [player] = remaining.length > 0 ? remaining.splice(index, 1) : [undefined];
                return { position: slot.position, pos: { ...slot.pos }, playerId: player?.id ?? null };
              })
            );
          }
        })
        .catch((e) => setError(String(e.message ?? e)));
    });
  }, [teamId]);

  const selected = players.find((p) => p.id === selectedId) ?? null;
  const startingIds = new Set(slots.map((s) => s.playerId).filter((id): id is number => id != null));
  // Starters first (in slot/formation order), then the rest of the roster —
  // the "priority" ordering that's the whole point of sharing this list
  // across both pages, so a starter never needs hunting for.
  const sortedPlayers = [
    ...slots.map((s) => players.find((p) => p.id === s.playerId)).filter((p): p is PlayerDTO => p != null),
    ...players.filter((p) => !startingIds.has(p.id)),
  ];

  function pageAt(offset: number): TeamManagementPage {
    const next = (pageIndex + offset + PAGES.length) % PAGES.length;
    return PAGES[next];
  }

  function vacateSlotForPlayer(playerId: number) {
    setSlots((prev) => prev.map((s) => (s.playerId === playerId ? { ...s, playerId: null } : s)));
  }

  function fillNextOpenSlot(player: PlayerDTO) {
    setSlots((prev) => {
      const positionMatch = prev.findIndex((s) => s.playerId == null && s.position === player.position);
      const index = positionMatch !== -1 ? positionMatch : prev.findIndex((s) => s.playerId == null);
      if (index === -1) return prev; // no open slot — full squad already selected
      return prev.map((s, i) => (i === index ? { ...s, playerId: player.id } : s));
    });
  }

  function swapIntoSlot(targetPlayerId: number, incoming: PlayerDTO) {
    setSlots((prev) => prev.map((s) => (s.playerId === targetPlayerId ? { ...s, playerId: incoming.id } : s)));
  }

  function repositionSlot(playerId: number, point: { x: number; y: number }) {
    setSlots((prev) => prev.map((s) => (s.playerId === playerId ? { ...s, pos: point } : s)));
  }

  function handleDragOverAllow(e: React.DragEvent) {
    e.preventDefault();
  }

  function readDraggedPlayerId(e: React.DragEvent): PlayerDTO | null {
    const id = Number(e.dataTransfer.getData("text/player-id"));
    if (!id) return null;
    const player = players.find((p) => p.id === id);
    return player && !startingIds.has(id) ? player : null;
  }

  return (
    <div className="career-page career-page-wide">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Club
        </button>
        <h1>Team Management</h1>
      </div>

      <div className="career-team-mgmt-header">
        <button type="button" className="career-page-arrow" onClick={() => setPage(pageAt(-1))} aria-label="Previous page">
          ←
        </button>
        <h2 style={{ margin: 0 }}>{page === "attributes" ? "Attributes" : "Formation"}</h2>
        <button type="button" className="career-page-arrow" onClick={() => setPage(pageAt(1))} aria-label="Next page">
          →
        </button>
        <div className="career-page-dots">
          {PAGES.map((p) => (
            <span key={p} className={`career-page-dot${p === page ? " active" : ""}`} />
          ))}
        </div>
      </div>

      {error && <p className="career-error">{error}</p>}
      {page === "formation" && (
        <p className="career-muted">
          {startingIds.size}/{slots.length} selected. Drag a bench name onto the pitch to bring them on, or onto a
          starter to swap directly. Right-click toggles a player on/off the pitch. Drag an on-pitch player to
          reposition them.
        </p>
      )}

      <div className="career-team-mgmt">
        <div className="career-team-mgmt-list">
          {sortedPlayers.map((p) => {
            const isStarting = startingIds.has(p.id);
            const isFormationPage = page === "formation";
            return (
              <button
                key={p.id}
                type="button"
                className={`career-team-mgmt-list-item${isStarting ? " starting" : ""}${!isFormationPage && p.id === selectedId ? " selected" : ""}`}
                onClick={isFormationPage ? undefined : () => setSelectedId(p.id)}
                draggable={isFormationPage && !isStarting}
                onDragStart={
                  isFormationPage && !isStarting ? (e) => e.dataTransfer.setData("text/player-id", String(p.id)) : undefined
                }
                onDragOver={isFormationPage && isStarting ? handleDragOverAllow : undefined}
                onDrop={
                  isFormationPage && isStarting
                    ? (e) => {
                        e.preventDefault();
                        const incoming = readDraggedPlayerId(e);
                        if (incoming) swapIntoSlot(p.id, incoming);
                      }
                    : undefined
                }
                onContextMenu={
                  isFormationPage
                    ? (e) => {
                        e.preventDefault();
                        if (isStarting) vacateSlotForPlayer(p.id);
                        else fillNextOpenSlot(p);
                      }
                    : undefined
                }
              >
                <span className="career-team-mgmt-list-pos">{p.position}</span>
                <span className="career-team-mgmt-list-name">
                  #{p.jersey_number} {p.name}
                </span>
              </button>
            );
          })}
          <button type="button" className="career-team-mgmt-list-add" onClick={() => setAddingPlayer((v) => !v)}>
            {addingPlayer ? "Cancel" : "+ Add player"}
          </button>
          {addingPlayer && (
            <NewPlayerForm
              teamId={teamId}
              onCreated={() => {
                setAddingPlayer(false);
                reload(false);
              }}
              onError={setError}
            />
          )}
        </div>

        {page === "attributes" ? (
          <div className="career-team-mgmt-detail">
            {selected ? (
              <PlayerDetail
                key={selected.id}
                player={selected}
                otherTeams={otherTeams}
                onChanged={() => reload(true)}
                onDeleted={() => reload(false)}
                onError={setError}
              />
            ) : (
              <p className="career-empty">No players yet — add one on the left.</p>
            )}
          </div>
        ) : (
          <FormationEditor
            teamId={teamId}
            players={players}
            slots={slots}
            onReposition={repositionSlot}
            onVacate={vacateSlotForPlayer}
            onFillNextOpenSlot={fillNextOpenSlot}
          />
        )}
      </div>
    </div>
  );
}

function PlayerDetail({
  player,
  otherTeams,
  onChanged,
  onDeleted,
  onError,
}: {
  player: PlayerDTO;
  otherTeams: TeamDTO[];
  onChanged: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const [edit, setEdit] = useState(player);
  const [transferring, setTransferring] = useState(false);
  const [toTeamId, setToTeamId] = useState<number | "">("");
  const [fee, setFee] = useState(0);

  function setField<K extends keyof PlayerDTO>(key: K, value: PlayerDTO[K]) {
    setEdit((e) => ({ ...e, [key]: value }));
  }

  async function handleSave() {
    try {
      await updatePlayer(player.id, {
        name: edit.name,
        position: edit.position,
        jersey_number: edit.jersey_number,
        age: edit.age,
        pace: edit.pace,
        stamina: edit.stamina,
        skill: edit.skill,
        jumping: edit.jumping,
        shot_stopping: edit.shot_stopping,
        reflexes: edit.reflexes,
        heading: edit.heading,
      });
      onChanged();
    } catch (e) {
      onError(String((e as Error).message ?? e));
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete ${player.name}?`)) return;
    try {
      await deletePlayer(player.id);
      onDeleted();
    } catch (e) {
      onError(String((e as Error).message ?? e));
    }
  }

  async function handleTransfer() {
    if (toTeamId === "") return;
    try {
      await transferPlayer(player.id, toTeamId, fee);
      onChanged();
    } catch (e) {
      onError(String((e as Error).message ?? e));
    }
  }

  return (
    <div>
      <div className="career-player-detail-header">
        <input type="text" value={edit.name} onChange={(e) => setField("name", e.target.value)} />
        <select value={edit.position} onChange={(e) => setField("position", e.target.value)}>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="career-attr-label">
          #
          <input
            type="number"
            value={edit.jersey_number}
            onChange={(e) => setField("jersey_number", Number(e.target.value))}
          />
        </label>
        <label className="career-attr-label">
          Age
          <input type="number" min={16} value={edit.age} onChange={(e) => setField("age", Number(e.target.value))} />
        </label>
      </div>

      <div className="career-player-detail-attrs">
        {ATTRS.map(({ key, label }) => (
          <label key={key} className="career-attr-row">
            <span>{label}</span>
            <input type="number" min={0} max={99} value={edit[key]} onChange={(e) => setField(key, Number(e.target.value))} />
          </label>
        ))}
      </div>

      <div className="career-player-actions">
        <button type="button" className="career-btn-small career-btn-primary" onClick={handleSave}>
          Save
        </button>
        <button type="button" className="career-btn-small" onClick={() => setTransferring((t) => !t)}>
          Transfer
        </button>
        <button type="button" className="career-btn-small" onClick={handleDelete}>
          Delete
        </button>
      </div>

      {transferring && (
        <div className="career-transfer-row">
          <select value={toTeamId} onChange={(e) => setToTeamId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Transfer to…</option>
            {otherTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <label className="career-attr-label">
            Fee
            <input type="number" min={0} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
          </label>
          <button type="button" className="career-btn-small career-btn-primary" onClick={handleTransfer}>
            Confirm transfer
          </button>
        </div>
      )}
    </div>
  );
}

function NewPlayerForm({
  teamId,
  onCreated,
  onError,
}: {
  teamId: number;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("MID");
  const [jerseyNumber, setJerseyNumber] = useState(1);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createPlayer(teamId, { name: trimmed, position, jersey_number: jerseyNumber });
      setName("");
      onCreated();
    } catch (e) {
      onError(String((e as Error).message ?? e));
    }
  }

  return (
    <div className="career-new-player-form">
      <input
        type="text"
        placeholder="Player name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
      />
      <select value={position} onChange={(e) => setPosition(e.target.value)}>
        {POSITIONS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input type="number" min={1} max={99} value={jerseyNumber} onChange={(e) => setJerseyNumber(Number(e.target.value))} />
      <button type="button" className="career-btn-small career-btn-primary" onClick={handleCreate}>
        Add player
      </button>
    </div>
  );
}
