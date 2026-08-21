# Passo a passo — instalar e executar o dashboard

Guia do zero absoluto até o dashboard aberto no navegador. Funciona em
qualquer máquina Windows/Mac/Linux.

---

## 1. Pré-requisito: Node.js (uma vez só)

O projeto precisa do **Node.js 20 ou mais novo**.

1. Verifique se já tem: abra um terminal e rode `node --version`.
2. Se der erro ou versão < 20, instale o LTS em https://nodejs.org
   (no Windows, também dá com `winget install OpenJS.NodeJS.LTS`).
3. Feche e reabra o terminal depois de instalar.

## 2. Descompactar e abrir no VS Code

1. Extraia o `omni-root-dashboard.zip` para uma pasta de sua preferência
   (ex.: `C:\Projetos\dashboard`). Evite pastas sincronizadas pelo OneDrive —
   o `node_modules` deixa a sincronização lenta.
2. No VS Code: **File → Open Folder…** e escolha a pasta extraída
   (a que contém o `package.json`).
3. Abra o terminal integrado: **Terminal → New Terminal** (ou `Ctrl+'`).

## 3. Instalar as dependências (uma vez só)

No terminal integrado:

```bash
npm install
```

Aguarde terminar (cria a pasta `node_modules`).

## 4. Configurar a conexão com o banco

1. Copie o arquivo `.env.example` e renomeie a cópia para `.env`
   (no terminal: `copy .env.example .env` no Windows, `cp .env.example .env` no Mac/Linux).
2. Edite o `.env` com os dados do PostgreSQL central:

```
PG_HOST=ip-ou-host-do-postgres
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=sua-senha
PG_DBNAME=desafio_madeira
```

> **Não tem acesso ao banco central?** Use o banco local de teste do passo 6
> e aponte o `.env` para ele (`PG_HOST=localhost`, `PG_PORT=5433`).

## 5. Executar

```bash
npm run dev
```

Isso sobe **dois processos juntos**:

- `server` — a API de leitura em http://localhost:3001
- `client` — a interface em **http://localhost:5173** ← abra este no navegador

Alterações no código recarregam sozinhas (hot reload). Para parar: `Ctrl+C`
no terminal.

**Deu a faixa vermelha "Não foi possível carregar os dados"?** O dashboard
abriu mas não alcançou o PostgreSQL — confira host/porta/senha no `.env` e se
o banco está no ar. Teste rápido: abra http://localhost:3001/api/health
(deve responder `{"ok":true}`).

## 6. (Opcional) Banco local de teste, sem acesso ao central

Cria um `desafio_madeira` com o schema real e ~8.000 inspeções sintéticas.

**Com Docker instalado:**

```bash
cd db/dev
docker compose up -d
cd ../..
```

**Sem Docker**, com qualquer PostgreSQL local vazio rodando na porta 5433:

```bash
node db/dev/setup-devdb.mjs 5433
```

Depois, no `.env`: `PG_HOST=localhost`, `PG_PORT=5433`, `PG_PASSWORD=dev`
(Docker) ou vazio (Postgres próprio) — e rode `npm run dev` de novo.

## 7. (Opcional) Build de produção

```bash
npm run build
npm start
```

Um processo só: o Express serve a interface compilada e a API na porta 3001
(http://localhost:3001).

---

Mais detalhes (endpoints da API, decisões técnicas, variáveis): veja o `README.md`.
