import { useState } from 'react';
import { api } from '../api';
import ThemeToggle from './ThemeToggle';

export default function Login({ onSuccess }: { onSuccess: (user: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(username, password);
      onSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
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
