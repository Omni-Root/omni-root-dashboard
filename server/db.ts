import pg from 'pg';

// Pool de leitura. `default_transaction_read_only=on` faz o Postgres rejeitar
// qualquer escrita nesta conexão, mesmo que um bug tente uma — o dashboard é
// somente leitura por contrato E por configuração.
export const pool = new pg.Pool({
  host: process.env.PG_HOST ?? 'localhost',
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DBNAME ?? 'desafio_madeira',
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on',
  max: 5,
  connectionTimeoutMillis: 5_000,
});
