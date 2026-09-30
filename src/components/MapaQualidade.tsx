import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AlertaZona, Mapa, MapaCelula, MapaPonto, Metrica, Nivel } from '../types';
import { FONTE_POSICAO_META } from '../types';
import { useThemeTokens, type ThemeTokens } from '../hooks/useThemeTokens';

// MAPA DE QUALIDADE — onde está a madeira ruim, e o que fazer a respeito.
//
// Cada célula (~25 m) junta as toras colhidas ali e é colorida pelo
// indicador escolhido (casca, tortuosidade ou rejeição). Os LIMITES, a cor
// de cada zona e o "Onde agir" vêm prontos do servidor (server/mapa.ts) —
// a mesma regra que o relatório PDF usa; aqui só se desenha.
//
// Offline por construção: a camada de qualidade é vetor desenhado por nós
// (Leaflet vai empacotado no app, sem CDN). O mapa de ruas por baixo é só um
// enriquecimento — sem internet ele some com um aviso e o resto continua.

const METRICAS: Record<Metrica, { label: string; valor: (c: MapaCelula) => number | null }> = {
  casca: { label: 'Casca residual', valor: (c) => c.casca_media },
  tort: { label: 'Tortuosidade', valor: (c) => c.tort_media },
  falhas: { label: 'Rejeição', valor: (c) => (c.toras > 0 ? (100 * c.falhas) / c.toras : null) },
};

// Texto das três faixas da legenda, a partir dos limites do servidor.
function faixas(m: Metrica, [ok, at]: [number, number]): [string, string, string] {
  return m === 'tort' ? [`< ${ok}%`, `${ok}–${at}%`, `≥ ${at}%`] : [`≤ ${ok}%`, `${ok}–${at}%`, `> ${at}%`];
}

function nRotulo(a: AlertaZona): string {
  if (a.metrica === 'tort') return `${a.n} ${a.n === 1 ? 'tora vista' : 'toras vistas'} de lado`;
  return `${a.n} ${a.n === 1 ? 'tora' : 'toras'}`;
}

function corNivel(t: ThemeTokens, n: Nivel): string {
  if (n === 'ok') return t.status.aprovado;
  if (n === 'atencao') return t.status.quarentena;
  if (n === 'critico') return t.status.reprovado;
  return t.muted;
}

