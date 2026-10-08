import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Filters, PosicaoFrota, Rastro } from '../types';
import { EVENTO_POSICAO, EVENTO_RASTRO } from './useLive';

// Frota no mapa: onde cada máquina (SN) está e por onde passou.
//   - lista inicial em /api/frota (ao vivo + última posição conhecida no banco);
//   - cada posição ao vivo chega pelo SSE (useLive repassa como evento da
//     janela) e substitui a daquela máquina na hora;
//   - o trajeto vem de /api/frota/rastro (período/máquina do filtro) e é
//     recarregado quando o sync avisa que entrou trajeto novo — inclusive o
//     trecho feito sem internet, quando a rede volta.
// A cada 2 s recalcula "há quanto tempo" e quem ficou sem sinal; a cada 30 s
// relê a lista (rede de segurança se algum evento se perdeu).
const OFFLINE_MS = 10_000; // o mesmo do servidor (FROTA_OFFLINE_MS)

export interface FrotaInfo {
  frota: PosicaoFrota[];
  rastro: Rastro | null;
}

export function useFrota(filters: Filters): FrotaInfo {
  const [frota, setFrota] = useState<PosicaoFrota[]>([]);
  const [rastro, setRastro] = useState<Rastro | null>(null);

  // Lista: carga inicial, releitura a cada 30 s e posições ao vivo.
  useEffect(() => {
    const ac = new AbortController();
    const ler = () =>
      api
        .frota(ac.signal)
        .then(setFrota)
        .catch(() => undefined); // sem servidor: mantém o que tinha
    void ler();
    const releitura = window.setInterval(() => void ler(), 30_000);

    const aoVivo = (e: Event) => {
      const p = (e as CustomEvent<PosicaoFrota>).detail;
      if (!p?.maquina) return;
      setFrota((lista) => {
        const antes = lista.find((x) => x.maquina === p.maquina);
        // Sem fix agora: continua mostrando onde ela estava (o servidor manda
        // a última posição válida; se nunca teve, mantém a do banco).
        const novo: PosicaoFrota = {
          ...p,
          modelo: antes?.modelo ?? p.modelo,
          ...(p.lat === null && antes && antes.lat !== null
            ? { lat: antes.lat, lon: antes.lon, precisao_m: antes.precisao_m, hdop: antes.hdop, satelites: antes.satelites, em: antes.em, idadeMs: antes.idadeMs, origem: antes.origem }
            : {}),
        };
        const resto = lista.filter((x) => x.maquina !== p.maquina);
        return [novo, ...resto].sort((a, b) => Number(b.online) - Number(a.online) || a.maquina.localeCompare(b.maquina));
      });
    };
    window.addEventListener(EVENTO_POSICAO, aoVivo);
    return () => {
      ac.abort();
      window.clearInterval(releitura);
      window.removeEventListener(EVENTO_POSICAO, aoVivo);
    };
  }, []);

  // Trajeto do período filtrado; recarrega quando o sync avisa (com folga
  // de 1 s: o sync manda vários lotes seguidos).
  useEffect(() => {
    const ac = new AbortController();
    let timer: number | undefined;
    const ler = () =>
      api
        .rastro(filters, ac.signal)
        .then(setRastro)
        .catch(() => undefined);
    void ler();
    const aoAvisar = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void ler(), 1000);
    };
    window.addEventListener(EVENTO_RASTRO, aoAvisar);
    return () => {
      ac.abort();
      window.clearTimeout(timer);
      window.removeEventListener(EVENTO_RASTRO, aoAvisar);
    };
  }, [filters]);

  // Relógio: "há Xs" anda e quem parou de mandar sinal vira "sem sinal". Vale
  // o último CONTATO, não a idade da posição: máquina online sem fix (sob uma
  // cobertura) segue online, mostrando onde estava.
  useEffect(() => {
    let ultimo = Date.now();
    const t = window.setInterval(() => {
      const agora = Date.now();
      const passou = agora - ultimo;
      ultimo = agora;
      setFrota((lista) =>
        lista.map((p) => {
          const idadeMs = p.idadeMs === null ? null : p.idadeMs + passou;
          const contatoMs = p.contatoMs === null ? null : p.contatoMs + passou;
          const online = contatoMs !== null && contatoMs <= OFFLINE_MS;
          return { ...p, idadeMs, contatoMs, online, estado: online ? p.estado : 'offline' };
        }),
      );
    }, 2000);
    return () => window.clearInterval(t);
  }, []);

  return { frota, rastro };
}
