// Narração (text-to-speech) do dashboard — Web Speech API do navegador, sem
// dependência nova. Vozes pt-BR vêm do sistema (Windows: Microsoft Maria /
// Daniel / Francisca; Chrome traz as "Google português do Brasil").
//
// Por que existe: o gestor não fica olhando o painel o dia inteiro. Com a
// narração ligada, uma tora rejeitada que acabou de sincronizar do campo é
// ANUNCIADA ("Tora rejeitada na máquina X: nó morto") — alerta sem exigir
// atenção visual. E os botões "Ler" leem o resumo do período e a última
// inspeção sob demanda, para quem prefere ouvir ou usa leitor de tela.
//
// Tudo o que é falado também vai para uma região aria-live (ver <Narrador/>),
// então NVDA/JAWS recebem o mesmo texto mesmo com a voz desligada.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Status, SummaryRow, UltimaInspecao } from './types';

export type Anunciar = 'todas' | 'falhas' | 'nenhuma';

export interface PrefsVoz {
  ativo: boolean; // narração ligada (fala de verdade)
  anunciar: Anunciar; // quais toras novas anunciar automaticamente
  taxa: number; // velocidade 0.7–1.4
  vozURI: string | null; // voz escolhida (voiceURI) ou null = melhor pt-BR
}

const STORAGE_KEY = 'omniroot-voz';
const PADRAO: PrefsVoz = { ativo: false, anunciar: 'falhas', taxa: 1.0, vozURI: null };

export function suportaVoz(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function lerPrefs(): PrefsVoz {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PADRAO;
    const p = JSON.parse(raw) as Partial<PrefsVoz>;
    return {
      ativo: typeof p.ativo === 'boolean' ? p.ativo : PADRAO.ativo,
      anunciar: p.anunciar === 'todas' || p.anunciar === 'falhas' || p.anunciar === 'nenhuma' ? p.anunciar : PADRAO.anunciar,
      taxa: typeof p.taxa === 'number' && p.taxa >= 0.7 && p.taxa <= 1.4 ? p.taxa : PADRAO.taxa,
      vozURI: typeof p.vozURI === 'string' ? p.vozURI : null,
    };
  } catch {
    return PADRAO;
  }
}

// ============================================================
// Textos em português — o que a voz diz
// ============================================================

const STATUS_FALADO: Record<Status, string> = {
  aprovado: 'aprovada',
  quarentena: 'em contenção',
  reprovado: 'rejeitada',
};

// Classes do modelo (data.yaml) em português falado.
const DEFEITO_FALADO: Record<string, string> = {
  Live_Knot: 'nó vivo',
  Dead_Knot: 'nó morto',
  Knot_missing: 'nó ausente',
  knot_with_crack: 'nó com rachadura',
  Crack: 'rachadura',
  Marrow: 'medula',
  Quartzity: 'inclusão mineral',
  resin: 'bolsa de resina',
};

