import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { CameraEstado, Maquina, Status } from '../types';
import { STATUS_META } from '../types';

// Painel "Câmera ao vivo": o que o operador está vendo na garra, com as
// caixas e o HUD que o main.py desenha, empurrado para o servidor a poucos
// fps enquanto há rede. Um <img> apontando para o stream MJPEG basta — o
// navegador troca o quadro sozinho a cada parte que chega.
//
// Regras de apresentação:
//   - "AO VIVO · há Xs" enquanto chegam quadros; quando a máquina some (sem
//     rede ou main.py parado), o último quadro fica na tela ESCURECIDO com
//     "Sem sinal" e a hora do último quadro — nunca um vídeo congelado
//     fingindo ser ao vivo;
//   - o filtro de máquina do topo manda: se ele está preenchido, mostra a
//     câmera daquela máquina; senão, a primeira que estiver transmitindo,
//     com um seletor caso haja mais de uma.

const POLL_MS = 2000;

function haQuanto(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)} h`;
}

export default function CameraAoVivo({
  maquinas,
  filtroMaquinaId,
}: {
  maquinas: Maquina[];
  filtroMaquinaId: string; // id numérico do Postgres ('' = todas)
}) {
  // `recebidoEm` = relógio do NAVEGADOR quando a resposta chegou: a idade do
  // quadro anda a partir dele, sem depender de relógio sincronizado com o servidor.
  const [estado, setEstado] = useState<{ dados: CameraEstado; recebidoEm: number } | null>(null);
  const [escolhida, setEscolhida] = useState<string>('');
  // Incrementado quando o <img> dá erro (servidor reiniciou, proxy caiu):
  // muda a URL e o navegador reabre o stream.
  const [versao, setVersao] = useState(0);
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    const ac = new AbortController();
    let vivo = true;
    const tick = () => {
      api
        .camera(ac.signal)
        .then((e) => vivo && setEstado({ dados: e, recebidoEm: Date.now() }))
        .catch(() => {
          /* servidor fora: mantém o último estado; próximo tick tenta de novo */
        });
    };
    tick();
    const t = setInterval(() => {
      setAgora(Date.now());
      tick();
    }, POLL_MS);
    return () => {
      vivo = false;
      clearInterval(t);
      ac.abort();
    };
  }, []);

  // numero_serie da máquina filtrada no topo (o stream é indexado por série,
  // que é o maquina_id do config.json — o mesmo que o sync grava).
  const serieFiltro = useMemo(() => {
    if (!filtroMaquinaId) return '';
    return maquinas.find((m) => String(m.id) === filtroMaquinaId)?.numero_serie ?? '';
  }, [maquinas, filtroMaquinaId]);

  const lista = estado?.dados.maquinas ?? [];
  const serie =
    serieFiltro ||
    (lista.some((c) => c.maquina === escolhida) ? escolhida : (lista.find((c) => c.online) ?? lista[0])?.maquina ?? '');
  const cam = lista.find((c) => c.maquina === serie) ?? null;
  // Idade recalculada localmente entre um poll e outro, para o "há Xs" andar.
  const idadeMs = cam && estado ? cam.idadeMs + Math.max(0, agora - estado.recebidoEm) : 0;
  const online = cam ? cam.online && idadeMs <= 6000 : false;

  // Reconecta o <img> quando a máquina volta: o servidor mantém o stream
  // aberto, mas se ele reiniciou no meio a conexão antiga morreu em silêncio.
  const antesOnline = useRef(online);
  useEffect(() => {
    if (online && !antesOnline.current) setVersao((v) => v + 1);
    antesOnline.current = online;
  }, [online]);

  if (estado && !estado.dados.ligada) {
    return (
      <div className="empty camera-empty">
        Câmera ao vivo desligada no servidor — defina <code>STREAM_TOKEN</code> no <code>.env</code> do dashboard
        (e o mesmo valor no <code>.env</code> da máquina).
      </div>
    );
  }

  if (!cam) {
    return (
      <div className="empty camera-empty">
        {serieFiltro
          ? `A máquina ${serieFiltro} ainda não transmitiu nenhum quadro.`
          : 'Nenhuma máquina transmitindo. Com o main.py rodando e "stream_url" no config.json, a imagem aparece aqui.'}
      </div>
    );
  }

  const statusMeta = cam.status && cam.status in STATUS_META ? STATUS_META[cam.status as Status] : null;

  return (
    <div className={`camera ${online ? 'camera-online' : 'camera-offline'}`}>
      <div className="camera-head">
        <span className={`live-badge ${online ? 'live-ao-vivo' : 'live-reconectando'}`} aria-live="polite">
          <span className="live-dot" aria-hidden="true" />
          <span className="live-label">{online ? 'Ao vivo' : 'Sem sinal'}</span>
          <span className="live-detail">· {online ? `quadro ${haQuanto(idadeMs)}` : `último quadro ${haQuanto(idadeMs)}`}</span>
        </span>
        {!serieFiltro && lista.length > 1 ? (
          <select value={serie} onChange={(e) => setEscolhida(e.target.value)} aria-label="Máquina da câmera">
            {lista.map((c) => (
              <option key={c.maquina} value={c.maquina}>
                {c.maquina} {c.online ? '● ao vivo' : '○ sem sinal'}
              </option>
            ))}
          </select>
        ) : (
          <span className="camera-serie">{serie}</span>
        )}
      </div>

      <div className="camera-frame">
        {/* MJPEG: o próprio navegador troca a imagem a cada quadro que chega. */}
        <img
          src={api.cameraStreamUrl(serie, versao)}
          alt={`Câmera da máquina ${serie}${online ? ', ao vivo' : ', sem sinal'}`}
          onError={() => setTimeout(() => setVersao((v) => v + 1), 3000)}
        />
        {!online && (
          <div className="camera-overlay">
            <strong>Sem sinal</strong>
            <span>Máquina sem rede ou inspeção parada — a coleta continua no SQLite local e sincroniza quando voltar.</span>
          </div>
        )}
      </div>

      <div className="camera-foot">
        {statusMeta ? (
          <span className="camera-status" style={{ color: statusMeta.cssVar }}>
            <span className="dot" style={{ background: statusMeta.cssVar }} />
            {statusMeta.label}
          </span>
        ) : (
          <span className="camera-status">—</span>
        )}
        <span>
          vista {cam.vista === 'secao' ? 'seção' : cam.vista === 'lateral' ? 'lateral' : '—'}
        </span>
        <span className="camera-hint">caixas e HUD desenhados na máquina; quadros só passam enquanto há rede</span>
      </div>
    </div>
  );
}
