import { useState } from 'react';
import { api, UnauthorizedError } from '../api';
import type { Filters } from '../types';

type Kind = 'csv' | 'pdf' | 'stanford';

export default function ExportMenu({
  filters,
  onUnauthorized,
}: {
  filters: Filters;
  onUnauthorized: () => void;
}) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (kind: Kind, fn: () => Promise<void>) => async () => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : 'Falha na exportação');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="export-menu">
      <button
        type="button"
        className="btn"
        disabled={busy !== null}
        onClick={run('csv', () => api.exportCsv(filters))}
        title="Dados brutos das inspeções do período (Excel pt-BR)"
      >
        {busy === 'csv' ? 'Gerando…' : 'Exportar CSV'}
      </button>
      <button
        type="button"
        className="btn"
        disabled={busy !== null}
        onClick={run('pdf', () => api.exportPdf(filters))}
        title="Relatório-sumário do período, gerado no servidor"
      >
        {busy === 'pdf' ? 'Gerando…' : 'Relatório PDF'}
      </button>
      <button
        type="button"
        className="btn"
        disabled={busy !== null}
        onClick={run('stanford', () => api.exportStanford(filters))}
        title="StanForD 2010 (.hpr) — um arquivo XML por máquina, em ZIP"
      >
        {busy === 'stanford' ? 'Gerando…' : 'Export StanForD'}
      </button>
      {error && (
        <span className="export-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
