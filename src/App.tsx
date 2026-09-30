import { useEffect, useState } from 'react';
import { api } from './api';
import Login from './components/Login';
import Painel from './paginas/Painel';

// Raiz do app: verifica a sessão e mostra o login ou o painel.
//
//   src/
//     paginas/Painel.tsx   layout do painel (grade de painéis)
//     hooks/               useDadosPainel (carga/recarga), useLive (SSE),
//                          useAnuncioInspecao (voz), useThemeTokens
//     components/          um componente por painel/controle
//     estilos/             CSS por área da tela (ordem em estilos/index.css)
//     api.ts · types.ts · voz.ts · datas.ts
export default function App() {
  // null = ainda verificando a sessão; false = deslogado; true = logado.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [user, setUser] = useState('');

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setAuthed(r.authenticated);
        setUser(r.user ?? '');
      })
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return <div className="loading">Carregando…</div>;
  }
  if (!authed) {
    return (
      <Login
        onSuccess={(u) => {
          setUser(u);
          setAuthed(true);
        }}
      />
    );
  }

  return (
    <Painel
      user={user}
      onLogout={() => {
        setAuthed(false);
        setUser('');
      }}
    />
  );
}
