# 05 — Migração do cliente atual para Tenant 1

> **Escopo.** Estratégia detalhada para transformar o sindicato em produção no Tenant 1,
> sem perda de dados e sem indisponibilidade desnecessária. Sobre o modelo escolhido em
> [`02`](./02-MODELO_DE_TENANCY.md) (banco compartilhado + `tenant_id` + RLS) e o contexto
> de [`03`](./03-TENANT_CONTEXT.md).
>
> **Nada foi executado.** Nenhum comando de banco, nenhuma migration, nenhuma alteração
> de código ou schema. O único arquivo criado é este documento.
>
> **Data:** 2026-08-02 · **Commit base:** `adc64d8` · **Status:** aguardando revisão

---

## Sumário

1. [Três achados que mudam o plano](#1-três-achados-que-mudam-o-plano)
2. [Criação do registro do Tenant 1](#2-criação-do-registro-do-tenant-1)
3. [Identificação das tabelas](#3-identificação-das-tabelas)
4. [Adição do `tenant_id`](#4-adição-do-tenant_id)
5. [Backfill](#5-backfill)
6. [Tratamento por categoria de tabela](#6-tratamento-por-categoria-de-tabela)
7. [Validação de órfãos](#7-validação-de-órfãos)
8. [Preservação de chaves estrangeiras](#8-preservação-de-chaves-estrangeiras)
9. [Índices e constraints](#9-índices-e-constraints)
10. [Quando tornar `tenant_id` obrigatório](#10-quando-tornar-tenant_id-obrigatório)
11. [Ensaio em cópia do banco](#11-ensaio-em-cópia-do-banco)
12. [Idempotência e recuperação](#12-idempotência-e-recuperação)
13. [Rollback](#13-rollback)
14. [Comparação antes × depois](#14-comparação-antes--depois)
15. [Evitar indisponibilidade](#15-evitar-indisponibilidade)
16. [Ordem entre migration e deploy](#16-ordem-entre-migration-e-deploy)
17. [Backoffice de tenants](#17-backoffice-de-tenants)
18. [Sequência consolidada](#18-sequência-consolidada)

---

## 1. Três achados que mudam o plano

Levantados do `schema.prisma` (65 relações com `onDelete` mapeadas) e do
`apps/api/package.json`. Cada um invalida uma suposição natural sobre esta migração.

### A1 · Sob RLS, quase **toda** tabela precisa da coluna — não ~39

O doc 02 estimou "~39 dos 51 models ganham `tenantId`". **Está subdimensionado.**

Uma policy RLS é avaliada linha a linha. Escrever a policy de `parcelas_cobranca` como
"o `tenant_id` da cobrança-pai" exigiria subconsulta por linha — inviável em qualquer
volume. A alternativa é **desnormalizar `tenant_id` em toda tabela sujeita a RLS**,
inclusive tabelas de relacionamento e de auditoria.

> **Número corrigido: ~50 das 51 tabelas recebem `tenant_id`** — todas menos as que forem
> decididas GLOBAL (§3.2). Isso aumenta o volume de DDL e de backfill, e precisa constar
> do dimensionamento antes de começar.

### A2 · Três tabelas **não têm como derivar o tenant por relação**

| Tabela | Problema | Consequência |
|---|---|---|
| `password_resets` | **Nenhuma FK.** Ligada a `users` por **string de e-mail** (`schema.prisma:276-286`) | Não há caminho relacional. Ver §6.5 |
| `compromissos` | **Todas** as relações são opcionais com `SetNull`: `criador`, `filiado`, `atendimento`, `processo` (`:1568-1571`) | Um compromisso pode não ter nenhuma âncora |
| `configuracao_sindicato` | Registro único sem FK (`:1291-1304`) | Vira 1 por tenant (§6.3) |

Outras com relação opcional `SetNull` que pode estar nula: `presencas` (todas as pessoas),
`processos` (`filiadoId`, `advogadoId`), `auditorias` (`userId`), `documentos`
(`filiadoId` e `colaboradorId` ambos opcionais), `logs_sincronizacao_datajud`
(`processoId`).

**Por que isso é tratável agora e não seria depois:** com **um único tenant**, o backfill
é uma atribuição em bloco — todo registro é do Tenant 1, tenha âncora ou não. A derivação
relacional só seria necessária se já houvesse mistura. **Esta é a janela mais barata que
existirá para essa migração**, e ela se fecha no dia em que o Tenant 2 entrar.

### A3 · Migration e deploy estão **acoplados** hoje

`apps/api/package.json:9`:

```
"start": "prisma migrate deploy && node dist/src/main.js"
```

Consequências diretas:

1. **Não existe "migrar sem publicar" nem "publicar sem migrar".** O comando é um só.
2. A migration roda **enquanto a versão anterior ainda serve tráfego** (o container novo
   sobe, migra, passa no health check e só então recebe tráfego).
3. Com múltiplas réplicas, todas executam `migrate deploy` ao subir — o Prisma usa
   advisory lock, então a segunda espera, mas o tempo de boot soma.

> **Portanto toda migration desta série é obrigatoriamente compatível com a versão de
> aplicação que está no ar.** Não é boa prática opcional: é a única forma que a topologia
> atual permite. Ver §16.

---

## 2. Criação do registro do Tenant 1

### 2.1 Onde

Numa migration `data-only` **separada** da que cria a tabela `tenants` — DDL e DML em
migrations distintas facilitam rollback e releitura.

### 2.2 UUID fixo, não gerado

O `id` do Tenant 1 deve ser um **UUID literal, escrito na migration**, não
`gen_random_uuid()`.

**Por quê:** o backfill (§5), a validação (§7), o ensaio (§11) e um eventual rollback
(§13) referenciam esse valor. Se ele for gerado, cada ambiente (produção, cópia de
ensaio, homologação) terá um valor diferente, e nenhum script serve para os dois. Com UUID
fixo, o mesmo SQL roda em qualquer ambiente — o que é pré-requisito de §11 e §12.

Sugestão de valor reconhecível em log: `00000000-0000-4000-8000-000000000001`.

### 2.3 Conteúdo

| Campo | Origem |
|---|---|
| `id` | UUID fixo acima |
| `slug` | `senatepi` |
| `razaoSocial` | Do cadastro institucional atual |
| `status` | `ATIVO` |
| `criadoEm` | `now()` |

**Módulos:** todos os 13 de `permissoes.constants.ts:45-63` ativos — o Tenant 1 não pode
perder nada (premissa P4).
**Branding:** o branding atual do SENATEPI gravado **como dado** (doc 04 §4.7), não
herdado do código.
**`ConfiguracaoSindicato`:** o registro único existente ganha o `tenant_id` do Tenant 1 —
não é recriado, para preservar a chave PIX e a assinatura já cadastradas.

### 2.4 Idempotência

`INSERT … ON CONFLICT (id) DO NOTHING`. Reexecutar a migration não duplica nem
sobrescreve o que o cliente já ajustou.

---

## 3. Identificação das tabelas

### 3.1 Procedimento, não lista pronta

A lista existe no doc 01 §3, mas ela é **hipótese de leitura**. O procedimento que a
transforma em decisão:

1. **Partir das 8 tabelas `❓`** do doc 01 §3 e fechá-las com as decisões D2–D5 do doc 02
   §9. Enquanto estiverem abertas, **nenhuma migration pode ser escrita** — a classe da
   tabela decide se ela ganha coluna, policy e índice.
2. **Derivar o resto pelo grafo de FKs.** Tabela que referencia uma tabela do tenant é do
   tenant. O grafo já está mapeado (65 relações).
3. **Marcar as três exceções de A2** para tratamento explícito.
4. **Gravar o resultado num manifesto versionado** (`docs/multitenant/manifesto-tabelas.md`
   ou um `.json` lido pelo CI), que vira a fonte do lint de schema do doc 02 §12
   mecanismo 5.

O passo 4 é o que impede a lista de envelhecer: sem manifesto, o model criado daqui a seis
meses não é classificado por ninguém.

### 3.2 Distribuição esperada

| Classe | Qtd. | Recebe `tenant_id`? | Recebe policy RLS? |
|---|--:|:--:|:--:|
| `TENANT` | 28 | Sim | Sim |
| `AUDIT` | 10 | Sim | Sim |
| `REL` | 5 | **Sim (desnormalizado)** — ver A1 | Sim |
| `❓` → a decidir | 8 | Depende de D2–D5 | Depende |
| `GLOBAL` (catálogo da plataforma) | 0 hoje; `Modulo` e `Plano` nascem assim | Não | Não |

**Tabelas de plataforma que nascem fora do escopo de tenant:** `tenants`, `modulos`,
`planos`, `operadores_plataforma`, `auditoria_plataforma` (§17).

---

## 4. Adição do `tenant_id`

### 4.1 Forma da coluna, por fase

| Fase | Definição | Por quê |
|---|---|---|
| F1 (expand) | `tenant_id UUID NULL` | `NULL` para não travar a versão em produção, que não conhece a coluna |
| F3 | `+ DEFAULT '<uuid-t1>'` | Cobre a janela em que a app antiga ainda insere sem a coluna |
| F3 (fim) | `NOT NULL` | Só após backfill completo e validado (§10) |
| F9 (contract) | `DROP DEFAULT` | O default é compatibilidade temporária; mantê-lo faria toda linha nova cair no Tenant 1 por engano |

> **O `DEFAULT` é a peça mais importante e a mais fácil de esquecer de remover.** Sem ele,
> a app antiga quebra ao inserir durante a janela de deploy. Com ele esquecido em F9, um
> bug de contexto no futuro grava silenciosamente no Tenant 1 em vez de falhar.

### 4.2 Ordem dentro da fase

1. `ALTER TABLE … ADD COLUMN tenant_id UUID` — instantâneo no Postgres 11+ (sem reescrita
   de tabela, pois a coluna é nullable e sem default volátil).
2. **Não** criar a FK para `tenants` ainda — ela exige validação da tabela inteira.
3. Índices e FK entram depois do backfill (§9).

### 4.3 Nomenclatura

`tenant_id` no banco (`snake_case`, consistente com `@map` do projeto) ↔ `tenantId` no
client Prisma.

---

## 5. Backfill

### 5.1 Estratégia: atribuição em bloco, em lotes

Como só existe um tenant, o backfill é literalmente "tudo é do Tenant 1". A complexidade
não está na regra — está em **não travar a produção**.

Padrão por tabela:

```
-- em lote, com pausa entre iterações; nunca um UPDATE único na tabela inteira
UPDATE <tabela>
   SET tenant_id = '<uuid-t1>'
 WHERE tenant_id IS NULL
   AND id IN (SELECT id FROM <tabela> WHERE tenant_id IS NULL LIMIT 5000);
```

**Por que em lotes:** um `UPDATE` sem `LIMIT` numa tabela grande mantém lock de linha até
o commit, infla o WAL e pode estourar o autovacuum. `filiados` tem ~7 mil registros
(mencionado em `schema.prisma:348`), mas `movimentacoes_processuais` e `auditorias`
crescem sem teto — o volume real ainda não foi medido (doc 01 C4, ainda aberto).

**Por que `WHERE tenant_id IS NULL`:** torna o backfill retomável e reexecutável (§12).

### 5.2 Ordem entre tabelas

Irrelevante para a **correção** (todos recebem o mesmo valor), relevante para a
**validação**: fazer primeiro as tabelas-raiz (`filiados`, `users`, `eventos`, `empresas`,
`processos`, `colonia_temporadas`) permite validar o caminho relacional cedo, com as
tabelas-folha ainda vazias de `tenant_id` — o que torna qualquer inconsistência óbvia.

### 5.3 Verificação de progresso

Uma consulta que, para cada tabela do manifesto, devolve `total`, `com_tenant`,
`sem_tenant`. O backfill termina quando `sem_tenant = 0` em todas. Essa consulta é a mesma
usada em §7 e §14 — escrever uma vez, usar três.

---

## 6. Tratamento por categoria de tabela

### 6.1 Específicas do tenant (28)

Caso simples: coluna, backfill em bloco, índice, policy. `filiados`, `eventos`,
`processos`, `cobrancas`, `colaboradores`, `colonia_*`, etc.

### 6.2 Globais (plataforma)

Nenhuma existe hoje (doc 01 §3). Nascem com a migração: `tenants`, `modulos`, `planos`,
`operadores_plataforma`. **Não recebem `tenant_id` nem RLS** — e por isso precisam de
proteção própria: acesso só pelo papel de plataforma (doc 03 §4.1).

### 6.3 Compartilhadas / candidatas a global

As 8 `❓`. Duas merecem tratamento nomeado nesta migração:

**`ConfiguracaoSindicato`** — registro único hoje, lido por
`findFirst({ orderBy: { createdAt: 'asc' } })` (`cobrancas.service.ts:749`). Passa a ter um
por tenant. O registro existente **recebe** o `tenant_id` do Tenant 1; não é recriado. A
leitura muda de `findFirst` para busca por tenant — e essa mudança de código precisa sair
**depois** do backfill, ou a versão antiga passa a ler o registro errado quando existir um
segundo.

**`Empresa`, `Processo`, `ParteExterna`, `TipoAndamento`, `TipoCompromisso`, `Cargo`,
`Departamento`, `User`** — dependem de D2–D5. **Se a decisão for "global com vínculo"**,
a tabela não recebe `tenant_id`; nasce em vez disso uma tabela de vínculo
(`tenant_empresas`, `tenant_processos`) que recebe. O backfill então cria uma linha de
vínculo por registro existente, apontando para o Tenant 1.

### 6.4 De relacionamento (5)

`ParteProcesso`, `ProcessoAdvogado`, `Presenca`, `VotoHabilitacao`, `DuplicataDecisao`.

**Recebem `tenant_id` desnormalizado** (A1). Derivação natural pelo lado obrigatório:
`Presenca` → `evento` (Cascade, obrigatório); `VotoHabilitacao` → `pauta`;
`ParteProcesso`/`ProcessoAdvogado` → `processo`. Como só há um tenant, o backfill é em
bloco — mas a **derivação precisa ser escrita mesmo assim**, porque é ela que valida
consistência em §7 e que servirá ao onboarding de tenants futuros.

### 6.5 De auditoria (10)

`Auditoria`, `FiliadoHistorico`, `ColaboradorHistorico`, `CompromissoHistorico`,
`RefreshToken`, `PasswordReset`, `LinkRecadastramento`, `LogSincronizacaoDatajud`,
`Importacao`, `ImportacaoLinha`.

Duas decisões próprias:

**Retenção.** Trilha de auditoria é registro legal e **não** deve ser truncada para
facilitar a migração. Recebe `tenant_id` como qualquer outra.

**`password_resets` é o caso especial (A2).** Sem FK, ligada por e-mail, e com
`expiraEm` de **1 hora** (`auth.service.ts:201`). Recomendação: **descartar as linhas não
usadas e expiradas** antes do backfill e atribuir o Tenant 1 ao que sobrar (que será quase
nada). Alternativa se houver exigência de trilha: resolver por `email → users.email`,
aceitando que endereços sem usuário correspondente fiquem com Tenant 1. É a única tabela
em que "resolver por join de string" é aceitável — e só porque o dado tem vida útil de
uma hora.

**`refresh_tokens`:** herda de `users`. Vale considerar **revogar todas as sessões** no
momento em que o `tid` entrar no JWT (doc 03 §2.3) — um token antigo sem `tid` será
rejeitado de qualquer forma (doc 03 §6). Revogar explicitamente troca "401 inesperado"
por "sessão encerrada, faça login" — melhor experiência e mais fácil de comunicar.

### 6.6 De arquivos e anexos

`Documento`, `AnexoDocumento` e as colunas de chave de storage
(`Filiado.fotoKey`, `User.avatarKey`, `Colaborador.fotoKey`…).

**As linhas do banco** seguem o padrão: coluna + backfill.

**Os arquivos no storage exigem migração própria**, e ela é a parte mais delicada porque
não tem transação:

| Passo | Ação |
|---|---|
| 1 | Congelar o formato: novos uploads já gravam em `tenants/<t1>/…` (doc 03 §5.2) |
| 2 | **Copiar** (não mover) os objetos existentes para o novo prefixo |
| 3 | Atualizar as chaves no banco, em lote, com a mesma verificação de `IS NULL`/prefixo |
| 4 | Leitura com **fallback**: chave nova → se ausente, chave antiga |
| 5 | Só depois de dias sem acessos ao caminho antigo, remover os originais |

**O fallback do passo 4 não é opcional.** Storage não participa da transação do banco: se
a migration der rollback depois de as chaves terem sido reescritas, os registros apontam
para arquivos que o rollback não desfaz. O fallback é o que torna os dois estados
compatíveis.

> **Bloqueio prévio:** o doc 01 registra que, com `STORAGE_DRIVER=local`, o disco do
> Railway é efêmero e os uploads são servidos **sem autenticação** em `/uploads/`
> (`main.ts:19-21`). Antes de migrar arquivo é preciso saber qual driver está em produção
> (doc 01 C2, **ainda não respondida**). Se for `local` sem volume montado, não há o que
> migrar — e há um problema maior a tratar antes.

---

## 7. Validação de órfãos

Quatro classes de verificação. Todas são consultas de leitura, executáveis a qualquer
momento, e todas devem devolver **zero linhas**.

### V1 · Nenhuma linha sem tenant

Para cada tabela do manifesto: `SELECT count(*) FROM <t> WHERE tenant_id IS NULL`.

### V2 · Nenhum `tenant_id` inexistente

`SELECT … WHERE tenant_id NOT IN (SELECT id FROM tenants)` — redundante depois da FK
(§8), mas é o que valida **antes** de a FK poder ser criada.

### V3 · Nenhuma FK cruzando tenants

A verificação mais importante — e a que hoje **nada impede**. Para cada uma das 65
relações mapeadas:

```
SELECT count(*)
  FROM compromissos c
  JOIN filiados f ON f.id = c.filiado_id
 WHERE c.tenant_id <> f.tenant_id;
```

Com um só tenant o resultado é trivialmente zero. **O valor da consulta não é o resultado
de hoje — é existir como suíte para o dia em que houver dois.** Ela deve nascer aqui e
virar teste de CI (doc 03 I1).

### V4 · Órfãos que já existem por desenho

O mapa de FKs mostra relações `SetNull` que **legitimamente** produzem linhas sem pai:
`auditorias.user_id` (usuário excluído), `presencas.filiado_id`,
`processos.filiado_id`, `compromissos.*`, `logs_sincronizacao_datajud.processo_id`.

> **Cuidado:** essas linhas **não são erro** e não podem ser "corrigidas" pela migração.
> Uma consulta de órfãos ingênua vai encontrá-las e sugerir limpeza — apagá-las destruiria
> trilha de auditoria e histórico de assembleia. A suíte de validação precisa
> **distinguir** "sem tenant" (erro) de "sem pai" (esperado).

---

## 8. Preservação de chaves estrangeiras

### 8.1 As FKs atuais não mudam

Nenhuma das 65 relações é alterada. `onDelete: Cascade`, `SetNull` e `Restrict`
permanecem como estão. Acrescentar uma coluna não afeta FK existente.

### 8.2 A FK nova: `tenant_id → tenants(id)`

Criada **depois** do backfill, para não validar tabela cheia de `NULL`. Técnica sem
bloqueio:

```
ALTER TABLE <t> ADD CONSTRAINT <t>_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) NOT VALID;   -- instantâneo
ALTER TABLE <t> VALIDATE CONSTRAINT <t>_tenant_fk;            -- não bloqueia escrita
```

`NOT VALID` passa a valer para linhas novas imediatamente; `VALIDATE` confere as antigas
com lock fraco (`SHARE UPDATE EXCLUSIVE`), que não impede `SELECT`/`INSERT`/`UPDATE`.

`ON DELETE` da FK de tenant: **`RESTRICT`**. Apagar um tenant não pode cascatear e apagar
o acervo de um sindicato inteiro por um clique no backoffice. Remoção de tenant é
processo próprio (§17), não `DELETE`.

### 8.3 FK composta — a proteção contra referência cruzada

Hoje `Compromisso.filiadoId` pode apontar para qualquer filiado. Amanhã, para um filiado
de **outro tenant** — e o banco não impediria.

Proteção: chave estrangeira **composta**, que carrega o tenant.

```
-- no pai:
ALTER TABLE filiados ADD CONSTRAINT filiados_tenant_id_uk UNIQUE (tenant_id, id);

-- no filho:
ALTER TABLE compromissos ADD CONSTRAINT compromissos_filiado_mesmo_tenant
  FOREIGN KEY (tenant_id, filiado_id) REFERENCES filiados (tenant_id, id) NOT VALID;
```

Com isso, um `INSERT` que cruze tenants é **recusado pelo banco** — não depende da
aplicação nem da policy.

**Ressalvas honestas:**
- O Prisma **não modela FK composta desse formato**; entra como SQL manual na migration.
  O projeto já escreve SQL manual em migration (índices parciais da colônia), então está
  dentro da prática demonstrada — mas o `prisma db pull` não vai representá-la.
- Aplicar às 65 relações de uma vez é muito. Recomendação: começar pelas que ligam
  **agregados diferentes** (`compromissos→filiados`, `processos→filiados`,
  `presencas→filiados`, `anexos→*`), que é onde o cruzamento seria plausível, e deixar as
  relações pai-filho estritas (`parcelas→cobrancas`) para depois.

---

## 9. Índices e constraints

### 9.1 Índices de `tenant_id`

Toda tabela sob RLS recebe índice. **Preferir índice composto com a coluna já usada nos
filtros quentes** a um índice isolado de `tenant_id`:

| Tabela | Índice sugerido | Substitui |
|---|---|---|
| `filiados` | `(tenant_id, situacao)` | `@@index([situacao])` (`:388`) |
| `filiados` | `(tenant_id, cpf)` | `@@index([cpf])` (`:389`) |
| `parcelas_cobranca` | `(tenant_id, status)` | `@@index([status])` |
| demais | `(tenant_id)` | — |

Motivo: com RLS, **todo** predicado passa a incluir `tenant_id`. Um índice só em
`situacao` deixa de ser seletivo quando houver N tenants.

### 9.2 As 17 unicidades colidentes

Doc 02 R-1 e §5-B item 11. Transformação em duas etapas, sem janela sem proteção:

1. **Criar** a unique composta `(tenant_id, campo)`.
2. **Só então derrubar** a unique simples.

Inverter a ordem abre um intervalo em que nada garante unicidade — e é justamente quando
uma importação em lote pode rodar.

### 9.3 Índice concorrente — limitação a verificar

`CREATE INDEX CONCURRENTLY` não bloqueia escrita, mas **não pode rodar dentro de
transação**. O Prisma envolve cada migration numa transação.

> ⚠️ **Verificar em ensaio (§11):** se `migrate deploy` recusa `CONCURRENTLY`. Se recusar,
> os índices das tabelas grandes precisam ser aplicados **fora** do Prisma, como passo
> operacional, e a migration apenas registra que já existem. É item de plano, não
> detalhe — muda quem executa o quê.

---

## 10. Quando tornar `tenant_id` obrigatório

Sequência, por tabela, com o critério de avanço explícito:

| Momento | Estado | Critério para avançar |
|---|---|---|
| 1 | `NULL`, sem default | Backfill iniciado |
| 2 | `NULL` + `DEFAULT <t1>` | V1 = 0 para a tabela |
| 3 | `CHECK (tenant_id IS NOT NULL) NOT VALID` | Instantâneo; passa a valer para linhas novas |
| 4 | `VALIDATE CONSTRAINT` | Confere as antigas sem bloquear escrita |
| 5 | `SET NOT NULL` | **Barato**, porque o Postgres reaproveita o CHECK já validado |
| 6 | `DROP CONSTRAINT` do CHECK | Redundante com o `NOT NULL` |
| 7 | *(fase F9)* `DROP DEFAULT` | App 100% escopada e RLS ativo |

O caminho 3→5 é o que evita o `ACCESS EXCLUSIVE` prolongado que um `SET NOT NULL` direto
causaria numa tabela grande.

**Regra de ouro:** `NOT NULL` **antes** de ligar RLS, e RLS **depois** da aplicação
escopada (doc 02 §11 F8, risco RR1). Inverter derruba o Tenant 1 — tudo passa a devolver
zero linhas.

---

## 11. Ensaio em cópia do banco

### 11.1 Ambiente

Um Postgres descartável no mesmo Railway, restaurado de `pg_dump` da produção. Se houver
restrição de LGPD para copiar dado real para ambiente de ensaio (**a confirmar**), o
ensaio roda sobre cópia **anonimizada** — o que preserva volume e forma, que é o que
importa aqui, ainda que reduza o realismo de alguns dados.

### 11.2 Roteiro

| # | Passo | O que mede |
|--:|---|---|
| 1 | `pg_dump` da produção; anotar **tamanho e duração** | Quanto custa a rede de segurança de §13 |
| 2 | Restaurar na cópia | Tempo de recuperação em desastre |
| 3 | Rodar §14 na cópia → **snapshot ANTES** | Linha de base |
| 4 | Aplicar toda a série de migrations, **cronometrando cada uma** | Quais precisam de lote menor |
| 5 | Rodar §14 → **snapshot DEPOIS** e comparar | Prova de preservação |
| 6 | Rodar V1–V4 (§7) | Prova de integridade |
| 7 | Subir a aplicação **na versão atual** contra o banco migrado | **Prova de compatibilidade retroativa (A3)** |
| 8 | Subir a versão nova | Prova de avanço |
| 9 | Executar o rollback (§13) e revalidar | Prova de que o rollback funciona |
| 10 | Repetir a série inteira **duas vezes seguidas** | Prova de idempotência (§12) |

Os passos **7, 9 e 10** são os que costumam ser pulados e são exatamente os que dão
segurança. O passo 7 valida a única coisa que a topologia atual exige (A3).

### 11.3 Critério de aprovação

Avançar para produção só com: V1–V4 zerados · snapshots idênticos nos invariantes (§14) ·
app antiga funcional contra banco novo · rollback exercitado · série reexecutada sem erro
· tempo total dentro da janela acordada.

---

## 12. Idempotência e recuperação

### 12.1 Por construção

| Operação | Forma idempotente |
|---|---|
| Criar tenant | `INSERT … ON CONFLICT (id) DO NOTHING` |
| Adicionar coluna | `ADD COLUMN IF NOT EXISTS` |
| Backfill | `WHERE tenant_id IS NULL` — retomável de onde parou |
| Índice | `CREATE INDEX IF NOT EXISTS` |
| Constraint | Verificar em `pg_constraint` antes de criar |
| Migração de storage | Copiar só se o destino não existir |

### 12.2 O backfill é o passo que pode ser interrompido

DDL é transacional no Postgres — falhou, desfez. O backfill em lotes **não** roda numa
transação única (de propósito, §5.1), então pode parar no meio.

O `WHERE tenant_id IS NULL` resolve: reexecutar continua do ponto em que parou, sem
reprocessar o que já foi feito. É o mesmo predicado que mede progresso (§5.3) e que valida
conclusão (§7 V1).

### 12.3 Registro de execução

Uma tabela `migracao_tenant_log` (`etapa`, `tabela`, `linhas_afetadas`, `iniciado_em`,
`concluido_em`, `erro`) — a mesma que o backoffice usa depois para provisionar tenants
novos (§17). Sem ela, "onde parou?" é respondido por contagem manual às duas da manhã.

---

## 13. Rollback

### 13.1 Por fase

| Fase | Rollback | Custo | Perda |
|---|---|---|:--:|
| F1 coluna nullable | `DROP COLUMN` | Baixo | Nenhuma |
| F2 tenant + backfill | `UPDATE … SET tenant_id = NULL` | Baixo | Nenhuma |
| F3 `NOT NULL` | `DROP NOT NULL` | Baixo | Nenhuma |
| F5 uniques compostas | Recriar as simples | **Médio** — pode falhar se já houver colisão | Nenhuma |
| F6 app escopada | Deploy da versão anterior | Baixo | Nenhuma |
| F8 **RLS ligado** | `DISABLE ROW LEVEL SECURITY` | **Instantâneo** | Nenhuma |
| F9 contract | **Difícil** — é o ponto sem volta | Alto | — |

**F8 ser instantâneo e sem perda é a razão técnica de o RLS estar no fim** (doc 02 M12).
O passo de maior risco é também o mais fácil de desfazer.

### 13.2 O ponto sem volta

**F9** (remover `DEFAULT`, flags e caminhos de compatibilidade). Antes dela, todo estado é
reversível por comando. Depois, reverter exige nova migration. F9 só entra com o Tenant 2
validado e um período acordado de estabilidade.

### 13.3 Rollback de dados

Para o que DDL não cobre: `pg_dump` **imediatamente antes** de cada fase que escreve dados
(F2, migração de storage). Com duração medida no ensaio (§11 passo 1), a decisão
"restaurar ou consertar" é tomada com número, não com estimativa.

### 13.4 O que rollback **não** desfaz

- **Arquivos no storage** — por isso o fallback de leitura (§6.6 passo 4).
- **Sessões revogadas** (§6.5) — usuários refazem login.
- **E-mails/WhatsApp já enviados** — links de recadastramento em circulação.

---

## 14. Comparação antes × depois

### 14.1 Snapshot

Executado antes e depois, em ambos os ambientes:

| Métrica | Consulta | Invariante |
|---|---|---|
| Contagem por tabela | `count(*)` em cada tabela do manifesto | **Idêntica** |
| Soma financeira | `SUM(valor)` em `parcelas_cobranca`, `movimentacoes`, `contribuicoes_patronais` | **Idêntica** |
| Distribuição de status | `GROUP BY situacao` em `filiados`; `GROUP BY status` em `parcelas_cobranca` | **Idêntica** |
| Checksum de identidade | `md5(string_agg(id, ',' ORDER BY id))` por tabela | **Idêntico** |
| Órfãos por desenho | Contagem de `SetNull` já nulos (§7 V4) | **Idêntica** — provar que a migração não "consertou" nada |
| Cobertura de tenant | `count(*) WHERE tenant_id IS NULL` | 0 **depois** |

**A quinta linha é a que costuma faltar.** Sem ela, um script bem-intencionado que
"limpou órfãos" passa despercebido, e só aparece quando alguém procurar o histórico de uma
assembleia de dois anos atrás.

### 14.2 Verificação funcional

Contagem igual não prova que o sistema funciona. Complementar com os testes de
caracterização do doc 01 §7.3 rodando **antes e depois**, e com uma conferência manual
dirigida: um filiado com dossiê completo, um carnê com parcelas, um evento encerrado com
certificado, um processo com movimentações. **Comparar o PDF gerado antes com o gerado
depois** — se saírem iguais, a cadeia inteira (dados → template → asset → assinatura)
sobreviveu.

---

## 15. Evitar indisponibilidade

### 15.1 O que causa parada, e a alternativa

| Operação | Lock | Alternativa |
|---|---|---|
| `ADD COLUMN` nullable | Instantâneo (PG 11+) | — |
| `ADD COLUMN` com default volátil | **Reescreve a tabela** | Adicionar sem default; aplicar default depois |
| `SET NOT NULL` direto | `ACCESS EXCLUSIVE` | `CHECK NOT VALID` → `VALIDATE` → `SET NOT NULL` (§10) |
| `ADD FOREIGN KEY` | Valida tabela cheia | `NOT VALID` → `VALIDATE` (§8.2) |
| `CREATE INDEX` | Bloqueia escrita | `CONCURRENTLY` — **se o Prisma permitir** (§9.3) |
| `UPDATE` em massa | Lock de linha, WAL | Lotes com pausa (§5.1) |
| `ENABLE ROW LEVEL SECURITY` | Instantâneo | — (o risco é lógico, não de lock — RR1) |

### 15.2 Janela

Com as técnicas acima, **nenhuma fase exige janela de manutenção**. O que exige atenção:

- **Backfill em horário de baixo uso.** O sistema é de sindicato: madrugada e fim de
  semana são naturalmente baixos, exceto durante assembleia (evento noturno) ou campanha
  de colônia. **Conferir a agenda do cliente antes de marcar** — não existe "horário
  sempre seguro" num sistema com plenário virtual.
- **Evitar sobreposição com o cron do DataJud** (`0 2 * * *`,
  `processos-cron.service.ts:33`), que já varre `processos` por horas.
- **F8 (RLS)** é a única com risco de indisponibilidade *lógica*: se a app não estiver
  escopada, tudo devolve vazio. Tabela a tabela, com flag e rollback ensaiado.

---

## 16. Ordem entre migration e deploy

### 16.1 A regra, dada a topologia atual (A3)

Como `start` roda `prisma migrate deploy && node …`, a ordem real de cada publicação é:

```
container novo sobe → migrate deploy → health check → tráfego migra → container antigo morre
                           ↑
              a versão ANTIGA ainda está servindo aqui
```

> **Toda migration precisa ser compatível com a versão de aplicação anterior.** Não é
> recomendação: é o que a topologia impõe.

### 16.2 Ordem por tipo de mudança

| Tipo | Ordem | Motivo |
|---|---|---|
| Coluna nova nullable | Migration → deploy | App antiga ignora |
| Backfill | Migration → deploy | Não muda contrato |
| `NOT NULL` + `DEFAULT` | Migration → deploy | Default cobre a app antiga |
| Unique composta | Migration → deploy | Mais restritiva; app antiga não colide (um tenant) |
| Leitura da coluna | Deploy **depois** da migration | Nunca ler o que pode não existir |
| **Remover coluna/default** | Deploy → **migration depois** | Ordem **invertida**: nenhuma versão no ar pode depender do que será removido |

A última linha é a assimetria do expand-and-contract: **adicionar vai do banco para a
aplicação; remover vai da aplicação para o banco.**

### 16.3 Recomendação de topologia

Considerar **desacoplar** `migrate deploy` do `start`, movendo-o para um passo próprio.
Ganhos: aplicar migration sem publicar código (útil no backfill longo), evitar N réplicas
disputando o advisory lock, e permitir que uma migration demorada não conte como tempo de
boot — hoje ela conta, e uma migration lenta pode fazer o health check falhar e o Railway
reiniciar o container **no meio da migration**.

> Esse último cenário é o risco operacional mais concreto desta seção e vale confirmar
> antes de F2: qual o timeout de health check configurado no Railway (doc 01 C3, aberta).

---

## 17. Backoffice de tenants

Entidades propostas. **Nenhuma pertence a tenant** — são da plataforma, acessíveis apenas
pelo papel `senatepi_platform` (doc 03 §4.1), fora do RLS.

### 17.1 Núcleo

| Entidade | Campos principais | Papel |
|---|---|---|
| `Tenant` | `id`, `slug`, `razaoSocial`, `nomeExibicao`, `cnpj`, `status`, `criadoEm`, `suspensoEm`, `motivoSuspensao` | Raiz |
| `TenantDominio` | `tenantId`, `dominio`, `tipo` (subdomínio\|próprio), `verificadoEm`, `certificadoAte` | Roteamento (D7) |
| `TenantBranding` | doc 04 §5 | White-label |
| `TenantModulo` | doc 04 §5 | Feature toggles |
| `TenantConfiguracao` | `tenantId`, `chave`, `valor Json` | Ajustes finos sem migration |

### 17.2 Comercial

| Entidade | Campos | Papel |
|---|---|---|
| `Plano` | `key`, `nome`, `limites Json`, `modulosInclusos[]`, `precoBase`, `ativo` | Catálogo global |
| `TenantAssinatura` | `tenantId`, `planoKey`, `inicioEm`, `fimEm`, `status`, `ciclo` | Contrato vigente |
| `TenantUso` | `tenantId`, `competencia`, `filiadosAtivos`, `usuarios`, `storageBytes`, `processosSincronizados` | Medição para cobrança e limites |

`TenantUso` tem uma função além da cobrança: **o sync do DataJud consome cota de uma API
pública compartilhada** (`datajud.service.ts:113`). Sem medir por tenant, um cliente com
50 mil processos consome a janela noturna dos demais.

### 17.3 Operação

| Entidade | Campos | Papel |
|---|---|---|
| `OperadorPlataforma` | `id`, `nome`, `email`, `senhaHash`, `papel`, `mfaSegredo`, `ativo` | Equipe do SaaS — **separado de `User`** |
| `AuditoriaPlataforma` | `operadorId`, `tenantId?`, `acao`, `entidade`, `metadata`, `ip`, `criadoEm` | Trilha **separada** da auditoria do tenant |
| `AcessoAssistido` | `operadorId`, `tenantId`, `motivo`, `autorizadoPor`, `iniciadoEm`, `expiraEm`, `encerradoEm` | Suporte entrando no tenant, com prazo e motivo |
| `TenantProvisionamento` | `tenantId`, `etapa`, `status`, `erro`, `tentativas` | Onboarding — reusa `migracao_tenant_log` (§12.3) |
| `TenantBackup` | `tenantId`, `tipo`, `chaveStorage`, `tamanho`, `criadoEm`, `expiraEm` | Restore por cliente (doc 02 D8) |

**Três decisões de segurança embutidas, que valem discussão explícita:**

1. **`OperadorPlataforma` é tabela separada de `User`.** Fundir os dois faria o suporte da
   plataforma ser um usuário de algum tenant — e qualquer bug de permissão viraria acesso
   cruzado. Separar custa uma tabela e um fluxo de login; fundir custa uma categoria
   inteira de vulnerabilidade.
2. **`AcessoAssistido` com motivo, autorização e prazo.** Suporte que entra no tenant não
   pode ser um interruptor permanente. Sem essa entidade, "o operador vê tudo" vira norma
   e some da trilha.
3. **`AuditoriaPlataforma` separada de `Auditoria`.** A trilha do tenant pertence ao
   sindicato; a da plataforma, ao SaaS. Misturar significa que apagar dados de um cliente
   que cancelou apagaria também o registro de quem acessou o quê.

---

## 18. Sequência consolidada

Mapeada nas fases do doc 02 §11.

| Etapa | Conteúdo | Fase | Reversível? |
|---|---|:--:|:--:|
| 0 | Fechar D2–D5; escrever o **manifesto de tabelas** | — | — |
| 0.1 | Testes de caracterização (doc 01 §7.3) | F0 | — |
| 0.2 | Medir volume por tabela (C4) e confirmar `STORAGE_DRIVER` (C2) | — | — |
| 0.3 | **Ensaio completo** em cópia (§11) | — | — |
| 1 | DDL: `tenants` + colunas nullable + `migracao_tenant_log` | F1 | ✅ |
| 2 | Tenant 1 (§2) | F2 | ✅ |
| 3 | Backfill em lotes (§5) | F2 | ✅ |
| 4 | Validação V1–V4 (§7) + snapshot (§14) | F2 | — |
| 5 | Índices + FK `NOT VALID`→`VALIDATE` (§8, §9) | F3 | ✅ |
| 6 | `DEFAULT` + `CHECK`→`VALIDATE`→`NOT NULL` (§10) | F3 | ✅ |
| 7 | Uniques compostas: criar, depois derrubar as simples (§9.2) | F5 | ⚠️ |
| 8 | Migração de arquivos, com fallback (§6.6) | F6 | ⚠️ |
| 9 | App escopada, módulo a módulo | F6 | ✅ |
| 10 | Tenant 2 de homologação | F7 | ✅ |
| 11 | FK compostas anti-cruzamento (§8.3) | F7 | ✅ |
| 12 | **RLS ligado**, tabela a tabela | F8 | ✅ |
| 13 | Contract: `DROP DEFAULT`, flags, storage antigo | F9 | ❌ |

---

## Pendências que bloqueiam a escrita das migrations

| # | Pendência | Origem | Por que bloqueia |
|--:|---|---|---|
| B1 | **D2–D5** (`User`, `Empresa`, `Processo`, catálogos) | doc 02 §9 | 8 tabelas sem classe definida — não dá para escrever DDL |
| B2 | **Volume real por tabela** | doc 01 C4 | Define tamanho de lote e duração da janela |
| B3 | **`STORAGE_DRIVER` em produção** | doc 01 C2 | Define se §6.6 existe ou vira outro problema |
| B4 | **Nº de réplicas e timeout de health check** | doc 01 C3 | Risco de reinício no meio da migration (§16.3) |
| B5 | **Prisma aceita `CONCURRENTLY`?** | §9.3 | Define quem aplica os índices grandes |
| B6 | **Pode copiar dado real para ambiente de ensaio?** | §11.1 | Define o realismo possível do ensaio |
| B7 | **S-1 e S-2** | doc 02 §13 | O desenho de RLS ainda é hipótese não testada |

---

## Estado

**Aguardando revisão. Nada executado, nada alterado.**

Próximo documento — `06-PLANO_DE_EXECUCAO.md` — só faz sentido depois de B1 fechada e do
ensaio de §11 concluído: é ele que transforma esta estratégia em cronograma com
responsáveis e janelas.
