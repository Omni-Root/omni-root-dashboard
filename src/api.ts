import type { Bucket, Filters, HeatmapCell, Maquina, SummaryRow, TimeseriesPoint } from './types';

async function fetchJson<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== ''),
  ).toString();
  const res = await fetch(qs ? `${path}?${qs}` : path, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha na requisição (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function filterParams(f: Filters): Record<string, string> {
  return { from: f.from, to: f.to, maquinaId: f.maquinaId };
}

export const api = {
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
};
