// Ponto de entrada da API de leitura: carrega o .env, sobe o Express e liga o
// tempo real (LISTEN no Postgres -> SSE para os navegadores).
//
//   server/
//     app.ts         monta o Express (middlewares, rotas, cliente em produção)
//     http.ts        filtros da query string e envelopes de erro (400/500)
//     rotas/         sessao · painel · camera · exportacoes
//     consultas/     SQL por assunto: operacao · qualidade · mapa · tendencia · exportacao
//     exportacoes/   CSV · PDF (com mapa de ruas) · StanForD 2010 · tiles · zip
//     auth.ts · db.ts · live.ts · camera.ts · validate.ts   (infraestrutura)
import 'dotenv/config';
import { criarApp } from './app.js';
import { iniciarTempoReal } from './live.js';

// Rede de segurança: um erro fora de um handler (promessa sem catch, evento
// 'error' sem ouvinte) nunca deve derrubar o servidor da demo. Loga e segue;
// as rotas tratam seus próprios erros e devolvem 500 quando o banco falha.
process.on('unhandledRejection', (reason) => {
  console.error('[server] promessa rejeitada sem tratamento:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] exceção não tratada (processo mantido vivo):', err);
});

const port = Number(process.env.API_PORT ?? 3001);

criarApp().listen(port, () => {
  console.log(`API de leitura em http://localhost:${port}`);
  void iniciarTempoReal();
});
