import type { QualidadeTalhao as Linha } from '../types';
import { TIPO_DADO_META } from '../types';

// Tabela "qualidade por talhão / clone": é a frase do enunciado ("maior
// previsibilidade para a fábrica") em números — casca média, tortuosidade,
// volume e massa seca prevista por talhão, com a proveniência da densidade
// que gerou a massa e, quando o clone tem faixa cadastrada, o intervalo.

const num = (v: number | null, casas = 1) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(0)}%` : '—');

export default function QualidadeTalhao({ rows }: { rows: Linha[] }) {
  if (rows.length === 0) {
    return <div className="empty">Sem indicadores de qualidade no período selecionado.</div>;
  }
  return (
    <div className="tabela-wrap">
      <table className="tabela">
        <thead>
          <tr>
            <th>Talhão</th>
            <th>Clone</th>
            <th className="num">Toras</th>
            <th className="num">Falhas</th>
            <th className="num" title="Diâmetro médio medido pela câmera">Diâm. médio</th>
            <th className="num" title="% média da superfície ainda com casca">Casca média</th>
            <th className="num" title="Média só das toras vistas de lado (flecha/comprimento)">Tortuosidade</th>
            <th className="num" title="Soma do volume útil medido">Volume</th>
            <th className="num" title="Densidade básica de referência do clone e sua proveniência">Densidade</th>
            <th className="num" title="Volume × densidade de referência; faixa = volume × densidade mín./máx.">Massa seca prevista</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tipo = r.tipo_dado ? TIPO_DADO_META[r.tipo_dado] : null;
            const temFaixa = r.massa_min_kg != null && r.massa_max_kg != null;
            return (
              <tr key={`${r.talhao ?? ''}|${r.clone ?? ''}|${i}`}>
                <td>{r.talhao ?? '—'}</td>
                <td>{r.clone ?? '—'}</td>
                <td className="num">{r.toras}</td>
                <td className="num">
                  {r.falhas} <span className="muted">({pct(r.falhas, r.toras)})</span>
                </td>
                <td className="num">{num(r.diam_medio)} cm</td>
                <td className="num">{num(r.casca_media)}%</td>
                <td className="num">
                  {r.tort_n > 0 ? (
                    <>
                      {num(r.tort_media)}% <span className="muted">({r.tort_n})</span>
                    </>
                  ) : (
                    <span className="muted" title="Nenhuma tora vista de lado no período">n/a</span>
                  )}
                </td>
                <td className="num">{num(r.volume_m3, 3)} m³</td>
                <td className="num">
                  {num(r.densidade, 0)} kg/m³
                  {tipo && (
                    <span className="tile-tag" title={tipo.hint}>
                      {tipo.label}
                    </span>
                  )}
                </td>
                <td className="num">
                  <strong>{num(r.massa_kg)} kg</strong>
                  {temFaixa && (
                    <div className="muted" title="Incerteza herdada da faixa de densidade do clone">
                      {num(r.massa_min_kg)}–{num(r.massa_max_kg)} kg
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
