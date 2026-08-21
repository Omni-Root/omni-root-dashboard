// Prepara um Postgres LOCAL de teste: cria o banco `desafio_madeira`, aplica o
// schema real (01_schema.sql) e o seed sintético (02_seed_dev.sql).
// Alternativa ao docker-compose para quem já tem um Postgres local vazio.
//
//   node db/dev/setup-devdb.mjs [porta=5433]
//
// NUNCA aponte este script para o banco central — ele existe só para
// desenvolvimento do dashboard.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const base = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 5433);
const conn = {
  host: 'localhost',
  port,
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD || undefined,
};

const admin = new pg.Client({ ...conn, database: 'postgres' });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'desafio_madeira'");
if (exists.rowCount === 0) {
  await admin.query('CREATE DATABASE desafio_madeira');
  console.log('banco desafio_madeira criado');
} else {
  console.log('banco desafio_madeira já existia');
}
await admin.end();

const db = new pg.Client({ ...conn, database: 'desafio_madeira' });
await db.connect();
const already = await db.query(
  "SELECT 1 FROM information_schema.tables WHERE table_name = 'toras_inspecionadas'",
);
if (already.rowCount === 0) {
  await db.query(readFileSync(join(base, '01_schema.sql'), 'utf8'));
  console.log('schema aplicado');
  await db.query(readFileSync(join(base, '02_seed_dev.sql'), 'utf8'));
  console.log('seed aplicado');
} else {
  console.log('schema já aplicado — nada a fazer');
}
const counts = await db.query(
  'SELECT status_classificacao, COUNT(*)::int AS n FROM toras_inspecionadas GROUP BY 1 ORDER BY 1',
);
console.table(counts.rows);
await db.end();
