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

## 10. Sem acesso ao banco central? Banco local de teste

O diretório `db/dev/` sobe um PostgreSQL isolado na porta **5433**, com o schema
real (`01_schema.sql`, cópia do repo principal) e **8.000 inspeções sintéticas**
(`02_seed_dev.sql`).

Opção A — Docker:

```bash
cd db/dev
docker compose up -d
```

Opção B — qualquer Postgres local vazio na porta 5433:

```bash
node db/dev/setup-devdb.mjs 5433
```

No `.env`, use `PG_PORT=5433` e senha `dev` (Docker) ou vazia (opção B).

> ℹ️ O seed popula `toras_inspecionadas` (mais máquinas e talhões),
> `clones_densidade` (`04_clones_densidade.sql`, cópia da migration do repo
> principal) e **indicadores de qualidade sintéticos** para todas as toras
> (`05_seed_indicadores_dev.sql`: ~60% vistas de lado, casca maior no Talhão
> Norte, dois clones — um com faixa de densidade). `defeitos_detectados` fica
> vazio, então o Export StanForD sai sem a tabela de defeitos. Para o formato
> completo, aponte para o banco central com dados reais do pipeline.

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
| `GET /api/export/csv` | exige | `from`, `to`, `maquinaId?` | Inspeções em CSV (streaming) |
| `GET /api/export/pdf` | exige | `from`, `to`, `maquinaId?` | Relatório-sumário em PDF |
| `GET /api/export/stanford` | exige | `from`, `to`, `maquinaId?` | ZIP com `.hpr` StanForD 2010 |

Datas em `YYYY-MM-DD`, intervalo inclusivo. Tudo é validado no servidor (datas
por regex, `maquinaId` inteiro, `bucket`/`statuses` por whitelist) e as consultas
são parametrizadas e **agregam no banco** — a tabela de eventos nunca é trazida
inteira para o cliente.

---

## 12. Estrutura de arquivos

```
server/
  index.ts            # Rotas, middleware de sessão e wiring geral
  db.ts               # Pool do PostgreSQL (read-only por configuração)
  queries.ts          # Todo o SQL: painéis + exportações
  qualidade.ts        # SQL dos indicadores de qualidade (última inspeção, por talhão, histogramas)
  validate.ts         # Validação dos parâmetros de query string
  auth.ts             # Credenciais + cookie de sessão assinado (HMAC)
  labels.ts           # Rótulos de status e formatação de data
  export-csv.ts       # CSV em streaming por lotes
  export-pdf.ts       # Relatório PDF (pdfkit)
  export-stanford.ts  # XML StanForD 2010 (.hpr)
  zip.ts              # Escritor de ZIP mínimo (zlib + CRC32)
src/
  App.tsx             # Gate de login + layout do dashboard
  api.ts              # Cliente HTTP (sessão, dados e downloads)
  types.ts            # Tipos e paleta de status compartilhados
  theme.css           # Tokens de tema (claro/escuro) e estilos
  components/
    Login.tsx           ThemeToggle.tsx    ExportMenu.tsx
    Filters.tsx         SummaryCards.tsx   TimeSeriesChart.tsx
    ProportionDonut.tsx Heatmap.tsx        useThemeTokens.ts
    UltimaInspecao.tsx  QualidadeTalhao.tsx Histograma.tsx
db/dev/               # PostgreSQL de desenvolvimento (schema + seed sintético)
```

---

## 13. Decisões técnicas

- **Schema**: o real do repo principal (`Banco de dados/schema_postgres.sql`).
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
