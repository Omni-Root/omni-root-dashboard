// Relatório PDF — sumário do período (não é uma captura de tela do navegador;
// é gerado no servidor com pdfkit). Respeita o período e a máquina filtrados.
//
// Duas armadilhas do pdfkit que este arquivo evita de propósito:
//   1. `doc.text(txt)` sem X continua da posição X da ÚLTIMA escrita — depois
//      de uma tabela, títulos "escorregam" para a coluna da direita. Aqui todo
//      texto de bloco recebe X = margem esquerda explicitamente.
//   2. Escrever abaixo da margem inferior (rodapé) faz o pdfkit abrir uma
//      página nova em branco. O rodapé zera a margem inferior enquanto escreve.
import type express from 'express';
import PDFDocument from 'pdfkit';
import { getPdfReport, type Filters } from './queries.js';
import { getQualidade } from './qualidade.js';
import { getMapa, nivelCelula, valorMetrica, LIMITES, type Mapa, type Metrica, type Nivel } from './mapa.js';
import { STATUS_LABEL, DOW_LABEL, FONTE_POSICAO_LABEL, fmtDateBR } from './labels.js';
import { baixarTiles, type TileBaixado } from './tiles.js';
import type { Status } from './validate.js';

// Identidade John Deere: verde (PMS 364) e amarelo (PMS 109).
const JD_GREEN = '#367c2b';
const JD_GREEN_DARK = '#2a5f22';
const JD_YELLOW = '#ffde00';
const INK = '#161a15';
const MUTED = '#5f6a5c';
const RULE = '#d9e0d5';
const ZEBRA = '#f3f6f1';
const STATUS_COLOR: Record<Status, string> = {
  aprovado: JD_GREEN,
  quarentena: '#c98f00',
  reprovado: '#b8322b',
};

function pct(n: number, d: number): string {
  return d > 0 ? ((n / d) * 100).toFixed(1).replace('.', ',') + '%' : '—';
}
function conf(v: number | null): string {
  return v == null ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%';
}
function num(v: number | null | undefined, casas = 1, sufixo = ''): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(casas).replace('.', ',') + sufixo;
}
// Helvetica padrão do pdfkit (WinAnsi) não tem ≤ ≥ — sairiam como "'d"/"'e".
function ascii(txt: string): string {
  return txt.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/–/g, '-');
}
function tipoDadoLabel(t: string | null): string {
  return t === 'laboratorio' ? 'laboratório' : t === 'literatura' ? 'literatura' : t === 'referencia_generica' ? 'ref. genérica' : '—';
}

const NIVEL_COR: Record<Nivel, string> = {
  ok: JD_GREEN,
  atencao: '#c98f00',
  critico: '#b8322b',
  sem: '#9aa596',
};
const METRICA_TITULO: Record<Metrica, string> = {
  casca: 'Casca residual',
  tort: 'Tortuosidade',
  falhas: 'Rejeição',
};

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

