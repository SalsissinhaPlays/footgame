import { useEffect, useState } from "react";
import { fetchPlayers } from "../../game/api";
import { createPlayer, deletePlayer, fetchSaveTeams, transferPlayer, updatePlayer } from "../../game/careerApi";
import type { PlayerDTO, TeamDTO } from "../../game/types";
import { FormationEditor } from "./FormationEditor";
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
 * Two-pane replacement for the old all-attributes-in-one-editable-row grid
 * (which read as a wall of tiny boxes) — player names on the left, the
 * selected player's full attribute breakdown on the right. Only one
 * player's edit state exists at a time (keyed by selection), so switching
 * players can't leave a half-edited row's state bleeding into another.
 */
export function TeamManagement({ saveId, teamId, onBack }: Props) {
  const [players, setPlayers] = useState<PlayerDTO[]>([]);
  const [otherTeams, setOtherTeams] = useState<TeamDTO[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [page, setPage] = useState<TeamManagementPage>("attributes");
  const pageIndex = PAGES.indexOf(page);

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

  const selected = players.find((p) => p.id === selectedId) ?? null;

  function pageAt(offset: number): TeamManagementPage {
    const next = (pageIndex + offset + PAGES.length) % PAGES.length;
    return PAGES[next];
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

      {page === "attributes" ? (
        <div className="career-team-mgmt">
          <div className="career-team-mgmt-list">
            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`career-team-mgmt-list-item${p.id === selectedId ? " selected" : ""}`}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="career-team-mgmt-list-pos">{p.position}</span>
                <span className="career-team-mgmt-list-name">
                  #{p.jersey_number} {p.name}
                </span>
              </button>
            ))}
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
        </div>
      ) : (
        <FormationEditor teamId={teamId} />
      )}
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
