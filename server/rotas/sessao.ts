// Saúde do servidor/banco (pública) e sessão: login, logout e "quem sou eu".
import express from 'express';
import { pool } from '../db.js';
import { checkCredentials, clearSessionCookie, createSessionToken, sessionFrom, setSessionCookie } from '../auth.js';
import { route } from '../http.js';

export const rotasSessao = express.Router();

// ---- Saúde (público) ----
rotasSessao.get('/api/health', route(async () => {
  await pool.query('SELECT 1');
  return { ok: true };
}));

// ---- Autenticação ----
rotasSessao.post('/api/login', (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  const token = createSessionToken(username as string);
  setSessionCookie(req, res, token);
  res.json({ user: username });
});

rotasSessao.post('/api/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

rotasSessao.get('/api/me', (req, res) => {
  const sess = sessionFrom(req);
  res.json(sess ? { authenticated: true, user: sess.user } : { authenticated: false });
});