const fmt = (v: number | null, casas = 1) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function fmtHora(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

// Um cartão por zona (uma zona pode estourar mais de um indicador), na ordem
// de gravidade em que o servidor já mandou.
function agruparPorZona(alertas: AlertaZona[]): { zona: string; nivel: 'atencao' | 'critico'; itens: AlertaZona[] }[] {
  const grupos = new Map<string, { zona: string; nivel: 'atencao' | 'critico'; itens: AlertaZona[] }>();
  for (const a of alertas) {
    const g = grupos.get(a.zona);
    if (g) {
      g.itens.push(a);
      if (a.nivel === 'critico') g.nivel = 'critico';
    } else {
      grupos.set(a.zona, { zona: a.zona, nivel: a.nivel, itens: [a] });
    }
  }
  return [...grupos.values()];
}

type StatusFundo = 'carregando' | 'ok' | 'falhou';

export default function MapaQualidade({ mapa }: { mapa: Mapa | null }) {
  const [metrica, setMetrica] = useState<Metrica>('casca');
  const [fundo, setFundo] = useState<'ruas' | 'nenhum'>('ruas');
  const [statusFundo, setStatusFundo] = useState<StatusFundo>('carregando');
  const [foco, setFoco] = useState<{ zona: string; nonce: number } | null>(null);
  const [enquadrar, setEnquadrar] = useState(0);

  const zonasAlerta = useMemo(() => agruparPorZona(mapa?.alertas ?? []), [mapa]);

  if (!mapa) return <div className="loading">Carregando…</div>;
  if (!mapa.disponivel) {
    return <div className="empty">{mapa.aviso ?? 'Mapa indisponível.'}</div>;
  }
  if (mapa.com_posicao === 0) {
    return (
      <div className="empty">
        <div>
          Nenhuma tora com posição no período ({mapa.total} {mapa.total === 1 ? 'tora' : 'toras'} sem posição).
          <br />
          <span className="muted">
            Na máquina: <code>--gnss COM5</code> (GNSS / receptor), <code>--gnss trilha.nmea</code> ou, no notebook
            da maquete, <code>--gnss windows</code> (Localização do Windows).
          </span>
        </div>
      </div>
    );
  }

  const def = METRICAS[metrica];
  const semPosicao = mapa.total - mapa.com_posicao;
  const temLog = mapa.fontes.some((f) => f.fonte === 'gnss_log');

  return (
    <div className="mapa">
      <div className="mapa-controles">
        <div className="mapa-metricas" role="radiogroup" aria-label="Indicador do mapa">
          {(Object.keys(METRICAS) as Metrica[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={metrica === k}
              className={`seg${metrica === k ? ' seg-ativo' : ''}`}
              onClick={() => setMetrica(k)}
            >
              {METRICAS[k].label}
            </button>
          ))}
        </div>
        <div className="mapa-opcoes">
          <select
            value={fundo}
            onChange={(e) => {
              setFundo(e.target.value as 'ruas' | 'nenhum');
              setStatusFundo('carregando');
            }}
            aria-label="Mapa de fundo"
          >
            <option value="ruas">Fundo: ruas (OpenStreetMap)</option>
            <option value="nenhum">Fundo: nenhum (offline)</option>
          </select>
          <button type="button" className="btn" onClick={() => setEnquadrar((n) => n + 1)}>
            Enquadrar
          </button>
        </div>
      </div>

      <div className="mapa-layout">
        <div className="mapa-area">
          <MapaLeaflet
            celulas={mapa.celulas}
            pontos={mapa.pontos}
            ultima={mapa.ultima}
            metrica={metrica}
            fundo={fundo}
            onStatusFundo={setStatusFundo}
            foco={foco}
            enquadrar={enquadrar}
          />
          {fundo === 'ruas' && statusFundo === 'falhou' && (
            <div className="mapa-aviso-fundo" role="status">
              Sem internet para o mapa de fundo — a camada de qualidade continua funcionando.
            </div>
          )}
          <div className="mapa-legenda">
            <strong>{def.label}:</strong>
            {(['ok', 'atencao', 'critico'] as Nivel[]).map((n, i) => (
              <span key={n}>
                <i className={`sw sw-${n}`} />
                {faixas(metrica, mapa.limites[metrica])[i]}
              </span>
            ))}
            <span>
              <i className="sw sw-sem" />
              sem medida
            </span>
            <span className="muted">· célula de {mapa.celula_m} m · ponto = tora</span>
          </div>
        </div>

        <aside className="mapa-alertas">
          <h3>Onde agir</h3>
          {zonasAlerta.length === 0 ? (
            <p className="muted">
              Nenhuma zona acima dos limites no período (mín. {mapa.min_toras_alerta} toras por zona).
            </p>
          ) : (
            <ul>
              {zonasAlerta.slice(0, 6).map((g) => (
                <li key={g.zona}>
                  <button
                    type="button"
                    className={`alerta alerta-${g.nivel}`}
                    onClick={() => {
                      setMetrica(g.itens[0].metrica);
                      setFoco({ zona: g.zona, nonce: Date.now() });
                    }}
                    title="Mostrar no mapa"
                  >
                    <span className="alerta-zona">Zona {g.zona}</span>
                    {g.itens.map((a) => (
                      <span className="alerta-texto" key={a.metrica}>
                        {a.curto} <strong>{fmt(a.valor, a.metrica === 'falhas' ? 0 : 1)}%</strong> em {nRotulo(a)} (limite{' '}
                        {a.limite}%): {a.acao}.
                      </span>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {zonasAlerta.length > 6 && <p className="muted">+ {zonasAlerta.length - 6} zonas acima do limite.</p>}
        </aside>
      </div>

      <div className="mapa-rodape">
        <span>
          <strong>{mapa.com_posicao}</strong> de {mapa.total} toras do período com posição
          {semPosicao > 0 && ` · ${semPosicao} sem posição (fora do mapa)`}
          {mapa.luz_critica > 0 && (
            <span title="Medidas em luz crítica (baixa confiança): aparecem no mapa, mas a casca e a tortuosidade delas não entram nas médias nem nos alertas">
              {` · ${mapa.luz_critica} medidas em luz crítica (fora dos alertas)`}
            </span>
          )}
          {mapa.pontos_truncados && ` · mostrando as ${mapa.pontos.length} mais recentes como ponto`}
        </span>
        <span>
          Posição:{' '}
          {mapa.fontes.map((f, i) => {
            const meta = FONTE_POSICAO_META[f.fonte];
            return (
              <span key={f.fonte} title={meta?.hint}>
                {i > 0 && ', '}
                <span className={`tile-tag${f.fonte === 'gnss_log' ? ' tag-demo' : ''}`}>{meta?.label ?? f.fonte}</span>{' '}
                ({f.toras})
              </span>
            );
          })}
          {temLog && <span className="muted"> — trilha GNSS real gravada e reproduzida</span>}
          {mapa.fontes.some((f) => f.fonte === 'windows_localizacao') && (
            <span className="muted"> — notebook no papel da máquina; posição por Wi-Fi, precisão de dezenas de metros</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// O mapa em si (Leaflet imperativo, ciclo de vida preso ao componente)
// ------------------------------------------------------------
function MapaLeaflet({
  celulas,
  pontos,
  ultima,
  metrica,
  fundo,
  onStatusFundo,
  foco,
  enquadrar,
}: {
  celulas: MapaCelula[];
  pontos: MapaPonto[];
  ultima: MapaPonto | null;
  metrica: Metrica;
  fundo: 'ruas' | 'nenhum';
  onStatusFundo: (s: StatusFundo) => void;
  foco: { zona: string; nonce: number } | null;
  enquadrar: number;
}) {
  const tokens = useThemeTokens();
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const grupoRef = useRef<L.LayerGroup | null>(null);
  const retangulosRef = useRef<Map<string, L.Rectangle>>(new Map());
  const enquadradoRef = useRef(false);

  // Cria e destrói o mapa junto com o componente.
  useEffect(() => {
    if (!divRef.current) return;
    // Zoom só inteiro: com zoom fracionado os blocos do mapa de fundo são
    // esticados e aparecem emendas (linhas) entre eles.
    const mapa = L.map(divRef.current, { maxZoom: 20 }).setView([-15.8, -47.9], 4);
    L.control.scale({ imperial: false }).addTo(mapa);
    grupoRef.current = L.layerGroup().addTo(mapa);
    mapRef.current = mapa;
    // O Leaflet mede o container só ao nascer: janela redimensionada, coluna
    // que muda de largura ou painel que aparece depois precisam de um aviso,
    // senão o mapa fica cortado/deslocado.
    const observador = new ResizeObserver(() => mapa.invalidateSize());
    observador.observe(divRef.current);
    return () => {
      observador.disconnect();
      mapa.remove();
      mapRef.current = null;
      grupoRef.current = null;
      enquadradoRef.current = false;
    };
  }, []);

  // Mapa de fundo: só um enriquecimento. Falhou (sem internet)? Avisa e segue.
  useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa || fundo !== 'ruas') return;
    let carregou = false;
    const camada = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    camada.on('tileload', () => {
      carregou = true;
      onStatusFundo('ok');
    });
    camada.on('tileerror', () => {
      if (!carregou) onStatusFundo('falhou');
    });
    camada.addTo(mapa);
    camada.bringToBack();
    if (!navigator.onLine) onStatusFundo('falhou');
    return () => {
      camada.remove();
    };
  }, [fundo, onStatusFundo]);

  // Camada de qualidade (células + toras + a última tora).
  useEffect(() => {
    const mapa = mapRef.current;
    const grupo = grupoRef.current;
    if (!mapa || !grupo) return;
    grupo.clearLayers();
    retangulosRef.current.clear();
    const m = METRICAS[metrica];

    for (const c of celulas) {
      const nv: Nivel = c.niveis?.[metrica] ?? 'sem';
      const cor = corNivel(tokens, nv);
      const v = m.valor(c);
      const ret = L.rectangle(
        [
          [c.lat_min, c.lon_min],
          [c.lat_max, c.lon_max],
        ],
        {
          color: cor,
          weight: 1,
          fillColor: cor,
          fillOpacity: nv === 'sem' ? 0.12 : 0.42,
          dashArray: nv === 'sem' ? '3 3' : undefined,
        },
      );
      ret.bindTooltip(
        `<strong>Zona ${c.zona}</strong> · ${c.toras} ${c.toras === 1 ? 'tora' : 'toras'}<br>` +
          `${m.label}: <strong>${v == null ? 'sem medida' : `${fmt(v, metrica === 'falhas' ? 0 : 1)}%`}</strong><br>` +
          `Casca média ${fmt(c.casca_media)}% · Tortuosidade ${c.tort_n > 0 ? `${fmt(c.tort_media)}% (${c.tort_n})` : 'n/a'}<br>` +
          `Rejeitadas/contenção: ${c.falhas} · Diâm. médio ${fmt(c.diam_medio)} cm<br>` +
          `<span style="opacity:.75">${fmtHora(c.primeira)} → ${fmtHora(c.ultima)}</span>`,
        { sticky: true },
      );
      ret.addTo(grupo);
      retangulosRef.current.set(c.zona, ret);
    }

    // Pontos em SVG (renderizador padrão), como as células. Com canvas, o
    // Leaflet deixava um redesenho agendado num canvas já destruído a cada
    // atualização ao vivo (erro "clearRect" no console). Até MAX_PONTOS
    // (3000, no servidor) o SVG dá conta.
    for (const p of pontos) {
      L.circleMarker([p.lat, p.lon], {
        radius: 2.5,
        weight: 0,
        fillColor: tokens.textPrimary,
        fillOpacity: 0.55,
        interactive: false,
      }).addTo(grupo);
    }
    if (ultima) {
      L.circleMarker([ultima.lat, ultima.lon], {
        radius: 7,
        weight: 3,
        color: tokens.accent,
        fillColor: tokens.surface,
        fillOpacity: 1,
        className: 'mapa-ultima',
      })
        .bindTooltip(`Última tora · ${fmtHora(ultima.data)}`)
        .addTo(grupo);
    }

    // Enquadra só na primeira carga com dados — atualização ao vivo não
    // deve arrancar o zoom que o usuário escolheu.
    if (!enquadradoRef.current && celulas.length > 0) {
      enquadrarTudo(mapa, celulas);
      enquadradoRef.current = true;
    }
  }, [celulas, pontos, ultima, metrica, tokens]);

  useEffect(() => {
    if (enquadrar > 0 && mapRef.current) enquadrarTudo(mapRef.current, celulas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquadrar]);

  useEffect(() => {
    if (!foco || !mapRef.current) return;
    const ret = retangulosRef.current.get(foco.zona);
    if (!ret) return;
    mapRef.current.flyToBounds(ret.getBounds(), { maxZoom: 19, padding: [60, 60], duration: 0.6 });
    ret.openTooltip();
  }, [foco]);

  return <div ref={divRef} className="mapa-leaflet" aria-label="Mapa de qualidade por zona" />;
}

function enquadrarTudo(mapa: L.Map, celulas: MapaCelula[]) {
  if (celulas.length === 0) return;
  const b = L.latLngBounds([]);
  for (const c of celulas) {
    b.extend([c.lat_min, c.lon_min]);
    b.extend([c.lat_max, c.lon_max]);
  }
  mapa.fitBounds(b, { padding: [24, 24], maxZoom: 19 });
}
