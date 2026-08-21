import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { getHeatmap, getSummary, getTimeseries, listMaquinas } from './queries.js';
import { parseBucket, parseDate, parseMaquinaId, parseStatuses, ValidationError } from './validate.js';

const app = express();
const port = Number(process.env.API_PORT ?? 3001);

function filtersFrom(req: express.Request) {
  return {
    from: parseDate(req.query.from, 'from'),
    to: parseDate(req.query.to, 'to'),
    maquinaId: parseMaquinaId(req.query.maquinaId),
  };
}

// Envolve cada handler: erro de validação vira 400, resto vira 500 sem vazar detalhes.
function route(handler: (req: express.Request) => Promise<unknown>): express.RequestHandler {
  return async (req, res) => {
    try {
      res.json(await handler(req));
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
      } else {
        console.error(err);
        res.status(500).json({ error: 'Erro ao consultar o banco de dados' });
      }
    }
  };
}

app.get('/api/health', route(async () => {
  await pool.query('SELECT 1');
  return { ok: true };
}));

app.get('/api/maquinas', route(() => listMaquinas()));

app.get('/api/summary', route((req) => getSummary(filtersFrom(req))));

app.get('/api/timeseries', route((req) =>
  getTimeseries(filtersFrom(req), parseBucket(req.query.bucket)),
));

app.get('/api/heatmap', route((req) =>
  getHeatmap(filtersFrom(req), parseStatuses(req.query.statuses)),
));

// Em produção (`npm run build && npm start`) o Express também serve o cliente.
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
app.use(express.static(clientDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'), (err) => {
    if (err) res.status(404).end(); // dev: cliente é servido pelo Vite, não por aqui
  });
});

app.listen(port, () => {
  console.log(`API de leitura em http://localhost:${port}`);
});
