import "./menu.css";

interface Props {
  onStartHotseat: () => void;
  onStartAi: () => void;
  onStartSolo: () => void;
  onOpenCareer: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function MainMenu({ onStartHotseat, onStartAi, onStartSolo, onOpenCareer, isFullscreen, onToggleFullscreen }: Props) {
  return (
    <div className="menu-wrapper">
      <button type="button" className="menu-fullscreen-btn" onClick={onToggleFullscreen}>
        {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      </button>
      <h1>EagleEye Studio</h1>
      <p className="menu-subtitle">Turn-based tactical soccer</p>
      <div className="menu-options">
        <button type="button" className="menu-button" onClick={onOpenCareer}>
          Career
          <span className="menu-button-desc">Create saves, build rosters, run leagues, and make transfers — including actually playing your league fixtures.</span>
        </button>
        <button type="button" className="menu-button" onClick={onStartHotseat}>
          Local multiplayer
          <span className="menu-button-desc">Two players on the same computer, taking turns controlling each team</span>
        </button>
        <button type="button" className="menu-button" onClick={onStartAi}>
          Play against AI
          <span className="menu-button-desc">You control the home team against a computer-controlled opponent</span>
        </button>
        <button type="button" className="menu-button" onClick={onStartSolo}>
          Team Management (testing)
          <span className="menu-button-desc">Create, place, delete, and edit players — build custom rosters and test matches. The foundation of the future Team Management tool.</span>
        </button>
      </div>
    </div>
  );
}
