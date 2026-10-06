// Login social (Google, Facebook, GitHub) — OAuth 2.0 "authorization code",
// todo do lado do servidor: o segredo de cada app nunca vai ao navegador.
//
//   GET /api/auth/provedores        quais botões estão configurados (público)
//   GET /api/auth/:provedor/entrar  → redireciona para o provedor
//   GET /api/auth/:provedor/retorno ← o provedor volta aqui com ?code&state
//
// Segurança:
//   - `state` aleatório num cookie assinado (HMAC do SESSION_SECRET, 10 min):
//     um site de terceiros não consegue "plantar" um login;
//   - só e-mail VERIFICADO pelo provedor conta;
//   - o painel é privado: só entra quem estiver em OAUTH_PERMITIDOS (e-mails
//     ou "@dominio.com"). Lista vazia = login social desligado. Sem isso,
//     qualquer conta Google/Facebook/GitHub do mundo veria os dados;
//   - deu certo: a MESMA sessão (cookie assinado) do login do admin.
// Precisa de internet (fala com o provedor); o login do admin funciona offline.
import crypto from 'node:crypto';
import express from 'express';
import { assinar, createSessionToken, iguais, parseCookies, setSessionCookie } from '../auth.js';

type NomeProvedor = 'google' | 'facebook' | 'github';
interface Perfil {
  email: string | null;
  verificado: boolean;
}

const COOKIE_ESTADO = 'omniroot_oauth';
const VALIDADE_ESTADO_MS = 10 * 60 * 1000;
const TEMPO_LIMITE_MS = 10_000;

const credenciais: Record<NomeProvedor, { id: string; segredo: string }> = {
  google: { id: process.env.GOOGLE_CLIENT_ID ?? '', segredo: process.env.GOOGLE_CLIENT_SECRET ?? '' },
  facebook: { id: process.env.FACEBOOK_APP_ID ?? '', segredo: process.env.FACEBOOK_APP_SECRET ?? '' },
  github: { id: process.env.GITHUB_CLIENT_ID ?? '', segredo: process.env.GITHUB_CLIENT_SECRET ?? '' },
};

// "ana@empresa.com, @fiap.com.br" -> e-mails exatos e domínios inteiros.
const PERMITIDOS = (process.env.OAUTH_PERMITIDOS ?? '')
  .split(/[,;\s]+/)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function configurado(p: NomeProvedor): boolean {
  return Boolean(credenciais[p].id && credenciais[p].segredo);
}

function permitido(email: string): boolean {
  const e = email.toLowerCase();
  return PERMITIDOS.some((x) => (x.startsWith('@') ? e.endsWith(x) : e === x));
}

function ehProvedor(p: string): p is NomeProvedor {
  return p === 'google' || p === 'facebook' || p === 'github';
}

// Endereço de retorno registrado no provedor. Em dev, o Vite repassa o Host
// do navegador (changeOrigin: false), então vira http://localhost:5173/...;
// OAUTH_URL_BASE fixa um endereço quando houver proxy/HTTPS na frente.
function urlRetorno(req: express.Request, p: NomeProvedor): string {
  const base = process.env.OAUTH_URL_BASE?.trim().replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  return `${base}/api/auth/${p}/retorno`;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} respondeu ${res.status}`);
  return (await res.json()) as T;
}

// ---- cada provedor: para onde mandar o usuário e como ler o e-mail ----

function urlAutorizacao(p: NomeProvedor, redirect: string, estado: string): string {
  const { id } = credenciais[p];
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (p === 'google') {
    return `https://accounts.google.com/o/oauth2/v2/auth?${q({
      client_id: id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'openid email profile',
      state: estado,
      prompt: 'select_account',
    })}`;
  }
  if (p === 'github') {
    return `https://github.com/login/oauth/authorize?${q({
      client_id: id,
      redirect_uri: redirect,
      scope: 'read:user user:email',
      state: estado,
      allow_signup: 'false',
    })}`;
  }
  // Facebook sem versão no caminho: usa a versão mais antiga ainda ativa da
  // API (uma versão fixa expira em ~2 anos e o login pararia de funcionar).
  return `https://www.facebook.com/dialog/oauth?${q({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'email,public_profile',
    state: estado,
  })}`;
}

async function perfil(p: NomeProvedor, code: string, redirect: string): Promise<Perfil> {
  const { id, segredo } = credenciais[p];
  if (p === 'google') {
    const tok = await json<{ access_token: string }>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: segredo, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const u = await json<{ email?: string; email_verified?: boolean }>('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    return { email: u.email ?? null, verificado: u.email_verified === true };
  }
  if (p === 'github') {
    const tok = await json<{ access_token?: string; error?: string }>('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: segredo, code, redirect_uri: redirect }),
    });
    if (!tok.access_token) throw new Error(`GitHub: ${tok.error ?? 'sem token'}`);
    const cab = { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'omni-root-dashboard' };
    // O e-mail do perfil pode ser privado: a lista de e-mails diz qual é o principal e se é verificado.
    const emails = await json<{ email: string; primary: boolean; verified: boolean }[]>('https://api.github.com/user/emails', { headers: cab });
    const e = emails.find((x) => x.primary && x.verified) ?? emails.find((x) => x.verified);
    return { email: e?.email ?? null, verificado: Boolean(e) };
  }
  const tok = await json<{ access_token: string }>(
    `https://graph.facebook.com/oauth/access_token?${new URLSearchParams({ client_id: id, client_secret: segredo, redirect_uri: redirect, code })}`,
  );
  const u = await json<{ email?: string }>(
    `https://graph.facebook.com/me?${new URLSearchParams({ fields: 'email', access_token: tok.access_token })}`,
  );
  // O Facebook só devolve e-mail já confirmado pela pessoa.
  return { email: u.email ?? null, verificado: Boolean(u.email) };
}

