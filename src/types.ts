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

export type Bucket = 'hour' | 'day' | 'week';

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
