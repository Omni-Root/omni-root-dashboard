// Autenticação simples do dashboard: um único par de credenciais vindo do
// .env (DASHBOARD_USER / DASHBOARD_PASSWORD) + cookie de sessão assinado
// com HMAC-SHA256. Sem dependências novas (só `node:crypto`) e sem escrever
// no banco — coerente com o dashboard ser somente-leitura.
import crypto from 'node:crypto';
import type express from 'express';

const COOKIE_NAME = 'omniroot_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const USER = process.env.DASHBOARD_USER ?? '';
const PASSWORD = process.env.DASHBOARD_PASSWORD ?? '';

// Segredo que assina o cookie. Se não vier no .env, gera um aleatório por boot
// (as sessões caem quando o servidor reinicia — aceitável, só avisa).
const SECRET = (() => {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  console.warn(
    '[auth] SESSION_SECRET não definido no .env — usando segredo aleatório ' +
      '(as sessões vão cair a cada reinício do servidor).',
  );
  return crypto.randomBytes(32).toString('hex');
})();

if (!USER || !PASSWORD) {
  console.warn(
    '[auth] DASHBOARD_USER/DASHBOARD_PASSWORD não definidos no .env — ' +
      'o login vai falhar até preenchê-los.',
  );
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

// Comparação de tempo constante que não vaza o tamanho: reduz cada lado a um
// digest de tamanho fixo antes do timingSafeEqual.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Confere usuário+senha contra o par do .env, em tempo constante. */
export function checkCredentials(user: unknown, password: unknown): boolean {
  if (!USER || !PASSWORD) return false;
  if (typeof user !== 'string' || typeof password !== 'string') return false;
  // Avalia os dois lados sempre (sem curto-circuito) para não vazar por timing.
  const okUser = safeEqual(user, USER);
  const okPass = safeEqual(password, PASSWORD);
  return okUser && okPass;
}

/** Cria um token de sessão assinado: base64url(payload).base64url(hmac). */
export function createSessionToken(user: string): string {
  const payload = JSON.stringify({ u: user, exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = b64url(Buffer.from(payload, 'utf8'));
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

/** Valida o token; devolve o usuário se a assinatura bate e não expirou. */
export function verifySessionToken(token: string | undefined): { user: string } | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      u?: unknown;
      exp?: unknown;
    };
    if (typeof data.u !== 'string' || typeof data.exp !== 'number') return null;
    if (Date.now() > data.exp) return null;
    return { user: data.u };
  } catch {
    return null;
  }
}

/** Parser mínimo de cookies (sem dependência de cookie-parser). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function isHttps(req: express.Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** Grava o cookie de sessão na resposta. */
export function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

/** Limpa o cookie de sessão (logout). */
export function clearSessionCookie(req: express.Request, res: express.Response): void {
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isHttps(req)) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

/** Lê a sessão válida do request, se houver. */
export function sessionFrom(req: express.Request): { user: string } | null {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

/** Middleware: bloqueia rotas de dados sem sessão válida (401). */
export const requireAuth: express.RequestHandler = (req, res, next) => {
  if (sessionFrom(req)) return next();
  res.status(401).json({ error: 'Não autenticado' });
};
