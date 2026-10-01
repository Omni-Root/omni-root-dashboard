import { nivelCelula, valorMetrica, type Mapa, type Metrica, type Nivel } from '../consultas/mapa.js';
import { INK, JD_GREEN, MUTED, NIVEL_COR, RULE, ZEBRA, num } from './pdf-estilo.js';
import { baixarTiles, type TileBaixado } from './tiles.js';

// ------------------------------------------------------------
// MAPA DO RELATÓRIO — o mesmo mapa do painel: ruas do OpenStreetMap por
// baixo, zonas coloridas, toras e a última tora por cima.
//
// Tudo na projeção dos tiles (Web Mercator), em coordenadas "de mundo"
// u, v em [0, 1]: fundo, zonas e pontos alinham exatamente como no Leaflet.
// Sem internet, o fundo de ruas não vem: o mapa sai sobre a grade de zonas,
// com aviso — o resto do relatório não muda.
// ------------------------------------------------------------
const CIRC_TERRA_M = 40_075_016.686;

function mundo(lat: number, lon: number): [number, number] {
  const r = (lat * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2];
}

export interface VistaMapa {
  uc: number; // centro da caixa, em coordenadas de mundo
  vc: number;
  S: number; // pt por unidade de mundo
  mPorPt: number; // metros por pt (para a barra de escala)
  z: number;
  tiles: TileBaixado[];
}

// Enquadra toras e zonas numa caixa w x h e baixa os tiles que a cobrem. É
// feito UMA vez: os três mapas (casca, tortuosidade, rejeição) são da mesma
// área e reaproveitam o mesmo fundo.
export async function prepararVista(mapa: Mapa, w: number, h: number): Promise<VistaMapa> {
  const us: number[] = [];
  const vs: number[] = [];
  for (const c of mapa.celulas) {
    for (const [la, lo] of [[c.lat_min, c.lon_min], [c.lat_max, c.lon_max]]) {
      const [u, v] = mundo(la, lo);
      us.push(u);
      vs.push(v);
    }
  }
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  const lat0 = (mapa.celulas[0].lat_min + mapa.celulas[0].lat_max) / 2;
  const mPorUnidade = CIRC_TERRA_M * Math.cos((lat0 * Math.PI) / 180);
  // Folga de 25% em volta e extensão mínima de ~120 m: uma zona só aparece
  // com a vizinhança (ruas, quadra), não como um quadrado colado na borda.
  const minU = 120 / mPorUnidade;
  const du = Math.max((u1 - u0) * 1.5, minU);
  const dv = Math.max((v1 - v0) * 1.5, minU * (h / w));
  const S = Math.min(w / du, h / dv);
  // Zoom dos tiles: um tile (256 px) com ~128 pt => ~2 px por pt (nítido).
  const z = Math.max(0, Math.min(19, Math.round(Math.log2(S / 128))));
  const n = 2 ** z;
  const tx0 = Math.floor((uc - w / 2 / S) * n);
  const tx1 = Math.floor((uc + w / 2 / S) * n);
  const ty0 = Math.floor((vc - h / 2 / S) * n);
  const ty1 = Math.floor((vc + h / 2 / S) * n);
  const tiles = await baixarTiles(z, tx0, tx1, ty0, ty1);
  return { uc, vc, S, mPorPt: mPorUnidade / S, z, tiles };
}

// Comprimento "redondo" para a barra de escala (~1/4 da largura do mapa).
function escalaRedonda(metros: number): number {
  const opcoes = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  return opcoes.reduce((melhor, o) => (o <= metros ? o : melhor), opcoes[0]);
}

