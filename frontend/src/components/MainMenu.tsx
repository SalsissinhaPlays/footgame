import "./menu.css";

interface Props {
  onStartHotseat: () => void;
}

export function MainMenu({ onStartHotseat }: Props) {
  return (
    <div className="menu-wrapper">
      <h1>EagleEye Interactive</h1>
      <p className="menu-subtitle">Futebol tático por turnos</p>
      <div className="menu-options">
        <button type="button" className="menu-button" onClick={onStartHotseat}>
          Multiplayer local
          <span className="menu-button-desc">Dois jogadores no mesmo computador, revezando o controle de cada time</span>
        </button>
        <button type="button" className="menu-button" disabled>
          Jogar contra a IA
          <span className="menu-button-desc">Em breve</span>
        </button>
      </div>
    </div>
  );
}
