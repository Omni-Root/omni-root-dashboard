import { useCallback, useEffect, useState } from 'react';
import { api, UnauthorizedError } from './api';
import LiveBadge from './components/LiveBadge';
import { useLive } from './useLive';
import FiltersBar from './components/Filters';
import Heatmap from './components/Heatmap';
import Login from './components/Login';
import ExportMenu from './components/ExportMenu';
import ThemeToggle from './components/ThemeToggle';
import ProportionDonut from './components/ProportionDonut';
import SummaryCards from './components/SummaryCards';
import TimeSeriesChart from './components/TimeSeriesChart';
import type {
  Bucket,
  Filters,
  HeatmapCell,
  Maquina,
  Status,
  SummaryRow,
  TimeseriesPoint,
} from './types';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function App() {
  // null = ainda verificando a sessão; false = deslogado; true = logado.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [user, setUser] = useState('');

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setAuthed(r.authenticated);
        setUser(r.user ?? '');
      })
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return <div className="loading">Carregando…</div>;
  }
  if (!authed) {
    return (
      <Login
        onSuccess={(u) => {
          setUser(u);
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <Dashboard
      user={user}
      onLogout={() => {
        setAuthed(false);
        setUser('');
      }}
    />
  );
}

function Dashboard({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [filters, setFilters] = useState<Filters>({
    from: isoDaysAgo(29),
    to: isoDaysAgo(0),
    maquinaId: '',
  });
  const [bucket, setBucket] = useState<Bucket>('day');
  const [heatStatuses, setHeatStatuses] = useState<Status[]>(['reprovado', 'quarentena']);

  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[] | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCell[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Incrementado a cada aviso de tora nova (SSE): força o efeito de carga a
  // rodar de novo com os mesmos filtros, sem F5.
  const [versao, setVersao] = useState(0);
  const live = useLive(useCallback(() => setVersao((v) => v + 1), []));

  async function logout() {
    await api.logout().catch(() => {
      /* ignora: seguimos deslogando o cliente de qualquer forma */
    });
    onLogout();
  }

  useEffect(() => {
    const ac = new AbortController();
    api
      .maquinas(ac.signal)
      .then(setMaquinas)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onLogout();
        /* filtro de máquina fica vazio; o erro real aparece nos painéis */
      });
    return () => ac.abort();
  }, [onLogout]);

  useEffect(() => {
    const ac = new AbortController();
    // Só mostra "Carregando…" na primeira vez; nas atualizações ao vivo os
    // painéis trocam de valor sem piscar.
    if (versao === 0) setError(null);
    Promise.all([
      api.summary(filters, ac.signal),
      api.timeseries(filters, bucket, ac.signal),
      api.heatmap(filters, heatStatuses, ac.signal),
    ])
      .then(([s, t, h]) => {
        setSummary(s);
        setTimeseries(t);
        setHeatmap(h);
        setError(null);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        if (err instanceof UnauthorizedError) {
          onLogout();
          return;
        }
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
      });
    return () => ac.abort();
  }, [filters, bucket, heatStatuses, onLogout, versao]);

  const loading = summary === null && !error;

  return (
    <div className="layout">
      <header className="header">
        <div className="header-title">
          <h1>Omni-Root · Qualidade da Madeira</h1>
          <span className="subtitle">
            Inspeções sincronizadas do campo — leitura do banco central
          </span>
        </div>
        <div className="header-actions">
          <LiveBadge info={live} />
          <ExportMenu filters={filters} onUnauthorized={onLogout} />
          <ThemeToggle />
          <span className="user-chip" title="Usuário autenticado">
            {user}
          </span>
          <button type="button" className="btn logout-btn" onClick={logout}>
            Sair
          </button>
        </div>
      </header>

      <FiltersBar filters={filters} maquinas={maquinas} onChange={setFilters} />

      {error && (
        <div className="error-banner">
          <strong>Não foi possível carregar os dados.</strong> {error} — verifique a
          conexão com o PostgreSQL central (variáveis PG_* no .env).
        </div>
      )}

      {loading && !error && <div className="loading">Carregando…</div>}

      {summary && !error && (
        <div className="grid">
          <SummaryCards rows={summary} />

          <section className="panel two-thirds">
            <div className="panel-controls">
              <div>
                <h2>Eventos ao longo do tempo</h2>
                <p className="panel-sub">Contagem por classificação em cada intervalo</p>
              </div>
              <select
                value={bucket}
                onChange={(e) => setBucket(e.target.value as Bucket)}
                aria-label="Granularidade da série temporal"
              >
                <option value="hour">Por hora</option>
                <option value="day">Por dia</option>
                <option value="week">Por semana</option>
              </select>
            </div>
            <TimeSeriesChart data={timeseries ?? []} bucket={bucket} />
          </section>

          <section className="panel third">
            <h2>Proporção por classificação</h2>
            <p className="panel-sub">Participação de cada resultado no período</p>
            <ProportionDonut rows={summary} />
          </section>

          <section className="panel">
            <h2>Mapa de calor de falhas</h2>
            <p className="panel-sub">
              Concentração por dia da semana × hora do dia (horário local da máquina)
            </p>
            <Heatmap
              cells={heatmap ?? []}
              statuses={heatStatuses}
              onStatusesChange={setHeatStatuses}
            />
          </section>
        </div>
      )}
    </div>
  );
}
