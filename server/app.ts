// Monta a aplicação Express: middlewares, as rotas da API (agrupadas por
// assunto em rotas/) e, em produção, o cliente já compilado.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rotasSessao } from './rotas/sessao.js';
import { rotasOAuth } from './rotas/oauth.js';
import { rotasPainel } from './rotas/painel.js';
import { rotasCamera } from './rotas/camera.js';
import { rotasExportacoes } from './rotas/exportacoes.js';

export function criarApp(): express.Express {
  const app = express();

  app.use(express.json({ limit: '64kb' }));

  app.use(rotasSessao);
  app.use(rotasOAuth); // login social (Google, Microsoft, GitHub)
  app.use(rotasPainel);
  app.use(rotasCamera);
  app.use(rotasExportacoes);

  // Em produção (`npm run build && npm start`) o Express também serve o cliente.
  const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client');
  app.use(express.static(clientDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'), (err) => {
      if (err) res.status(404).end(); // dev: cliente é servido pelo Vite, não por aqui
    });
  });

  return app;
}
