import { useEffect, useRef, useState } from 'react';
import type { AlertaTendencia } from '../types';

// Faixa de alerta do "supervisor no bolso": aparece no topo quando uma
// máquina tem várias toras seguidas acima do limite (ver server/tendencia.ts).
//
//   - Alerta NOVO (não estava na leitura anterior): vibra o celular e, se a
//     narração estiver ligada, fala a frase. A primeira carga da página só
//     mostra — não dispara vibração por problemas que já estavam lá.
//   - "Ciente" esconde aquele alerta NESTE aparelho até ele sumir e voltar.
//     Não grava nada: o dashboard é somente leitura por contrato.

const PADRAO_VIBRACAO = [200, 100, 200, 100, 400];

export default function AlertasTendencia({
  alertas,
  falar,
}: {
  alertas: AlertaTendencia[] | null;
  falar: (texto: string) => void;
}) {
  const [cientes, setCientes] = useState<Set<string>>(new Set());
  const vistos = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!alertas) return;
    const atuais = new Set(alertas.map((a) => a.chave));
    if (vistos.current !== null) {
      const novos = alertas.filter((a) => !vistos.current!.has(a.chave));
      if (novos.length > 0) {
        if ('vibrate' in navigator) navigator.vibrate(PADRAO_VIBRACAO);
        falar('Atenção. ' + novos.map((a) => a.texto).join(' '));
      }
    }
    vistos.current = atuais;
    // Alerta que sumiu (problema resolvido) sai da lista de "ciente": se
    // voltar, avisa de novo.
    setCientes((c) => new Set([...c].filter((k) => atuais.has(k))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertas]);

  const visiveis = (alertas ?? []).filter((a) => !cientes.has(a.chave));
  if (visiveis.length === 0) return null;

  return (
    <div className="tendencia" role="alert">
      {visiveis.map((a) => (
        <div key={a.chave} className="tendencia-item">
          <span className="tendencia-icone" aria-hidden="true">
            ⚠
          </span>
          <span className="tendencia-texto">{a.texto}</span>
          <button
            type="button"
            className="btn tendencia-ciente"
            onClick={() => setCientes((c) => new Set(c).add(a.chave))}
            title="Esconder este alerta neste aparelho (volta se o problema sumir e reaparecer)"
          >
            Ciente
          </button>
        </div>
      ))}
    </div>
  );
}
