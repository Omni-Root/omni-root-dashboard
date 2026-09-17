import { useEffect, useState } from 'react';

// Tema com três estados: "system" segue o sistema operacional (comportamento
// original do dashboard), "light" e "dark" forçam manualmente. A escolha fica
// no localStorage e é aplicada como data-theme no <html> — o theme.css tem as
// regras correspondentes.
export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'omniroot-theme';

function lerPreferencia(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage bloqueado (aba anônima etc.) — cai no padrão */
  }
  return 'system';
}

function aplicar(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
}

/**
 * Aplica o tema salvo ANTES do React renderizar (chamado no main.tsx), para a
 * página não piscar no tema errado — inclusive na tela de login.
 */
export function aplicarTemaSalvo(): void {
  aplicar(lerPreferencia());
}

const PROXIMO: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};
const ROTULO: Record<ThemeMode, string> = {
  system: 'Sistema',
  light: 'Claro',
  dark: 'Escuro',
};
const ICONE: Record<ThemeMode, string> = {
  system: '🖥️',
  light: '☀️',
  dark: '🌙',
};

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(lerPreferencia);

  useEffect(() => {
    aplicar(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* sem persistência neste navegador; o tema ainda vale nesta sessão */
    }
  }, [mode]);

  return (
    <button
      type="button"
      className="btn theme-btn"
      onClick={() => setMode(PROXIMO[mode])}
      title={`Tema: ${ROTULO[mode]} — clique para alternar`}
      aria-label={`Alternar tema. Atual: ${ROTULO[mode]}`}
    >
      <span aria-hidden="true">{ICONE[mode]}</span>
      <span className="sr-only">{ROTULO[mode]}</span>
    </button>
  );
}
