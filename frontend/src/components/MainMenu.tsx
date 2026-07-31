import "./menu.css";

interface Props {
  onStartHotseat: () => void;
  onStartAi: () => void;
  onStartSolo: () => void;
}

export function MainMenu({ onStartHotseat, onStartAi, onStartSolo }: Props) {
  return (
    <div className="menu-wrapper">
      <h1>EagleEye Interactive</h1>
      <p className="menu-subtitle">Turn-based tactical soccer</p>
      <div className="menu-options">
        <button type="button" className="menu-button" onClick={onStartHotseat}>
          Local multiplayer
          <span className="menu-button-desc">Two players on the same computer, taking turns controlling each team</span>
        </button>
        <button type="button" className="menu-button" onClick={onStartAi}>
          Play against AI
          <span className="menu-button-desc">You control the home team against a computer-controlled opponent</span>
        </button>
        <button type="button" className="menu-button" onClick={onStartSolo}>
          Solo mode (testing)
          <span className="menu-button-desc">Just you playing — the opposing team stays put, for testing the mechanics without interference</span>
        </button>
      </div>
    </div>
  );
}
