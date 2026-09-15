import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { getHeatmap, getSummary, getTimeseries, listMaquinas } from './queries.js';
import { parseBucket, parseDate, parseMaquinaId, parseStatuses, ValidationError } from './validate.js';
import {
  checkCredentials,
  clearSessionCookie,
  createSessionToken,
  requireAuth,
  sessionFrom,
  setSessionCookie,
} from './auth.js';
import { streamCsv } from './export-csv.js';
import { streamPdf } from './export-pdf.js';
import { streamStanford } from './export-stanford.js';
import { iniciarTempoReal, rotaEventos } from './live.js';

const app = express();
const port = Number(process.env.API_PORT ?? 3001);

app.use(express.json({ limit: '64kb' }));

function filtersFrom(req: express.Request) {
  return {
    from: parseDate(req.query.from, 'from'),
    to: parseDate(req.query.to, 'to'),
    maquinaId: parseMaquinaId(req.query.maquinaId),
  };
}

// Envolve cada handler JSON: erro de validação vira 400, resto vira 500 sem vazar detalhes.
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

// Rotas de exportação: entregam arquivo (não JSON). Validam os filtros ANTES de
// começar a escrever a resposta, então um erro de parâmetro ainda vira 400 limpo.
function exportRoute(
  stream: (f: ReturnType<typeof filtersFrom>, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return async (req, res) => {
    let filters: ReturnType<typeof filtersFrom>;
    try {
      filters = filtersFrom(req);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    try {
      await stream(filters, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'Erro ao gerar a exportação' });
      else res.end();
    }
  };
}

// ---- Saúde (público) ----
app.get('/api/health', route(async () => {
  await pool.query('SELECT 1');
  return { ok: true };
}));

// ---- Autenticação ----
app.post('/api/login', (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  const token = createSessionToken(username as string);
  setSessionCookie(req, res, token);
  res.json({ user: username });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const sess = sessionFrom(req);
  res.json(sess ? { authenticated: true, user: sess.user } : { authenticated: false });
});

// ---- Rotas de dados (exigem sessão) ----
app.get('/api/maquinas', requireAuth, route(() => listMaquinas()));

app.get('/api/summary', requireAuth, route((req) => getSummary(filtersFrom(req))));

app.get('/api/timeseries', requireAuth, route((req) =>
  getTimeseries(filtersFrom(req), parseBucket(req.query.bucket)),
));

app.get('/api/heatmap', requireAuth, route((req) =>
  getHeatmap(filtersFrom(req), parseStatuses(req.query.statuses)),
));

// ---- Tempo real (exige sessão): SSE com avisos de tora nova ----
app.get('/api/events', requireAuth, rotaEventos);

// ---- Exportações (exigem sessão) ----
app.get('/api/export/csv', requireAuth, exportRoute(streamCsv));
app.get('/api/export/pdf', requireAuth, exportRoute(streamPdf));
app.get('/api/export/stanford', requireAuth, exportRoute(streamStanford));

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
  void iniciarTempoReal();
});
