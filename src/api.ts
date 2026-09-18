import type {
  Bucket,
  CameraEstado,
  Filters,
  HeatmapCell,
  Maquina,
  Qualidade,
  SummaryRow,
  TimeseriesPoint,
  UltimaInspecao,
} from './types';

// Erro específico para 401: deixa o App voltar para a tela de login quando a
// sessão expira no meio do uso.
export class UnauthorizedError extends Error {
  constructor() {
    super('Sessão expirada');
    this.name = 'UnauthorizedError';
  }
}

function qsFrom(params: Record<string, string>): string {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '')).toString();
}

async function fetchJson<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const qs = qsFrom(params);
  const res = await fetch(qs ? `${path}?${qs}` : path, { signal });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha na requisição (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// Dispara o download de um arquivo servido por uma rota GET (usa o cookie de
// sessão automaticamente por ser same-origin).
async function download(path: string, params: Record<string, string>): Promise<void> {
  const qs = qsFrom(params);
  const res = await fetch(qs ? `${path}?${qs}` : path);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha na exportação (${res.status})`);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function filterParams(f: Filters): Record<string, string> {
  return { from: f.from, to: f.to, maquinaId: f.maquinaId };
}

export interface MeResponse {
  authenticated: boolean;
  user?: string;
}

export const api = {
  // ---- saúde do servidor/banco (pública) ----
  health: async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  },

  // ---- sessão ----
  me: async (): Promise<MeResponse> => {
    const res = await fetch('/api/me');
    if (!res.ok) return { authenticated: false };
    return res.json() as Promise<MeResponse>;
  },
  login: async (username: string, password: string): Promise<{ user: string }> => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Falha no login (${res.status})`);
    }
    return res.json() as Promise<{ user: string }>;
  },
  logout: async (): Promise<void> => {
    await fetch('/api/logout', { method: 'POST' });
  },

  // ---- dados ----
  maquinas: (signal?: AbortSignal) => fetchJson<Maquina[]>('/api/maquinas', {}, signal),
  summary: (f: Filters, signal?: AbortSignal) =>
    fetchJson<SummaryRow[]>('/api/summary', filterParams(f), signal),
  timeseries: (f: Filters, bucket: Bucket, signal?: AbortSignal) =>
    fetchJson<TimeseriesPoint[]>('/api/timeseries', { ...filterParams(f), bucket }, signal),
  heatmap: (f: Filters, statuses: string[], signal?: AbortSignal) =>
    fetchJson<HeatmapCell[]>(
      '/api/heatmap',
      { ...filterParams(f), statuses: statuses.join(',') },
      signal,
    ),

  // ---- indicadores de qualidade ----
  ultima: (f: Filters, signal?: AbortSignal) =>
    fetchJson<UltimaInspecao | null>('/api/ultima', { maquinaId: f.maquinaId }, signal),
  qualidade: (f: Filters, signal?: AbortSignal) =>
    fetchJson<Qualidade>('/api/qualidade', filterParams(f), signal),

  // ---- câmera ao vivo ----
  camera: (signal?: AbortSignal) => fetchJson<CameraEstado>('/api/camera/maquinas', {}, signal),
  // URL do stream MJPEG (vai direto num <img>; o cookie de sessão vai junto por
  // ser same-origin). `v` muda para forçar reconexão quando o stream cai.
  cameraStreamUrl: (maquina: string, v: number) =>
    `/api/camera/stream?maquina=${encodeURIComponent(maquina)}&v=${v}`,

  // ---- exportações ----
  exportCsv: (f: Filters) => download('/api/export/csv', filterParams(f)),
  exportPdf: (f: Filters) => download('/api/export/pdf', filterParams(f)),
  exportStanford: (f: Filters) => download('/api/export/stanford', filterParams(f)),
};