interface VistaMapa {
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
async function prepararVista(mapa: Mapa, w: number, h: number): Promise<VistaMapa> {
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

function desenharMapaPdf(
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

export async function streamPdf(f: Filters, res: express.Response): Promise<void> {
  const [rep, qual, mapa] = await Promise.all([
    getPdfReport(f),
    getQualidade(f).catch(() => null),
    getMapa(f).catch(() => null),
  ]);
  const filename = `relatorio_${f.from}_a_${f.to}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'Omni-Root — Relatório de qualidade da madeira' } });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 24; // deixa espaço para o rodapé

  // ---- Faixa de cabeçalho (verde JD com filete amarelo) ----
  const drawHeaderBand = () => {
    doc.save();
    doc.rect(0, 0, doc.page.width, 64).fill(JD_GREEN);
    doc.rect(0, 64, doc.page.width, 4).fill(JD_YELLOW);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text('Omni-Root · Qualidade da Madeira', left, 18, { width, lineBreak: false });
    doc.font('Helvetica').fontSize(9.5).fillColor('#e8f0e5').text('Relatório de inspeções · Challenge John Deere / Suzano / Eldorado', left, 40, { width, lineBreak: false });
    doc.restore();
  };
  drawHeaderBand();
  doc.y = 84;

  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(
    `Período: ${fmtDateBR(f.from)} a ${fmtDateBR(f.to)}` +
      (f.maquinaId ? `  ·  Máquina #${f.maquinaId}` : '  ·  Todas as máquinas') +
      `  ·  Gerado em ${fmtDateBR(new Date().toISOString().slice(0, 19))}`,
    left, doc.y, { width },
  );
  doc.moveDown(0.9);

  if (rep.totals.total === 0) {
    doc.font('Helvetica').fontSize(12).fillColor(INK).text(
      'Nenhuma inspeção encontrada para o período e filtros selecionados.', left, doc.y, { width },
    );
    rodape();
    doc.end();
    return;
  }

  // ---- KPIs em cartões ----
  const { total, falhas, confMedia } = rep.totals;
  const massaTotalKg = qual ? qual.porTalhao.reduce((a, r) => a + (r.massa_kg ?? 0), 0) : null;
  const volumeTotal = qual ? qual.porTalhao.reduce((a, r) => a + (r.volume_m3 ?? 0), 0) : null;
  const kpis: [string, string, string?][] = [
    ['Inspeções', String(total), '100% das toras, não amostra'],
    ['Taxa de aprovação', pct(total - falhas, total), `${falhas} em contenção/rejeitadas`],
    ['Confiança média da IA', conf(confMedia)],
    ['Massa seca estimada', massaTotalKg != null ? num(massaTotalKg / 1000, 2, ' t') : '—', volumeTotal != null ? `${num(volumeTotal, 2)} m³ medidos` : undefined],
  ];
  const gap = 10;
  const kpiW = (width - gap * (kpis.length - 1)) / kpis.length;
  const kpiH = 58;
  const ky = doc.y;
  kpis.forEach(([label, value, sub], i) => {
    const x = left + i * (kpiW + gap);
    doc.save();
    doc.roundedRect(x, ky, kpiW, kpiH, 6).fillAndStroke(ZEBRA, RULE);
    doc.rect(x, ky, 4, kpiH).fill(JD_GREEN);
    doc.restore();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, x + 12, ky + 9, { width: kpiW - 18, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(value, x + 12, ky + 21, { width: kpiW - 18, lineBreak: false });
    if (sub) doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(sub, x + 12, ky + 43, { width: kpiW - 18, lineBreak: false });
  });
  doc.y = ky + kpiH + 14;

  // ---- Seções e tabelas ----
  const section = (title: string, sub?: string) => {
    if (doc.y > bottomLimit() - 90) novaPagina();
    doc.moveDown(0.5);
    const y = doc.y;
    doc.save().rect(left, y + 2, 3, 12).fill(JD_YELLOW).restore();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(JD_GREEN_DARK).text(title, left + 10, y, { width: width - 10 });
    if (sub) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(sub, left + 10, doc.y, { width: width - 10 });
    doc.moveDown(0.35);
  };

  const novaPagina = () => {
    doc.addPage();
    drawHeaderBand();
    doc.y = 84;
  };

  // Tabela com larguras relativas, cabeçalho verde, zebra e quebra de página
  // que repete o cabeçalho.
  const table = (
    headers: string[],
    widths: number[],
    rows: string[][],
    aligns: ('left' | 'right')[] = [],
    opts: { colorCol?: number; colors?: (string | null)[] } = {},
  ) => {
    const colX = (i: number) => left + widths.slice(0, i).reduce((a, b) => a + b, 0) * width;
    const colW = (i: number) => widths[i] * width;
    const rowH = (cells: string[], size: number) => {
      doc.fontSize(size);
      return Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: colW(i) - 8 }))) + 7;
    };
    // Cabeçalho + primeira linha juntos: cabeçalho sozinho no pé da página
    // (com as linhas na seguinte) não serve para nada.
    if (rows.length > 0 && doc.y + rowH(headers, 8.5) + rowH(rows[0], 9) > bottomLimit()) novaPagina();
    const drawHeader = () => {
      const h = rowH(headers, 8.5);
      doc.save().rect(left, doc.y, width, h).fill(JD_GREEN).restore();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      const y = doc.y;
      headers.forEach((c, i) => doc.text(c, colX(i) + 4, y + 3.5, { width: colW(i) - 8, align: aligns[i] ?? 'left', lineBreak: false }));
      doc.y = y + h;
    };
    drawHeader();
    rows.forEach((cells, r) => {
      const h = rowH(cells, 9);
      if (doc.y + h > bottomLimit()) {
        novaPagina();
        drawHeader();
      }
      const y = doc.y;
      if (r % 2 === 1) doc.save().rect(left, y, width, h).fill(ZEBRA).restore();
      cells.forEach((c, i) => {
        const cor = opts.colorCol === i && opts.colors?.[r] ? opts.colors[r]! : INK;
        doc.font(opts.colorCol === i ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(cor);
        doc.text(c, colX(i) + 4, y + 3.5, { width: colW(i) - 8, align: aligns[i] ?? 'left' });
      });
      doc.y = y + h;
      doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.4).strokeColor(RULE).stroke();
    });
    doc.moveDown(0.4);
  };

  // ---- Por classificação ----
  section('Por classificação', 'Aprovada segue para a fábrica; Contenção vai para revisão manual; Rejeitada sai do fluxo.');
  const statusOrder: Status[] = ['aprovado', 'quarentena', 'reprovado'];
  const byStatus = new Map(rep.porStatus.map((r) => [r.status, r]));
  const statusRows = statusOrder.filter((s) => byStatus.has(s));
  table(
    ['Classificação', 'Inspeções', 'Participação', 'Confiança média IA'],
    [0.4, 0.2, 0.2, 0.2],
    statusRows.map((s) => {
      const r = byStatus.get(s)!;
      return [STATUS_LABEL[s], String(r.total), pct(r.total, total), conf(r.confMedia)];
    }),
    ['left', 'right', 'right', 'right'],
    { colorCol: 0, colors: statusRows.map((s) => STATUS_COLOR[s]) },
  );

  // ---- Qualidade da madeira (o que o desafio pede) ----
  if (qual && qual.porTalhao.length > 0) {
    section(
      'Qualidade da madeira por talhão e clone',
      'Casca residual e tortuosidade medidas pela câmera; densidade é referência por clone (proveniência indicada); massa seca = volume medido × densidade.',
    );
    table(
      ['Talhão', 'Clone', 'Toras', 'Casca', 'Tortuos.', 'Diâm.', 'Densid.', 'Proven.', 'Volume', 'Massa'],
      [0.16, 0.1, 0.07, 0.09, 0.12, 0.09, 0.1, 0.1, 0.09, 0.08],
      qual.porTalhao.map((r) => [
        r.talhao ?? '—',
        r.clone ?? '—',
        String(r.toras),
        num(r.casca_media, 1, '%'),
        r.tort_n > 0 ? `${num(r.tort_media, 1, '%')} (n=${r.tort_n})` : 'n/a (seção)',
        num(r.diam_medio, 1, ' cm'),
        num(r.densidade, 0, ' kg/m³'),
        tipoDadoLabel(r.tipo_dado),
        num(r.volume_m3, 2, ' m³'),
        r.massa_kg != null ? num(r.massa_kg / 1000, 2, ' t') : '—',
      ]),
      ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'left', 'right', 'right'],
    );

    const hist = (titulo: string, faixas: { faixa: string; total: number }[]) => {
      const n = faixas.reduce((a, b) => a + b.total, 0);
      if (n === 0) return;
      if (doc.y > bottomLimit() - 80) novaPagina();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(titulo, left, doc.y, { width });
      doc.moveDown(0.25);
      const maxT = Math.max(...faixas.map((x) => x.total));
      const labelW = 110;
      const barW = width - labelW - 60;
      faixas.forEach((fx) => {
        const y = doc.y;
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(ascii(fx.faixa), left, y + 1, { width: labelW - 6, lineBreak: false });
        const w = maxT > 0 ? (fx.total / maxT) * barW : 0;
        doc.save().rect(left + labelW, y, Math.max(w, 1), 10).fill(w > 0 ? JD_GREEN : RULE).restore();
        doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(`${fx.total} (${pct(fx.total, n)})`, left + labelW + w + 6, y + 1, { lineBreak: false });
        doc.y = y + 14;
      });
      doc.moveDown(0.5);
    };
    hist('Distribuição de casca residual (toras)', qual.casca);
    hist('Distribuição de tortuosidade (só toras vistas de lado)', qual.tortuosidade);
  }

  // ---- Mapa de qualidade + Onde agir ----
  if (mapa && mapa.disponivel && mapa.com_posicao > 0) {
    // Uma página para os mapas: três mapas grandes (um por indicador), como o
    // painel mostra alternando o seletor. Mesma área => o fundo de ruas é
    // baixado uma vez e reaproveitado.
    const mapaH = 172;
    const blocoH = 13 + mapaH + 18; // título + mapa + legenda
    if (doc.y + 40 + blocoH * 3 > bottomLimit()) novaPagina();
    section(
      'Mapa de qualidade',
      `Toras na posição da máquina no corte, agrupadas em zonas de ${mapa.celula_m} m; cada ponto é uma tora, ` +
        `o anel verde é a mais recente. ${mapa.com_posicao} de ${mapa.total} toras do período com posição.`,
    );
    const vista = await prepararVista(mapa, width, mapaH);
    const metricas: Metrica[] = ['casca', 'tort', 'falhas'];
    for (const m of metricas) {
      if (doc.y + blocoH > bottomLimit()) novaPagina();
      const topo = doc.y;
      const [ok, at] = LIMITES[m];
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(METRICA_TITULO[m], left, topo, { width, lineBreak: false });
      desenharMapaPdf(doc, mapa, vista, m, left, topo + 13, width, mapaH);
      // Legenda: os limites que coloriram as zonas.
      const ly = topo + 13 + mapaH + 4;
      const faixas: [Nivel, string][] =
        m === 'tort'
          ? [['ok', `< ${ok}%`], ['atencao', `${ok}-${at}%`], ['critico', `>= ${at}%`], ['sem', 'sem medida']]
          : [['ok', `<= ${ok}%`], ['atencao', `${ok}-${at}%`], ['critico', `> ${at}%`], ['sem', 'sem medida']];
      let lx = left;
      for (const [nv, rot] of faixas) {
        doc.save().fillOpacity(nv === 'sem' ? 0.3 : 1).rect(lx, ly + 1, 7, 7).fill(NIVEL_COR[nv]).restore();
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(rot, lx + 10, ly + 0.5, { lineBreak: false });
        lx += 10 + doc.widthOfString(rot) + 10;
      }
      doc.y = topo + blocoH;
    }
    if (vista.tiles.length === 0) {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
        'Mapa de ruas não incluído: o servidor não alcançou o OpenStreetMap ao gerar este relatório. Zonas, toras e valores estão completos.',
        left, doc.y, { width },
      );
      doc.moveDown(0.3);
    }

    const fontes = mapa.fontes
      .map((fo) => `${FONTE_POSICAO_LABEL[fo.fonte] ?? fo.fonte} (${fo.toras})`)
      .join('; ');
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
      `Posição: ${fontes}. É a posição da MÁQUINA no corte; a árvore está no alcance da grua (~10 m), além do erro da própria fonte.`,
      left, doc.y, { width },
    );
    doc.moveDown(0.6);

    // Título + cabeçalho + ao menos duas linhas juntos: sem isso o título
    // ficava sozinho no pé da página e a tabela começava na seguinte.
    if (doc.y > bottomLimit() - 80) novaPagina();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Onde agir', left, doc.y, { width });
    doc.moveDown(0.25);
    if (mapa.alertas.length === 0) {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
        `Nenhuma zona acima dos limites no período (mínimo de ${mapa.min_toras_alerta} toras por zona).`,
        left, doc.y, { width },
      );
      doc.moveDown(0.5);
    } else {
      table(
        ['Zona', 'Indicador', 'Valor', 'Toras', 'Limite', 'Ação recomendada'],
        [0.07, 0.13, 0.09, 0.08, 0.08, 0.55],
        mapa.alertas.map((a) => [
          a.zona,
          METRICA_TITULO[a.metrica],
          num(a.valor, a.metrica === 'falhas' ? 0 : 1, '%'),
          String(a.n),
          `${a.limite}%`,
          a.acao,
        ]),
        ['left', 'left', 'right', 'right', 'right', 'left'],
        { colorCol: 2, colors: mapa.alertas.map((a) => NIVEL_COR[a.nivel]) },
      );
    }
  }

  // ---- Por máquina ----
  section('Por máquina');
  table(
    ['Máquina', 'Nº de série', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.3, 0.28, 0.14, 0.14, 0.14],
    rep.porMaquina.map((m) => [m.modelo ?? '—', m.numero_serie ?? '—', String(m.total), String(m.falhas), pct(m.falhas, m.total)]),
    ['left', 'left', 'right', 'right', 'right'],
  );

  // ---- Por talhão ----
  section('Por talhão');
  table(
    ['Talhão', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.46, 0.18, 0.18, 0.18],
    rep.porTalhao.map((t) => [t.nome ?? '—', String(t.total), String(t.falhas), pct(t.falhas, t.total)]),
    ['left', 'right', 'right', 'right'],
  );

  // ---- Padrão temporal das falhas ----
  section('Padrão temporal das falhas', 'Concentração por dia da semana e horário — sinal de turno, fadiga ou troca de talhão.');
  table(
    ['Dia da semana', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.46, 0.18, 0.18, 0.18],
    rep.porDow.map((d) => [DOW_LABEL[d.dow] ?? String(d.dow), String(d.total), String(d.falhas), pct(d.falhas, d.total)]),
    ['left', 'right', 'right', 'right'],
  );
  if (rep.topHoras.length > 0) {
    if (doc.y > bottomLimit() - 70) novaPagina(); // título junto da tabela
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Top 5 horários com mais falhas', left, doc.y, { width });
    doc.moveDown(0.25);
    table(
      ['Horário', 'Falhas'],
      [0.5, 0.5],
      rep.topHoras.map((h) => [`${String(h.hora).padStart(2, '0')}:00 – ${String(h.hora).padStart(2, '0')}:59`, String(h.falhas)]),
      ['left', 'right'],
    );
  }

  // ---- Nota metodológica (curta, honesta) ----
  if (doc.y > bottomLimit() - 60) novaPagina();
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
    'Nota: casca residual, tortuosidade, diâmetro e defeitos são medidos por visão computacional na máquina. ' +
      'Densidade básica vem do cadastro por clone (fonte de verdade no banco central) e a massa seca herda a incerteza dessa referência — é estimativa, não pesagem. ' +
      'Na vista de seção o comprimento usa o traçamento configurado do talhão.',
    left, doc.y, { width, align: 'justify' },
  );

  rodape();
  doc.end();

  // Rodapé em todas as páginas. Zera a margem inferior enquanto escreve para
  // o pdfkit não abrir uma página em branco no fim.
  function rodape() {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const margemInferior = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.moveTo(left, doc.page.height - 34).lineTo(right, doc.page.height - 34).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
        `Omni-Root · gerado automaticamente a partir do banco central — página ${i + 1} de ${range.count}`,
        left, doc.page.height - 28, { width, align: 'center', lineBreak: false },
      );
      doc.page.margins.bottom = margemInferior;
    }
  }
}