// ---- cookie de `state` (provedor.nonce.validade.assinatura) ----

function gravarEstado(req: express.Request, res: express.Response, p: NomeProvedor, nonce: string): void {
  const corpo = `${p}.${nonce}.${Date.now() + VALIDADE_ESTADO_MS}`;
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append(
    'Set-Cookie',
    `${COOKIE_ESTADO}=${corpo}.${assinar(corpo)}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${VALIDADE_ESTADO_MS / 1000}${https ? '; Secure' : ''}`,
  );
}

function lerEstado(req: express.Request, p: NomeProvedor): string | null {
  const v = parseCookies(req.headers.cookie)[COOKIE_ESTADO];
  if (!v) return null;
  const partes = v.split('.');
  if (partes.length !== 4) return null;
  const [prov, nonce, validade, sig] = partes;
  if (!iguais(sig, assinar(`${prov}.${nonce}.${validade}`))) return null;
  if (prov !== p || Date.now() > Number(validade)) return null;
  return nonce;
}

function apagarEstado(res: express.Response): void {
  res.append('Set-Cookie', `${COOKIE_ESTADO}=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0`);
}

// Volta ao app com um código de erro que a tela de login traduz.
function falha(res: express.Response, codigo: string): void {
  res.redirect(302, `/?erro_login=${encodeURIComponent(codigo)}`);
}

export const rotasOAuth = express.Router();

rotasOAuth.get('/api/auth/provedores', (_req, res) => {
  res.json({
    google: configurado('google'),
    facebook: configurado('facebook'),
    github: configurado('github'),
    permitidosDefinidos: PERMITIDOS.length > 0,
  });
});

rotasOAuth.get('/api/auth/:provedor/entrar', (req, res) => {
  const p = req.params.provedor;
  if (!ehProvedor(p)) return falha(res, 'provedor_desconhecido');
  if (!configurado(p)) return falha(res, 'nao_configurado');
  if (PERMITIDOS.length === 0) return falha(res, 'sem_permitidos');
  const nonce = crypto.randomBytes(24).toString('base64url');
  gravarEstado(req, res, p, nonce);
  res.redirect(302, urlAutorizacao(p, urlRetorno(req, p), nonce));
});

rotasOAuth.get('/api/auth/:provedor/retorno', async (req, res) => {
  const p = req.params.provedor;
  if (!ehProvedor(p) || !configurado(p)) return falha(res, 'nao_configurado');
  const esperado = lerEstado(req, p);
  apagarEstado(res);
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return falha(res, 'cancelado'); // a pessoa clicou em "cancelar" no provedor
  if (!esperado || !state || !iguais(state, esperado)) return falha(res, 'estado_invalido');
  if (!code) return falha(res, 'cancelado');
  try {
    const { email, verificado } = await perfil(p, code, urlRetorno(req, p));
    if (!email || !verificado) return falha(res, 'sem_email');
    if (!permitido(email)) {
      console.warn(`[oauth] ${p}: ${email} não está em OAUTH_PERMITIDOS — acesso negado`);
      return falha(res, 'nao_autorizado');
    }
    setSessionCookie(req, res, createSessionToken(email.toLowerCase()));
    console.info(`[oauth] ${p}: entrou ${email}`);
    res.redirect(302, '/');
  } catch (err) {
    console.error(`[oauth] ${p}: falha ao falar com o provedor —`, err instanceof Error ? err.message : err);
    falha(res, 'falha_provedor');
  }
});
