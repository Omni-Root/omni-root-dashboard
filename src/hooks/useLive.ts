import { useEffect, useRef, useState } from 'react';

// Assina /api/events (Server-Sent Events). A cada tora nova sincronizada do
// campo, chama `onNova` (com debounce: o sync_daemon manda várias toras em
// rajada, e refazer as consultas uma vez por rajada basta). O navegador
// reconecta sozinho se a conexão cair; `estado` mostra isso na interface.
export type EstadoLive = 'conectando' | 'ao-vivo' | 'reconectando';

export const EVENTO_POSICAO = 'omniroot:posicao';
export const EVENTO_RASTRO = 'omniroot:rastro';

export interface LiveInfo {
  estado: EstadoLive;
  ultimaEm: Date | null; // quando chegou a última tora
  novas: number; // toras recebidas desde que a página carregou
  push: boolean; // true = trigger LISTEN/NOTIFY ativo; false = só polling
}

export function useLive(onNova: () => void, debounceMs = 800): LiveInfo {
  const [info, setInfo] = useState<LiveInfo>({ estado: 'conectando', ultimaEm: null, novas: 0, push: false });
  const cb = useRef(onNova);
  cb.current = onNova;

  useEffect(() => {
    const es = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout> | null = null;

    es.addEventListener('hello', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { listen: boolean };
      setInfo((i) => ({ ...i, estado: 'ao-vivo', push: d.listen }));
    });
    es.addEventListener('tora', (ev) => {
      // op = 'UPDATE' é a MESMA tora sendo refinada (evento incremental):
      // atualiza os painéis, mas não conta como inspeção nova.
      let nova = true;
      try {
        nova = (JSON.parse((ev as MessageEvent).data) as { op?: string }).op !== 'UPDATE';
      } catch {
        /* payload sem op: trata como nova */
      }
      setInfo((i) => ({ ...i, estado: 'ao-vivo', ultimaEm: new Date(), novas: nova ? i.novas + 1 : i.novas }));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    });
    // Frota (server/frota.ts): posição ao vivo de uma máquina e "trajeto novo
    // no banco". Repassados como eventos da janela para o mapa (useFrota), sem
    // abrir uma segunda conexão SSE.
    es.addEventListener('posicao', (ev) => {
      try {
        window.dispatchEvent(new CustomEvent(EVENTO_POSICAO, { detail: JSON.parse((ev as MessageEvent).data) }));
      } catch {
        /* payload inválido: ignora */
      }
    });
    es.addEventListener('rastro', () => window.dispatchEvent(new Event(EVENTO_RASTRO)));
    es.onopen = () => setInfo((i) => ({ ...i, estado: 'ao-vivo' }));
    es.onerror = () => setInfo((i) => ({ ...i, estado: 'reconectando' }));

    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [debounceMs]);

  return info;
}
