# 03 — Tenant Context: identificação e propagação

> **Escopo.** Desenho da camada que identifica o tenant na entrada e o propaga por todo
> o sistema, sobre o modelo de isolamento escolhido em
> [`02-MODELO_DE_TENANCY.md`](./02-MODELO_DE_TENANCY.md) (banco compartilhado +
> `tenant_id` + RLS, com conexão indireta para futuro banco dedicado).
> **Nenhum código foi alterado.** Documento para revisão.
>
> **Data:** 2026-08-02 · **Commit base:** `adc64d8` · **Status:** aguardando revisão

---

## Sumário

1. [Ponto de partida no código real](#1-ponto-de-partida-no-código-real)
2. [Identificação do tenant na entrada](#2-identificação-do-tenant-na-entrada)
3. [Onde o contexto é criado](#3-onde-o-contexto-é-criado)
4. [A zona de resolução — o problema do ovo e da galinha](#4-a-zona-de-resolução--o-problema-do-ovo-e-da-galinha)
5. [Propagação por canal](#5-propagação-por-canal)
6. [Comportamento nos casos de falha](#6-comportamento-nos-casos-de-falha)
7. [Como não depender da memória do desenvolvedor](#7-como-não-depender-da-memória-do-desenvolvedor)
8. [Arquivos a criar e modificar](#8-arquivos-a-criar-e-modificar)
9. [Testes propostos para esta camada](#9-testes-propostos-para-esta-camada)
10. [Decisões pendentes que afetam este desenho](#10-decisões-pendentes-que-afetam-este-desenho)

---

## 1. Ponto de partida no código real

Verificado nesta análise (`grep` sobre `apps/api/src`):

| Fato | Resultado | Consequência |
|---|---|---|
| Middlewares NestJS | **0** | Campo limpo — o ALS entra sem desfazer nada |
| Exception filters | **0** | Erros de tenant precisam de filtro próprio |
| `AsyncLocalStorage` / `nestjs-cls` | **0** | Nenhuma infra de contexto a reaproveitar |
| `Scope.REQUEST` | **0** | Sem provider request-scoped a migrar |
| Guards globais | 4, em `app.module.ts:74-82` | Ordem conhecida: `Throttler → JwtAuth → Roles → Permissions` |
| Contexto atual | `req.user` (`AuthUser`) | Único canal; services não veem o request |

**Como o dado que identifica o tenant chega hoje, nas rotas públicas:**

| Rota | Onde vem a chave | Arquivo |
|---|---|---|
| `GET /sala/:eventoId` (+3) | **route param** | `checkin.controller.ts:44-93` |
| `GET /colonia/disponibilidade` | **query param** `?slug=` | `colonia.controller.ts:43-45` |
| `POST /colonia/reservas` | **body** — `dto.slug` | `colonia.controller.ts:51-53` + `dto/*.ts:54` |
| `POST /colonia/sorteio/inscricao` | **body** — `dto.slug` | `colonia.controller.ts:58-60` + `dto/*.ts:64` |
| `GET /recadastro/:token` (+3) | **route param** | `link-recadastramento.controller.ts:62-97` |
| `GET /certificados/verificar/:codigo` | **route param** | `plenario.controller.ts:258-263` |
| `POST /auth/login` | **body** — `dto.email` | `auth.controller.ts:23-28` |
| `POST /portal-empresa/auth/login` | **body** — `dto.cnpj` | `portal-empresa-auth.controller.ts:33` |

> **Detalhe que condiciona o desenho:** duas rotas trazem a chave **no corpo**. Um Guard
> consegue ler `req.body` (o body-parser do Nest roda antes dos guards), mas **antes do
> `ValidationPipe`** — ou seja, o guard vê o corpo **cru e não validado**. O resolvedor
> precisa tratar isso como entrada hostil.

---

## 2. Identificação do tenant na entrada

### 2.1 Princípio

> **O tenant nunca vem de algo que o cliente escolhe livremente.** Ele vem de uma
> credencial assinada pelo servidor, ou é derivado de um recurso que o servidor
> localiza. Header e subdomínio são **conferência**, jamais fonte.

Isso descarta `X-Tenant-Id` como fonte: um header é texto livre do cliente. Se um usuário
autenticado pudesse trocá-lo, teríamos escalada horizontal em uma linha de `curl`.

### 2.2 Cadeia de resolução, em ordem

O `TenantContextGuard` percorre as estratégias na ordem abaixo e para na primeira que
resolver. Cada rota declara qual espera; a cadeia é o padrão.

| # | Estratégia | Fonte | Aplica-se a | Confiança |
|--:|---|---|---|:--:|
| 1 | **`SemTenant`** | decorator `@SemTenant()` | `/health`, `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/portal-empresa/auth/login` | — (opt-out explícito) |
| 2 | **Claim do JWT da equipe** | `tid` no access token | Todas as rotas autenticadas do administrativo | 🔒🔒🔒 assinado |
| 3 | **Claim do JWT da empresa** | `tid` no token do portal | `portal-empresa/*` autenticadas | 🔒🔒🔒 assinado |
| 4 | **Derivado de recurso** | `@TenantPor('param:eventoId')` etc. | Rotas `@Public()` com slug/id/token | 🔒🔒 servidor localiza |
| 5 | **Host / subdomínio** | `Host` header | — | 🔒 **só conferência** (§2.4) |

### 2.3 Por que a claim do JWT é a fonte primária

Três razões ancoradas no código:

1. **O ponto de validação já existe e já custa uma query.** `jwt.strategy.ts:33-52` relê
   o usuário do banco a cada request, por decisão deliberada (revogação imediata). O
   `tenantId` sai dessa mesma leitura — **zero round-trip adicional**.
2. **A claim é conferida contra o banco, não confiada.** O token diz `tid`; a estratégia
   relê o vínculo e compara. Token antigo com vínculo revogado morre na hora — mesma
   garantia que o sistema já dá hoje para `role` e `permissoes`.
3. **Não exige mudança de topologia.** `NEXT_PUBLIC_API_URL` é embutida no build do front
   (`README-DEPLOY.md:78-85`): uma API por subdomínio exigiria um build de front por
   tenant. A claim funciona com **um** deploy de API e **um** de front.

### 2.4 Sobre subdomínio e domínio personalizado

Recomendação: **subdomínio no front, claim na API.**

- `sindicato-a.senatepi.app` → mesma API, mesmo build; o front usa o host apenas para
  **branding** e para pré-selecionar o tenant na tela de login.
- Na API, o `Host` entra como **conferência**: se o host resolver o tenant X e o token
  disser Y, a request é rejeitada (403) e registrada como evento de segurança. Divergência
  aqui é sinal de token reaproveitado entre abas/tenants, não de erro honesto.
- **Domínio personalizado** (`portal.sindicatoA.org.br`) é viável no mesmo desenho —
  vira uma linha em `Tenant.dominios[]`. Custo real está no TLS/DNS e em `CORS_ORIGINS`
  (`main.ts:49-52`), que hoje é uma lista fixa por deploy e passaria a ser dinâmica.

> Depende de **D7** (§10). O desenho acima é o que exige menos mudança na topologia atual.

---

## 3. Onde o contexto é criado

### 3.1 A restrição que decide o lugar

`AsyncLocalStorage.run(store, callback)` só funciona se **envolver** a execução seguinte.
Um Guard devolve `boolean` — ele **não envolve** nada do que vem depois. Portanto:

> **O ALS não pode ser aberto num Guard.** Precisa ser aberto em **middleware**, que é a
> única camada do Nest capaz de envolver todo o resto (`als.run(store, () => next())`).

Mas o middleware roda **antes** do `JwtAuthGuard` — nele ainda não existe `req.user` e o
tenant é desconhecido. A solução é separar as responsabilidades:

| Camada | Papel | Momento |
|---|---|---|
| **`TenantContextMiddleware`** | **Abre** o ALS com um store vazio e mutável | Antes de tudo |
| **`TenantContextGuard`** | **Preenche** o store (`store.tenantId = …`) | Após `JwtAuthGuard` |

O store é criado vazio e populado depois — por isso precisa ser um objeto mutável, não um
valor imutável. É o mesmo padrão da biblioteca `nestjs-cls`, aqui descrito explicitamente
porque a alternativa (`als.enterWith()` dentro do guard) tem semântica frágil e não deve
ser usada.

### 3.2 Ordem final dos guards

```
express body-parser
   ↓
TenantContextMiddleware        ← als.run({}, () => next())    [NOVO]
   ↓
ThrottlerGuard                 (já existe)
   ↓
JwtAuthGuard                   (já existe) → popula req.user
   ↓
TenantContextGuard             ← resolve e preenche o store   [NOVO]
   ↓
RolesGuard                     (já existe)
   ↓
PermissionsGuard               (já existe)
   ↓
ValidationPipe → Controller → Services
   ↓
AuditInterceptor               (já existe) → lê tenantId do store
```

Registro em `app.module.ts:74-82`, inserindo `TenantContextGuard` **entre** `JwtAuthGuard`
e `RolesGuard`. O `AppModule` passa a implementar `NestModule.configure()` para o
middleware — hoje ele não implementa (não há middleware algum).

**Por que depois do `JwtAuthGuard`:** precisa de `req.user`.
**Por que antes do `RolesGuard`:** a autorização passará a considerar o vínculo com o
tenant (D2), e a ordem já deixa isso pronto.
**Por que não pula em `@Public()`:** rotas públicas são justamente as que mais precisam de
resolução (estratégia 4). O guard **não** faz early-return em `IS_PUBLIC_KEY` — ele troca
de estratégia. Isso é o oposto do que `JwtAuthGuard` e `PermissionsGuard` fazem hoje, e é
intencional.

### 3.3 Forma do store

```
TenantStore {
  tenantId?:  TenantId          // branded string
  tenantSlug?: string
  origem:     'jwt-equipe' | 'jwt-empresa' | 'recurso' | 'cron' | 'seed' | 'sem-tenant'
  userId?:    string
  empresaId?: string
  ip?:        string
  requestId:  string            // correlação em log e auditoria
}
```

`origem` não é decoração: é o que permite auditar **como** cada acesso resolveu o tenant e
detectar um caminho de resolução inesperado em produção.

---

## 4. A zona de resolução — o problema do ovo e da galinha

**Este é o ponto mais delicado do desenho e o que mais facilmente passa despercebido.**

Para saber o tenant de um login, é preciso consultar `users` por e-mail. Mas consultar
`users` sob RLS exige já saber o tenant. Circular.

O mesmo vale para toda a estratégia 4: para saber o tenant de `/sala/:eventoId` é preciso
ler `Evento` — antes de haver contexto.

### 4.1 Solução: um conjunto pequeno, nomeado e fechado

Duas conexões, dois papéis de banco, dois clientes Prisma:

| Cliente | Papel no Postgres | RLS | Quem pode usar |
|---|---|:--:|---|
| `prisma.forTenant(id)` | `senatepi_app` | **sujeito** (`FORCE ROW LEVEL SECURITY`) | Todos os 51 provedores |
| `prismaPlataforma` | `senatepi_platform` | isento | **Só** `TenantResolverService`, migrations e administração da plataforma |

`prismaPlataforma` fica num módulo próprio, não é `@Global()`, e é proibido por lint fora
da allowlist (§7). O caminho inseguro **tem nome** e é revisável.

### 4.2 As consultas que compõem a zona

Levantamento completo a partir do código. **Esta lista é fechada — acrescentar item exige
revisão explícita.**

| # | Consulta | Model | Onde hoje | Devolve |
|--:|---|---|---|---|
| 1 | Login da equipe por e-mail | `User` | `auth.service.ts:76` | `tenantId` do vínculo |
| 2 | Recuperação de senha por e-mail | `User` | `auth.service.ts:194` | idem |
| 3 | Refresh por hash | `RefreshToken` | `auth.service.ts:140` | idem |
| 4 | Reset por hash | `PasswordReset` | `auth.service.ts:227` | idem |
| 5 | Revalidação da sessão | `User` | `jwt.strategy.ts:34` | confere `tid` do token |
| 6 | Login patronal por CNPJ | `Empresa` | `portal-empresa-auth.service.ts:55` | `tenantId` da empresa |
| 7 | Revalidação da empresa | `Empresa` | `empresa-jwt.strategy.ts:53` | confere `tid` |
| 8 | Link de recadastramento | `LinkRecadastramento` | `link-recadastramento.service.ts:350` | `tenantId` do link |
| 9 | Campanha por slug | `ColoniaTemporada` | `colonia.service.ts:70` | `tenantId` da temporada |
| 10 | Sala pública | `Evento` | `checkin.service.ts` (`salaPublica`) | `tenantId` do evento |
| 11 | Verificação de certificado | `Presenca`/código | `plenario.controller.ts:263` | `tenantId` da presença |
| 12 | Metadados do tenant | `Tenant` | *(novo)* | status, slug, domínios |

**Regra de projeção:** cada consulta devolve **apenas** o `tenantId` (e o mínimo para o
passo seguinte). Um resolvedor **nunca** devolve o registro de negócio — quem faz isso é o
service normal, já com escopo. Sem essa regra, a zona de resolução vira uma porta lateral
para ler dados sem RLS.

### 4.3 Consequência de configuração

Nasce uma variável nova: `DATABASE_URL_PLATFORM` (mesmo banco, papel diferente). O
`validar-ambiente.ts` passa a exigi-la em produção, na lista de **críticas** — sem ela, ou
o sistema não sobe, ou alguém "resolve" apontando os dois clientes para o papel
`postgres`, que tem `BYPASSRLS` e anula todo o modelo (RR12 do doc 02).

**Orçamento de conexões:** 2 pools por instância (~10 conexões com 2 vCPU) em vez de 1.
Confortável dentro de R-4 do doc 02.

---

## 5. Propagação por canal

### 5.1 Visão geral

```
                    ┌──────────────────────────────┐
                    │  AsyncLocalStorage (ALS)      │  ← fonte única da verdade
                    │  TenantContextService         │
                    └───────────┬──────────────────┘
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   Controllers            PrismaService            Serviços comuns
   @TenantAtual()      forTenant() + extensão      Storage · QrCode · Audit
                              ▼
                    ┌──────────────────────┐
                    │ $transaction         │
                    │  set_config(local)   │
                    │        ▼             │
                    │  Postgres + RLS      │  ← garantia final, fail-closed
                    └──────────────────────┘
```

### 5.2 Canal a canal

| Canal | Como recebe | Precisa mudar? |
|---|---|---|
| **Controllers** | `@TenantAtual()` (novo param decorator, espelha `@CurrentUser`) | Só onde o tenant for usado explicitamente |
| **Services** | **Não recebem parâmetro.** Leem do ALS via `PrismaService` | **Nenhuma mudança de assinatura** — é o ponto central do desenho |
| **Repositories** | Não existem (01 §4.1) | — |
| **ORM (Prisma)** | `forTenant()` + extensão `$allModels.$allOperations`: injeta `where.tenantId` e `data.tenantId` | `prisma.service.ts` reescrito |
| **Queries nativas** | **Não recebem injeção.** Filtradas pelo **RLS** dentro da transação de escopo | Os 9 sítios ficam como estão; muda só o cliente que os executa |
| **Cache** | Não há cache de dados (01 §9). O `Map` de `assets.util.ts` guarda logo de arquivo — **passa a precisar de chave por tenant** | `assets.util.ts` |
| **Workers / filas** | Não existem | — |
| **Tarefas agendadas** | `runParaTenant(tenantId, fn)` — abre ALS manualmente; o job **itera** tenants | 2 crons + 2 seeds |
| **Auditoria** | `AuditInterceptor` roda depois dos guards; lê do ALS | `audit.service.ts` grava `tenantId` |
| **Storage** | Prefixo `tenants/<tenantId>/…` em toda chave | `storage.service.ts` + 6 sítios de upload |
| **QR Code** | `tenantId` entra no HMAC e no payload | `qrcode.service.ts` |
| **PDFs** | Herdam o escopo dos dados consultados | — (mas ver `ConfiguracaoSindicato`) |
| **Config institucional** | `findFirst` singleton → um registro **por tenant** | `cobrancas.service.ts:749`, `contribuicoes.service.ts:247` |

### 5.3 O ponto que faz o desenho valer a pena

> **Nenhum dos 44 services muda de assinatura.**

Eles continuam chamando `this.prisma.filiado.findMany({ where: { situacao } })`. O que muda
é o que `this.prisma` devolve: um cliente já amarrado ao tenant do ALS. Serviços que hoje
recebem `ctx: { ip, userAgent, userId }` montado à mão no controller
(`colonia.controller.ts:36-38`, `auth.controller.ts:19-21`) continuam funcionando — esse
padrão inclusive passa a poder ler do ALS, eliminando o boilerplate.

Isso é o que torna a adaptação dos 51 provedores viável sem reescrever o domínio.

### 5.4 Tarefas agendadas — o canal que nenhum modelo resolve sozinho

Hoje os dois crons varrem o banco inteiro (`processos-cron.service.ts:33`,
`cobrancas-cron.service.ts:17`). Com tenant, o desenho passa a ser:

```
@Cron('0 2 * * *')
async sincronizarAtivos() {
  for (const t of await this.tenants.ativos()) {          // prismaPlataforma
    await runParaTenant(t.id, () => this.varrerProcessos());
  }
}
```

Três consequências que precisam entrar no plano:

1. **A trava de reentrância vira por tenant.** Hoje é `this.rodando`, um booleano em
   memória (`processos-cron.service.ts:26`) — que já não coordena entre réplicas.
2. **O rate limit do CNJ é da instalação, não do tenant.** O delay de 2–3s
   (`processos-cron.service.ts:20-21`) hoje protege uma varredura; com N tenants em
   sequência, a janela noturna cresce linearmente. É orçamento de tempo, não de código.
3. **Falha de um tenant não pode parar os outros** — o `try/catch` por processo já existe
   e precisa de um equivalente por tenant.

---

## 6. Comportamento nos casos de falha

Tabela normativa. Cada linha vira um teste (§9).

| Situação | Resposta | Corpo / código | Auditoria | Justificativa |
|---|:--:|---|:--:|---|
| **Nenhum tenant resolvido** — rota autenticada | `401` | `TENANT_NAO_RESOLVIDO` | log | Token sem `tid` = token de versão anterior; forçar novo login é seguro e reversível |
| **Nenhum tenant resolvido** — rota pública por recurso (`slug`/`id`/`token` inexistente) | `404` | `RECURSO_NAO_ENCONTRADO` | não | **Nunca** distinguir "não existe" de "existe em outro tenant" — a diferença é enumerável por quem não tem sessão |
| **Nenhum tenant resolvido** — rota sem `@SemTenant()` e sem estratégia | `500` | `TENANT_NAO_CONFIGURADO` | **alerta** | É bug de configuração de rota, não erro do usuário. Falhar alto na primeira request, não silenciosamente |
| **Tenant inativo / suspenso** | `403` | `TENANT_SUSPENSO` | sim | Mensagem distinta para o usuário final ("acesso suspenso, procure a administração") |
| **Tenant cancelado / removido** | `404` | `RECURSO_NAO_ENCONTRADO` | sim | Cancelado não deve revelar que já existiu |
| **Usuário tenta acessar outro tenant** (token diz A, recurso é de B) | `404` | `RECURSO_NAO_ENCONTRADO` | **evento de segurança** | Sob RLS o registro simplesmente não existe para ele — 404 é a resposta *verdadeira*, e não confirma existência |
| **Divergência host × token** | `403` | `TENANT_INCONSISTENTE` | **evento de segurança** | Sinal de token reaproveitado entre tenants |
| **Job em segundo plano sem tenant** | *lança* | `TenantContextMissingError` | **alerta** | Job precisa chamar `runParaTenant`. Falha alta e imediata |
| **Query executada sem contexto** | *lança* | `TenantContextMissingError` | **alerta** | Ver §6.1 |
| **Query sem contexto que escape da extensão** | 0 linhas | — | — | Rede final do RLS |

### 6.1 Por que a query sem contexto lança em vez de devolver vazio

O RLS já garante segurança: sem `app.tenant_id`, a política não casa e o resultado é
**zero linhas**. Só que zero linhas é **péssimo para diagnóstico** — a tela aparece vazia,
ninguém sabe por quê, e o bug pode viver meses.

Por isso a extensão do Prisma **lança antes de chegar ao banco**, com mensagem explícita:

- **Extensão lança** → experiência de desenvolvimento (erro legível, cedo, com stack).
- **RLS devolve vazio** → garantia de segurança (vale mesmo se a extensão tiver bug, for
  contornada ou o código for novo).

As duas camadas existem para propósitos diferentes. Remover a segunda porque a primeira
"já cobre" é justamente o erro que o modelo do doc 02 se propõe a impedir.

---

## 7. Como não depender da memória do desenvolvedor

Os sete mecanismos do doc 02 §12 continuam valendo. Abaixo o que é **específico desta
camada** — o que impede esquecer o *contexto*, não o *tenant_id*.

| # | Mecanismo | Onde | O que impede |
|--:|---|---|---|
| **C1** | **`PrismaService` não expõe client cru.** O tipo devolvido por `forTenant()` é o único acessível; `prismaPlataforma` vive em módulo separado, não-`@Global()` | `prisma.module.ts` | Acesso sem escopo por descuido |
| **C2** | **Extensão lança `TenantContextMissingError`** quando o ALS está vazio | `prisma-tenant.extension.ts` | Query fora de request e fora de `runParaTenant` |
| **C3** | **`@SemTenant()` é obrigatório e explícito.** Rota sem estratégia e sem opt-out **falha em runtime na primeira chamada** | `tenant-context.guard.ts` | Rota nova sem decidir a origem do tenant |
| **C4** | **Teste de cobertura de rotas em CI:** varre o roteador do Nest e falha se alguma rota não tiver estratégia declarada nem `@SemTenant()` | CI | Rota criada daqui a um ano por quem não leu isto |
| **C5** | **Allowlist de `prismaPlataforma` em ESLint** (`no-restricted-imports` por caminho) | Lint | Uso do client sem RLS fora dos 12 resolvedores |
| **C6** | **Tipo `TenantId` branded** — `string & { readonly __tenant: unique symbol }` | Tipos | Passar `userId` onde se espera `tenantId` |
| **C7** | **`origem` no store, gravada em auditoria** | `audit.service.ts` | Permite detectar em produção um caminho de resolução inesperado |

**A hierarquia importa.** C1–C3 falham **alto e cedo** (erro em desenvolvimento). C4–C5
falham **no CI**. O RLS (doc 02 §12 mecanismo 1) falha **fechado em produção**. Nenhuma
delas substitui a outra: as primeiras existem para que a última quase nunca precise agir.

---

## 8. Arquivos a criar e modificar

### 8.1 Criar

| Arquivo | Responsabilidade | Tam. |
|---|---|:--:|
| `apps/api/src/common/tenant/tenant.types.ts` | `TenantId` branded, `TenantStore`, `OrigemTenant` | P |
| `apps/api/src/common/tenant/tenant-context.storage.ts` | Instância do `AsyncLocalStorage` | P |
| `apps/api/src/common/tenant/tenant-context.service.ts` | `atual()`, `exigir()`, `runParaTenant()` | P |
| `apps/api/src/common/tenant/tenant-context.middleware.ts` | Abre o ALS (`als.run`) | P |
| `apps/api/src/common/tenant/tenant-context.guard.ts` | Cadeia de resolução; popula o store | M |
| `apps/api/src/common/tenant/tenant-resolver.service.ts` | **A zona de resolução** (§4.2), único usuário de `prismaPlataforma` | M |
| `apps/api/src/common/tenant/tenant.decorators.ts` | `@TenantAtual()`, `@TenantPor()`, `@SemTenant()` | P |
| `apps/api/src/common/tenant/tenant.errors.ts` | `TenantContextMissingError`, `TenantSuspensoError`, … | P |
| `apps/api/src/common/tenant/tenant-exception.filter.ts` | Traduz os erros para os códigos de §6 | P |
| `apps/api/src/common/tenant/tenant.module.ts` | `@Global()`; exporta context + resolver | P |
| `apps/api/src/prisma/prisma-plataforma.service.ts` | Client sem escopo (`DATABASE_URL_PLATFORM`) | P |
| `apps/api/src/prisma/prisma-tenant.extension.ts` | `$extends` que injeta e valida | **G** |
| `apps/api/src/modules/tenants/*` | CRUD de tenants (administração da plataforma) | M |

### 8.2 Modificar

| Arquivo | O que muda | Risco |
|---|---|:--:|
| `apps/api/src/app.module.ts:74-82` | `implements NestModule`; middleware global; `TenantContextGuard` entre `JwtAuth` e `Roles` | 🟠 |
| `apps/api/src/prisma/prisma.service.ts` | `forTenant()`, aplicação da extensão, `set_config` na transação | 🔴 |
| `apps/api/src/prisma/prisma.module.ts` | Deixa de exportar o client cru | 🔴 |
| `apps/api/src/modules/auth/auth.service.ts:83-89` | Claim `tid` no payload; `login` via resolver | 🟠 |
| `apps/api/src/modules/auth/strategies/jwt.strategy.ts:33-52` | Confere `tid` × vínculo; devolve `tenantId` em `AuthUser` | 🔴 |
| `apps/api/src/common/decorators/current-user.decorator.ts:4-12` | `AuthUser` ganha `tenantId` | 🟢 |
| `apps/api/src/modules/portal-empresa/portal-empresa-auth.service.ts` | Claim `tid` no token da empresa | 🟠 |
| `apps/api/src/modules/portal-empresa/strategies/empresa-jwt.strategy.ts:48-74` | Confere `tid` | 🟠 |
| `apps/api/src/common/audit/audit.service.ts:20-33` | Grava `tenantId` e `origem` | 🟢 |
| `apps/api/src/modules/processos/processos-cron.service.ts:33` | Itera tenants; trava por tenant | 🟠 |
| `apps/api/src/modules/cobrancas/cobrancas-cron.service.ts:17` | Itera tenants | 🟢 |
| `apps/api/src/modules/auth/admin-seed.service.ts:28` | Seed **por tenant**, não por banco vazio | 🟠 |
| `apps/api/src/modules/colonia/colonia-seed.service.ts:104` | Idem | 🟠 |
| `apps/api/src/common/storage/storage.service.ts` | Prefixo `tenants/<id>/` | 🟠 |
| `apps/api/src/common/qrcode/qrcode.service.ts:30-34` | `tenantId` no HMAC | 🔴 |
| `apps/api/src/common/assets.util.ts:12-20` | Chave de cache por tenant | 🟢 |
| `apps/api/src/common/config/validar-ambiente.ts:32` | `DATABASE_URL_PLATFORM` como crítica | 🟢 |
| `apps/api/src/main.ts:49-52` | `CORS_ORIGINS` dinâmico (se D7 = domínio próprio) | 🟠 |
| Controllers das 17 rotas `@Public()` | `@TenantPor(...)` ou `@SemTenant()` | 🟠 |
| `.env.example` | `DATABASE_URL_PLATFORM` | 🟢 |

**🔴 = alto risco.** Os quatro merecem atenção especial: `prisma.service.ts` e
`prisma.module.ts` são o eixo do desenho; `jwt.strategy.ts` está no caminho de **toda**
request autenticada; e `qrcode.service.ts` **invalida carteirinhas já emitidas** se o HMAC
mudar sem período de transição — carteirinhas impressas em campo param de validar. Precisa
de verificação com os dois formatos durante a migração.

---

## 9. Testes propostos para esta camada

Contexto: a API tem hoje **4 arquivos `*.spec.ts`**. Esta camada é a candidata natural a
inaugurar a suíte, porque é nova (sem legado a caracterizar) e porque é onde uma falha
custa mais caro.

### 9.1 Unitários — resolução e contexto

| # | Teste | Verifica |
|--:|---|---|
| U1 | ALS isola requests concorrentes: 50 chamadas paralelas com tenants distintos | Nenhum vazamento entre contextos — o risco nº 1 de ALS |
| U2 | `exigir()` lança `TenantContextMissingError` fora de contexto | C2 |
| U3 | Ordem da cadeia: token presente **vence** header e host | §2.1 |
| U4 | Header `X-Tenant-Id` divergente do token → 403 | §2.4 |
| U5 | `@SemTenant()` permite passar sem tenant | §2.2 |
| U6 | Rota sem estratégia e sem `@SemTenant()` → erro de configuração | C3 |
| U7 | `runParaTenant` aninhado não vaza o tenant externo | §5.4 |
| U8 | Resolvedor devolve **só** `tenantId`, nunca o registro | §4.2 regra de projeção |

### 9.2 Integração — banco real, dois tenants

Exigem Postgres real (RLS não existe em mock). Sugestão: container efêmero no CI.

| # | Teste | Verifica |
|--:|---|---|
| I1 | **Varredura de isolamento:** semeia tenants A e B; percorre **todas** as rotas de listagem autenticadas como A; falha se qualquer resposta contiver ID de B | O teste mais importante da suíte |
| I2 | Query sem `set_config` devolve **zero linhas** (não erro, não dado) | Fail-closed do RLS |
| I3 | `$queryRaw` dos 9 sítios respeita RLS | Doc 02 S-3 |
| I4 | Extensão continua ativa dentro de `$transaction` | Doc 02 S-2 / RR9 |
| I5 | `createMany` grava `tenantId` em todas as linhas | §5.2 |
| I6 | `updateMany`/`deleteMany` não alcançam o outro tenant | §5.2 |
| I7 | `upsert` com mesma chave em dois tenants cria **dois** registros | Unicidades compostas |
| I8 | Papel `senatepi_app` **não** tem `BYPASSRLS` | RR12 |
| I9 | `prismaPlataforma` alcança os dois tenants (é o esperado) | §4.1 |

### 9.3 End-to-end — entradas reais

| # | Teste | Verifica |
|--:|---|---|
| E1 | Login em A → token com `tid` de A → rota de B devolve **404** (não 403) | §6, não-enumerabilidade |
| E2 | Token de A com vínculo revogado → 401 na request seguinte | §2.3 item 2 |
| E3 | `/sala/:eventoId` de outro tenant → 404 | §6 |
| E4 | `/colonia/disponibilidade?slug=` de outro tenant → 404 | §6 |
| E5 | `POST /colonia/reservas` com `slug` no **body** resolve corretamente | §1 — body cru no guard |
| E6 | `POST /colonia/reservas` com body malformado no guard → 400, sem 500 | §1 — entrada hostil |
| E7 | `/recadastro/:token` resolve pelo token; token de A não abre filiado de B | §4.2 item 8 |
| E8 | Portal patronal: CNPJ de A não autentica contra dados de B | §4.2 item 6 |
| E9 | Tenant suspenso → 403 `TENANT_SUSPENSO` em rota autenticada | §6 |
| E10 | Tenant suspenso → 404 em rota pública | §6 |
| E11 | `/health` responde sem tenant | §2.2 |

### 9.4 Cron e segundo plano

| # | Teste | Verifica |
|--:|---|---|
| B1 | Cron sem `runParaTenant` **lança** | §6 |
| B2 | Cron itera todos os tenants ativos e pula suspensos | §5.4 |
| B3 | Falha no tenant 2 não interrompe o 3 | §5.4 item 3 |
| B4 | Trava de reentrância é **por tenant** | §5.4 item 1 |

### 9.5 Testes que precisam existir *antes* desta camada

Caracterização do doc 01 §7.3, porque esta camada mexe em `$transaction`, sessão e QR:
**T2** (SQL nativo), **T3** (sorteio concorrente), **T7** (refresh/revogação), **T9**
(PDFs com `ConfiguracaoSindicato`). Sem elas, uma regressão em `prisma.service.ts` ou
`jwt.strategy.ts` só aparece em produção.

---

## 10. Decisões pendentes que afetam este desenho

| # | Decisão | Como este documento fica se mudar |
|--:|---|---|
| **D2** | `User` do tenant ou global com vínculo | Se global: a claim vira `tid` **selecionável** entre N vínculos, o login ganha uma etapa de escolha de organização, e `TenantResolverService` devolve **lista**, não valor. **Afeta §2.3, §4.2 (itens 1–5) e §5** |
| **D7** | Roteamento (subdomínio / path / seletor) | §2.4 é a proposta de menor mudança. Domínio personalizado exige `CORS_ORIGINS` dinâmico (`main.ts:49-52`) e `Tenant.dominios[]` |
| **D3** | `Empresa` global ou por tenant | Se global com vínculo, o item 6 de §4.2 passa a poder devolver N tenants e o login patronal precisa de discriminador |
| **D9** | Papel de operador da plataforma | Define se `prismaPlataforma` ganha rotas HTTP (hoje o desenho é: **não** — só resolução) |
| **S-2** | Extensão sobrevive ao `$transaction`? | Se **não**, §5.2 muda: a injeção precisa migrar para dentro do wrapper de `forTenant()`, com custo maior. **Bloqueante** |

---

## Estado e próximo passo

**Aguardando revisão. Nada implementado.**

Próximo documento — `04-PLANO_DE_EXECUCAO.md` — depende de:

1. Aprovação deste desenho;
2. **S-2** executado (doc 02 §13) — sem ele, §5.2 é hipótese;
3. **D2** e **D7** respondidas — mudam §2 e §4 de forma estrutural.
