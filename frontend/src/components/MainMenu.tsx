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
      <p className="menu-subtitle">Futebol tático por turnos</p>
      <div className="menu-options">
        <button type="button" className="menu-button" onClick={onStartHotseat}>
          Multiplayer local
          <span className="menu-button-desc">Dois jogadores no mesmo computador, revezando o controle de cada time</span>
        </button>
        <button type="button" className="menu-button" onClick={onStartAi}>
          Jogar contra a IA
          <span className="menu-button-desc">Você controla o time da casa contra um adversário controlado pelo computador</span>
        </button>
        <button type="button" className="menu-button" onClick={onStartSolo}>
          Modo solo (testes)
          <span className="menu-button-desc">Só você jogando — o time adversário fica parado, pra testar a mecânica sem interferência</span>
        </button>
      </div>
    </div>
  );
}
