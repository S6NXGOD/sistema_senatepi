# Deploy do SENATEPI no Railway

Este projeto é um **monorepo** (npm workspaces) com dois aplicativos que sobem como
**dois serviços separados** no Railway, mais um banco **PostgreSQL**:

| Serviço | Pasta | Stack | Papel |
|--------|-------|-------|-------|
| **API** | raiz (usa `apps/api`) | NestJS + Prisma | Backend, banco, migrations, seed |
| **Web** | `apps/web` | Next.js 15 | Frontend público + painel |
| **Postgres** | plugin | PostgreSQL | Banco de dados |

O que já é **automático** no deploy:
- A API roda `prisma migrate deploy` **antes** de subir (aplica as migrations).
- No **primeiro deploy** (banco vazio), a API cria de forma idempotente:
  - o **usuário administrador padrão** (`AdminSeedService`);
  - a **campanha da Colônia de Férias de Julho** com 5 lotes × 6 quartos (`ColoniaSeedService`).
- Em deploys seguintes esses seeds **não re-rodam** (guard de primeira execução), então
  nada é sobrescrito nem reiniciado.

---

## 1. Criar o projeto e o banco

1. No [Railway](https://railway.app), crie um **New Project → Deploy from GitHub repo** e
   selecione `S6NXGOD/sistema_senatepi`.
2. **Add → Database → PostgreSQL**. Isso cria a variável de referência
   `${{ Postgres.DATABASE_URL }}`.

---

## 2. Serviço API (backend)

O primeiro serviço criado a partir do repo é a API. Ele usa o `railway.json` da **raiz**
(build `npm run build --workspace=@senatepi/api`, start `npm run start`).

**Settings → Root Directory:** deixe a **raiz** (`/`).

**Variáveis de ambiente** (Settings → Variables):

```
DATABASE_URL=${{ Postgres.DATABASE_URL }}
NODE_ENV=production
API_PREFIX=api

# Gere cada segredo com: openssl rand -base64 48
JWT_ACCESS_SECRET=<segredo-forte>
JWT_REFRESH_SECRET=<segredo-forte>
QR_SIGNING_SECRET=<segredo-forte>
JWT_ACCESS_EXPIRES_IN=30d
JWT_REFRESH_EXPIRES_IN=60d

# Admin criado no 1º deploy — defina uma senha forte ANTES de subir
SEED_ADMIN_EMAIL=admin@senatepi.org.br
SEED_ADMIN_PASSWORD=<senha-forte>

# Depois de criar o serviço Web, coloque o domínio dele aqui (CORS)
CORS_ORIGINS=https://<seu-web>.up.railway.app

# Armazenamento (ver seção 5)
STORAGE_DRIVER=local
STORAGE_PUBLIC_URL=https://<sua-api>.up.railway.app
```

> A API escuta na `PORT` que o Railway injeta automaticamente — não defina `PORT`.
> O Railway gera o domínio em **Settings → Networking → Generate Domain**.

---

## 3. Serviço Web (frontend)

Crie um **segundo serviço** no mesmo projeto: **New → GitHub Repo →** mesmo repositório.

**Settings → Root Directory:** `apps/web` (ele usa `apps/web/railway.json`).

**Variáveis de ambiente:**

```
# É EMBUTIDA NO BUILD — precisa apontar para a API já com /api no final
NEXT_PUBLIC_API_URL=https://<sua-api>.up.railway.app/api
NEXT_PUBLIC_APP_NAME=SENATEPI
```

> Como `NEXT_PUBLIC_*` é embutida no build, se você mudar a URL da API depois,
> precisa **rebuildar** o serviço Web.

---

## 4. Ligar os domínios (CORS)

1. Gere o domínio de cada serviço (Networking → Generate Domain).
2. No serviço **API**, ajuste `CORS_ORIGINS` para o domínio do **Web**.
3. No serviço **Web**, confirme `NEXT_PUBLIC_API_URL` com o domínio da **API** + `/api`.
4. Redeploy dos dois se necessário.

---

## 5. Armazenamento de arquivos (importante)

O filesystem do Railway é **efêmero**: com `STORAGE_DRIVER=local`, uploads (fotos,
carteirinhas) são **perdidos a cada redeploy**. Para produção, escolha uma opção:

- **S3/compatível** (recomendado): `STORAGE_DRIVER=s3` + `STORAGE_ENDPOINT`,
  `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`,
  `STORAGE_FORCE_PATH_STYLE`.
- **Railway Volume**: crie um Volume e monte em `STORAGE_LOCAL_DIR` (ex.: `/data/uploads`),
  mantendo `STORAGE_DRIVER=local` e `STORAGE_LOCAL_DIR=/data/uploads`.

---

## 6. Checklist de segurança (antes de ir ao ar)

- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `QR_SIGNING_SECRET` definidos e **fortes**
      (o código tem fallbacks só de dev — nunca use em produção).
- [ ] `SEED_ADMIN_PASSWORD` definido **antes** do 1º deploy (senão cai numa senha padrão insegura).
- [ ] Faça login e **troque a senha do admin** após o primeiro acesso.
- [ ] `NODE_ENV=production` (desliga o Swagger em `/api/docs`).
- [ ] Confirme que nenhum `.env` real foi para o Git (só o `.env.example` deve existir no repo).
- [ ] `CORS_ORIGINS` restrito ao domínio do front.

---

## 7. Rodar localmente (dev)

O `docker-compose` foi removido; use um PostgreSQL local ou de nuvem.

```bash
# 1. Copie o exemplo e preencha (DATABASE_URL, segredos, etc.)
cp .env.example .env
cp .env.example apps/api/.env      # a API lê apps/api/.env
# apps/web/.env.local → NEXT_PUBLIC_API_URL=http://localhost:3333/api

# 2. Instale e prepare o banco
npm install
npm run db:deploy        # aplica migrations
npm run db:seed          # (opcional) popula dados de exemplo

# 3. Suba API + Web juntos
npm run dev
# API:  http://localhost:3333/api
# Web:  http://localhost:3000
```

---

## 8. Referência de scripts

**Raiz**
- `npm run dev` — API + Web em paralelo (watch)
- `npm run build` — build dos dois apps
- `npm run start` — start de produção da API (`migrate deploy` + servidor)
- `npm run db:deploy` / `db:seed` / `db:studio`

**apps/api**
- `build: nest build` · `start: prisma migrate deploy && node dist/main.js`
- `postinstall: prisma generate` (gera o client do Prisma na nuvem)

**apps/web**
- `build: next build` · `start: next start` (respeita a `PORT` do Railway)
