// Datas do filtro de período (usadas pelo painel e pela barra de filtros).

// "YYYY-MM-DD" de `days` dias atrás. Atenção: usa a data em UTC
// (toISOString) — depois das 21h no horário de Brasília já é "amanhã".
export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
