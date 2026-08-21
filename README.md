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
ou 

```bash
Para rodar diretamente na raiz do diretório(Melhor dessa forma)
docker compose -f db/dev/docker-compose.yml up -d
```

Opção B — qualquer Postgres local vazio (ex.: binários portáteis) na porta 5433:

```bash
node db/dev/setup-devdb.mjs 5433
```

As duas opções criam `desafio_madeira` com o schema real (`01_schema.sql`,
cópia do repo principal) e ~8.000 inspeções sintéticas (`02_seed_dev.sql`).
No `.env`, use `PG_PORT=5433` e senha `dev` (Docker) ou vazia (opção B).

## Endpoints da API (todos GET, todos somente leitura)

| Rota | Parâmetros | Retorna |
|---|---|---|
| `/api/health` | — | `{ok: true}` se o banco responde |
| `/api/maquinas` | — | Lista de máquinas para o filtro |
| `/api/summary` | `from`, `to`, `maquinaId?` | Contagem por classificação |
| `/api/timeseries` | + `bucket` (`hour`/`day`/`week`) | Série temporal por classificação |
| `/api/heatmap` | + `statuses` (ex.: `reprovado,quarentena`) | Contagem por dia da semana × hora |

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
- **Sem autenticação**: fora do escopo pedido (a tabela `usuarios` do schema
  fica para uma etapa futura).
