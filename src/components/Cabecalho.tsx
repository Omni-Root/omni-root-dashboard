import { api } from '../api';
import type { LiveInfo } from '../hooks/useLive';
import type { Filters } from '../types';
import type { Voz } from '../voz';
import ExportMenu from './ExportMenu';
import LiveBadge from './LiveBadge';
import ThemeToggle from './ThemeToggle';
import VozMenu from './VozMenu';

// Faixa verde do topo: título, "Ao vivo", narração, exportações, tema e sessão.
export default function Cabecalho({
  live,
  voz,
  filters,
  user,
  onLogout,
}: {
  live: LiveInfo;
  voz: Voz;
  filters: Filters;
  user: string;
  onLogout: () => void;
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
