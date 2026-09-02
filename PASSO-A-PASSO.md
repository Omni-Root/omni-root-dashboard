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

## 4. Conferir o arquivo .env (já vem pronto)

O zip **já inclui um `.env` configurado** para o banco de teste do Docker
(passo 6) e com o login do dashboard:

- Banco: `localhost`, porta `5433`, senha `dev` (o Postgres do docker-compose)
- Login da interface: usuário `admin`, senha `root`

Você só precisa editá-lo em dois casos:

1. **Trocar a senha de login**: mude `DASHBOARD_PASSWORD` (e reinicie o servidor).
2. **Apontar para o banco central real**: troque as linhas `PG_*`
   (host/IP real, porta `5432`, senha real; `PG_SSL=true` se exigir TLS).

> Importante: quem vale é o **`.env`** — o `.env.example` é só um modelo
> documentando as variáveis, o servidor não lê ele. E toda mudança no `.env`
> exige reiniciar o servidor (`Ctrl+C` e `npm run dev` de novo).

## 5. Executar

```bash
npm run dev
```

Isso sobe **dois processos juntos**:

- `server` — a API de leitura em http://localhost:3001
- `client` — a interface em **http://localhost:5173** ← abra este no navegador

Entre com o usuário e a senha definidos em `DASHBOARD_USER`/`DASHBOARD_PASSWORD`.

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
