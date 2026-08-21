import type { SummaryRow } from '../types';
import { STATUS_META, STATUS_ORDER } from '../types';

const fmt = new Intl.NumberFormat('pt-BR');
const fmtPct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

export default function SummaryCards({ rows }: { rows: SummaryRow[] }) {
  const byStatus = new Map(rows.map((r) => [r.status, r.total]));
  const total = rows.reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="cards">
      <div className="card">
        <div className="card-label">Peças inspecionadas</div>
        <div className="card-value">{fmt.format(total)}</div>
        <div className="card-share">no período selecionado</div>
      </div>
      {STATUS_ORDER.map((s) => {
        const n = byStatus.get(s) ?? 0;
        return (
          <div className="card" key={s}>
            <div className="card-label">
              <span className="dot" style={{ background: STATUS_META[s].cssVar }} />
              {STATUS_META[s].label}
            </div>
            <div className="card-value">{fmt.format(n)}</div>
            <div className="card-share">{total > 0 ? fmtPct.format(n / total) : '—'}</div>
          </div>
        );
      })}
    </div>
  );
}
