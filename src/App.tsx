import { useCallback, useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError } from './api';
import LiveBadge from './components/LiveBadge';
import VozMenu, { Narrador } from './components/VozMenu';
import { useLive } from './useLive';
import { descreverInspecao, descreverResumo, useVoz } from './voz';
import CameraAoVivo from './components/CameraAoVivo';
import FiltersBar from './components/Filters';
import Heatmap from './components/Heatmap';
import Histograma from './components/Histograma';
import QualidadeTalhao from './components/QualidadeTalhao';
import UltimaInspecao from './components/UltimaInspecao';
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
  Qualidade,
  Status,
  SummaryRow,
  TimeseriesPoint,
  UltimaInspecao as Ultima,
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
  // Acumulado: cada ponto soma tudo até ali — a linha só sobe. É o modo que
  // "constrói" o gráfico ao vivo durante a demonstração.
  const [acumulado, setAcumulado] = useState(false);
  const [heatStatuses, setHeatStatuses] = useState<Status[]>(['reprovado', 'quarentena']);

  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[] | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapCell[] | null>(null);
  const [ultima, setUltima] = useState<Ultima | null>(null);
  const [qualidade, setQualidade] = useState<Qualidade | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Incrementado a cada aviso de tora nova (SSE): força o efeito de carga a
  // rodar de novo com os mesmos filtros, sem F5.
  const [versao, setVersao] = useState(0);
  const live = useLive(useCallback(() => setVersao((v) => v + 1), []));
  const voz = useVoz();

  // Alerta falado: quando a "última inspeção" muda DEPOIS da primeira carga,
  // anuncia conforme a preferência (todas / só falhas / nenhuma). Numa
  // rajada do sync (várias toras de uma vez) fala quantas chegaram e
  // descreve só a última — sem enfileirar dezenas de frases.
  const ultimaAnunciada = useRef<number | null>(null);
  const novasVistas = useRef(0);
  useEffect(() => {
    if (!ultima) return;
    if (ultimaAnunciada.current === null) {
      ultimaAnunciada.current = ultima.id; // primeira carga: não anuncia
      novasVistas.current = live.novas;
      return;
    }
    if (ultima.id === ultimaAnunciada.current) return;
    ultimaAnunciada.current = ultima.id;
    const chegaram = Math.max(1, live.novas - novasVistas.current);
    novasVistas.current = live.novas;

    const politica = voz.prefs.anunciar;
    if (politica === 'nenhuma') return;
    if (politica === 'falhas' && ultima.status === 'aprovado') return;
    const prefixo = chegaram > 1 ? `${chegaram} novas inspeções sincronizadas. Última: ` : 'Nova inspeção. ';
    voz.falar(prefixo + descreverInspecao(ultima));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultima?.id]);

  const maquinaFiltrada = maquinas.find((m) => String(m.id) === filters.maquinaId)?.numero_serie ?? null;
  const lerResumo = () => {
    if (summary) voz.falar(descreverResumo(summary, filters.from, filters.to, maquinaFiltrada), { forcar: true });
  };
  const lerUltima = () => {
    if (ultima) voz.falar(descreverInspecao(ultima, true), { forcar: true });
  };

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
      api.ultima(filters, ac.signal),
      api.qualidade(filters, ac.signal),
    ])
      .then(([s, t, h, u, q]) => {
        setSummary(s);
        setTimeseries(t);
        setHeatmap(h);
        setUltima(u);
        setQualidade(q);
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

  // Banco caiu (500 nas rotas) ou servidor reiniciou: em vez de ficar parado
  // no erro até um F5, sonda /api/health a cada 5 s e recarrega sozinho
  // quando o banco responde de novo. `tentativas` aparece no banner.
  const [tentativas, setTentativas] = useState(0);
  useEffect(() => {
    if (!error) {
      setTentativas(0);
      return;
    }
    let ativo = true;
    const t = setInterval(async () => {
      const ok = await api.health();
      if (!ativo) return;
      if (ok) setVersao((v) => v + 1);
      else setTentativas((n) => n + 1);
    }, 5000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [error]);

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

      <FiltersBar filters={filters} maquinas={maquinas} onChange={setFilters} />
      <Narrador texto={voz.ultimoTexto} />

      {error && (
        <div className="error-banner" role="status">
          <strong>Não foi possível carregar os dados.</strong> {error} — verifique a
          conexão com o PostgreSQL central (variáveis PG_* no .env).
          <span className="error-retry">
            {' '}
            Tentando de novo a cada 5 s{tentativas > 0 ? ` (${tentativas}× sem resposta)` : ''}… os
            painéis voltam sozinhos quando o banco responder.
          </span>
        </div>
      )}

      {loading && !error && <div className="loading">Carregando…</div>}

      {summary && !error && (
        <div className="grid">
          <section className="panel panel-camera third">
            <h2>Câmera ao vivo</h2>
            <p className="panel-sub">O que a garra está vendo agora — só enquanto a máquina tem rede</p>
            <CameraAoVivo maquinas={maquinas} filtroMaquinaId={filters.maquinaId} />
          </section>

          <section className="panel panel-ultima two-thirds">
            <div className="panel-controls">
              <div>
                <h2>Última inspeção recebida do campo</h2>
                <p className="panel-sub">
                  Indicadores da tora mais recente — atualiza sozinho quando a máquina sincroniza
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ler"
                onClick={lerUltima}
                disabled={!ultima || !voz.suportado}
                title="Ler em voz alta os indicadores desta tora"
              >
                <span aria-hidden="true">🔊</span> Ler
              </button>
            </div>
            <UltimaInspecao u={ultima} />
          </section>

          <div className="cards-wrap">
            <div className="cards-head">
              <span className="cards-titulo">Resumo do período</span>
              <button
                type="button"
                className="btn btn-ler"
                onClick={lerResumo}
                disabled={!voz.suportado}
                title="Ler em voz alta o resumo do período filtrado"
              >
                <span aria-hidden="true">🔊</span> Ler resumo
              </button>
            </div>
            <SummaryCards rows={summary} />
          </div>

          <section className="panel">
            <h2>Qualidade da madeira por talhão e clone</h2>
            <p className="panel-sub">
              Casca residual, tortuosidade, volume e massa seca prevista — com a proveniência da
              densidade que gera a massa
            </p>
            <QualidadeTalhao rows={qualidade?.porTalhao ?? []} />
          </section>

          <section className="panel third">
            <h2>Distribuição diamétrica</h2>
            <p className="panel-sub">Toras por classe de diâmetro — 100% das toras, não amostra</p>
            <Histograma data={qualidade?.diametro ?? []} unidade="diâmetro" />
          </section>

          <section className="panel third">
            <h2>Distribuição de casca residual</h2>
            <p className="panel-sub">% da superfície da tora ainda coberta por casca</p>
            <Histograma data={qualidade?.casca ?? []} unidade="casca residual" />
          </section>

          <section className="panel third">
            <h2>Distribuição de tortuosidade</h2>
            <p className="panel-sub">Flecha do eixo / comprimento, só toras vistas de lado</p>
            <Histograma data={qualidade?.tortuosidade ?? []} unidade="tortuosidade" />
          </section>

          <section className="panel two-thirds">
            <div className="panel-controls">
              <div>
                <h2>Eventos ao longo do tempo</h2>
                <p className="panel-sub">Contagem por classificação em cada intervalo</p>
              </div>
              <div className="panel-opcoes">
                <label className="chk">
                  <input type="checkbox" checked={acumulado} onChange={(e) => setAcumulado(e.target.checked)} />
                  Acumulado
                </label>
                <select
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value as Bucket)}
                  aria-label="Granularidade da série temporal"
                >
                  <option value="minute">Por minuto</option>
                  <option value="hour">Por hora</option>
                  <option value="day">Por dia</option>
                  <option value="week">Por semana</option>
                </select>
              </div>
            </div>
            <TimeSeriesChart data={timeseries ?? []} bucket={bucket} acumulado={acumulado} />
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
