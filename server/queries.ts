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

// Passo de cada granularidade, para preencher os intervalos vazios.
const PASSO: Record<Bucket, string> = {
  minute: '1 minute',
  hour: '1 hour',
  day: '1 day',
  week: '1 week',
};
// Acima disso, não preenche (30 dias por minuto seriam 43 mil pontos): devolve
// só os intervalos com dado, como antes.
const MAX_PONTOS_PREENCHIDOS = 3000;

export async function getTimeseries(f: Filters, bucket: Bucket) {
  // date_trunc aceita a unidade como parâmetro text; ainda assim `bucket` já
  // chegou aqui validado contra a whitelist em validate.ts.
  //
  // Intervalos SEM inspeção entram como zero, do primeiro ao último intervalo
  // com dado: um gráfico de linha precisa de eixo contínuo — sem isso, "por
  // hora" com dado numa hora só virava um ponto solto, e na demonstração
  // (5 minutos de inspeções) a linha não se formava.
  const { rows } = await pool.query(
    `WITH agg AS (
       SELECT date_trunc($4, data_inspecao) AS b,
              COUNT(*) FILTER (WHERE status_classificacao = 'aprovado')::int   AS aprovado,
              COUNT(*) FILTER (WHERE status_classificacao = 'quarentena')::int AS quarentena,
              COUNT(*) FILTER (WHERE status_classificacao = 'reprovado')::int  AS reprovado
       FROM toras_inspecionadas
       WHERE ${RANGE_WHERE}
       GROUP BY 1
     ),
     lim AS (SELECT MIN(b) AS b0, MAX(b) AS b1, COUNT(*) AS n FROM agg),
     eixo AS (
       SELECT gs AS b
       FROM lim, generate_series(lim.b0, lim.b1, $5::interval) AS gs
       WHERE lim.n > 0
         AND (EXTRACT(EPOCH FROM (lim.b1 - lim.b0)) / EXTRACT(EPOCH FROM $5::interval)) <= $6
       UNION
       SELECT b FROM agg
     )
     SELECT to_char(eixo.b, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
            COALESCE(agg.aprovado, 0)   AS aprovado,
            COALESCE(agg.quarentena, 0) AS quarentena,
            COALESCE(agg.reprovado, 0)  AS reprovado
     FROM eixo LEFT JOIN agg ON agg.b = eixo.b
     ORDER BY eixo.b`,
    [f.from, f.to, f.maquinaId, bucket, PASSO[bucket], MAX_PONTOS_PREENCHIDOS],
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

// ============================================================
// Consultas de EXPORTAÇÃO (CSV / PDF / StanForD)
// ============================================================
// Mesma janela de RANGE_WHERE, mas com as tabelas apelidadas ("t." etc.)
// porque as exportações fazem JOIN com máquinas/talhões.
const RANGE_WHERE_T = `
  t.data_inspecao >= $1::date
  AND t.data_inspecao < $2::date + INTERVAL '1 day'
  AND ($3::int IS NULL OR t.maquina_id = $3::int)
`;

export interface InspectionRow {
  id: number;
  data: string; // "YYYY-MM-DDTHH:mm:ss"
  status: Status;
  confianca: number; // 0..1
  log_id: string;
  maquina_modelo: string | null;
  maquina_serie: string | null;
  talhao_nome: string | null;
}

// CSV é gerado em lotes por keyset (id > último) para nunca materializar a
// tabela inteira na memória do servidor. Devolve um lote ordenado por id.
export async function fetchInspectionBatch(
  f: Filters,
  afterId: number,
  limit: number,
): Promise<InspectionRow[]> {
  const { rows } = await pool.query(
    `SELECT t.id,
            to_char(t.data_inspecao, 'YYYY-MM-DD"T"HH24:MI:SS') AS data,
            t.status_classificacao AS status,
            t.confianca_ia::float   AS confianca,
            t.log_id,
            m.modelo        AS maquina_modelo,
            m.numero_serie  AS maquina_serie,
            tal.nome        AS talhao_nome
     FROM toras_inspecionadas t
     LEFT JOIN maquinas m   ON m.id_maquina = t.maquina_id
     LEFT JOIN talhoes  tal ON tal.id_talhao = t.talhao_id
     WHERE ${RANGE_WHERE_T}
       AND t.id > $4
     ORDER BY t.id
     LIMIT $5`,
    [f.from, f.to, f.maquinaId, afterId, limit],
  );
  return rows as InspectionRow[];
}

const FALHA_SQL = `status_classificacao IN ('reprovado','quarentena')`;

export interface PdfReport {
  totals: {
    total: number;
    falhas: number;
    confMedia: number | null;
    primeiro: string | null;
    ultimo: string | null;
  };
  porStatus: { status: Status; total: number; confMedia: number | null }[];
  porMaquina: { modelo: string | null; numero_serie: string | null; total: number; falhas: number }[];
  porTalhao: { nome: string | null; total: number; falhas: number }[];
  porDow: { dow: number; total: number; falhas: number }[];
  topHoras: { hora: number; falhas: number }[];
}

export async function getPdfReport(f: Filters): Promise<PdfReport> {
  const args = [f.from, f.to, f.maquinaId];
  const [totals, porStatus, porMaquina, porTalhao, porDow, topHoras] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${FALHA_SQL})::int AS falhas,
              AVG(confianca_ia)::float AS conf_media,
              to_char(MIN(data_inspecao),'YYYY-MM-DD"T"HH24:MI:SS') AS primeiro,
              to_char(MAX(data_inspecao),'YYYY-MM-DD"T"HH24:MI:SS') AS ultimo
       FROM toras_inspecionadas WHERE ${RANGE_WHERE}`,
      args,
    ),
    pool.query(
      `SELECT status_classificacao AS status, COUNT(*)::int AS total,
              AVG(confianca_ia)::float AS conf_media
       FROM toras_inspecionadas WHERE ${RANGE_WHERE}
       GROUP BY 1`,
      args,
    ),
    pool.query(
      `SELECT m.modelo, m.numero_serie, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.${FALHA_SQL})::int AS falhas
       FROM toras_inspecionadas t LEFT JOIN maquinas m ON m.id_maquina = t.maquina_id
       WHERE ${RANGE_WHERE_T}
       GROUP BY m.modelo, m.numero_serie
       ORDER BY total DESC`,
      args,
    ),
    pool.query(
      `SELECT tal.nome, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE t.${FALHA_SQL})::int AS falhas
       FROM toras_inspecionadas t LEFT JOIN talhoes tal ON tal.id_talhao = t.talhao_id
       WHERE ${RANGE_WHERE_T}
       GROUP BY tal.nome
       ORDER BY total DESC`,
      args,
    ),
    pool.query(
      `SELECT EXTRACT(DOW FROM data_inspecao)::int AS dow, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${FALHA_SQL})::int AS falhas
       FROM toras_inspecionadas WHERE ${RANGE_WHERE}
       GROUP BY 1 ORDER BY 1`,
      args,
    ),
    pool.query(
      `SELECT EXTRACT(HOUR FROM data_inspecao)::int AS hora,
              COUNT(*) FILTER (WHERE ${FALHA_SQL})::int AS falhas
       FROM toras_inspecionadas WHERE ${RANGE_WHERE}
       GROUP BY 1 ORDER BY falhas DESC, hora LIMIT 5`,
      args,
    ),
  ]);

  const t = totals.rows[0] as {
    total: number; falhas: number; conf_media: number | null; primeiro: string | null; ultimo: string | null;
  };
  return {
    totals: {
      total: t.total,
      falhas: t.falhas,
      confMedia: t.conf_media,
      primeiro: t.primeiro,
      ultimo: t.ultimo,
    },
    porStatus: porStatus.rows.map((r) => ({
      status: r.status as Status,
      total: r.total as number,
      confMedia: r.conf_media as number | null,
    })),
    porMaquina: porMaquina.rows as PdfReport['porMaquina'],
    porTalhao: porTalhao.rows as PdfReport['porTalhao'],
    porDow: porDow.rows as PdfReport['porDow'],
    topHoras: topHoras.rows as PdfReport['topHoras'],
  };
}

// ---- StanForD ----------------------------------------------------------
export interface StanfordMachine {
  id: number;
  modelo: string;
  numero_serie: string;
}
export interface StanfordStem {
  id: number;
  uuid_local: string;
  maquina_id: number;
  log_id: string;
  data: string;
  confianca: number;
  status: Status;
  hash_sha256: string;
  talhao_nome: string | null;
  talhao_especie: string | null;
}
export interface StanfordIndicador {
  tora_id: number;
  tipo_indicador: string;
  valor: number;
  unidade: string | null;
  metodo_medicao: string;
}
export interface StanfordDefeito {
  tora_id: number;
  tipo_defeito: string;
  pos_x: number;
  pos_y: number;
  largura: number;
  altura: number;
  confianca: number;
}
export interface StanfordDataset {
  machines: StanfordMachine[];
  stems: StanfordStem[];
  indicadores: Map<number, StanfordIndicador[]>;
  defeitos: Map<number, StanfordDefeito[]>;
}

export async function getStanfordDataset(f: Filters): Promise<StanfordDataset> {
  const args = [f.from, f.to, f.maquinaId];
  const [machines, stems, indic, defs] = await Promise.all([
    pool.query(
      `SELECT DISTINCT m.id_maquina AS id, m.modelo, m.numero_serie
       FROM maquinas m JOIN toras_inspecionadas t ON t.maquina_id = m.id_maquina
       WHERE ${RANGE_WHERE_T}
       ORDER BY m.numero_serie`,
      args,
    ),
    pool.query(
      `SELECT t.id, t.uuid_local, t.maquina_id, t.log_id,
              to_char(t.data_inspecao,'YYYY-MM-DD"T"HH24:MI:SS') AS data,
              t.confianca_ia::float AS confianca, t.status_classificacao AS status,
              t.hash_sha256, tal.nome AS talhao_nome, tal.especie AS talhao_especie
       FROM toras_inspecionadas t LEFT JOIN talhoes tal ON tal.id_talhao = t.talhao_id
       WHERE ${RANGE_WHERE_T}
       ORDER BY t.maquina_id, t.id`,
      args,
    ),
    pool.query(
      `SELECT i.tora_id, i.tipo_indicador, i.valor::float AS valor, i.unidade, i.metodo_medicao
       FROM indicadores_qualidade i JOIN toras_inspecionadas t ON t.id = i.tora_id
       WHERE ${RANGE_WHERE_T}
       ORDER BY i.tora_id, i.id`,
      args,
    ),
    pool.query(
      `SELECT d.tora_id, d.tipo_defeito, d.pos_x::float, d.pos_y::float,
              d.largura::float, d.altura::float, d.confianca::float
       FROM defeitos_detectados d JOIN toras_inspecionadas t ON t.id = d.tora_id
       WHERE ${RANGE_WHERE_T}
       ORDER BY d.tora_id, d.id`,
      args,
    ),
  ]);

  const indicadores = new Map<number, StanfordIndicador[]>();
  for (const r of indic.rows as StanfordIndicador[]) {
    const list = indicadores.get(r.tora_id) ?? [];
    list.push(r);
    indicadores.set(r.tora_id, list);
  }
  const defeitos = new Map<number, StanfordDefeito[]>();
  for (const r of defs.rows as StanfordDefeito[]) {
    const list = defeitos.get(r.tora_id) ?? [];
    list.push(r);
    defeitos.set(r.tora_id, list);
  }
  return {
    machines: machines.rows as StanfordMachine[],
    stems: stems.rows as StanfordStem[],
    indicadores,
    defeitos,
  };
}
