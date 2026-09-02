# Dashboard — Qualidade da Madeira (Omni-Root)

Dashboard **somente leitura** sobre o PostgreSQL central do projeto
[Omni-Root_challenge_2026](https://github.com/Omni-Root/Omni-Root_challenge_2026).
Não escreve nada no banco e não toca no pipeline de câmera/classificação/sync.

## Stack

- **Servidor**: Express + `pg` (TypeScript, executado com `tsx`) — API fina de leitura.
- **Cliente**: Vite + React + Recharts (heatmap em CSS grid puro, sem lib extra).
- Dev roda os dois juntos com `concurrently`; o Vite faz proxy de `/api` para o Express.

## Variáveis de ambiente

Copie `.env.example` para `.env` (mesmos nomes usados pelo `sync.go` do repo principal):

| Variável | Padrão | Descrição |
|---|---|---|
| `PG_HOST` | `localhost` | Host do PostgreSQL central |
| `PG_PORT` | `5432` | Porta |
| `PG_USER` | `postgres` | Usuário (ideal: um usuário só-leitura) |
| `PG_PASSWORD` | — | Senha |
| `PG_DBNAME` | `desafio_madeira` | Banco |
| `PG_SSL` | `false` | `true` se o servidor exigir TLS |
| `API_PORT` | `3001` | Porta da API de leitura |
| `DASHBOARD_USER` | — | Usuário de login do dashboard (obrigatório) |
| `DASHBOARD_PASSWORD` | — | Senha de login do dashboard (obrigatória) |
| `SESSION_SECRET` | aleatório | Assina o cookie de sessão; sem ele, as sessões caem a cada reinício do servidor |

Além da restrição de escopo no código, a conexão abre com
`default_transaction_read_only=on` — o próprio Postgres rejeita qualquer
escrita nesta conexão (testado: `INSERT` retorna erro `25006`).

## Rodando (desenvolvimento)

```bash
npm install
npm run dev
```

- UI: http://localhost:5173 (com hot reload)
- API: http://localhost:3001/api/health

## Rodando (produção local)

```bash
npm run build
npm start
```

O Express serve a UI compilada e a API na mesma porta (`API_PORT`).

## Sem acesso ao banco central? Banco local de teste

Opção A — Docker:

```bash
cd db/dev
docker compose up -d
```

Opção B — qualquer Postgres local vazio (ex.: binários portáteis) na porta 5433:

```bash
node db/dev/setup-devdb.mjs 5433
```

As duas opções criam `desafio_madeira` com o schema real (`01_schema.sql`,
cópia do repo principal) e ~8.000 inspeções sintéticas (`02_seed_dev.sql`).
No `.env`, use `PG_PORT=5433` e senha `dev` (Docker) ou vazia (opção B).

## Autenticação

A interface exige login (usuário/senha de `DASHBOARD_USER`/`DASHBOARD_PASSWORD`).
A sessão dura 12h num cookie HttpOnly assinado (HMAC-SHA256, sem dependências
novas); comparações são timing-safe e todas as rotas de dados respondem 401 sem
sessão válida. Não há cadastro de usuários: é um par único de credenciais por
ambiente, definido no `.env` (a tabela `usuarios` do schema central ficou para
uma etapa futura, já que este dashboard não escreve no banco).

## Imagens térmicas do drone

Painel "Imagens térmicas do drone": registro (log) dos voos com a câmera
infravermelho — as imagens **não são em tempo real**; a aba **Enviar imagens**
carrega os arquivos capturados (JPEG/PNG/WebP/SVG, até 15 MB), que ficam no
disco do servidor em `uploads/drone/` com um `index.json` de catálogo — o
PostgreSQL continua intocado. Três imagens sintéticas de demonstração
(rotuladas `DEMO`, em `server/assets/`) garantem que o painel nunca abre vazio.

## Exportações

Dois botões no cabeçalho, respeitando o período e a máquina filtrados:

- **Exportar CSV** — dados brutos das inspeções do período (uma linha por tora:
  data, classificação, confiança da IA, máquina, talhão, log_id). Gerado em
  streaming por lotes no servidor, nunca materializa a tabela inteira; formato
  amigável ao Excel pt-BR (BOM UTF-8, separador `;`, decimal com vírgula).
- **Relatório PDF** — sumário do período: total e taxa de falha, tabela por
  classificação com confiança média da IA, quebra por máquina e por talhão, e o
  padrão temporal das falhas (por dia da semana + top-5 horários). Gerado no
  servidor com `pdfkit` (sem depender do "imprimir" do navegador).
- **Export StanForD** — exporta no padrão **StanForD 2010** (`.hpr`, Harvested
  Production Report), o formato XML que as máquinas John Deere usam. Gera um
  arquivo por máquina (`<numero_serie>.hpr`) num ZIP. É a porta para TypeScript
  do `stanford_export.py` do repo principal, lendo do PostgreSQL: cada tora vira
  um `Stem` com `Log`/`LogMeasurement`, `StemGrade` (OK / REVISAO_MANUAL /
  REJEITADO) e os indicadores da IA + defeitos do YOLO em `UserDefinedData`
  (mecanismo oficial `DataTableGroup/DataTable/Row/ColumnData`). Estrutura
  baseada na documentação pública da Skogforsk; **não** validada contra o XSD
  oficial — não declarar como "certificado StanForD".

## Endpoints da API

| Rota | Parâmetros | Retorna |
|---|---|---|
| `/api/health` | — | `{ok: true}` se o banco responde |
| `/api/maquinas` | — | Lista de máquinas para o filtro |
| `/api/summary` | `from`, `to`, `maquinaId?` | Contagem por classificação |
| `/api/timeseries` | + `bucket` (`hour`/`day`/`week`) | Série temporal por classificação |
| `/api/heatmap` | + `statuses` (ex.: `reprovado,quarentena`) | Contagem por dia da semana × hora |
| `/api/login` (POST) | `{username, password}` | Abre sessão (cookie HttpOnly) |
| `/api/logout` (POST) / `/api/me` | — | Encerra / consulta a sessão |
| `/api/drone/imagens` | GET lista · PUT envia (corpo binário + `?nome=`) | Registro de imagens térmicas |
| `/api/drone/imagens/:id/arquivo` | — | Conteúdo da imagem |
| `/api/export/csv` | `from`, `to`, `maquinaId?` | Dados brutos das inspeções em CSV (streaming) |
| `/api/export/pdf` | `from`, `to`, `maquinaId?` | Relatório-sumário em PDF |
| `/api/export/stanford` | `from`, `to`, `maquinaId?` | ZIP com `.hpr` StanForD 2010 (um por máquina) |

Datas em `YYYY-MM-DD` (intervalo inclusivo). Tudo é validado no servidor
(datas por regex, `maquinaId` inteiro, `bucket`/`statuses` por whitelist) e as
consultas são parametrizadas e agregam no banco — a tabela de eventos nunca é
trazida inteira para o cliente.

## Decisões técnicas

- **Schema**: o real do repo principal (`Banco de dados/schema_postgres.sql`).
  Tabela `toras_inspecionadas`; `status_classificacao` ∈ `aprovado` /
  `quarentena` / `reprovado`, exibidos como **Aprovada / Contenção / Rejeitada**.
- **Mapa de calor**: falhas por **dia da semana × hora do dia** (padrão
  combinado), com toggle para incluir/excluir Rejeitadas e Contenção.
  `data_inspecao` é `TIMESTAMP` sem fuso (hora local da máquina), então dia/hora
  são extraídos direto no SQL, sem conversão de fuso no navegador.
- **Falha** = `reprovado` + `quarentena` por padrão (ajustável no toggle).
- **Cores**: paleta de status fixa (verde/âmbar/vermelho, sempre com rótulo ao
  lado — nunca cor sozinha) e rampa sequencial azul de uma matiz só no heatmap;
  tema claro/escuro segue o sistema.
- **Autenticação**: login simples por par de credenciais em variáveis de
  ambiente + cookie de sessão assinado — sem escrever no banco (a tabela
  `usuarios` do schema fica para uma etapa futura).
- **Imagens do drone**: como não são em tempo real, viraram um log com upload
  manual, guardado no disco do servidor do dashboard (decisão alinhada em
  01/09/2026); o mapa de calor temporal continua existindo em paralelo.
- **Exportações**: CSV em streaming por lotes (keyset) para não carregar tudo na
  memória; PDF gerado no servidor com `pdfkit` (única dependência nova) —
  relatório de verdade, não uma captura de tela do navegador.
- **Export StanForD**: porta em TypeScript do `stanford_export.py` do repo
  principal (pendência nº 3 do README deles: "conectar ao dashboard"). Gera
  `.hpr` por máquina, empacotados em ZIP por um escritor mínimo próprio
  (`zlib` + CRC32, sem dependência de zip). Os indicadores/defeitos por tora
  (tabelas `indicadores_qualidade` e `defeitos_detectados`) foram adicionados
  ao seed de dev para o export demonstrar o formato completo.