export function desenharMapaPdf(
  doc: PDFKit.PDFDocument, mapa: Mapa, vista: VistaMapa, metrica: Metrica,
  x: number, y: number, w: number, h: number,
) {
  const { uc, vc, S, z, tiles } = vista;
  const pos = (lat: number, lon: number): [number, number] => {
    const [u, v] = mundo(lat, lon);
    return [x + w / 2 + (u - uc) * S, y + h / 2 + (v - vc) * S];
  };

  doc.save().rect(x, y, w, h).fillAndStroke(ZEBRA, RULE).restore();
  doc.save();
  doc.rect(x, y, w, h).clip();

  // Fundo: ruas (tiles) ou, sem internet, a grade de zonas.
  const n = 2 ** z;
  const lado = S / n;
  for (const t of tiles) {
    doc.image(t.png, x + w / 2 + (t.x / n - uc) * S, y + h / 2 + (t.y / n - vc) * S, { width: lado, height: lado });
  }
  if (tiles.length === 0) {
    // Grade alinhada às zonas: o passo é o tamanho de uma zona na tela.
    const c0 = mapa.celulas[0];
    const [xa, ya] = pos(c0.lat_min, c0.lon_min);
    const [xb, yb] = pos(c0.lat_max, c0.lon_max);
    const passoX = Math.abs(xb - xa);
    const passoY = Math.abs(yb - ya);
    doc.lineWidth(0.3).strokeColor(RULE);
    for (let gx = xa - Math.ceil((xa - x) / passoX) * passoX; gx <= x + w; gx += passoX) doc.moveTo(gx, y).lineTo(gx, y + h).stroke();
    for (let gy = ya - Math.ceil((ya - y) / passoY) * passoY; gy <= y + h; gy += passoY) doc.moveTo(x, gy).lineTo(x + w, gy).stroke();
  }

  // Zonas coloridas pelo indicador.
  const caixas: { c: Mapa['celulas'][number]; nivel: Nivel; x0: number; y0: number; cw: number; ch: number }[] = [];
  for (const c of mapa.celulas) {
    const nivel = nivelCelula(c, metrica);
    const cor = NIVEL_COR[nivel];
    const [x0, y0] = pos(c.lat_max, c.lon_min);
    const [x1, y1] = pos(c.lat_min, c.lon_max);
    const cw = x1 - x0;
    const ch = y1 - y0;
    doc.save().fillOpacity(nivel === 'sem' ? 0.12 : 0.45).rect(x0, y0, cw, ch).fill(cor).restore();
    doc.save().lineWidth(1).strokeColor(cor).rect(x0, y0, cw, ch).stroke().restore();
    caixas.push({ c, nivel, x0, y0, cw, ch });
  }

  // Cada tora: ponto escuro com contorno branco.
  for (const p of mapa.pontos) {
    const [px, py] = pos(p.lat, p.lon);
    doc.save().lineWidth(0.5).fillColor(INK).strokeColor('#ffffff').circle(px, py, 1.8).fillAndStroke().restore();
  }
  // Última tora: anel verde (no painel, é o ponto que pulsa).
  if (mapa.ultima) {
    const [px, py] = pos(mapa.ultima.lat, mapa.ultima.lon);
    doc.save().lineWidth(2).fillColor('#ffffff').strokeColor(JD_GREEN).circle(px, py, 4.2).fillAndStroke().restore();
  }

  // Rótulo "zona + valor" no topo de cada zona, com fundo claro: por cima de
  // tudo, legível sobre rua, cor e pontos.
  for (const { c, nivel, x0, y0, cw, ch } of caixas) {
    if (cw < 14 || ch < 9) continue;
    const v = valorMetrica(c, metrica);
    const cabeValor = cw >= 38;
    const rotValor = v == null || nivel === 'sem' ? 'sem medida' : num(v, metrica === 'falhas' ? 0 : 1, '%');
    const texto = cabeValor ? `${c.zona}  ${rotValor}` : c.zona;
    const fz = Math.max(5.5, Math.min(8, ch * 0.28));
    doc.font('Helvetica-Bold').fontSize(fz);
    const tw = Math.min(doc.widthOfString(texto) + 5, cw - 2);
    const tx = x0 + (cw - tw) / 2;
    const ty = y0 + 2;
    doc.save().fillOpacity(0.9).roundedRect(tx, ty, tw, fz + 3.5, 1.5).fill('#ffffff').restore();
    doc.font('Helvetica-Bold').fontSize(fz).fillColor(INK).text(texto, tx, ty + 1.8, { width: tw, align: 'center', lineBreak: false });
  }

  // Sem internet: diz por que não há ruas (o mapa continua certo).
  if (tiles.length === 0) {
    const aviso = 'Mapa de ruas indisponível (sem internet) — zonas e toras completas';
    doc.font('Helvetica').fontSize(7);
    const aw = doc.widthOfString(aviso) + 10;
    doc.save().fillOpacity(0.9).roundedRect(x + 6, y + 6, aw, 13, 2).fill('#ffffff').restore();
    doc.fillColor(MUTED).text(aviso, x + 11, y + 9.5, { lineBreak: false });
  }
  doc.restore(); // fim do recorte

  // Barra de escala (inferior esquerdo), norte (superior direito) e a
  // atribuição obrigatória do OSM (inferior direito), com fundo claro.
  const barraM = escalaRedonda((w * vista.mPorPt) / 4);
  const barraPt = barraM / vista.mPorPt;
  const bx = x + 8;
  const by = y + h - 9;
  doc.save().fillOpacity(0.85).roundedRect(bx - 4, by - 13, barraPt + 8, 17, 2).fill('#ffffff').restore();
  doc.save().lineWidth(1.2).strokeColor(INK).moveTo(bx, by).lineTo(bx + barraPt, by).stroke()
    .moveTo(bx, by - 3).lineTo(bx, by + 1).stroke().moveTo(bx + barraPt, by - 3).lineTo(bx + barraPt, by + 1).stroke().restore();
  doc.font('Helvetica').fontSize(6.5).fillColor(INK).text(`${barraM} m`, bx, by - 10, { lineBreak: false });

  const nx = x + w - 13;
  const ny = y + 7;
  doc.save().fillOpacity(0.85).roundedRect(nx - 7, ny - 3, 14, 23, 2).fill('#ffffff').restore();
  doc.save().polygon([nx, ny], [nx - 4, ny + 9], [nx + 4, ny + 9]).fill(INK).restore();
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(INK).text('N', nx - 2.3, ny + 11, { lineBreak: false });

  if (tiles.length > 0) {
    const attr = '© colaboradores do OpenStreetMap';
    doc.font('Helvetica').fontSize(6);
    const aw = doc.widthOfString(attr) + 6;
    doc.save().fillOpacity(0.85).rect(x + w - aw, y + h - 10, aw, 10).fill('#ffffff').restore();
    doc.fillColor(MUTED).text(attr, x + w - aw + 3, y + h - 8, { lineBreak: false });
  }
}
