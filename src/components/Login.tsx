import { useEffect, useState } from 'react';
import { api } from '../api';
import ThemeToggle from './ThemeToggle';

export default function Login({ onSuccess }: { onSuccess: (user: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null = ainda não sondou; false = servidor da API não responde (fetch falhou)
  const [servidorOk, setServidorOk] = useState<boolean | null>(null);

  // Sonda o servidor ao abrir e, enquanto ele estiver fora, a cada 5 s — o
  // aviso some sozinho quando ele voltar, sem F5. (O login em si não usa o
  // banco: com o servidor de pé, entra mesmo com o Postgres parado.)
  useEffect(() => {
    let ativo = true;
    const sondar = async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store' });
        if (ativo) setServidorOk(res.ok || res.status === 401);
      } catch {
        if (ativo) setServidorOk(false);
      }
    };
    void sondar();
    const t = setInterval(() => {
      if (servidorOk === false) void sondar();
    }, 5000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [servidorOk]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(username, password);
      onSuccess(user);
    } catch (err) {
      // fetch que nem chegou ao servidor vira TypeError: é "servidor fora", não "senha errada"
      if (err instanceof TypeError) {
        setServidorOk(false);
        setError('Servidor do dashboard não respondeu. Vou tentar de novo sozinho — confira se o `npm run dev` está rodando.');
      } else {
        setError(err instanceof Error ? err.message : 'Falha no login');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-theme">
        <ThemeToggle />
      </div>

      <form className="login-card" onSubmit={submit}>
        <h1>Omni-Root</h1>
        <p className="login-sub">Dashboard · Qualidade da Madeira</p>

        {servidorOk === false && !error && (
          <div className="login-error" role="status">
            Servidor do dashboard fora do ar — tentando reconectar a cada 5 s…
          </div>
        )}
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <label>
          Usuário
          <input
            type="text"
            value={username}
            autoFocus
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
