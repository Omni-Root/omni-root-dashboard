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
import { STATUS_LABEL, DOW_LABEL, fmtDateBR } from './labels.js';
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

export async function streamPdf(f: Filters, res: express.Response): Promise<void> {
  const [rep, qual] = await Promise.all([getPdfReport(f), getQualidade(f).catch(() => null)]);
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
