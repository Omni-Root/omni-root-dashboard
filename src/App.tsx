import { useEffect, useState } from 'react';
import { api } from './api';
import FiltersBar from './components/Filters';
import Heatmap from './components/Heatmap';
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

  useEffect(() => {
    const ac = new AbortController();
    api
      .maquinas(ac.signal)
      .then(setMaquinas)
      .catch(() => {
        /* filtro de máquina fica vazio; o erro real aparece nos painéis */
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    Promise.all([
      api.summary(filters, ac.signal),
      api.timeseries(filters, bucket, ac.signal),
      api.heatmap(filters, heatStatuses, ac.signal),
    ])
      .then(([s, t, h]) => {
        setSummary(s);
        setTimeseries(t);
        setHeatmap(h);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
      });
    return () => ac.abort();
  }, [filters, bucket, heatStatuses]);

  const loading = summary === null && !error;

  return (
    <div className="layout">
      <header className="header">
        <h1>Omni-Root · Qualidade da Madeira</h1>
        <span className="subtitle">
          Inspeções sincronizadas do campo — leitura do banco central
        </span>
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