const nf = (v: number | null, casas = 0) =>
  v == null ? null : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function listar(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function horaFalada(iso: string): string {
  return `${iso.slice(11, 13)} e ${iso.slice(14, 16)}`;
}

/** Frase curta para o alerta ao vivo e para o botão "Ler última inspeção". */
export function descreverInspecao(u: UltimaInspecao, completa = false): string {
  const partes: string[] = [];
  partes.push(`Tora ${STATUS_FALADO[u.status]} às ${horaFalada(u.data)}`);
  if (u.maquina_serie) partes[0] += ` na máquina ${u.maquina_serie}`;
  if (u.talhao_nome) partes[0] += `, ${u.talhao_nome}`;

  if (u.defeitos > 0) {
    const nomes = u.defeitos_tipos.map((t) => DEFEITO_FALADO[t] ?? t);
    partes.push(`${u.defeitos === 1 ? '1 defeito' : `${u.defeitos} defeitos`}: ${listar(nomes)}`);
  } else {
    partes.push('sem defeitos');
  }

  const medidas: string[] = [];
  if (u.diametro_cm != null) medidas.push(`diâmetro ${nf(u.diametro_cm)} centímetros`);
  if (u.casca_pct != null) medidas.push(`casca residual ${nf(u.casca_pct)} por cento`);
  if (completa) {
    if (u.tortuosidade != null) medidas.push(`tortuosidade ${nf(u.tortuosidade, 1)} por cento`);
    if (u.comprimento_cm != null) medidas.push(`comprimento ${nf(u.comprimento_cm / 100, 1)} metros`);
    if (u.densidade.valor != null) medidas.push(`densidade de referência ${nf(u.densidade.valor)} quilos por metro cúbico`);
    if (u.massa_kg != null) medidas.push(`massa seca estimada ${nf(u.massa_kg)} quilos`);
    if (u.saude_pct != null) medidas.push(`saúde ${nf(u.saude_pct)} por cento`);
  }
  if (medidas.length) partes.push(listar(medidas));
  return partes.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ') + '.';
}

/** Resumo do período para o botão "Ler resumo". */
export function descreverResumo(rows: SummaryRow[], from: string, to: string, maquina: string | null): string {
  const total = rows.reduce((a, r) => a + r.total, 0);
  const por = new Map(rows.map((r) => [r.status, r.total]));
  const data = (iso: string) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;
  const escopo = maquina ? `, máquina ${maquina}` : '';
  if (total === 0) return `Nenhuma inspeção entre ${data(from)} e ${data(to)}${escopo}.`;
  const pct = (n: number) => `${Math.round((100 * n) / total)} por cento`;
  const ap = por.get('aprovado') ?? 0;
  const qu = por.get('quarentena') ?? 0;
  const re = por.get('reprovado') ?? 0;
  return (
    `Entre ${data(from)} e ${data(to)}${escopo}: ${nf(total)} ${total === 1 ? 'inspeção' : 'inspeções'}. ` +
    `${nf(ap)} aprovadas, ${pct(ap)}. ${nf(qu)} em contenção, ${pct(qu)}. ${nf(re)} rejeitadas, ${pct(re)}.`
  );
}

// ============================================================
// Hook
// ============================================================

export interface Voz {
  suportado: boolean;
  prefs: PrefsVoz;
  setPrefs: (p: Partial<PrefsVoz>) => void;
  vozes: SpeechSynthesisVoice[]; // só pt-BR (ou pt) — as demais não fazem sentido aqui
  falando: boolean;
  /** Fala (se a narração estiver ligada) e publica no aria-live (sempre). */
  falar: (texto: string, opts?: { forcar?: boolean }) => void;
  parar: () => void;
  ultimoTexto: string; // o que foi para o aria-live
}

export function useVoz(): Voz {
  const suportado = useMemo(suportaVoz, []);
  const [prefs, setPrefsState] = useState<PrefsVoz>(lerPrefs);
  const [vozes, setVozes] = useState<SpeechSynthesisVoice[]>([]);
  const [falando, setFalando] = useState(false);
  const [ultimoTexto, setUltimoTexto] = useState('');
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* sem persistência: vale nesta sessão */
    }
  }, [prefs]);

  // As vozes carregam de forma assíncrona (Chrome dispara 'voiceschanged').
  useEffect(() => {
    if (!suportado) return;
    const carregar = () => {
      const todas = window.speechSynthesis.getVoices();
      const pt = todas.filter((v) => /^pt/i.test(v.lang));
      setVozes(pt.length ? pt : todas);
    };
    carregar();
    window.speechSynthesis.addEventListener('voiceschanged', carregar);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', carregar);
  }, [suportado]);

  const escolherVoz = useCallback((): SpeechSynthesisVoice | null => {
    if (!vozes.length) return null;
    const pref = prefsRef.current.vozURI;
    if (pref) {
      const v = vozes.find((x) => x.voiceURI === pref);
      if (v) return v;
    }
    // Melhor pt-BR disponível: prioriza pt-BR, depois qualquer pt.
    return vozes.find((v) => /^pt[-_]BR/i.test(v.lang)) ?? vozes[0];
  }, [vozes]);

  const parar = useCallback(() => {
    if (!suportado) return;
    window.speechSynthesis.cancel();
    setFalando(false);
  }, [suportado]);

  const falar = useCallback(
    (texto: string, opts?: { forcar?: boolean }) => {
      setUltimoTexto(texto); // aria-live sempre recebe, com voz ou sem
      if (!suportado) return;
      if (!prefsRef.current.ativo && !opts?.forcar) return;
      const synth = window.speechSynthesis;
      synth.cancel(); // um alerta novo substitui o anterior; não enfileira
      const u = new SpeechSynthesisUtterance(texto);
      const voz = escolherVoz();
      if (voz) u.voice = voz;
      u.lang = voz?.lang ?? 'pt-BR';
      u.rate = prefsRef.current.taxa;
      u.onstart = () => setFalando(true);
      u.onend = () => setFalando(false);
      u.onerror = () => setFalando(false);
      synth.speak(u);
    },
    [suportado, escolherVoz],
  );

  const setPrefs = useCallback((p: Partial<PrefsVoz>) => {
    setPrefsState((atual) => ({ ...atual, ...p }));
  }, []);

  // Ao sair da página, cala a voz.
  useEffect(() => () => parar(), [parar]);

  return { suportado, prefs, setPrefs, vozes, falando, falar, parar, ultimoTexto };
}
