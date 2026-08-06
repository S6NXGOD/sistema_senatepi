# 06 — Checklist de segurança e testes: isolamento entre tenants

> **Escopo.** Checklist operacional para impedir vazamento de dados entre tenants,
> ancorado na arquitetura real ([`01`](./01-ARQUITETURA_ATUAL.md)) e na estratégia
> escolhida ([`02`](./02-MODELO_DE_TENANCY.md) banco compartilhado + `tenant_id` + RLS,
> [`03`](./03-TENANT_CONTEXT.md) contexto, [`05`](./05-MIGRACAO_TENANT_1.md) migração).
>
> **Nenhum código foi alterado.** Documento de trabalho — para ser percorrido item a item
> antes de o Tenant 2 entrar em produção.
>
> **Data:** 2026-08-02 · **Commit base:** `adc64d8` · **Status:** aguardando revisão

**Legenda de severidade:**
`🔴` bloqueante para ir a produção com Tenant 2 · `🟠` obrigatório antes do encerramento
do projeto · `🟡` desejável

---

## Sumário

1. [O número que dimensiona o problema](#0-o-número-que-dimensiona-o-problema)
2. [Proteções no banco de dados](#1-proteções-no-banco-de-dados)
3. [Row Level Security](#2-row-level-security)
4. [Filtros globais no ORM](#3-filtros-globais-no-orm)
5. [Queries SQL nativas](#4-queries-sql-nativas)
6. [Services](#5-services-não-há-repositories)
7. [Cache separado por tenant](#6-cache-separado-por-tenant)
8. [Jobs, workers e filas](#7-jobs-workers-e-filas)
9. [Uploads, documentos e anexos](#8-uploads-documentos-e-anexos)
10. [Auditoria e logs](#9-auditoria-e-logs)
11. [Testes de integração](#10-testes-de-integração)
12. [Testes negativos](#11-testes-negativos)
13. [Os seis cenários de ataque](#12-os-seis-cenários-de-ataque)
14. [Mapa de risco: onde uma query sem tenant é mais perigosa](#13-mapa-de-risco-onde-uma-query-sem-tenant-é-mais-perigosa)
15. [Dois pontos para a revisão](#14-dois-pontos-para-a-revisão)

---

## 0. O número que dimensiona o problema

**174 buscas por `id` cru (`where: { id }`) em 43 arquivos.**

> Verificação: busca multi-linha por `(findUnique|findFirst)\(\{\s*where:\s*\{\s*id[,:\s]`
> em `apps/api/src/modules`.

Hoje cada uma dessas chamadas confia que qualquer ID recebido pertence ao único tenant
existente. Essa é a superfície de **IDOR** (referência direta a objeto) que o multi-tenant
abre de uma vez só. Concentração:

| Arquivo | Ocorrências |
|---|--:|
| `modules/agenda/agenda.service.ts` | 17 |
| `modules/colonia/colonia.service.ts` | 16 |
| `modules/colaboradores/colaboradores.service.ts` | 10 |
| `modules/cobrancas/cobrancas.service.ts` | 8 |
| `modules/processos/partes.service.ts` | 6 |
| `modules/processos/movimentacoes.service.ts` | 6 |
| `modules/anexos/anexos.service.ts` | 6 |
| `modules/eventos/checkin.service.ts` | 5 |
| `modules/empresas/auditoria-contribuicoes.service.ts` | 5 |
| outros 34 arquivos | 95 |

---

## 1. Proteções no banco de dados

- [ ] 🔴 `tenant_id NOT NULL` em todas as ~50 tabelas do manifesto — validado por
      `count(*) WHERE tenant_id IS NULL = 0`
- [ ] 🔴 FK `tenant_id → tenants(id)` com **`ON DELETE RESTRICT`**
      *(nunca `CASCADE`: um clique no backoffice não pode apagar o acervo de um sindicato)*
- [ ] 🔴 As **17 unicidades colidentes** convertidas em compostas `(tenant_id, campo)` —
      criar a composta **antes** de derrubar a simples, senão há uma janela sem proteção
- [ ] 🔴 Papel `senatepi_app` **sem `BYPASSRLS`** — conferido por
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'senatepi_app'`
- [ ] 🟠 **FK compostas** `(tenant_id, <fk>)` nas relações entre agregados distintos:
      `compromissos→filiados`, `processos→filiados`, `presencas→filiados`,
      `anexos_documentos→*`. É o que faz o **banco** recusar o cruzamento, sem depender de
      aplicação nem de policy
- [ ] 🟠 `DEFAULT '<uuid-t1>'` **removido** na fase de contract — esquecê-lo faz um erro de
      contexto gravar silenciosamente no Tenant 1 em vez de falhar
- [ ] 🟠 Índices compostos `(tenant_id, <coluna quente>)` substituindo os simples:
      `filiados(situacao)` (`schema.prisma:388`), `filiados(cpf)` (`:389`),
      `parcelas_cobranca(status)`
- [ ] 🟡 Índices únicos **parciais** da colônia revisados para incluir `tenant_id`
      (`migrations/20260702180000_colonia_indices_parciais/`)

---

## 2. Row Level Security

Compatível com a estratégia escolhida, com as ressalvas técnicas do doc 02 (R-2 e R-3).

- [ ] 🔴 `ENABLE` **e** `FORCE ROW LEVEL SECURITY` em toda tabela de tenant — sem `FORCE`,
      o dono da tabela ignora a policy
- [ ] 🔴 Policy fail-closed:
      `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` — sem contexto,
      `current_setting` devolve `NULL`, nada casa, resultado é **zero linhas**
- [ ] 🔴 Policy com **`WITH CHECK` além do `USING`** — senão a leitura é filtrada mas
      `INSERT`/`UPDATE` ainda podem gravar em outro tenant
- [ ] 🔴 `set_config(..., true)` — **local à transação**. Com `false`, a variável persiste
      na conexão e vaza para a próxima request que pegar aquela conexão do pool
- [ ] 🔴 Ligar RLS **só depois** da aplicação escopada e validada com o Tenant 2. Ligar
      antes derruba o Tenant 1: tudo devolve vazio, e para o usuário isso é indistinguível
      de perda de dados
- [ ] 🟠 Teste que prova que o RLS está ativo: conectar sem `set_config` e verificar
      retorno vazio **em cada tabela**
- [ ] 🟠 Migrations rodam por papel com bypass — confirmar que a aplicação **nunca** usa
      essa conexão (`DATABASE_URL` × `DATABASE_URL_PLATFORM`)

---

## 3. Filtros globais no ORM

- [ ] 🔴 `PrismaService` **não expõe o client cru**; só `forTenant()`. O client sem escopo
      chama-se `prismaPlataforma`, vive em módulo próprio e é banido por lint
- [ ] 🔴 Extension `$allModels.$allOperations` injeta `where.tenantId` e `data.tenantId`
- [ ] 🔴 Extension **lança** `TenantContextMissingError` quando o ALS está vazio — o RLS já
      garante segurança, mas zero linhas é péssimo para diagnóstico
- [ ] 🔴 Verificar que a extension continua ativa dentro de `$transaction`
      (**spike S-2, ainda não testado**) — 43 sítios em 24 arquivos dependem disso
- [ ] 🟠 As **22 `findUnique` por campo único simples** (13 arquivos) convertidas para
      `where: { tenantId_campo: {...} }` ou `findFirst`. O Prisma **não aceita** `tenantId`
      no `where` de `findUnique` — não há solução automática
- [ ] 🟠 Os **6 upserts** revisados: todos ancoram em chave única
      (`colonia-seed.service.ts:104,122,129`, `duplicidade.service.ts:561,664`,
      `partes.service.ts:310`)
- [ ] 🟠 `createMany` grava `tenantId` em **todas** as linhas; `updateMany`/`deleteMany`
      (14 arquivos) nunca alcançam outro tenant

---

## 4. Queries SQL nativas

**9 sítios em 5 arquivos. A extension não os alcança — quem protege é o RLS.**

| Local | O que faz |
|---|---|
| `modules/cobrancas/cobrancas.service.ts:373` | Agregação de carnês: `GROUP BY` + `HAVING` + `COUNT FILTER` |
| `modules/cobrancas/cobrancas.service.ts:393` | `COUNT` de paginação sobre a subquery acima |
| `modules/dashboard/dashboard.module.ts:602` | Falhas de sincronização DataJud |
| `modules/dashboard/dashboard.module.ts:665` | Série agregada do painel |
| `modules/dashboard/dashboard.module.ts:677` | Série agregada do painel |
| `modules/filiados/duplicidade.service.ts:185` | Candidatos a duplicata |
| `modules/filiados/duplicidade.service.ts:220` | Candidatos a duplicata (variante) |
| `modules/colonia/colonia.service.ts:79` | `pg_advisory_xact_lock` |
| `modules/health/health.module.ts:20` | `SELECT 1` |

- [ ] 🔴 Cada um dos 9 executado **dentro** da transação com `set_config` — fora dela
      devolvem vazio (ou tudo, se o RLS ainda não estiver ativo)
- [ ] 🔴 `colonia.service.ts:79`: **o `tenant_id` precisa entrar na chave do advisory
      lock**. Sem isso o sorteio de um cliente serializa o do outro — não é vazamento, é
      indisponibilidade cruzada
- [ ] 🟠 ESLint `no-restricted-syntax` proibindo `$queryRaw`/`$executeRaw` fora de
      allowlist explícita
- [ ] 🟠 Zero `$queryRawUnsafe` mantido como invariante em CI (hoje é 0)

---

## 5. Services (não há repositories)

O projeto não tem camada de repositório — os 51 provedores falam Prisma direto.

- [ ] 🔴 **As 174 buscas por `id` cru** (§0) passam a herdar escopo do `forTenant()`
- [ ] 🔴 `modules/anexos/anexos.service.ts:381-420` (`resolverAlvo`) — recebe
      `atendimentoId`/`processoId`/`compromissoId` **do DTO** e resolve por
      `findFirst({ where: { id } })`. Sem escopo, anexa documento ao processo de outro
      sindicato
- [ ] 🔴 `modules/filiados/duplicidade.service.ts` — **funde e exclui filiados**. Fusão
      entre tenants misturaria cadastros de dois sindicatos de forma irreversível. Merece
      guarda própria além do escopo
- [ ] 🔴 `modules/cobrancas/cobrancas.service.ts:749` e
      `modules/portal-empresa/contribuicoes.service.ts:247` — `findFirst` no
      `ConfiguracaoSindicato` singleton, que guarda a **chave PIX**. Sem escopo, o carnê
      sai com o PIX de outro sindicato
- [ ] 🟠 **35 dos 43 controllers não declaram `@Modulo`** — a autorização por módulo cobre
      menos de 20% da superfície
- [ ] 🟠 `modules/importacao/importacao.service.ts` — escrita em massa em 5 tabelas, com
      `count()` global como sequência

---

## 6. Cache separado por tenant

- [ ] 🔴 `common/assets.util.ts:4` — `Map` global **chaveado por nome de arquivo**. Com N
      tenants, serve o logo do sindicato errado. Chave passa a ser `tenantId + nome`
- [ ] 🔴 `common/assets.util.ts` é `Map` **sem teto e sem TTL** — vira vazamento de memória
      com N tenants. Substituir por LRU com limite
- [ ] 🟠 React Query no front: `queryKey` inclui o tenant, ou a troca de organização serve
      dado da anterior
- [ ] 🟠 `Cache-Control: private, no-store` mantido nas rotas com dado pessoal de terceiros
      (`portal-empresa.controller.ts:93`, `auditoria-contribuicoes.controller.ts:51`)
- [ ] 🟠 Logo e favicon com **hash na URL** — invalidação por mudança de URL, não por
      expiração
- [ ] 🟡 Cache de branding em memória não propaga entre réplicas; TTL curto é o limite real
      de propagação

---

## 7. Jobs, workers e filas

Não há filas nem workers. Há **2 crons** e **2 seeds**.

- [ ] 🔴 `modules/processos/processos-cron.service.ts:33` e
      `modules/cobrancas/cobrancas-cron.service.ts:17` — hoje varrem o banco inteiro.
      Passam a **iterar tenants** com escopo explícito por iteração
- [ ] 🔴 Job sem contexto **lança** — nunca roda "sem tenant" silenciosamente
- [ ] 🔴 `modules/auth/admin-seed.service.ts:28` — condição `user.count() === 0` é global.
      Com Tenant 2, nenhum tenant novo ganha administrador por esse caminho
- [ ] 🟠 `processos-cron.service.ts:26` — trava de reentrância é `this.rodando`, booleano
      **em memória**. Não coordena entre réplicas nem separa tenants. Vira lock no banco,
      por tenant
- [ ] 🟠 Falha no tenant N não interrompe o N+1
- [ ] 🟠 Rate limit do CNJ é da instalação, não do tenant — a janela noturna cresce
      linearmente com o número de clientes (`processos-cron.service.ts:20-21`)

---

## 8. Uploads, documentos e anexos

- [ ] 🔴 As 6 chaves de storage ganham prefixo `tenants/<id>/…`:
      `anexos.service.ts:98` · `filiados.service.ts:551` ·
      `colaboradores.service.ts:369` · `dossie-evento.service.ts:97` ·
      `contribuicoes.service.ts:163,170` · `image.service.ts:44-65`
- [ ] 🔴 **`main.ts:19-21`** — com driver `local`, uploads são servidos **estaticamente e
      sem autenticação** em `/uploads/`. Quem tem a URL lê o arquivo. Hoje é problema de um
      sindicato; com N, é vazamento entre clientes
- [ ] 🔴 `common/storage/storage.service.ts:163-166` — driver `local` devolve URL estática
      **permanente**; só o `s3` assina. URL vazada nunca expira
- [ ] 🟠 Os 5 geradores de PDF resolvem asset por tenant, com **fallback neutro** — nunca o
      logo do SENATEPI: `carteirinhas.module.ts:190` · `colaboradores.service.ts:436` ·
      `certificado.service.ts:124` · `dossie-evento.service.ts:161` ·
      `filiados.service.ts:844`
- [ ] 🟠 `common/qrcode/qrcode.service.ts:21-23` — `QR_SIGNING_SECRET` único: QR assinado
      num tenant valida em outro. `tenantId` entra no HMAC, **com período de transição**
      para carteirinhas já impressas
- [ ] 🟠 Validação de posse antes de servir arquivo: a chave no banco pertence ao tenant do
      contexto

---

## 9. Auditoria e logs

- [ ] 🔴 `common/audit/audit.service.ts:20-33` grava `tenantId` — trilha sem tenant é
      inútil para investigar incidente
- [ ] 🔴 `AuditoriaPlataforma` **separada** de `Auditoria` — a trilha do tenant é do
      sindicato; a da plataforma é do SaaS (doc 05 §17.3)
- [ ] 🟠 Gravar a **origem** da resolução (`jwt-equipe`, `jwt-empresa`, `recurso`, `cron`)
      — permite detectar em produção um caminho de resolução inesperado
- [ ] 🟠 Tentativa de acesso cruzado registrada como **evento de segurança**, não como 404
      comum
- [ ] 🟠 Logs nunca contêm CPF, e-mail ou chave de storage — o projeto já tem essa
      disciplina (`cobrancas-cron.service.ts:9`)
- [ ] 🟡 `requestId` correlacionando log e auditoria

---

## 10. Testes de integração

Exigem Postgres real — **RLS não existe em mock**.

- [ ] 🔴 **Varredura completa de isolamento**: semeia tenants A e B; percorre **todas** as
      rotas de listagem autenticado como A; falha se qualquer resposta contiver ID de B.
      Varredura, não amostra
- [ ] 🔴 Query sem `set_config` devolve **zero linhas** — em cada tabela
- [ ] 🔴 Os 9 SQLs nativos respeitam RLS
- [ ] 🔴 Extension continua ativa dentro de `$transaction`
- [ ] 🟠 `createMany` grava `tenantId` em todas as linhas
- [ ] 🟠 `upsert` com a mesma chave em dois tenants cria **dois** registros
- [ ] 🟠 Papel da aplicação não tem `BYPASSRLS`
- [ ] 🟠 50 requests concorrentes com tenants distintos não vazam contexto entre si —
      **risco nº 1 de `AsyncLocalStorage`**

---

## 11. Testes negativos

- [ ] 🔴 Rota sem estratégia de tenant e sem opt-out explícito → **falha em runtime**, não
      passa silenciosa
- [ ] 🔴 Token sem claim de tenant → 401
- [ ] 🔴 Header `X-Tenant-Id` divergente do token → 403 + evento de segurança
- [ ] 🟠 Body malformado no guard → 400, nunca 500. *O `slug` da colônia vem no **corpo**
      (`colonia/dto/*.ts:54,64`) e é lido pelo guard **antes** do `ValidationPipe`*
- [ ] 🟠 Tenant suspenso → 403 em rota autenticada, **404** em rota pública
- [ ] 🟠 Tenant cancelado → 404 (não revelar que existiu)

---

## 12. Os seis cenários de ataque

| # | Cenário | Resultado esperado | Por quê |
|--:|---|---|---|
| 1 | **A lê dado de B** | **404**, não 403 | Sob RLS o registro não existe para ele. 403 confirmaria a existência do recurso |
| 2 | **A altera dado de B** | 404 no `findFirst` prévio; se escapar, **`WITH CHECK` do RLS recusa**; se escapar, **FK composta recusa** | Três camadas independentes |
| 3 | **ID válido de outro tenant enviado direto** | 404 | O caso mais provável na prática. Alvos concretos: `anexos.service.ts:381-420` (anexar a processo alheio) · `checkin.service.ts` (`presencaId` é credencial de sessão) · `plenario.controller.ts:263` (certificado por código) · `agenda.service.ts` (17 buscas por id) |
| 4 | **Worker recebe tenant incorreto** | Processa **só** o tenant recebido; job sem tenant **lança** | Cron não tem request; o erro precisa ser alto e imediato |
| 5 | **Chave de cache reutilizada** | Miss, não hit cruzado | Teste direto sobre `assets.util.ts`: pedir o mesmo nome de arquivo por dois tenants devolve bytes diferentes |
| 6 | **Rota acessada sem Tenant Context** | Erro de configuração + alerta; nunca resposta com dados | Falhar alto na primeira request, não em produção seis meses depois |

---

## 13. Mapa de risco: onde uma query sem tenant é mais perigosa

Ranqueado por **consequência**, não por probabilidade.

| # | Local | Se faltar escopo |
|--:|---|---|
| 1 | `modules/filiados/duplicidade.service.ts` | **Funde e exclui filiados.** Fusão entre tenants mistura cadastros de dois sindicatos de forma irreversível |
| 2 | `modules/cobrancas/cobrancas.service.ts:749` · `modules/portal-empresa/contribuicoes.service.ts:247` | Carnê e PIX emitidos com a **chave de recebimento de outro sindicato** — dinheiro para a conta errada |
| 3 | `modules/anexos/anexos.service.ts:381-420` | Documento anexado ao processo de outro sindicato; `resolverAlvo` confia em ID vindo do DTO |
| 4 | `main.ts:19-21` + `common/storage/storage.service.ts:163` | Arquivo servido **sem autenticação** por URL permanente — documento pessoal de filiado de outro cliente |
| 5 | `modules/eventos/checkin.service.ts` + `modules/eventos/plenario.controller.ts` | Rotas públicas; `presencaId` é credencial de sessão. Voto e presença de assembleia — dado com efeito jurídico |
| 6 | `modules/cobrancas/cobrancas.service.ts:373` | SQL nativo com agregação financeira; sem RLS soma valores de todos os tenants |
| 7 | `modules/importacao/importacao.service.ts` | Escrita em massa em 5 tabelas, com `count()` global como sequência |
| 8 | `modules/processos/processos-cron.service.ts:33` | Varre todos os processos e chama a API do CNJ; sem escopo, consome cota alheia e grava movimentação no processo errado |
| 9 | `modules/dashboard/dashboard.module.ts` | 3 SQLs nativos + 12 models; painel somando dados de todos os clientes |
| 10 | `modules/auth/auth.service.ts:76`, `:194` | Login e recuperação por e-mail. Precisam rodar **sem** tenant (zona de resolução, doc 03 §4) — o risco é a zona virar porta lateral se devolver mais que o `tenantId` |

---

## 14. Dois pontos para a revisão

### 14.1 O item 4 do mapa já é um problema hoje, com um cliente só

Uploads locais servidos sem autenticação em `/uploads/`, com URL permanente
(`main.ts:19-21`, `storage.service.ts:163-166`), é exposição de documento pessoal
**independentemente de multi-tenancy**. Com N clientes ele muda de categoria, mas não de
natureza.

Vale tratar antes, como correção própria — não como parte da migração.

*(Depende de confirmar `STORAGE_DRIVER` em produção — doc 01 C2, ainda aberta.)*

### 14.2 Nada disto substitui o mecanismo do banco

As camadas de aplicação existem para que o erro apareça **cedo e legível**. O RLS existe
para que, quando todas elas falharem — extension com bug, lint suprimido, teste marcado
como `skip`, código novo que ninguém revisou —, o resultado seja **zero linhas** em vez de
linhas de outro sindicato.

> **Se algum item deste checklist for cortado por prazo, que não sejam os `🔴` das seções
> 1 e 2.**

---

## Referências cruzadas

| Assunto | Documento |
|---|---|
| Inventário que fundamenta os números | [`01-ARQUITETURA_ATUAL.md`](./01-ARQUITETURA_ATUAL.md) |
| Por que RLS, e suas limitações com Prisma | [`02-MODELO_DE_TENANCY.md`](./02-MODELO_DE_TENANCY.md) |
| Zona de resolução, ALS, casos de falha | [`03-TENANT_CONTEXT.md`](./03-TENANT_CONTEXT.md) |
| Campos, módulos e white-label | [`04-PERSONALIZACAO_POR_TENANT.md`](./04-PERSONALIZACAO_POR_TENANT.md) |
| Migração do Tenant 1 e backoffice | [`05-MIGRACAO_TENANT_1.md`](./05-MIGRACAO_TENANT_1.md) |
