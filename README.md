# SENATEPI — Sistema de Gestão Sindical

Plataforma de gestão do **Sindicato dos Enfermeiros, Auxiliares e Técnicos em Enfermagem do Estado do Piauí**: filiação, recadastramento, carteirinha digital, eventos, validação por QR Code, dependentes, funcionários, prestadores, documentos, dashboard e auditoria.

> **Status desta entrega:** fundação completa do monorepo. Banco de dados, infraestrutura, backend (todos os módulos com API funcional) e o scaffold do frontend (login + dashboard + telas-referência) estão prontos. Algumas telas do frontend estão marcadas como _“em construção”_ — suas APIs já existem e serão consumidas nas próximas iterações.

---

## 🧱 Arquitetura

Monorepo com **npm workspaces**:

```
projeto_senatepi/
├── apps/
│   ├── api/                 # Backend — NestJS 10 + Prisma + PostgreSQL
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Modelagem completa (12+ entidades)
│   │   │   └── seed.ts         # Seed inicial (usuários, filiado exemplo, etc.)
│   │   └── src/
│   │       ├── common/         # Storage (S3/MinIO), imagem, QR Code, auditoria, decorators
│   │       ├── modules/        # auth, filiados, dependentes, funcionarios, prestadores,
│   │       │                   # eventos, presencas, carteirinhas, dashboard, auditoria, health
│   │       ├── prisma/         # PrismaService
│   │       ├── app.module.ts
│   │       └── main.ts
│   └── web/                 # Frontend — Next.js 15 (App Router) + Tailwind + shadcn-style
│       └── src/
│           ├── app/
│           │   ├── login/          # Tela de login
│           │   └── (dashboard)/    # Área autenticada (layout + páginas)
│           ├── components/         # UI base, sidebar, topbar, providers
│           └── lib/                # api (axios + refresh), auth (context), utils
├── docker-compose.yml       # PostgreSQL 16 + MinIO (+ criação do bucket)
├── .env.example
└── package.json             # Workspaces + scripts orquestradores
```

### Stack

| Camada        | Tecnologias |
|---------------|-------------|
| Frontend      | Next.js 15, TypeScript, TailwindCSS, React Hook Form, Zod, TanStack Query, Framer Motion, Recharts, html5-qrcode |
| Backend       | NestJS 10, TypeScript, Prisma ORM, class-validator, Swagger |
| Banco         | PostgreSQL 16 |
| Armazenamento | MinIO (dev) / AWS S3 (prod) — mesma API (`@aws-sdk/client-s3`) |
| Auth          | JWT (access + refresh com rotação), bcrypt, guard de perfis |
| Imagens       | `sharp` — redimensiona, comprime, converte para **WebP** e gera thumbnail |
| QR Code       | `qrcode` + assinatura **HMAC** (anti-falsificação) |
| PDF           | `pdfkit` — carteirinha digital |

---

## 🎨 Identidade visual

Paleta institucional aplicada via Tailwind (`senatepi.*`):

| Cor | Hex |
|-----|-----|
| Verde escuro | `#1B7F0A` |
| Verde médio  | `#4FA11B` |
| Verde claro  | `#9BC53D` |
| Branco       | `#FFFFFF` |
| Cinza claro  | `#F5F7FA` |

Inclui **dark mode** (`next-themes`).

---

## 🚀 Como rodar (desenvolvimento)

### Pré-requisitos
- Node.js ≥ 20
- Docker + Docker Compose (para PostgreSQL e MinIO)

### Passo a passo

```bash
# 1. Instalar dependências (na raiz — instala api e web)
npm install

# 2. Subir a infraestrutura (PostgreSQL + MinIO + bucket)
npm run infra:up

# 3. Gerar o client do Prisma e aplicar as migrações
npm run db:generate
npm run db:migrate          # cria as tabelas (primeira vez: nomeie a migração, ex. "init")

# 4. Popular dados iniciais (usuários, filiado de exemplo, evento...)
npm run db:seed

# 5. Rodar backend + frontend juntos
npm run dev
```

