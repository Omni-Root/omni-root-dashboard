// Relatório PDF — sumário do período (não é uma captura de tela do navegador;
// é gerado no servidor com pdfkit). Respeita o período e a máquina filtrados.
import type express from 'express';
import PDFDocument from 'pdfkit';
import { getPdfReport, type Filters } from './queries.js';
import { STATUS_LABEL, DOW_LABEL, fmtDateBR } from './labels.js';
import type { Status } from './validate.js';

const INK = '#1a2b22';
const MUTED = '#5b6b63';
const RULE = '#d8e0db';

function pct(n: number, d: number): string {
  return d > 0 ? ((n / d) * 100).toFixed(1).replace('.', ',') + '%' : '—';
}
function conf(v: number | null): string {
  return v == null ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%';
}

export async function streamPdf(f: Filters, res: express.Response): Promise<void> {
  const rep = await getPdfReport(f);
  const filename = `relatorio_${f.from}_a_${f.to}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // ---- Cabeçalho ----
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('Omni-Root · Qualidade da Madeira');
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(11).fillColor(MUTED).text('Relatório-sumário de inspeções');
  doc.moveDown(0.6);
  doc.fontSize(9).fillColor(MUTED).text(
    `Período: ${fmtDateBR(f.from)} a ${fmtDateBR(f.to)}` +
      (f.maquinaId ? `  ·  Máquina #${f.maquinaId}` : '  ·  Todas as máquinas') +
      `  ·  Gerado em ${fmtDateBR(new Date().toISOString().slice(0, 19))}`,
  );
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor(RULE).stroke();
  doc.moveDown(0.8);

  if (rep.totals.total === 0) {
    doc.font('Helvetica').fontSize(12).fillColor(INK).text(
      'Nenhuma inspeção encontrada para o período e filtros selecionados.',
    );
    doc.end();
    return;
  }

  // ---- KPIs ----
  const { total, falhas, confMedia } = rep.totals;
  const kpis: [string, string][] = [
    ['Total de inspeções', String(total)],
    ['Falhas (Rejeitada + Contenção)', `${falhas}  (${pct(falhas, total)})`],
    ['Taxa de aprovação', pct(total - falhas, total)],
    ['Confiança média da IA', conf(confMedia)],
  ];
  const kpiW = width / 2;
  const ky = doc.y;
  kpis.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = left + col * kpiW;
    const y = ky + row * 56;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, x, y, { width: kpiW - 12 });
    doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(value, x, y + 13, { width: kpiW - 12 });
  });
  doc.y = ky + Math.ceil(kpis.length / 2) * 56 + 6;

  const section = (title: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(title);
    doc.moveDown(0.3);
  };

  // Tabela genérica de colunas com larguras relativas.
  const table = (
    headers: string[],
    widths: number[],
    rows: string[][],
    aligns: ('left' | 'right')[] = [],
  ) => {
    const colX = (i: number) => left + widths.slice(0, i).reduce((a, b) => a + b, 0) * width;
    const colW = (i: number) => widths[i] * width;
    const drawRow = (cells: string[], bold: boolean) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? MUTED : INK);
      let maxH = 0;
      cells.forEach((c, i) => {
        const align = aligns[i] ?? 'left';
        doc.text(c, colX(i) + 2, y, { width: colW(i) - 4, align });
        maxH = Math.max(maxH, doc.heightOfString(c, { width: colW(i) - 4 }));
      });
      doc.y = y + maxH + 5;
      doc.moveTo(left, doc.y - 2).lineTo(right, doc.y - 2).lineWidth(0.5).strokeColor(RULE).stroke();
    };
    drawRow(headers, true);
    rows.forEach((r) => drawRow(r, false));
  };

  // ---- Por classificação ----
  section('Por classificação');
  const statusOrder: Status[] = ['aprovado', 'quarentena', 'reprovado'];
  const byStatus = new Map(rep.porStatus.map((r) => [r.status, r]));
  table(
    ['Classificação', 'Inspeções', 'Participação', 'Confiança média IA'],
    [0.4, 0.2, 0.2, 0.2],
    statusOrder
      .filter((s) => byStatus.has(s))
      .map((s) => {
        const r = byStatus.get(s)!;
        return [STATUS_LABEL[s], String(r.total), pct(r.total, total), conf(r.confMedia)];
      }),
    ['left', 'right', 'right', 'right'],
  );

  // ---- Por máquina ----
  section('Por máquina');
  table(
    ['Máquina', 'Nº de série', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.3, 0.28, 0.14, 0.14, 0.14],
    rep.porMaquina.map((m) => [
      m.modelo ?? '—',
      m.numero_serie ?? '—',
      String(m.total),
      String(m.falhas),
      pct(m.falhas, m.total),
    ]),
    ['left', 'left', 'right', 'right', 'right'],
  );

  // ---- Por talhão ----
  section('Por talhão');
  table(
    ['Talhão', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.46, 0.18, 0.18, 0.18],
    rep.porTalhao.map((t) => [
      t.nome ?? '—',
      String(t.total),
      String(t.falhas),
      pct(t.falhas, t.total),
    ]),
    ['left', 'right', 'right', 'right'],
  );

  // ---- Padrão temporal das falhas ----
  section('Padrão temporal das falhas');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Falhas por dia da semana');
  doc.moveDown(0.2);
  table(
    ['Dia da semana', 'Inspeções', 'Falhas', 'Taxa de falha'],
    [0.46, 0.18, 0.18, 0.18],
    rep.porDow.map((d) => [
      DOW_LABEL[d.dow] ?? String(d.dow),
      String(d.total),
      String(d.falhas),
      pct(d.falhas, d.total),
    ]),
    ['left', 'right', 'right', 'right'],
  );
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Top 5 horários com mais falhas');
  doc.moveDown(0.2);
  table(
    ['Horário', 'Falhas'],
    [0.5, 0.5],
    rep.topHoras.map((h) => [
      `${String(h.hora).padStart(2, '0')}:00 – ${String(h.hora).padStart(2, '0')}:59`,
      String(h.falhas),
    ]),
    ['left', 'right'],
  );

  // ---- Rodapé com paginação ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      `Omni-Root · gerado automaticamente — página ${i + 1} de ${range.count}`,
      left,
      doc.page.height - 40,
      { width, align: 'center' },
    );
  }

  doc.end();
}
