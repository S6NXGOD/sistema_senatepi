# 02 — Modelo de Tenancy (comparação e recomendação)

> **Escopo.** Compara os modelos de isolamento viáveis **contra a codebase real**
> inventariada em [`01-ARQUITETURA_ATUAL.md`](./01-ARQUITETURA_ATUAL.md), recomenda um
> caminho e descreve a arquitetura de alto nível e a transição.
> **Nenhum código, schema ou migration foi alterado.** Este documento é para revisão.
>
> **Data:** 2026-08-02 · **Commit base:** `adc64d8` · **Status:** aguardando revisão
> **Prisma instalado:** `5.22.0` (`@prisma/client` e `prisma`) · **Postgres:** Railway

---

## Sumário

1. [Premissas de negócio aprovadas](#1-premissas-de-negócio-aprovadas)
2. [Restrições técnicas que decidem a comparação](#2-restrições-técnicas-que-decidem-a-comparação)
3. [Matriz comparativa](#3-matriz-comparativa)
4. [Como o isolamento funcionaria em cada superfície](#4-como-o-isolamento-funcionaria-em-cada-superfície)
5. [Análise detalhada por alternativa](#5-análise-detalhada-por-alternativa)
6. [Recomendação](#6-recomendação)
7. [Motivos ancorados no projeto real](#7-motivos-ancorados-no-projeto-real)
8. [Riscos que permanecem](#8-riscos-que-permanecem)
9. [Decisões de negócio ainda necessárias](#9-decisões-de-negócio-ainda-necessárias)
10. [Arquitetura de alto nível proposta](#10-arquitetura-de-alto-nível-proposta)
11. [Estratégia preliminar de transição](#11-estratégia-preliminar-de-transição)
12. [Mecanismos obrigatórios anti-esquecimento](#12-mecanismos-obrigatórios-anti-esquecimento)
13. [Spikes a executar antes de implementar](#13-spikes-a-executar-antes-de-implementar)

---

## 1. Premissas de negócio aprovadas

Registradas como entrada deste documento, não como conclusão dele:

| # | Premissa |
|--:|---|
| P1 | Tenant = **sindicato ou entidade sindical** cliente da plataforma |
| P2 | O sistema **já está em produção** atendendo um sindicato real |
| P3 | A aplicação existente **será evoluída**; não haverá sistema paralelo |
| P4 | O sindicato atual vira **Tenant 1**, preservando integralmente usuários, filiados, colaboradores, documentos, processos, cobranças, eventos, configurações, arquivos, históricos e fluxos |
| P5 | Migração **incremental**, compatível com produção, em **expand-and-contract** |
| P6 | **Proibido** deploy Big Bang e migration destrutiva única |
| P7 | Identificadores de negócio (matrícula, número visível de atendimento) devem ser avaliados **por tenant**; IDs técnicos podem seguir globais |
| P8 | Ainda **em aberto**: `User` tenant vs. global+vínculo · `Empresa` global+vínculo vs. duplicada · `Processo` global+acompanhamento vs. duplicado · catálogos globais vs. por tenant · roteamento · modelo de isolamento no banco |

**P6 tem consequência direta e imediata sobre a comparação:** ele elimina qualquer
modelo cuja adoção exija uma virada única de estado. Isso pesa contra C e D não pelo
mérito do isolamento, mas pelo **modo de chegar lá** a partir de um banco em produção.

---

## 2. Restrições técnicas que decidem a comparação

Estes fatos foram verificados no código e nas dependências instaladas. São eles — e não
preferência teórica — que ordenam as alternativas.

### R-1 · `findUnique` não aceita `tenantId` no `where`

O `where` de `findUnique` só aceita campos declarados únicos. Injetar `tenantId` via
extensão é erro de tipo **e** de runtime. Levantamento na codebase:

| Arquivo | Chamadas | Campo |
|---|--:|---|
| `modules/processos/processos.service.ts:71`, `:445` | 2 | `numeroCNJ` |
| `modules/processos/consulta-previa.service.ts:110` | 1 | `numeroCNJ` |
| `modules/processos/movimentacoes.service.ts:126`, `:373` | 2 | `slug` |
| `modules/colonia/colonia.service.ts:70`, `:107`, `:740` | 3 | `slug`, `cpf` |
| `modules/eventos/checkin.service.ts:126`, `:293` | 2 | `cpf` |
| `modules/empresas/empresas.service.ts:78`, `:97` | 2 | `cnpj` |
| `modules/importacao/importacao.service.ts:424`, `:742` | 2 | `cpf` |
| `modules/agenda/tipos-evento.service.ts:99`, `:119` | 2 | `slug` |
| `modules/agenda/agenda.service.ts:850` | 1 | `slug` |
| `modules/auth/auth.service.ts:76`, `:194` | 2 | `email` |
| `modules/filiados/filiados.service.ts:99` | 1 | `cpf` |
| `modules/portal-empresa/portal-empresa-auth.service.ts:55` | 1 | `cnpj` |
| `modules/recadastramento/link-recadastramento.service.ts:350` | 1 | `tokenHash` (hash — não colide) |

**22 chamadas em 13 arquivos; 21 sobre campos com colisão plausível.**

Consequência: em **qualquer** modelo de banco compartilhado (A, B), converter as 17
unicidades colidentes em compostas `@@unique([tenantId, campo])` **não é opcional** — e
cada uma dessas 22 chamadas precisa virar `where: { tenantId_campo: { … } }` ou
`findFirst`. É trabalho manual, não automatizável por extensão.

> Verificado: `grep -rn "findUnique" apps/api/src --include=*.ts` → 187 ocorrências em 44
> arquivos; 73 por `id` (não afetadas); as 22 acima por campo colidente.

### R-2 · Não existe transação aninhada no Prisma

O tipo do cliente transacional é `Omit<PrismaClient, ITXClientDenyList>`, que **remove**
`$transaction`, `$connect`, `$disconnect`, `$on`, `$use` e `$extends`. Logo:

- **Não dá para chamar `$extends` sobre um `tx`.** A extensão precisa estar no cliente
  raiz, antes de abrir a transação.
- **Não dá para abrir uma transação dentro de outra.** Um mecanismo de isolamento que
  envolva cada operação numa transação entra em conflito direto com os **43
  `$transaction` já existentes em 24 arquivos** ([01 §4.3](./01-ARQUITETURA_ATUAL.md#43-uso-de-transaction)).

Isso é o custo central e concreto do RLS sobre Prisma (ver R-3).

### R-3 · RLS exige contexto de sessão, e Prisma não o expõe

O Postgres avalia políticas RLS contra variáveis de sessão
(`current_setting('app.tenant_id', true)`). O Prisma **não** tem API para "defina esta
variável nesta conexão pelo tempo desta request". O padrão viável é:

```
$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  //                                                       ↑ true = LOCAL à transação
  return trabalho(tx);
});
```

O `true` (local) é obrigatório: com `false`, a variável **persiste na conexão** e vaza
para a próxima request que pegar aquela conexão do pool — o oposto do objetivo.

Consequência combinada com R-2: **RLS obriga todo acesso a passar por transação**, e a
transação de escopo precisa ser a *mesma* que os services usam hoje. Isso não impede o
modelo — mas define o desenho (§10) e o custo de refatorar 43 call-sites.

> ⚠️ **A verificar em spike (S-2):** se uma extensão `$extends` aplicada ao cliente raiz
> permanece ativa dentro do `tx` devolvido por `$transaction`. A documentação do Prisma
> indica que sim; o desenho de §10 depende disso e não deve ser assumido sem teste.

### R-4 · Um `PrismaClient` = um pool de conexões

Modelos com N clientes (C e D) multiplicam pools. Prisma usa por padrão
`connection_limit = num_cpus × 2 + 1`. Num container Railway de 2 vCPU, são ~5 conexões
por cliente. Com o Postgres do Railway em `max_connections` típico de 100:

| Modelo | Clientes | Conexões por instância de API | Teto aproximado |
|---|---|---|---|
| A / B | 1 | ~5 | ilimitado em nº de tenants |
| C / D | N (um por tenant) | ~5 × N | **~15–20 tenants por instância**, sem pooler externo |

Com 2 réplicas da API, o teto cai pela metade. Isso é um limite **quantificável**, não
uma objeção estilística.

### R-5 · `prisma migrate deploy` aplica a um alvo por execução

O comando aplica migrations ao schema/banco da `DATABASE_URL`, gravando o controle em
`_prisma_migrations` **daquele alvo**. Não existe fan-out nativo. Em C e D, as **41
migrations atuais** e todas as futuras exigem um executor próprio que percorra N alvos,
com tratamento de falha parcial (tenant 7 falhou, 1–6 já migraram) — e o
`start` hoje é literalmente `prisma migrate deploy && node dist/src/main.js`
([`apps/api/package.json:9`](../../apps/api/package.json)), que teria de ser reescrito.

### R-6 · O `multiSchema` do Prisma é estático

A preview feature `multiSchema` declara schemas **fixos** no `datasource`. Ela não
modela "um schema por tenant criado em runtime". Schema-per-tenant dinâmico com Prisma
significa, na prática, N clientes com `?schema=` na URL (voltando a R-4) ou
`SET search_path` por transação (voltando a R-2/R-3, com as mesmas amarras do RLS e sem
o benefício de fail-closed).

### R-7 · A rede de segurança de testes é quase inexistente

**4 arquivos `*.spec.ts`** em ~27.650 linhas
([01 §7.3](./01-ARQUITETURA_ATUAL.md#73-riscos-que-exigem-testes-de-caracterização)).
Isso desqualifica qualquer estratégia que dependa de "revisar cuidadosamente os 51
provedores" e favorece fortemente modelos com **imposição pelo banco**, onde o erro do
desenvolvedor vira erro visível em vez de vazamento silencioso.

### R-8 · Fatos que aliviam o trabalho

Nem tudo é contra. Levantado no código:

- **Zero `connect:` aninhado** (`grep -rn "connect:" apps/api/src` → 0). Não há escrita
  aninhada por relação, que é o caso mais difícil de escopar por extensão.
- **Zero `$queryRawUnsafe` / `$executeRawUnsafe`.** Todo SQL nativo é template
  parametrizado, revisável ponto a ponto.
- **Zero `Scope.REQUEST`.** Não há provider request-scoped para desfazer; o contexto
  pode ser introduzido de forma limpa via `AsyncLocalStorage`.
- **Apenas 9 sítios de SQL nativo em 5 arquivos** — número tratável à mão.
- **Grafo de DI acíclico com 5 arestas** — a ordem de adaptação dos módulos é óbvia.

---

## 3. Matriz comparativa

Escala: `++` muito favorável · `+` favorável · `~` neutro/condicional · `−` desfavorável
· `−−` muito desfavorável.

| # | Critério | **A** shared + `tenant_id` | **B** shared + `tenant_id` + RLS | **C** schema/tenant | **D** banco/tenant | **E** híbrido (B padrão + D sob demanda) |
|--:|---|:--:|:--:|:--:|:--:|:--:|
| 1 | Impacto nos 51 models | − (≈39 ganham coluna) | − (idem A + policies) | ++ (nenhum) | ++ (nenhum) | − (igual B) |
| 2 | Impacto nos 51 consumidores | − (extensão + 22 `findUnique`) | − (idem A + wrapper tx) | + (só resolução de client) | + (só resolução de client) | − (igual B) |
| 3 | Compatibilidade Prisma 5.22 | ++ | + (R-2/R-3) | − (R-4/R-5/R-6) | ~ (R-4/R-5) | + |
| 4 | Isolamento nas 15 superfícies | ~ (falha em SQL nativo) | ++ (cobre tudo) | ++ | ++ | ++ |
| 5 | Risco de vazamento | −− | ++ | ++ | ++ | ++ |
| 6 | Risco de esquecer o tenant | −− (silencioso) | ++ (fail-closed) | + | ++ | ++ |
| 7 | Alteração na `PrismaService` | − (extensão) | −− (extensão + tx wrapper) | −− (factory N clients) | −− (factory N clients) | −− |
| 8 | Client Extensions utilizáveis | ++ (mecanismo principal) | ++ (mecanismo primário) | ~ (desnecessário) | ~ (desnecessário) | ++ |
| 9 | Limitações em transaction client | ~ (extensão herda — S-2) | − (sem aninhamento, R-2) | ~ | ~ | − |
| 10 | Estratégia p/ 9 SQLs nativos | −− (manual, 100%) | ++ (RLS cobre) | ++ | ++ | ++ |
| 11 | Impacto nas 17 unicidades | − (todas compostas) | − (todas compostas) | ++ (nenhum) | ++ (nenhum) | − |
| 12 | Complexidade das migrations | ~ (aditivas, 1 alvo) | − (+ policies) | −− (R-5, N alvos) | −− (R-5, N alvos) | − |
| 13 | Migração do atual → Tenant 1 | + (backfill 1 valor) | + (idem) | −− (mover schema) | ++ (nada a fazer) | + |
| 14 | Compat. entre versões no deploy | ++ (nulo → default) | + (policy por último) | − | + | + |
| 15 | Rollback | ++ (coluna sobra) | + (drop policy) | −− | + | + |
| 16 | Backup / restore por tenant | − (lógico, por filtro) | − (idem) | + | ++ (nativo) | ~ (nativo p/ dedicados) |
| 17 | Custo no Railway | ++ (1 Postgres) | ++ (1 Postgres) | + | −− (N serviços) | + |
| 18 | Onboarding de novo sindicato | ++ (`INSERT`) | ++ (`INSERT`) | − (criar schema + migrar) | −− (provisionar banco) | ++ |
| 19 | Manutenção futura de migrations | ++ | + | −− | −− | + |
| 20 | Mover tenant p/ isolamento dedicado | + (schema idêntico) | + (schema idêntico) | + | ++ (já é) | ++ (é o objetivo) |
| | **Adequação às premissas P4–P6** | ~ | **++** | −− | + | **++** |

---

## 4. Como o isolamento funcionaria em cada superfície

Critério 4 aberto nas 15 superfícies pedidas. `✅` isolado pelo mecanismo ·
`⚠️` isolado **só se** o desenvolvedor lembrar · `🔧` exige trabalho manual dedicado.

| Superfície | **A** | **B** | **C** | **D** | Observação sobre o projeto |
|---|:--:|:--:|:--:|:--:|---|
| Queries Prisma comuns (`findMany`, `findFirst`, `update`…) | ✅ extensão | ✅ extensão + RLS | ✅ | ✅ | 58 `findFirst`, centenas de `findMany` |
| `findUnique` por campo único simples | 🔧 | 🔧 | ✅ | ✅ | **22 chamadas, 13 arquivos** (R-1) |
| `$transaction` interativa | ⚠️ S-2 | ✅ (a tx **é** o escopo) | ✅ | ✅ | 43 sítios, 24 arquivos |
| SQL nativo | ⚠️ 🔧 | ✅ **RLS alcança** | ✅ | ✅ | 9 sítios, 5 arquivos — inclui o advisory lock |
| `createMany` | ✅ extensão | ✅ | ✅ | ✅ | Precisa injetar `tenantId` em cada linha |
| `updateMany` | ✅ extensão | ✅ | ✅ | ✅ | 14 arquivos com escrita em massa |
| `deleteMany` | ✅ extensão | ✅ | ✅ | ✅ | Sem escopo, apaga de todos |
| `upsert` | 🔧 | 🔧 | ✅ | ✅ | 6 sítios, **todos** por chave única (R-1) |
| Crons | ⚠️ | ⚠️ | ⚠️ | ⚠️ | **Nenhum modelo resolve**: o job precisa iterar tenants explicitamente (§8-RR3) |
| Rotas públicas (`sala/:eventoId`, `colonia?slug`, `recadastro/:token`) | ⚠️ | ✅ após resolver | ✅ | ✅ | 17 `@Public()`; o ID/slug/token **passa a ser** o resolvedor de tenant |
| Autenticação da equipe | ✅ | ✅ | ✅ | ✅ | `jwt.strategy.ts:33` já relê o usuário — ponto natural |
| Autenticação do portal patronal | ⚠️ | ✅ | 🔧 | 🔧 | Login por CNPJ: em C/D não se sabe **qual** banco consultar antes de resolver o tenant |
| Uploads / storage | 🔧 | 🔧 | 🔧 | 🔧 | **Nenhum modelo de banco resolve arquivo.** Exige prefixo `tenants/<id>/…` sempre |
| QR Codes | 🔧 | 🔧 | 🔧 | 🔧 | `QR_SIGNING_SECRET` é único; HMAC precisa incluir o tenant |
| Geração de PDFs | ✅ | ✅ | ✅ | ✅ | Herda o escopo dos dados que consulta |
| Configurações institucionais | 🔧 | 🔧 | ✅ | ✅ | `findFirst` singleton → 1 registro por tenant (A/B) |

**Leitura desta tabela:** quatro superfícies — **uploads, QR Codes, crons e portal
patronal** — não são resolvidas por *nenhum* modelo de banco. São trabalho próprio,
independente da escolha, e precisam entrar no plano em qualquer cenário.

---

## 5. Análise detalhada por alternativa

### A · Shared Database com `tenant_id` nas tabelas

**Mecanismo:** coluna `tenantId` nos models do tenant; Prisma Client Extension
(`$allModels.$allOperations`) injeta `where.tenantId` em leituras/escritas e
`data.tenantId` em criações; contexto vindo de `AsyncLocalStorage`.

| # | Critério | Avaliação |
|--:|---|---|
| 1 | Models | ~39 dos 51 ganham `tenantId` + FK + índice. Os `AUDIT` e `REL` herdam por relação ou ganham coluna redundante para performance |
| 2 | Consumidores | Extensão cobre a maioria sem tocar em call-site. Exceções manuais: 22 `findUnique` (R-1), 6 `upsert`, 9 SQL nativo |
| 3 | Prisma 5.22 | Totalmente compatível. `$extends` é GA |
| 4 | Superfícies | Ver §4 — falha em SQL nativo e depende de disciplina em rotas públicas |
| 5 | Vazamento | **Alto.** Nada no banco impede ler linha de outro tenant |
| 6 | Esquecer o tenant | **Alto e silencioso.** Um `$queryRaw` novo sem filtro não gera erro — devolve dado alheio |
| 7 | `PrismaService` | Deixa de expor o client cru; passa a expor `forTenant()`. ~40 linhas |
| 8 | Extensions | **É o mecanismo principal.** Uso pleno |
| 9 | Transaction client | Extensão precisa valer dentro do `tx` (S-2). Sem aninhamento não é problema, pois A não abre transação própria |
| 10 | SQL nativo | **Sem solução automática.** 9 sítios reescritos à mão + política permanente de revisão |
| 11 | Unicidades | 17 viram compostas `@@unique([tenantId, …])` |
| 12 | Migrations | Aditivas e simples: `ADD COLUMN NULL` → backfill → `SET NOT NULL`. Um alvo só |
| 13 | Tenant 1 | Backfill trivial: `UPDATE … SET tenant_id = '<uuid-tenant-1>'` por tabela |
| 14 | Deploy | Excelente. Coluna nula é ignorada pela versão antiga; `DEFAULT` cobre a janela |
| 15 | Rollback | Excelente. Basta parar de usar a coluna |
| 16 | Backup/restore | Fraco: restore por tenant é exportação lógica filtrada, com risco de FK órfã |
| 17 | Custo | Mínimo: um Postgres |
| 18 | Onboarding | `INSERT` numa tabela + seeds |
| 19 | Manutenção | Uma linha de migrations, como hoje |
| 20 | Isolamento futuro | Viável: schema idêntico permite extrair um tenant depois |

**Veredito:** é o *caminho* técnico correto, mas **inaceitável como destino** frente a
R-7. Confiar em disciplina humana para isolamento, com 4 arquivos de teste e 9 SQLs
nativos fora de qualquer abstração, é apostar a LGPD na memória do desenvolvedor.

---

### B · Shared Database com `tenant_id` + PostgreSQL Row Level Security

**Mecanismo:** tudo de A, **mais** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` com
política `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. O acesso da
aplicação passa por um papel **sem** `BYPASSRLS`.

| # | Critério | Avaliação |
|--:|---|---|
| 1 | Models | Igual a A, mais uma policy por tabela (SQL manual na migration — o Prisma não modela RLS) |
| 2 | Consumidores | Igual a A, **mais** a adequação dos 43 `$transaction` ao wrapper de escopo (R-2) |
| 3 | Prisma 5.22 | Compatível **com desenho cuidadoso**. Sem suporte nativo a variável de sessão (R-3) |
| 4 | Superfícies | Melhor cobertura possível — inclusive SQL nativo |
| 5 | Vazamento | **Baixo.** A política é avaliada pelo Postgres, não pela aplicação |
| 6 | Esquecer o tenant | **Fail-closed:** sem `set_config`, `current_setting(...,true)` devolve `NULL`, a policy não casa e a query devolve **zero linhas**. O erro aparece como bug visível, não como vazamento |
| 7 | `PrismaService` | Reescrita relevante: `forTenant(tenantId)` que abre transação, aplica `set_config` e devolve o `tx` estendido. É o item de maior esforço |
| 8 | Extensions | Sim — usadas como camada **primária** (ergonomia e `data.tenantId` em `create`); o RLS é a rede |
| 9 | Transaction client | **A limitação central.** Sem aninhamento (R-2): o wrapper e os 43 `$transaction` existentes precisam ser a mesma transação |
| 10 | SQL nativo | **Resolvido pelo banco.** Os 9 sítios passam a ser filtrados pela policy sem alteração de SQL — inclusive o `pg_advisory_xact_lock`, cuja chave ainda precisa ganhar o tenant à mão |
| 11 | Unicidades | Igual a A: 17 compostas. RLS **não** substitui constraint |
| 12 | Migrations | A de A + `ENABLE RLS` + `CREATE POLICY` por tabela, em SQL manual. Habilitar RLS é a **última** etapa |
| 13 | Tenant 1 | Igual a A. A policy só entra depois de backfill completo e app 100% escopada |
| 14 | Deploy | Bom, **desde que** a ordem seja respeitada: coluna → backfill → app → policy. Ligar RLS antes da app escopada derruba o Tenant 1 (tudo devolve zero linhas) |
| 15 | Rollback | Bom: `ALTER TABLE … DISABLE ROW LEVEL SECURITY` é instantâneo e reversível |
| 16 | Backup/restore | Igual a A: fraco por tenant |
| 17 | Custo | Mínimo: um Postgres |
| 18 | Onboarding | `INSERT` + seeds |
| 19 | Manutenção | Cada model novo exige coluna **e** policy — mitigável por CI (§12) |
| 20 | Isolamento futuro | Viável e limpo: schema idêntico, `pg_dump` filtrado por tenant |

**Veredito:** o único modelo que satisfaz P5/P6 **e** neutraliza R-7. O custo real e
honesto é o item 9 (transações) e o item 7 (reescrita da `PrismaService`).

---

### C · Schema por tenant

**Mecanismo:** um schema Postgres por tenant, mesmo banco; resolução por `search_path`
ou por N `PrismaClient` com `?schema=`.

| # | Critério | Avaliação |
|--:|---|---|
| 1 | Models | **Zero alteração** — maior vantagem |
| 2 | Consumidores | Baixo impacto no corpo dos services; alto na resolução do client |
| 3 | Prisma 5.22 | **Ruim.** `multiSchema` é estático (R-6); dinâmico volta a R-2/R-4 |
| 4–6 | Isolamento | Forte por construção |
| 7 | `PrismaService` | Vira factory com cache de N clients |
| 8 | Extensions | Desnecessárias para isolamento |
| 10 | SQL nativo | Funciona sem alteração (resolvido pelo `search_path`) |
| 11 | Unicidades | **Zero impacto** — segunda maior vantagem |
| 12 | Migrations | **Pior ponto:** R-5. Executor próprio para N schemas, com falha parcial |
| 13 | Tenant 1 | Ruim: exige mover o schema `public` inteiro em produção — exatamente a virada única que P6 proíbe |
| 15 | Rollback | Muito ruim: reverter movimentação de schema com dados vivos |
| 17 | Custo | Bom (um Postgres), mas R-4 limita conexões |
| 18 | Onboarding | Criar schema + rodar 41 migrations por tenant |
| 19 | Manutenção | Toda migration futura multiplica por N |

**Veredito: descartado.** Combina o pior de dois mundos para este projeto — o custo
operacional de C/D sem o benefício de isolamento físico de D, e um caminho de adoção
que colide frontalmente com P6.

---

### D · Banco de dados por tenant

**Mecanismo:** um Postgres por tenant. O banco atual permanece **intocado** como banco do
Tenant 1.

| # | Critério | Avaliação |
|--:|---|---|
| 1 | Models | **Zero alteração** |
| 2 | Consumidores | Só a resolução do client muda |
| 3 | Prisma 5.22 | Aceitável; R-4 e R-5 continuam valendo |
| 4–6 | Isolamento | **O mais forte possível.** Vazamento entre tenants exige errar a string de conexão |
| 7 | `PrismaService` | Factory com N clients e cache |
| 10 | SQL nativo | Funciona sem alteração |
| 11 | Unicidades | **Zero impacto.** As 17 colisões simplesmente não existem |
| 12 | Migrations | R-5: fan-out com falha parcial |
| 13 | Tenant 1 | **O melhor de todos: nada a fazer.** O banco atual já é o do Tenant 1 |
| 14 | Deploy | Bom |
| 16 | Backup/restore | **Nativo por cliente** — melhor de todos |
| 17 | Custo | **Pior de todos:** cada tenant é um serviço Postgres no Railway. Custo linear no nº de clientes, num produto vendido a sindicatos |
| 18 | Onboarding | Provisionar banco + migrar + seed. Minutos, não segundos; e exige automação de infraestrutura que hoje não existe |
| 19 | Manutenção | Toda migration multiplica por N, para sempre |
| 20 | Isolamento futuro | Já é o estado final |

**Veredito: não recomendado como padrão, mas é a alternativa séria.** D vence A/B em
P4 (Tenant 1 não é tocado), em backup/restore e em força de isolamento. Perde em custo
(R-4, item 17), em fan-out de migrations (R-5) e em onboarding.

> **A condição em que D venceria:** se o produto for vendido a **poucos clientes de alto
> valor** (ordem de ≤ 10) e/ou houver exigência contratual de separação física. Essa é
> uma **decisão de negócio ainda não informada** (§9-D1) e é o único ponto capaz de
> inverter a recomendação deste documento.

---

### E · Híbrido — B como padrão, D sob demanda

**Mecanismo:** banco compartilhado com `tenant_id` + RLS para o conjunto dos tenants;
schema **idêntico** permite extrair um tenant específico para banco dedicado quando
houver exigência contratual, sem mudar uma linha de código de domínio — apenas a
resolução da conexão.

Não é hibridismo teórico: é exatamente o **requisito 20** (mover um tenant para
isolamento dedicado no futuro), e o único modelo que o atende **sem** pagar o custo de D
para todos desde o primeiro dia.

Custo adicional sobre B: a `PrismaService` precisa nascer com a resolução de conexão
**indireta** (mapa `tenantId → conexão`, com o padrão apontando para o banco
compartilhado). É uma decisão de desenho na origem, barata; retrofit depois é caro.

---

## 6. Recomendação

> ### Adotar **E**: banco compartilhado com `tenant_id` + **RLS** (modelo B) como padrão, com a resolução de conexão desenhada desde o início para permitir mover um tenant a banco dedicado (modelo D) sob demanda.
>
> O caminho até lá **passa por A** — colunas e escopo de aplicação primeiro, RLS por
> último. A não é uma alternativa descartada: é a **fase 1 de B**, e é o que torna a
> migração compatível com P5/P6.

**Ordem de adoção (detalhada em §11):** `tenant_id` nullable → Tenant 1 → backfill →
`NOT NULL` → uniques compostas → escopo na aplicação → validação → Tenant 2 → **RLS
ligado** → remoção da compatibilidade.

**O que decide, em uma frase:** B é o único modelo em que *esquecer* o tenant produz
**zero linhas** em vez de **linhas de outro sindicato** — e, com 4 arquivos de teste
(R-7) e 9 SQLs nativos fora de qualquer abstração, essa diferença é a única garantia
que não depende de vigilância humana.

---

## 7. Motivos ancorados no projeto real

| # | Motivo | Evidência no projeto |
|--:|---|---|
| M1 | **RLS é o único mecanismo que alcança o SQL nativo.** Extensão de client não injeta `WHERE` em SQL arbitrário | 9 sítios em 5 arquivos, incl. a agregação de carnês com `GROUP BY`+`HAVING`+`FILTER` (`cobrancas.service.ts:373`) e o `pg_advisory_xact_lock` (`colonia.service.ts:79`) |
| M2 | **Não há camada de repositório para instrumentar.** O ponto de imposição precisa ficar abaixo da aplicação | 51 provedores injetam `PrismaService` direto; `prisma.service.ts` tem 13 linhas sem `$extends`/`$use` |
| M3 | **A rede de testes não sustenta imposição por disciplina** | 4 `*.spec.ts` em ~27.650 ln |
| M4 | **P6 proíbe a virada única que C exige** | Mover `public` para `tenant_1` em produção é big bang por definição |
| M5 | **O custo de D é linear no nº de clientes, num produto vendido a sindicatos** | Railway cobra por serviço; cada tenant = um Postgres (§5-D item 17) |
| M6 | **A migração aditiva é barata neste schema** | Todos os models usam `id String @id @default(uuid())`; adicionar coluna nullable + backfill não exige recriar chave |
| M7 | **O ponto de resolução do tenant já existe e já custa uma query** | `jwt.strategy.ts:33-52` relê o usuário a cada request — o `tenantId` entra ali sem round-trip novo |
| M8 | **Não há obstáculo escondido nas escritas aninhadas** | `grep -rn "connect:" apps/api/src` → **0** ocorrências |
| M9 | **Todo SQL nativo é parametrizado e auditável** | 0 `$queryRawUnsafe` / `$executeRawUnsafe` |
| M10 | **Não há provider request-scoped a desfazer** | 0 usos de `Scope.REQUEST`; `AsyncLocalStorage` entra limpo |
| M11 | **O grafo de DI é acíclico e raso** | 5 arestas — a ordem de adaptação por módulo é determinada, começando pelos folha (`financeiro`, 1 tabela) |
| M12 | **RLS é reversível; movimentação de schema não é** | `DISABLE ROW LEVEL SECURITY` é instantâneo (critério 15) |

---

## 8. Riscos que permanecem

Riscos que a escolha de B/E **não** elimina. Ordenados por gravidade.

| # | Risco | Por que persiste | Mitigação prevista |
|--:|---|---|---|
| RR1 | **Ligar RLS cedo demais derruba o Tenant 1.** Com a policy ativa e a app sem `set_config`, toda query devolve zero linhas — indistinguível de "perdemos os dados" para o usuário | É a consequência direta do fail-closed | RLS é a **penúltima** etapa (§11-F7), validada antes no Tenant 2; feature flag por tabela; ensaio de rollback cronometrado |
| RR2 | **Refatorar 43 `$transaction` sem testes** | R-2 + R-7 | Testes de caracterização (01 §7.3 T2, T3, T6) **antes** de tocar em transação |
| RR3 | **Crons não são resolvidos por nenhum modelo** | O job não tem request nem usuário; precisa iterar tenants explicitamente | Executor que percorre tenants e abre um escopo por tenant; a trava `this.rodando` em memória (`processos-cron.service.ts:26`) precisa virar lock no banco |
| RR4 | **Storage e QR Code ficam fora do banco** | Nenhum modelo de tenancy alcança arquivo ou HMAC | Prefixo `tenants/<id>/…` obrigatório; `QR_SIGNING_SECRET` derivado por tenant; **uploads locais servidos sem autenticação** (`main.ts:19-21`) precisam ser resolvidos antes do Tenant 2 |
| RR5 | **Rotas públicas passam a resolver tenant por dado de URL** | `slug`, `eventoId` e `token` viram chave de roteamento de dados sem sessão | `slug` único por tenant; validação de que o recurso resolvido pertence ao tenant da URL; caracterização T5 |
| RR6 | **Portal patronal: login por CNPJ sem saber o tenant** | Se `Empresa.cnpj` deixar de ser único global, o login precisa de outro discriminador | Depende da decisão N3/§9-D3 |
| RR7 | **Performance sob RLS** | Toda query ganha predicado; toda operação passa a abrir transação | Índice `(tenant_id, …)` nos caminhos quentes; medir antes/depois no Tenant 2 |
| RR8 | **Sequências por tenant** (`matricula`, `Atendimento.numero`) | P7 pede avaliação; `count()+1` já é *race-prone* hoje | Substituir por sequência/tabela de contador por tenant, dentro de transação — não por `count()` |
| RR9 | **Extensão pode não valer dentro do `tx`** | Não verificado (S-2) | Spike bloqueante antes de fechar o desenho de §10 |
| RR10 | **Migration de `NOT NULL` em tabela grande** | Volume real desconhecido (01 §7.2-C4) | Medir volume; backfill em lotes; `NOT NULL` via `NOT VALID` + `VALIDATE CONSTRAINT` |
| RR11 | **RLS não substitui constraint de unicidade** | Uma unique global continua bloqueando o tenant 2 mesmo com RLS ativo | As 17 unicidades **precisam** virar compostas — não é opcional em B |
| RR12 | **`BYPASSRLS` do superusuário** | Migrations e o próprio Railway costumam conectar como owner, que ignora RLS | Papel de aplicação dedicado, **sem** `BYPASSRLS`; `FORCE ROW LEVEL SECURITY` na tabela |

---

## 9. Decisões de negócio ainda necessárias

As de N1–N10 do documento 01 que P1–P7 **já resolveram** estão marcadas. As demais
seguem abertas e agora com o impacto preciso sobre o modelo recomendado.

| # | Decisão | Status | Impacto direto |
|--:|---|---|---|
| — | O que é um tenant (N1) | ✅ **P1** | — |
| — | Migração do sindicato atual (N8) | ✅ **P4** | — |
| — | Numeração por tenant (N9) | ✅ **P7** (avaliar) | RR8 |
| **D1** | **Quantos sindicatos a plataforma pretende atender?** Ordem de grandeza: unidades, dezenas, centenas? | ❗ **Aberta — a mais importante** | **É a única capaz de inverter a recomendação.** ≤ ~10 clientes de alto valor torna D competitivo (§5-D) |
| **D2** | **`User` é do tenant ou global com vínculo?** (N2) | ❗ Aberta | Decide `users.tenant_id` vs. tabela `tenant_usuarios`; decide se o token carrega 1 ou N tenants; decide o seletor de organização no front |
| **D3** | **`Empresa` global com vínculo ou duplicada?** (N3) | ❗ Aberta | Decide o login do portal patronal (RR6) e a forma da unique de `cnpj` |
| **D4** | **`Processo` global com acompanhamento ou duplicado?** (N4) | ❗ Aberta | Decide se o espelho DataJud é compartilhado; afeta o maior módulo (5.571 ln) e o custo de chamadas ao CNJ |
| **D5** | **Quais catálogos são globais?** `ParteExterna`, `TipoAndamento`, `TipoCompromisso`, `Cargo`, `Departamento` (N5) | ❗ Aberta | Define quais tabelas **não** recebem `tenant_id` nem policy |
| **D6** | **Isolamento contratual/LGPD: lógico basta?** (N6) | ❗ Aberta | Se exigir separação física, E vira D para os clientes afetados |
| **D7** | **Roteamento: subdomínio, path ou seletor pós-login?** (N7) | ❗ Aberta | Define as rotas públicas (RR5), o CORS e se o front precisa de build por tenant (`NEXT_PUBLIC_API_URL` é build-time) |
| **D8** | **Restore por cliente é requisito contratual?** (N10) | ❗ Aberta | Se sim, é ponto forte de D e exige ferramenta própria em B |
| **D9** | **Existe papel de "operador da plataforma"** que enxerga todos os tenants (suporte, cobrança)? | ❗ Nova | Exige policy de bypass controlada e trilha de auditoria própria — desenhar junto, não depois |

**D1, D2, D6 e D7 bloqueiam o documento 03.** As demais podem avançar sob suposição
declarada.

---

## 10. Arquitetura de alto nível proposta

Desenho-alvo. **Nada disto foi implementado.**

```
┌─ ENTRADA ─────────────────────────────────────────────────────────────┐
│  Equipe        → JWT (claim tenantId)   → jwt.strategy.validate()     │
│  Portal patronal → JWT empresa          → empresa-jwt.strategy        │
│  Público c/ token → recadastro/:token   → LinkRecadastramento.tenantId│
│  Público c/ slug  → colonia?slug        → ColoniaTemporada.tenantId   │
│  Público c/ id    → sala/:eventoId      → Evento.tenantId             │
│  Cron            → itera tenants        → escopo explícito por tenant │
└───────────────────────────┬───────────────────────────────────────────┘
                            ▼
              ┌─────────────────────────────┐
              │  TenantContextGuard          │  resolve e valida o tenant
              │  (APP_GUARD, após JwtAuth)   │  → 403 se ausente/inválido
              └─────────────┬───────────────┘
                            ▼
              ┌─────────────────────────────┐
              │  AsyncLocalStorage           │  { tenantId, userId, ip }
              │  (TenantContextService)      │  ÚNICA fonte da verdade
              └─────────────┬───────────────┘
                            ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  PrismaService                                                  │
   │   ├─ resolveConexão(tenantId)   → compartilhado | dedicado (E)  │
   │   ├─ forTenant(tenantId)                                        │
   │   │    └─ $transaction( tx => {                                 │
   │   │         SELECT set_config('app.tenant_id', <id>, true);     │
   │   │         return tx-estendido;   ← extensão do client raiz    │
   │   │       })                                                    │
   │   └─ prismaPlataforma  (sem escopo — uso restrito, lint-banido) │
   └────────────────────────────┬───────────────────────────────────┘
                                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  PostgreSQL — papel de aplicação SEM BYPASSRLS                  │
   │   FORCE ROW LEVEL SECURITY em toda tabela de tenant             │
   │   POLICY: tenant_id = current_setting('app.tenant_id',true)::uuid│
   │   @@unique([tenantId, <campo>]) nas 17 unicidades               │
   └────────────────────────────────────────────────────────────────┘
```

**Camadas de defesa, da mais externa à mais interna:**

| Camada | Mecanismo | O que pega |
|--:|---|---|
| 1 | `TenantContextGuard` | Request sem tenant resolvido |
| 2 | Prisma Client Extension | `where`/`data` sem `tenantId` em operação de model |
| 3 | **RLS (fail-closed)** | **Tudo o mais** — SQL nativo, extensão com bug, código novo |
| 4 | `@@unique([tenantId, …])` | Colisão de identificador entre tenants |
| 5 | CI (§12) | Model novo sem coluna/policy; `$queryRaw` fora da allowlist |

Nenhuma camada isolada é suficiente. A camada 3 é a que não depende de ninguém lembrar.

**Modelos novos previstos** (nomes preliminares): `Tenant` (id, slug, razão social,
status, conexão), e — condicional a D2 — `TenantUsuario` (vínculo N:N com papel por
tenant). `ConfiguracaoSindicato` passa de registro único a **um registro por tenant**.

---

## 11. Estratégia preliminar de transição

Expand-and-contract em 9 fases. **Toda fase é reversível e deployável sozinha.** O
Tenant 1 permanece em produção o tempo inteiro.

| Fase | O que entra | Tenant 1 sente? | Rollback |
|:--:|---|---|---|
| **F0** | **Testes de caracterização** (01 §7.3): T2 SQL nativo, T3 sorteio, T4 matrícula, T6 importação, T7 sessão, T9 PDFs. **Pré-requisito de tudo** | Não | n/a |
| **F1** | Migration aditiva: tabela `tenants`; `tenant_id` **nullable** nas ~39 tabelas; índices. Nenhuma leitura usa a coluna | Não | `DROP COLUMN` |
| **F2** | Criar o **Tenant 1** (`INSERT`). Backfill em lotes: `UPDATE … SET tenant_id = <t1> WHERE tenant_id IS NULL` | Não | `UPDATE … SET NULL` |
| **F3** | `tenant_id NOT NULL` + `DEFAULT <t1>` (a *default* é a compatibilidade temporária que a fase F9 remove) | Não | Remover constraint |
| **F4** | `AsyncLocalStorage` + `TenantContextGuard` + `tenantId` no JWT. Contexto **populado mas ainda não imposto** | Não | Desligar o guard |
| **F5** | Unicidades → compostas `@@unique([tenantId, …])`; adequar as **22 `findUnique`** (R-1) e os **6 upsert** | Não | Reverter índices |
| **F6** | Extensão do Prisma + `forTenant()`; adaptar os 43 `$transaction`. Módulo a módulo, na ordem do grafo de DI: `financeiro` → `escalas` → `auditoria` → … → `filiados` → `processos` | Não (comportamento idêntico com 1 tenant) | Extensão em modo *no-op* por flag |
| **F7** | **Tenant 2 de homologação.** Validar isolamento de ponta a ponta com dois tenants reais no mesmo banco | Não | Excluir o Tenant 2 |
| **F8** | **Ligar RLS**, tabela a tabela, por feature flag. Papel de aplicação sem `BYPASSRLS`. Começar pelas tabelas de menor risco (`contas_bancarias`, `escalas_advogados`), terminar em `filiados`/`processos` | **Sim** — janela de risco (RR1) | `DISABLE ROW LEVEL SECURITY` |
| **F9** | **Contract:** remover `DEFAULT <t1>`, remover flags, remover caminhos de compatibilidade, tornar `prismaPlataforma` inacessível fora da allowlist | Não | — |

**Regras invioláveis da transição:**

1. **Nenhuma fase remove nada antes da F9.** Expand primeiro, contract por último.
2. **F0 antes de F6.** Refatorar 43 transações sem caracterização é o cenário de RR2.
3. **F8 só depois de F7 verde.** Ligar RLS sem a app 100% escopada é RR1 — o Tenant 1
   vê o sistema vazio.
4. **Storage, QR Code e crons (RR3, RR4) entram entre F6 e F7**, porque o Tenant 2 já os
   exercita.
5. **Cada fase sai em deploy próprio**, com a versão anterior da app ainda funcional
   contra o banco novo (P6).

---

## 12. Mecanismos obrigatórios anti-esquecimento

Requisito explícito: o isolamento **não pode depender da memória do desenvolvedor**.
Sete mecanismos, do mais forte ao mais fraco. Os quatro primeiros são bloqueantes.

| # | Mecanismo | Onde | O que impede | Força |
|--:|---|---|---|:--:|
| **1** | **RLS fail-closed** com papel de aplicação sem `BYPASSRLS` + `FORCE ROW LEVEL SECURITY` | Banco | Qualquer query sem contexto — **inclusive código futuro que ninguém revisou** | 🔒🔒🔒 |
| **2** | **`@@unique([tenantId, …])`** nas 17 unicidades | Banco | Colisão de matrícula/CPF/CNPJ/slug entre tenants | 🔒🔒🔒 |
| **3** | **`PrismaService` não expõe client cru.** Só `forTenant()`. O client sem escopo chama-se `prismaPlataforma` e vive num módulo com allowlist | Aplicação | Acesso global acidental — o caminho inseguro precisa ser **nomeado** e revisado | 🔒🔒 |
| **4** | **CI: teste de isolamento com 2 tenants.** Semeia dois tenants, varre todas as rotas de listagem, falha se qualquer resposta contiver ID do outro | CI | Regressão de escopo em qualquer rota | 🔒🔒 |
| **5** | **CI: lint de schema.** Todo model novo precisa estar classificado (`TENANT`/`GLOBAL`/`REL`/`AUDIT`) num manifesto versionado; `TENANT` sem `tenantId`, sem índice ou sem policy **quebra o build** | CI | O model criado daqui a um ano por alguém que não leu este documento | 🔒🔒 |
| **6** | **ESLint `no-restricted-syntax`:** proíbe `$queryRaw`/`$executeRaw` fora de uma allowlist explícita e `this.prisma.<model>` fora do acessor com escopo | Lint | SQL nativo novo sem revisão de tenant | 🔒 |
| **7** | **Tipo `TenantId` branded** (`string & { __brand: 'TenantId' }`) | Tipos | Passar um `userId` onde se espera `tenantId` | 🔒 |

**Por que 1 é insubstituível:** os mecanismos 3–7 dependem de configuração que alguém
pode afrouxar, de teste que alguém pode marcar como `skip`, de lint que alguém pode
suprimir com um comentário. O mecanismo 1 é avaliado pelo Postgres em toda query, sem
exceção, e falha para o lado seguro. É o único que continua valendo quando todos os
outros forem contornados.

---

## 13. Spikes a executar antes de implementar

Experimentos pequenos e descartáveis, em branch separada, **sem tocar em produção**.
Os dois primeiros são bloqueantes: o desenho de §10 depende do resultado.

| # | Spike | Pergunta | Bloqueante? |
|--:|---|---|:--:|
| **S-1** | RLS + Prisma 5.22, prova de conceito com 2 tenants e 2 tabelas | O padrão `$transaction` + `set_config(…, true)` isola de fato? Qual o custo em latência por query? | **Sim** |
| **S-2** | Extensão `$extends` dentro de `$transaction` | A extensão do client raiz permanece ativa no `tx`? (R-2, RR9) | **Sim** |
| S-3 | `$queryRaw` sob policy RLS | Os 9 sítios são filtrados sem alteração de SQL? Inclusive o `pg_advisory_xact_lock`? | Sim |
| S-4 | Papel de aplicação sem `BYPASSRLS` no Railway | O Railway permite criar papel não-superusuário? `prisma migrate deploy` funciona com ele? (RR12) | Sim |
| S-5 | Backfill em lote na maior tabela | Quanto tempo leva `UPDATE` + `NOT NULL` no volume real? (RR10, C4) | Não |
| S-6 | `pg_dump` filtrado por tenant | Restore de um tenant é viável em B? (D8, critério 16) | Não |
| S-7 | Custo real de N Postgres no Railway | Quanto custa D para 10, 50, 100 tenants? Fecha D1 com número, não com impressão | Não |

---

## Estado e próximo passo

**Este documento está aguardando revisão. Nada foi implementado.**

O próximo documento — `03-PLANO_DE_MIGRACAO.md` — depende de:

1. **Aprovação ou correção da recomendação** (§6);
2. **D1** (quantos sindicatos) — única decisão capaz de inverter B/E → D;
3. **D2, D6, D7** (`User`, isolamento contratual, roteamento);
4. **S-1 e S-2** executados — sem eles, o desenho de §10 é hipótese.