| Serviço            | URL |
|--------------------|-----|
| Frontend           | http://localhost:3000 |
| API                | http://localhost:3333/api |
| Swagger (OpenAPI)  | http://localhost:3333/api/docs |
| MinIO Console      | http://localhost:9001 (minioadmin / minioadmin) |

> Os arquivos `.env` de desenvolvimento já estão criados na raiz, em `apps/api/.env` e `apps/web/.env.local`. **Troque os segredos em produção.**

### Usuários de teste (após o seed)

| Perfil        | E-mail                        | Senha          |
|---------------|-------------------------------|----------------|
| Administrador | admin@senatepi.org.br         | `senatepi@2026` |
| Diretoria     | diretoria@senatepi.org.br     | `senatepi@2026` |
| Funcionário   | funcionario@senatepi.org.br   | `senatepi@2026` |
| Recepção      | recepcao@senatepi.org.br      | `senatepi@2026` |

---

## 🔐 Perfis e permissões

| Perfil        | Acesso |
|---------------|--------|
| `ADMIN`       | Total |
| `DIRETORIA`   | Operacional (cadastros, emissão de carteirinha, auditoria) |
| `FUNCIONARIO` | Limitado (cadastro/edição de filiados e dependentes) |
| `RECEPCAO`    | Somente validação de QR e consulta |

Aplicadas via `@Roles(...)` + `RolesGuard` global. Rotas públicas usam `@Public()`.

---

## 📋 Módulos da API

Todos sob o prefixo `/api`. Documentação interativa em `/api/docs`.

- **auth** — login, refresh (rotação), logout, recuperação/reset de senha
- **filiados** — CRUD, upload de foto (WebP + thumb), matrícula automática, QR Code
- **dependentes** — cônjuge/filhos, **validação automática de idade** (filho ≤ 18 p/ eventos)
- **funcionarios** / **prestadores** — CRUD, status, QR Code, vigência de contrato
- **eventos** — CRUD, tipos e status
- **presencas** — **validação de QR** com regras por tipo de pessoa + anti-duplicidade + registro de presença
- **carteirinhas** — emissão pós-aprovação, dados mobile, **PDF** com QR
- **dashboard** — indicadores e séries para gráficos
- **auditoria** — consulta de logs (login, escrita, validação de QR)

### Regras de validação em eventos
| Tipo | Liberação |
|------|-----------|
| Filiado | Apenas se `ATIVO` |
| Dependente (cônjuge) | Se filiado responsável `ATIVO` |
| Dependente (filho) | Se filiado `ATIVO` **e** idade ≤ 18 |
| Funcionário | Apenas se `ATIVO` |
| Prestador | Se `ATIVO` **e** dentro da vigência do contrato |

Toda validação verifica a **assinatura HMAC** do QR Code e registra auditoria.

---

## 🧪 Testes

```bash
npm run test            # roda os testes de todos os workspaces
```

Inclui testes de unidade das regras de negócio (cálculo de idade e elegibilidade de dependentes em `apps/api/.../dependentes.regras.spec.ts`).

---

## 📦 Build de produção

```bash
npm run build           # build de api + web
npm --workspace=@senatepi/api run prisma:deploy   # aplica migrações em produção
npm --workspace=@senatepi/api run start:prod
npm --workspace=@senatepi/web run start
```

Em produção, basta apontar as variáveis `STORAGE_*` para um bucket **AWS S3** (com `STORAGE_FORCE_PATH_STYLE=false`) — o código de armazenamento é o mesmo.

---

## 🗺️ Roadmap (próximas iterações)

- [ ] Telas completas de Funcionários, Prestadores, Eventos, Recadastramento, Carteirinhas e Auditoria (APIs já prontas)
- [ ] Formulário multi-etapas de filiação com upload de foto e assinatura
- [ ] Termo de consentimento (LGPD) em PDF com assinatura digital/manual (tablet)
- [ ] Fluxo de aprovação de recadastramento com diff de alterações
- [ ] Relatórios em PDF e Excel com filtros avançados
- [ ] Envio de e-mail (recuperação de senha) e notificações
- [ ] Testes e2e e pipeline de CI/CD

---

© SENATEPI — Sindicato dos Enfermeiros, Auxiliares e Técnicos em Enfermagem do Estado do Piauí.
