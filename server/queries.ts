import { pool } from './db.js';
import type { Bucket, Status } from './validate.js';

// Todas as consultas são parametrizadas e agregam NO BANCO — nunca trazem a
// tabela de eventos inteira. O intervalo é [from, to] inclusivo em dias:
// data_inspecao >= from::date AND data_inspecao < to::date + 1 dia.
const RANGE_WHERE = `
  data_inspecao >= $1::date
  AND data_inspecao < $2::date + INTERVAL '1 day'
  AND ($3::int IS NULL OR maquina_id = $3::int)
`;

export interface Filters {
  from: string;
  to: string;
  maquinaId: number | null;
}

export async function listMaquinas() {
  const { rows } = await pool.query(
    `SELECT id_maquina AS id, modelo, numero_serie
     FROM maquinas
     ORDER BY modelo, numero_serie`,
  );
  return rows as { id: number; modelo: string; numero_serie: string }[];
}

export async function getSummary(f: Filters) {
  const { rows } = await pool.query(
    `SELECT status_classificacao AS status, COUNT(*)::int AS total
     FROM toras_inspecionadas
     WHERE ${RANGE_WHERE}
     GROUP BY status_classificacao`,
    [f.from, f.to, f.maquinaId],
  );
  return rows as { status: Status; total: number }[];
}

export async function getTimeseries(f: Filters, bucket: Bucket) {
  // date_trunc aceita a unidade como parâmetro text; ainda assim `bucket` já
  // chegou aqui validado contra a whitelist em validate.ts.
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc($4, data_inspecao), 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
            COUNT(*) FILTER (WHERE status_classificacao = 'aprovado')::int   AS aprovado,
            COUNT(*) FILTER (WHERE status_classificacao = 'quarentena')::int AS quarentena,
            COUNT(*) FILTER (WHERE status_classificacao = 'reprovado')::int  AS reprovado
     FROM toras_inspecionadas
     WHERE ${RANGE_WHERE}
     GROUP BY 1
     ORDER BY 1`,
    [f.from, f.to, f.maquinaId, bucket],
  );
  return rows as { bucket: string; aprovado: number; quarentena: number; reprovado: number }[];
}

export async function getHeatmap(f: Filters, statuses: Status[]) {
  // dow: 0 = domingo ... 6 = sábado (convenção do EXTRACT(DOW) do Postgres)
  const { rows } = await pool.query(
    `SELECT EXTRACT(DOW FROM data_inspecao)::int  AS dow,
            EXTRACT(HOUR FROM data_inspecao)::int AS hora,
            COUNT(*)::int AS total
     FROM toras_inspecionadas
     WHERE ${RANGE_WHERE}
       AND status_classificacao = ANY($4::text[])
     GROUP BY 1, 2`,
    [f.from, f.to, f.maquinaId, statuses],
  );
  return rows as { dow: number; hora: number; total: number }[];
}
