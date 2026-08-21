import { useEffect, useState } from 'react';

// O Recharts recebe cores como atributos SVG, onde var(--x) não resolve.
// Este hook lê os tokens computados do tema e re-lê quando o esquema
// claro/escuro do sistema muda.
export interface ThemeTokens {
  grid: string;
  axis: string;
  muted: string;
  textSecondary: string;
  surface: string;
  border: string;
}

function readTokens(): ThemeTokens {
  const s = getComputedStyle(document.documentElement);
  const get = (name: string) => s.getPropertyValue(name).trim();
  return {
    grid: get('--grid'),
    axis: get('--axis'),
    muted: get('--text-muted'),
    textSecondary: get('--text-secondary'),
    surface: get('--surface'),
    border: get('--border'),
  };
}

export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(readTokens);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTokens(readTokens());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return tokens;
}

// Cores de status são fixas (iguais nos dois temas) — seguras como hex em SVG.
export const STATUS_HEX = {
  aprovado: '#0ca30c',
  quarentena: '#fab219',
  reprovado: '#d03b3b',
} as const;
