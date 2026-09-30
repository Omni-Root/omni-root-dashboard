import { useState } from 'react';
import AlertasTendencia from '../components/AlertasTendencia';
import AvisoConexao from '../components/AvisoConexao';
import Cabecalho from '../components/Cabecalho';
import CameraAoVivo from '../components/CameraAoVivo';
import FiltersBar from '../components/Filters';
import Heatmap from '../components/Heatmap';
import Histograma from '../components/Histograma';
import MapaQualidade from '../components/MapaQualidade';
import NavCelular from '../components/NavCelular';
import ProportionDonut from '../components/ProportionDonut';
import QualidadeTalhao from '../components/QualidadeTalhao';
import SummaryCards from '../components/SummaryCards';
import TimeSeriesChart from '../components/TimeSeriesChart';
import UltimaInspecao from '../components/UltimaInspecao';
import { Narrador } from '../components/VozMenu';
import { isoDaysAgo } from '../datas';
import { useAnuncioInspecao } from '../hooks/useAnuncioInspecao';
import { useDadosPainel } from '../hooks/useDadosPainel';
import type { Bucket, Filters, Status } from '../types';
import { descreverInspecao, descreverResumo, useVoz } from '../voz';

// A página do painel (usuário logado): estado dos filtros, os dados
// (useDadosPainel) e o layout em grade dos painéis.
export default function Painel({ user, onLogout }: { user: string; onLogout: () => void }) {
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

  const {
    live,
    maquinas,
    summary,
    timeseries,
    heatmap,
    ultima,
    qualidade,
    mapa,
    tendencia,
    error,
    atualizadoEm,
    tentativas,
    loading,
  } = useDadosPainel(filters, bucket, heatStatuses, onLogout);
  const voz = useVoz();
  useAnuncioInspecao(ultima, live.novas, voz);

  const maquinaFiltrada = maquinas.find((m) => String(m.id) === filters.maquinaId)?.numero_serie ?? null;
  const lerResumo = () => {
    if (summary) voz.falar(descreverResumo(summary, filters.from, filters.to, maquinaFiltrada), { forcar: true });
  };
  const lerUltima = () => {
    if (ultima) voz.falar(descreverInspecao(ultima, true), { forcar: true });
  };

  return (
    <div className="layout">
      <Cabecalho live={live} voz={voz} filters={filters} user={user} onLogout={onLogout} />

      <AlertasTendencia alertas={tendencia} falar={(t) => voz.falar(t)} />
      <FiltersBar filters={filters} maquinas={maquinas} onChange={setFilters} />
      <Narrador texto={voz.ultimoTexto} />

      <AvisoConexao error={error} temDados={summary !== null} atualizadoEm={atualizadoEm} tentativas={tentativas} />

      {loading && !error && <div className="loading">Carregando…</div>}

      {summary && (
        <div className="grid">
          <section className="panel panel-camera third">
            <h2>Câmera ao vivo</h2>
            <p className="panel-sub">O que a garra está vendo agora — só enquanto a máquina tem rede</p>
            <CameraAoVivo maquinas={maquinas} filtroMaquinaId={filters.maquinaId} />
          </section>

          <section className="panel panel-ultima two-thirds" id="agora">
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

          <div className="cards-wrap" id="resumo">
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

          <section className="panel" id="qualidade">
            <h2>Qualidade da madeira por talhão e clone</h2>
            <p className="panel-sub">
              Casca residual, tortuosidade, volume e massa seca prevista — com a proveniência da
              densidade que gera a massa
            </p>
            <QualidadeTalhao rows={qualidade?.porTalhao ?? []} />
          </section>

          <section className="panel panel-mapa" id="mapa">
            <h2>Mapa de qualidade</h2>
            <p className="panel-sub">
              Onde está a casca alta, a madeira torta e a rejeição — cada tora na posição da máquina
              no corte (GNSS), agrupada por zona. Funciona sem internet; o mapa de ruas é opcional.
            </p>
            <MapaQualidade mapa={mapa} />
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

      {summary && <NavCelular />}
    </div>
  );
}
