import { api } from '../api';
import type { LiveInfo } from '../hooks/useLive';
import type { Filters } from '../types';
import type { Voz } from '../voz';
import ExportMenu from './ExportMenu';
import LiveBadge from './LiveBadge';
import TamanhoTexto from './TamanhoTexto';
import ThemeToggle from './ThemeToggle';
import VozMenu from './VozMenu';

// Faixa verde do topo: título, "Ao vivo", narração, exportações, tamanho do
// texto, atalhos, tema e sessão.
export default function Cabecalho({
  live,
  voz,
  filters,
  user,
  onLogout,
  onAtalhos,
}: {
  live: LiveInfo;
  voz: Voz;
  filters: Filters;
  user: string;
  onLogout: () => void;
  onAtalhos: () => void;
}) {
  async function logout() {
    await api.logout().catch(() => {
      /* ignora: seguimos deslogando o cliente de qualquer forma */
    });
    onLogout();
  }

  return (
    <header className="header">
      <div className="header-title">
        <h1>Omni-Root · Qualidade da Madeira</h1>
        <span className="subtitle">
          Inspeções sincronizadas do campo — leitura do banco central
        </span>
      </div>
      <div className="header-actions">
        <LiveBadge info={live} />
        <VozMenu voz={voz} />
        <ExportMenu filters={filters} onUnauthorized={onLogout} />
        <TamanhoTexto />
        <button
          type="button"
          className="btn theme-btn btn-atalhos"
          onClick={onAtalhos}
          title="Teclas de atalho (tecla ?)"
          aria-label="Mostrar as teclas de atalho"
        >
          <span aria-hidden="true">⌨</span>
        </button>
        <ThemeToggle />
        <span className="user-chip" title="Usuário autenticado">
          {user}
          <button type="button" className="chip-link" onClick={logout}>
            Sair
          </button>
        </span>
      </div>
    </header>
  );
}
