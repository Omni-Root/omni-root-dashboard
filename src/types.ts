export type Status = 'aprovado' | 'quarentena' | 'reprovado';

export interface Maquina {
  id: number;
  modelo: string;
  numero_serie: string;
}

export interface SummaryRow {
  status: Status;
  total: number;
}

export interface TimeseriesPoint {
  bucket: string; // "YYYY-MM-DDTHH:mm:ss" (hora local do evento, sem fuso)
  aprovado: number;
  quarentena: number;
  reprovado: number;
}

export interface HeatmapCell {
  dow: number; // 0 = domingo ... 6 = sábado
  hora: number; // 0..23
  total: number;
}

export type Bucket = 'minute' | 'hour' | 'day' | 'week';

export interface Filters {
  from: string;
  to: string;
  maquinaId: string; // '' = todas
}

// Rótulos e cores de status usados em toda a UI (cores de status são fixas,
// nunca reaproveitadas como cores de série genéricas).
export const STATUS_META: Record<Status, { label: string; cssVar: string }> = {
  aprovado: { label: 'Aprovada', cssVar: 'var(--status-good)' },
  quarentena: { label: 'Contenção', cssVar: 'var(--status-warning)' },
  reprovado: { label: 'Rejeitada', cssVar: 'var(--status-critical)' },
};

export const STATUS_ORDER: Status[] = ['aprovado', 'quarentena', 'reprovado'];

// ---- Indicadores de qualidade (o que o desafio pede) ----
export type TipoDado = 'laboratorio' | 'literatura' | 'referencia_generica' | null;

export interface DensidadeInfo {
  valor: number | null;
  clone: string | null;
  tipo_dado: TipoDado;
  min: number | null;
  max: number | null;
  fonte: string | null;
}

export interface UltimaInspecao {
  id: number;
  data: string;
  status: Status;
  confianca: number;
  log_id: string;
  maquina_modelo: string | null;
  maquina_serie: string | null;
  talhao_nome: string | null;
  vista: 'secao' | 'lateral' | 'desconhecida';
  diametro_cm: number | null;
  comprimento_cm: number | null;
  comprimento_medido: boolean;
  tortuosidade: number | null;
  casca_pct: number | null;
  volume_m3: number | null;
  massa_kg: number | null;
  massa_min_kg: number | null;
  massa_max_kg: number | null;
  densidade: DensidadeInfo;
  saude_pct: number | null;
  defeitos: number;
  defeitos_tipos: string[];
}

export interface QualidadeTalhao {
  talhao: string | null;
  clone: string | null;
  tipo_dado: TipoDado;
  densidade: number | null;
  densidade_min: number | null;
  densidade_max: number | null;
  toras: number;
  falhas: number;
  casca_media: number | null;
  tort_media: number | null;
  tort_n: number;
  diam_medio: number | null;
  volume_m3: number | null;
  massa_kg: number | null;
  massa_min_kg: number | null;
  massa_max_kg: number | null;
}

export interface Faixa {
  faixa: string;
  total: number;
}

export interface Qualidade {
  porTalhao: QualidadeTalhao[];
  tortuosidade: Faixa[];
  casca: Faixa[];
  diametro: Faixa[];
}

// Rótulo da proveniência da densidade — a "base científica" virando pixel:
// o gestor vê de onde o número veio, não só o número.
export const TIPO_DADO_META: Record<Exclude<TipoDado, null>, { label: string; hint: string }> = {
  laboratorio: { label: 'Laboratório', hint: 'Laudo de densidade básica do próprio clone' },
  literatura: { label: 'Literatura', hint: 'Valor publicado para este clone específico' },
  referencia_generica: {
    label: 'Referência genérica',
    hint: 'Média do híbrido E. grandis × urophylla; aguardando laudo do clone',
  },
};

// ---- Câmera ao vivo (quadros empurrados pelo main.py) ----
export interface CameraMaquina {
  maquina: string; // numero_serie (maquina_id do config.json da máquina)
  ultimoEm: string; // ISO
  idadeMs: number;
  online: boolean; // quadro recente o bastante para ser "ao vivo"
  status: Status | string | null;
  vista: string | null;
  ligada: boolean;
}

export interface CameraEstado {
  ligada: boolean; // STREAM_TOKEN configurado no servidor
  maquinas: CameraMaquina[];
}
