import { useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError } from '../api';
import type { Filters } from '../types';

type Kind = 'csv' | 'pdf' | 'stanford';

// Um único botão "Exportar ▾" com as três saídas num menu. Três botões lado a
// lado no cabeçalho não cabiam ao lado do título em janelas médias (o header
// quebrava em duas linhas) e competiam com o chip "Ao vivo". O menu fecha com
// clique fora, Esc ou ao escolher uma opção.
const OPCOES: { kind: Kind; titulo: string; descricao: string; run: (f: Filters) => Promise<void> }[] = [
  { kind: 'csv', titulo: 'CSV', descricao: 'Dados brutos das inspeções (Excel pt-BR)', run: (f) => api.exportCsv(f) },
  { kind: 'pdf', titulo: 'Relatório PDF', descricao: 'Sumário do período, gerado no servidor', run: (f) => api.exportPdf(f) },
  { kind: 'stanford', titulo: 'StanForD (.hpr)', descricao: 'XML padrão florestal, um arquivo por máquina em ZIP', run: (f) => api.exportStanford(f) },
];

export default function ExportMenu({
  filters,
  onUnauthorized,
}: {
  filters: Filters;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setOpen(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [open]);

  const exportar = async (kind: Kind, fn: () => Promise<void>) => {
    setOpen(false);
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

  const ocupado = OPCOES.find((o) => o.kind === busy);

  return (
    <div className="export-menu" ref={raiz}>
      <button
        type="button"
        className="btn"
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Exportar as inspeções do período e máquina filtrados"
      >
        {ocupado ? `Gerando ${ocupado.titulo}…` : 'Exportar'}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="export-dropdown" role="menu" aria-label="Formatos de exportação">
          {OPCOES.map((o) => (
            <button
              key={o.kind}
              type="button"
              role="menuitem"
              className="export-item"
              onClick={() => void exportar(o.kind, () => o.run(filters))}
            >
              <strong>{o.titulo}</strong>
              <span>{o.descricao}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <span className="export-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
