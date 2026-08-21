import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Bucket, TimeseriesPoint } from '../types';
import { STATUS_META, STATUS_ORDER } from '../types';
import { STATUS_HEX, useThemeTokens } from './useThemeTokens';

// buckets chegam como "YYYY-MM-DDTHH:mm:ss" (hora local do evento) — formata
// por fatia de string para não envolver fuso horário do navegador.
function formatBucket(b: string, bucket: Bucket): string {
  const dayPart = `${b.slice(8, 10)}/${b.slice(5, 7)}`;
  return bucket === 'hour' ? `${dayPart} ${b.slice(11, 16)}` : dayPart;
}

export default function TimeSeriesChart({
  data,
  bucket,
}: {
  data: TimeseriesPoint[];
  bucket: Bucket;
}) {
  const tokens = useThemeTokens();

  if (data.length === 0) {
    return <div className="empty">Sem dados no período selecionado.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={(b: string) => formatBucket(b, bucket)}
          tick={{ fill: tokens.muted, fontSize: 11 }}
          stroke={tokens.axis}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: tokens.muted, fontSize: 11 }}
          stroke="transparent"
          tickLine={false}
        />
        <Tooltip
          labelFormatter={(b: string) => formatBucket(b, bucket)}
          contentStyle={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            color: tokens.textSecondary,
          }}
        />
        <Legend
          iconType="plainline"
          formatter={(value: string) => (
            <span style={{ color: tokens.textSecondary }}>{value}</span>
          )}
        />
        {STATUS_ORDER.map((s) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            name={STATUS_META[s].label}
            stroke={STATUS_HEX[s]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: tokens.surface, strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
