// Câmera ao vivo: máquina de campo -> servidor -> navegador.
//
// Direção do fluxo é a MESMA do sync_daemon.py (campo empurra para a
// central): o main.py faz POST de um JPEG já anotado (caixas + HUD) a poucos
// fps em /api/camera/frame. Em campo a máquina está atrás de 4G/NAT, então a
// central nunca consegue "puxar" dela — e quando não há rede, o POST falha
// na máquina, que só espera e tenta de novo; a inspeção nunca para.
//
// Aqui guardamos SÓ o último quadro por máquina, em memória. Nada vai para
// o Postgres: o dashboard continua somente-leitura no banco. O navegador
// recebe um stream MJPEG (multipart/x-mixed-replace) — um <img> basta, sem
// WebSocket, sem dependência nova — e a rota exige a sessão do dashboard
// como qualquer outra.
//
// O upload é autenticado por um token compartilhado (STREAM_TOKEN nos dois
// .env). Sem o token no servidor, o endpoint fica desligado (503) em vez de
// aceitar quadro de qualquer um.
import crypto from 'node:crypto';
import type express from 'express';

const TOKEN = process.env.STREAM_TOKEN?.trim() ?? '';
// Quadro mais velho que isso = máquina offline (ou main.py parado).
const OFFLINE_MS = Number(process.env.CAMERA_OFFLINE_MS ?? 4000);
const BOUNDARY = 'omniroot-quadro';

if (!TOKEN) {
  console.warn(
    '[camera] STREAM_TOKEN não definido no .env — a câmera ao vivo fica desligada ' +
      '(o main.py precisa do mesmo token em STREAM_TOKEN).',
  );
}

interface Quadro {
  jpeg: Buffer;
  em: number; // Date.now() da chegada
  status: string | null; // aprovado / quarentena / reprovado, como a máquina mandou
  vista: string | null; // secao / lateral / desconhecida
}

interface Assinante {
  res: express.Response;
}

const ultimoQuadro = new Map<string, Quadro>();
const assinantes = new Map<string, Set<Assinante>>();

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function headerStr(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

// Identificador da máquina = numero_serie (o maquina_id do config.json).
// Restrito a caracteres inofensivos: entra em headers e em query string.
const MAQUINA_RE = /^[A-Za-z0-9_.:\- ]{1,100}$/;

function escreverParte(res: express.Response, q: Quadro): boolean {
  try {
    res.write(
      `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${q.jpeg.length}\r\n` +
        `X-Status: ${q.status ?? ''}\r\nX-Vista: ${q.vista ?? ''}\r\n\r\n`,
    );
    res.write(q.jpeg);
    res.write('\r\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * `POST /api/camera/frame` — corpo é o JPEG cru (express.raw), headers:
 *   X-Stream-Token, X-Maquina-Id, X-Status (opcional), X-Vista (opcional).
 */
export function receberQuadro(req: express.Request, res: express.Response): void {
  if (!TOKEN) {
    res.status(503).json({ error: 'Câmera ao vivo desligada no servidor (STREAM_TOKEN ausente)' });
    return;
  }
  const token = headerStr(req.headers['x-stream-token']);
  if (!token || !safeEqual(token, TOKEN)) {
    res.status(401).json({ error: 'Token de transmissão inválido' });
    return;
  }
  const maquina = headerStr(req.headers['x-maquina-id']).trim();
  if (!MAQUINA_RE.test(maquina)) {
    res.status(400).json({ error: 'X-Maquina-Id ausente ou inválido' });
    return;
  }
  const body = req.body as unknown;
  // JPEG começa com FF D8: rejeita qualquer outra coisa antes de guardar.
  if (!Buffer.isBuffer(body) || body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) {
    res.status(415).json({ error: 'Esperado image/jpeg no corpo' });
    return;
  }

  const quadro: Quadro = {
    jpeg: body,
    em: Date.now(),
    status: headerStr(req.headers['x-status']).slice(0, 20) || null,
    vista: headerStr(req.headers['x-vista']).slice(0, 20) || null,
  };
  ultimoQuadro.set(maquina, quadro);

  const set = assinantes.get(maquina);
  if (set) {
    for (const a of set) {
      if (!escreverParte(a.res, quadro)) set.delete(a);
    }
  }
  res.status(204).end();
}

export interface CameraMaquina {
  maquina: string;
  ultimoEm: string; // ISO
  idadeMs: number;
  online: boolean;
  status: string | null;
  vista: string | null;
  ligada: boolean; // STREAM_TOKEN configurado no servidor
}

/** `GET /api/camera/maquinas` — quem já transmitiu e há quanto tempo. */
export function listarCameras(): CameraMaquina[] {
  const agora = Date.now();
  return [...ultimoQuadro.entries()]
    .map(([maquina, q]) => ({
      maquina,
      ultimoEm: new Date(q.em).toISOString(),
      idadeMs: agora - q.em,
      online: agora - q.em <= OFFLINE_MS,
      status: q.status,
      vista: q.vista,
      ligada: Boolean(TOKEN),
    }))
    .sort((a, b) => a.idadeMs - b.idadeMs);
}

/** Estado geral para o cliente saber se o recurso existe no servidor. */
export function cameraLigada(): boolean {
  return Boolean(TOKEN);
}

/**
 * `GET /api/camera/stream?maquina=<numero_serie>` — MJPEG. Manda o último
 * quadro na hora (a imagem aparece sem esperar o próximo) e depois cada
 * quadro novo conforme chega. Fica aberto enquanto o navegador quiser;
 * quando a máquina some, simplesmente para de chegar quadro — o cliente
 * decide "sem sinal" olhando /api/camera/maquinas.
 */
export function streamCamera(req: express.Request, res: express.Response): void {
  const maquina = typeof req.query.maquina === 'string' ? req.query.maquina.trim() : '';
  if (!MAQUINA_RE.test(maquina)) {
    res.status(400).json({ error: 'Parâmetro "maquina" ausente ou inválido' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store, no-transform',
    Connection: 'keep-alive',
    Pragma: 'no-cache',
    'X-Accel-Buffering': 'no',
  });
  // Nada de compressão/buffer: cada quadro tem que sair na hora.
  req.socket.setNoDelay(true);

  const atual = ultimoQuadro.get(maquina);
  if (atual) escreverParte(res, atual);

  let set = assinantes.get(maquina);
  if (!set) {
    set = new Set();
    assinantes.set(maquina, set);
  }
  const eu: Assinante = { res };
  set.add(eu);

  req.on('close', () => {
    set?.delete(eu);
    if (set && set.size === 0) assinantes.delete(maquina);
  });
}
