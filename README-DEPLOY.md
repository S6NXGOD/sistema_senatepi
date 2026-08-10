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
# DE QUAL SINDICATO É ESTA INSTALAÇÃO — obrigatória, sem valor padrão.
# A API NÃO SOBE sem ela, e isso é de propósito: cair no SENATEPI por omissão
# faria a API de outro cliente subir com o nome, os módulos e os campos do
# SENATEPI POR CIMA DO BANCO DELE. Serviço fora do ar se percebe em 30 s;
# cliente trocado em silêncio leva semanas. Valores: senatepi, sindserm.
TENANT=senatepi

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

# CONSULTA AO CNJ — leia TODAS as instâncias do processo.
#
# DESLIGADA POR PADRÃO, e o padrão é ruim para quem tem jurídico: com ela
# ausente o sistema lê UM ÚNICO documento do DataJud — o que o Elasticsearch
# ranquear em primeiro — e o processo aparece com uma instância só. O 2º grau,
# a Turma Recursal do Juizado e o recurso no tribunal superior simplesmente não
# existem para o sistema.
#
# Ligue em TODA instalação que use o módulo de processos.
DATAJUD_MULTI_INSTANCIA=true

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
# O MESMO CLIENTE DECLARADO NA API. Obrigatória: sem ela o BUILD FALHA.
# Ela decide a paleta, o logo, o vocabulário e quais módulos existem — e como
# o Tailwind compila a cor dentro do CSS, isso é resolvido no build, não em
# runtime. Precisa ser IGUAL ao `TENANT` da API do mesmo par: front de um
# sindicato apontando para a API de outro é o pior estado possível.
NEXT_PUBLIC_TENANT=senatepi

# É EMBUTIDA NO BUILD — precisa apontar para a API já com /api no final
NEXT_PUBLIC_API_URL=https://<sua-api>.up.railway.app/api
NEXT_PUBLIC_APP_NAME=SENATEPI
```

> Como `NEXT_PUBLIC_*` é embutida no build, se você mudar a URL da API depois,
> precisa **rebuildar** o serviço Web.

> **`NEXT_PUBLIC_TENANT` precisa estar definida no build E no runtime.** O
> `next.config.ts` usa o cliente no `distDir` (`.next-senatepi`); se ela existir
> só num dos dois momentos, o `next start` procura o build no diretório errado e
> falha com *"Could not find a production build"*. No Railway a variável do
> serviço vale para os dois — só não a defina apenas no comando de build.

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

- [ ] `TENANT` (API) e `NEXT_PUBLIC_TENANT` (Web) definidos, **iguais entre si** e
      apontando para o sindicato certo. Confira também que o `DATABASE_URL` é o
      banco DAQUELE cliente: cada sindicato tem o seu, e não há seleção por
      requisição — a instalação inteira é de um cliente só.
- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `QR_SIGNING_SECRET` definidos e **fortes**.
      Em produção **não há fallback**: se faltarem, a aplicação não sobe (um segredo
      previsível permitiria forjar credenciais desta instalação). Segredos são
      **por sindicato** — nunca reaproveite os mesmos valores em dois clientes,
      senão um token emitido para um passa a valer no outro.
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

---

## 9. Forçar logout de todos (ferramenta pontual)

**Não faz parte de nenhuma rotina.** Roda à mão, quando alguém precisa sair de
um aparelho — conta administrativa usada em demonstração, usuários novos que
devem passar a entrar com a própria conta, suspeita de senha exposta.

```bash
# No shell do serviço da API no Railway (a DATABASE_URL já está no ambiente):
npm run forcar-logout -w @senatepi/api          # pede confirmação (digite SIM)
npm run forcar-logout -w @senatepi/api -- --sim # sem perguntar
```

**Por que não basta apagar as sessões.** O token de acesso é um JWT autocontido
e válido por 30 dias: enquanto ele não expira, o aplicativo nunca pede refresh e
a sessão continua de pé. O script faz as duas coisas que, juntas, resolvem —
grava um corte por usuário (`users.sessoes_validas_apos`, conferido no
`JwtStrategy` contra o `iat` do token) e apaga os refresh tokens, para que
ninguém receba um token novo logo em seguida.

**Efeito colateral útil:** ao ser desconectado, o aplicativo faz uma navegação
completa para `/login` — o que também traz a versão nova do front para quem
estava com o app instalado no celular segurando uma tela antiga.

**O que NÃO acontece:** nenhum dado é apagado, desativado ou alterado. Todos
voltam a entrar normalmente com a própria senha.
