import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { SummaryRow } from '../types';
import { STATUS_META, STATUS_ORDER } from '../types';
import { STATUS_HEX, useThemeTokens } from './useThemeTokens';

const fmt = new Intl.NumberFormat('pt-BR');

export default function ProportionDonut({ rows }: { rows: SummaryRow[] }) {
  const tokens = useThemeTokens();
  const byStatus = new Map(rows.map((r) => [r.status, r.total]));
  const data = STATUS_ORDER.map((s) => ({
    status: s,
    name: STATUS_META[s].label,
    value: byStatus.get(s) ?? 0,
  })).filter((d) => d.value > 0);

  if (data.length === 0) {
    return <div className="empty">Sem dados no período selecionado.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          stroke={tokens.surface}
          strokeWidth={2}
        >
          {data.map((d) => (
            <Cell key={d.status} fill={STATUS_HEX[d.status]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => fmt.format(value)}
          contentStyle={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            color: tokens.textSecondary,
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span style={{ color: tokens.textSecondary }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
