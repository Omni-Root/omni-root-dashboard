# Omni-Root — Dashboard de Qualidade da Madeira

Interface web **somente leitura** que mostra, analisa e exporta as inspeções de
tora produzidas pelo pipeline de visão computacional do projeto
[Omni-Root_challenge_2026](https://github.com/Omni-Root/Omni-Root_challenge_2026)
(Challenge FIAP × John Deere / Suzano).

Este repositório **não** captura imagem, **não** roda IA e **não** escreve no
banco. Ele é a ponta final da cadeia: lê o PostgreSQL central e transforma os
dados em painéis e relatórios para o engenheiro florestal e para a operação.

---

## 1. Como este projeto se encaixa no todo

O sistema completo são **dois repositórios** que se comunicam por um único
PostgreSQL compartilhado — não há chamada direta de código entre eles:

```
  Omni-Root_challenge_2026 (máquina de campo)        ESTE REPOSITÓRIO
 ┌──────────────────────────────────────────┐      ┌──────────────────────┐
 │ main.py                                   │      │ Dashboard            │
 │  câmera → YOLO → indicadores              │      │  Express + React     │
 │             ↓                             │      │                      │
 │        SQLite local (offline)             │      │  • painéis           │
 │             ↓  sync_daemon.py             │      │  • login             │
 └─────────────┼─────────────────────────────┘      │  • CSV / PDF /       │
               ↓                                    │    StanForD          │
        ┌──────────────────────┐   leitura          └──────────┬───────────┘
        │ PostgreSQL central   │ ──────────────────────────────┘
        │   desafio_madeira    │
        └──────────────────────┘
```

**O ponto de integração é o banco.** O `.env` daqui aponta para o mesmo
PostgreSQL que o `sync_daemon.py` do outro repositório alimenta. Quando uma
inspeção é sincronizada do campo, ela aparece aqui sem nenhuma cópia extra.

A garantia de "somente leitura" é dupla: além do escopo do código, a conexão
abre com `default_transaction_read_only=on`, então o próprio PostgreSQL rejeita
qualquer escrita nesta conexão (um `INSERT` retorna erro `25006`).

---

## 2. Stack

- **Servidor**: Express + `pg` em TypeScript, executado com `tsx` — API fina de
  leitura, sem ORM.
- **Cliente**: Vite + React + Recharts. O mapa de calor é CSS grid puro, sem
  biblioteca extra.
- **PDF**: `pdfkit` (única dependência pesada adicionada).
- Em desenvolvimento os dois sobem juntos com `concurrently`, e o Vite faz proxy
  de `/api` para o Express.

---

## 3. O que a interface mostra

Todos os painéis respeitam os filtros do topo (**período** e **máquina**):

| Painel | O que responde |
|---|---|
| **Última inspeção recebida do campo** | A tora mais recente, com os indicadores que o desafio pede: diâmetro, comprimento, casca residual, tortuosidade, densidade básica (com a **proveniência**: laboratório / literatura / referência genérica), massa seca (com faixa mín.–máx. quando o clone tem faixa cadastrada) e defeitos. **Atualiza sozinho** quando a máquina sincroniza (SSE) e pisca uma vez ao chegar tora nova. Medido (borda sólida) e estimado (borda tracejada) ficam explícitos. Ignora o período: é sempre a última; respeita só o filtro de máquina. |
| **Cartões de resumo** | Quantas peças foram inspecionadas e a divisão entre Aprovada / Contenção / Rejeitada, com percentual |
| **Qualidade por talhão e clone** | Casca média, tortuosidade média (só toras vistas de lado), diâmetro médio, volume e **massa seca prevista** — com a densidade de referência, sua proveniência e a faixa de incerteza herdada da densidade mín./máx. do clone. É a "previsibilidade para a fábrica" do enunciado em números |
| **Distribuição de tortuosidade / casca residual** | Histogramas por faixa (tortuosidade: reta < 2%, leve 2–5%, visível 5–10%, torta ≥ 10%; casca: ≤ 5%, 5–15%, 15–30%, > 30%) |
| **Eventos ao longo do tempo** | Como o volume e a qualidade evoluem (granularidade por hora, dia ou semana) |
| **Proporção por classificação** | Participação de cada resultado no período (rosca) |
| **Mapa de calor de falhas** | Concentração de falhas por **dia da semana × hora do dia** — revela padrão operacional (turno, fadiga, troca de talhão) |

Os indicadores vêm de `indicadores_qualidade` (8 linhas por tora, gravadas pelo
`main.py` do repositório principal). O clone de cada tora sai do
`metodo_medicao` da densidade (`lookup_clone_<ID>`), e a proveniência/faixa da
densidade da tabela `clones_densidade` (migration do repo principal). Se essa
tabela não existir no banco, os painéis continuam funcionando — só sem
proveniência e sem faixa.

Os status do banco (`aprovado` / `quarentena` / `reprovado`) aparecem na
interface como **Aprovada / Contenção / Rejeitada**. "Falha" é, por padrão,
`reprovado` + `quarentena`, ajustável no próprio mapa de calor.

---

## 4. Autenticação

A interface exige login. É um **par único de credenciais por ambiente**, vindo
do `.env` (`DASHBOARD_USER` / `DASHBOARD_PASSWORD`) — não há cadastro de
usuários, porque este dashboard não escreve no banco (a tabela `usuarios` do
schema central fica para uma etapa futura).

- Sessão de **12h** num cookie **HttpOnly** assinado com HMAC-SHA256
  (`server/auth.ts`), sem dependência nova além do `node:crypto`.
- Comparação de credenciais em **tempo constante**.
- Todas as rotas de dados e de exportação respondem **401** sem sessão válida;
  o cliente volta sozinho para a tela de login quando a sessão expira.
- `SESSION_SECRET` no `.env` faz as sessões sobreviverem a reinícios do
  servidor. Sem ele, um segredo aleatório é gerado a cada boot.

---

## 5. Tema claro / escuro

Botão no cabeçalho (e na tela de login) que alterna entre três estados:

**Sistema → Claro → Escuro → Sistema**

- "Sistema" segue o `prefers-color-scheme` do sistema operacional.
- "Claro" e "Escuro" forçam o tema mesmo contra a preferência do SO.
- A escolha fica no `localStorage` e é aplicada **antes** do React renderizar,
  para a página não piscar no tema errado.

Detalhe de implementação que importa: o Recharts recebe cor como **atributo
SVG**, onde `var(--token)` não resolve. Por isso `useThemeTokens.ts` observa o
atributo `data-theme` do `<html>` com um `MutationObserver` — sem isso, os
gráficos continuariam com as cores do tema anterior após a troca.

---

## 6. Acessibilidade — narração (texto para voz)

Botão **🔊** no cabeçalho. Usa a **Web Speech API** do navegador (sem
dependência; vozes pt-BR do próprio Windows/Chrome). Três usos:

| Uso | O que faz |
|---|---|
| **Alerta falado ao vivo** | Quando uma inspeção nova sincroniza do campo, o painel fala: *"Nova inspeção. Tora rejeitada às 15 e 42 na máquina X, Talhão Y. 1 defeito: nó morto. Diâmetro 18 centímetros e casca residual 8 por cento."* Numa rajada do sync, diz quantas chegaram e descreve só a última. |
| **Ler resumo** / **Ler** | Botões nos painéis "Resumo do período" e "Última inspeção" leem o conteúdo sob demanda (a leitura da tora inclui tortuosidade, densidade, massa e saúde). |
| **Leitor de tela** | Tudo o que é falado vai também para uma região `aria-live` — NVDA/JAWS recebem o mesmo alerta, com a voz ligada ou não. |

Preferências (▾ ao lado do 🔊, salvas no `localStorage`): o que anunciar
automaticamente (**só contenção e rejeitadas** — padrão —, todas, nenhuma),
voz, velocidade e "Testar voz". Um alerta novo substitui o anterior — nunca
enfileira. O botão fica amarelo quando ligado e pulsa enquanto fala.

Por que isso importa para o desafio: o critério de UX pede *ergonomia
cognitiva e alertas* para o gestor/operador. Um gestor não fica olhando o
painel; uma tora rejeitada anunciada em voz é um alerta que não exige atenção
visual. Textos em `src/voz.ts` (classes do modelo traduzidas: `Dead_Knot` →
"nó morto" etc.).

## 7. Exportações

Menu **Exportar ▾** no cabeçalho, com três formatos, todos respeitando o
período e a máquina filtrados:

### Exportar CSV
Dados **brutos** das inspeções do período — uma linha por tora: data/hora,
classificação, confiança da IA, máquina, número de série, talhão e `log_id`.

Gerado em streaming por lotes (paginação *keyset*) no servidor, então nunca
materializa a tabela inteira na memória. Formato amigável ao Excel pt-BR: BOM
UTF-8, separador `;` e decimal com vírgula.

### Relatório PDF
Sumário do período, gerado no servidor com `pdfkit` — um relatório de verdade,
não uma captura de tela do navegador. Contém:

- KPIs: total de inspeções, falhas e taxa de falha, taxa de aprovação e
  confiança média da IA;
- tabela por classificação, com confiança média;
- quebra por máquina e por talhão, com taxa de falha de cada;
- padrão temporal das falhas: por dia da semana e top-5 horários.

### Export StanForD
Exporta no padrão **StanForD 2010** (`.hpr` — *Harvested Production Report*), o
formato XML usado pela indústria florestal e pelas máquinas John Deere. Gera um
arquivo por máquina (`<numero_serie>.hpr`), empacotados num ZIP.

Cada tora inspecionada vira um `<Stem>` com:
- `<Log>` / `<LogMeasurement>` com diâmetro, comprimento e volume;
- `<StemGrade>` derivado do status (1 = OK, 2 = REVISAO_MANUAL, 3 = REJEITADO);
- os indicadores da IA e os defeitos do YOLO em `<UserDefinedData>`, usando o
  mecanismo oficial `DataTableGroup / DataTable / Row / ColumnData` (tabelas
  `InspecaoIA`, `IndicadoresQualidade` e `DefeitosYOLO`).

Dois avisos honestos:

> ⚠️ A estrutura é baseada na **documentação pública da Skogforsk**, mas **não
> foi validada contra o XSD oficial**. Não declarar como "certificado StanForD".

> ℹ️ O StanForD expressa diâmetro e comprimento em **milímetros**. Os
> indicadores chegam do pipeline em centímetros, então a conversão respeita a
> **unidade gravada junto com cada valor** em vez de assumir uma só.

O ZIP é montado por um escritor mínimo próprio (`server/zip.ts`, `zlib` +
CRC32), sem dependência de biblioteca de zip.

---

## 8. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha. O `.env` real **nunca** vai para o
Git (já está no `.gitignore`) — é assim que se leva a configuração para outra
máquina sem vazar senha no histórico.

| Variável | Padrão | Descrição |
|---|---|---|
| `PG_HOST` | `localhost` | Host do PostgreSQL central |
| `PG_PORT` | `5432` | Porta |
| `PG_USER` | `postgres` | Usuário (ideal: um usuário só-leitura) |
| `PG_PASSWORD` | — | Senha |
| `PG_DBNAME` | `desafio_madeira` | Banco |
| `PG_SSL` | `false` | `true` se o servidor exigir TLS (ex.: nuvem gerenciada) |
| `API_PORT` | `3001` | Porta da API (o Vite faz proxy para ela) |
| `DASHBOARD_USER` | — | Usuário de login (obrigatório) |
| `DASHBOARD_PASSWORD` | — | Senha de login (obrigatória) |
| `SESSION_SECRET` | aleatório | Assina o cookie de sessão |

Os nomes `PG_*` são **os mesmos** usados pelo `sync_daemon.py` do repositório
principal — de propósito, para os dois apontarem para o mesmo banco sem
tradução de configuração.

---

## 9. Rodando

### Desenvolvimento

```bash
npm install
npm run dev
```

- UI: http://localhost:5173 (com hot reload)
- API: http://localhost:3001/api/health

### Produção local

```bash
npm run build
npm start
```

O Express passa a servir a UI compilada **e** a API na mesma porta (`API_PORT`).

### Conferindo os tipos

```bash
npm run typecheck
```

> O banco precisa estar de pé. No repositório do desafio: `docker compose up -d`.

---

## 10. Sem acesso ao banco central? Banco local

O banco é o do repositório principal: `docker compose up -d` lá sobe o
PostgreSQL e aplica o `Banco de dados/setup_completo.sql` (o **único** script
do banco: schema, seed, densidade por clone, colunas de posição e trigger de
tempo real; idempotente). Para ter dados, rode o `main.py` (ou o
`tests/simular_cenario.py`, sem câmera) e o `sync_daemon.py` de lá.

> Para testar sem mexer nos dados reais, crie um banco separado no mesmo
> container, aplique o `setup_completo.sql` nele e aponte o dashboard com
> `PG_DBNAME=<banco_de_teste>`.

---

## 11. Endpoints da API

| Rota | Sessão | Parâmetros | Retorna |
|---|---|---|---|
| `GET /api/health` | pública | — | `{ok: true}` se o banco responde |
| `POST /api/login` | pública | `{username, password}` | Abre sessão (cookie HttpOnly) |
| `POST /api/logout` | pública | — | Encerra a sessão |
| `GET /api/me` | pública | — | `{authenticated, user?}` |
| `GET /api/maquinas` | exige | — | Lista de máquinas para o filtro |
| `GET /api/summary` | exige | `from`, `to`, `maquinaId?` | Contagem por classificação |
| `GET /api/timeseries` | exige | + `bucket` (`hour`/`day`/`week`) | Série temporal por classificação |
| `GET /api/heatmap` | exige | + `statuses` (ex.: `reprovado,quarentena`) | Contagem por dia da semana × hora |
| `GET /api/ultima` | exige | `maquinaId?` | Última tora recebida, com os 8 indicadores, proveniência da densidade e faixa de massa |
| `GET /api/qualidade` | exige | `from`, `to`, `maquinaId?` | Qualidade por talhão/clone + histogramas de tortuosidade e casca |
| `GET /api/mapa` | exige | `from`, `to`, `maquinaId?` | Mapa de qualidade: zonas de 25 m (casca, tortuosidade, rejeição), toras com posição, limites e "Onde agir" |
| `GET /api/tendencia` | exige | `maquinaId?` | Alerta de tendência: máquina com 3+ das últimas 5 toras acima do limite (últimas 2 h) |
| `GET /api/events` | exige | — | Tempo real (SSE): aviso de tora nova/atualizada |
| `POST /api/camera/frame` | `STREAM_TOKEN` | JPEG no corpo | Quadro da câmera ao vivo, empurrado pela máquina |
| `GET /api/camera/maquinas` · `GET /api/camera/stream` | exige | `maquina` | Máquinas transmitindo / vídeo MJPEG |
| `GET /api/export/csv` | exige | `from`, `to`, `maquinaId?` | Inspeções em CSV (streaming) |
| `GET /api/export/pdf` | exige | `from`, `to`, `maquinaId?` | Relatório PDF (com mapa de ruas e "Onde agir") |
| `GET /api/export/stanford` | exige | `from`, `to`, `maquinaId?` | ZIP com `.hpr` StanForD 2010 (posição em `UserDefinedData`) |

Datas em `YYYY-MM-DD`, intervalo inclusivo. Tudo é validado no servidor (datas
por regex, `maquinaId` inteiro, `bucket`/`statuses` por whitelist) e as consultas
são parametrizadas e **agregam no banco** — a tabela de eventos nunca é trazida
inteira para o cliente.

---

## 12. Estrutura de arquivos

```
server/
  index.ts              # Entrada: sobe o app e o tempo real
  app.ts                # Monta o Express (middlewares, rotas, cliente em produção)
  http.ts               # Filtros da query string e envelopes de erro (400/500)
  rotas/                # Uma por assunto: sessao · painel · camera · exportacoes
  consultas/            # SQL por assunto (tudo agregado no banco)
    filtros.ts            período/máquina e os fragmentos SQL que os aplicam
    operacao.ts           resumo, série temporal, mapa de calor, máquinas
    qualidade.ts          última inspeção, qualidade por talhão, histogramas
    mapa.ts               zonas de 25 m, limites e "Onde agir" (fonte única dos limites)
    tendencia.ts          alerta de tendência por máquina
    exportacao.ts         linhas para CSV, PDF e StanForD
  exportacoes/          # Arquivos gerados
    csv.ts  pdf.ts  pdf-mapa.ts (mapa com ruas)  pdf-estilo.ts  stanford.ts
    tiles.ts (OpenStreetMap)  zip.ts  rotulos.ts
  auth.ts · db.ts · live.ts · camera.ts · validate.ts   # Infraestrutura
src/
  App.tsx               # Sessão: login ou painel
  paginas/Painel.tsx    # Layout do painel (grade)
  hooks/                # useDadosPainel (carga e recarga), useLive (SSE),
                        # useAnuncioInspecao (voz), useThemeTokens
  components/           # Um componente por painel/controle (Cabecalho, MapaQualidade,
                        # UltimaInspecao, AlertasTendencia, AvisoConexao, NavCelular, ...)
  estilos/              # CSS por área da tela; a ordem da cascata está em estilos/index.css
  api.ts · types.ts · voz.ts · datas.ts
```

A reorganização foi verificada contra a versão anterior: mesmas respostas em
todas as rotas da API, CSV/PDF/StanForD idênticos byte a byte (com o relógio
fixo) e a mesma tela (estrutura, texto e medidas em desktop e celular).

---

## 13. Decisões técnicas

- **Schema**: o real do repo principal (`Banco de dados/setup_completo.sql`).
  Tabela `toras_inspecionadas`, com `status_classificacao` ∈ `aprovado` /
  `quarentena` / `reprovado`.
- **Mapa de calor por dia da semana × hora**: `data_inspecao` é `TIMESTAMP` sem
  fuso (hora local da máquina), então dia e hora são extraídos direto no SQL,
  sem conversão de fuso no navegador.
- **Cores**: paleta de status fixa (verde / âmbar / vermelho) e **sempre com
  rótulo ao lado** — cor nunca é o único portador de informação. O mapa de calor
  usa rampa sequencial de uma matiz só.
- **Agregação no banco**: todos os painéis recebem dados já agregados; o cliente
  nunca pagina a tabela de eventos.
- **CSV em streaming por lotes (keyset)** para não carregar tudo na memória;
  **PDF gerado no servidor**, não impressão do navegador.
- **Autenticação sem banco**: par de credenciais em variável de ambiente +
  cookie assinado, coerente com o dashboard ser somente leitura.
- **Sem dependência de zip**: o ZIP do StanForD é montado à mão com `zlib`.
