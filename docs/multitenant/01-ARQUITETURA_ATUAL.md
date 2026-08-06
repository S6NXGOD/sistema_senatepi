# 01 — Arquitetura Atual (inventário auditável)

> **Escopo.** Retrato do sistema **como ele é hoje**, para servir de linha de base à
> avaliação de multi-tenancy. Documento de leitura: nenhum código foi alterado.
> **Não escolhe modelo de tenancy, não propõe migrations, não altera o schema.**
> Toda classificação marcada como *preliminar* é hipótese de trabalho a validar.
>
> **Data do levantamento:** 2026-08-02 · **Commit base:** `adc64d8` (branch `main`)
> **Escala:** ~27.650 ln TypeScript na API · 24 módulos · 51 models Prisma · 41 migrations

---

## Sumário

1. [Resumo executivo](#1-resumo-executivo)
2. [Inventário de módulos](#2-inventário-de-módulos)
3. [Inventário de models do Prisma](#3-inventário-de-models-do-prisma)
4. [Pontos de acesso à PrismaService](#4-pontos-de-acesso-à-prismaservice)
5. [Entradas onde o tenant precisará ser resolvido](#5-entradas-onde-o-tenant-precisará-ser-resolvido)
6. [Evidências](#6-evidências)
7. [Lacunas e incertezas](#7-lacunas-e-incertezas)

---

## 1. Resumo executivo

Monorepo npm workspaces com dois serviços e **um único banco**.

| Camada | Stack | Caminho |
|---|---|---|
| API | NestJS 10 + Express (monólito modular, processo único) | `apps/api/` |
| Web | Next.js 15 App Router — SPA 100% client-side | `apps/web/` |
| Banco | PostgreSQL, acesso exclusivo via Prisma 5 | `apps/api/prisma/schema.prisma` |
| Deploy | Railway, disco de container efêmero | `railway.json` |

**Fatos estruturais que condicionam qualquer conversão multi-tenant:**

- **Nenhum dos 51 models tem coluna de organização.** Toda query é implicitamente
  "todos os registros do sistema".
- **Não existe camada de repositório.** 51 provedores injetam a mesma `PrismaService`
  e leem/escrevem qualquer tabela diretamente.
- **`PrismaService` tem 13 linhas, sem `$extends` e sem `$use`.** Não há hoje um ponto
  onde um filtro transversal por tenant possa ser instalado.
- **O contexto de requisição não trafega.** Sem AsyncLocalStorage, sem CLS, sem provider
  request-scoped: o que existe é `req.user`, e os services não veem o request.
- **Sem fila, sem broker, sem worker externo, sem Redis.** Dois crons in-process.
- **Front sem noção de organização** e com `NEXT_PUBLIC_API_URL` fixado em build time.

Nada disso é defeito no desenho single-tenant atual — é o que muda de custo quando o
requisito passa a ser multi-tenant.

---

## 2. Inventário de módulos

**Legenda — acoplamento:** `Baixo` = sem `imports:` de outro domínio e ≤ 5 models ·
`Médio` = sem deps mas lê models de outros domínios · `Alto` = tem ou é dependência de
DI, ou lê ≥ 10 models.

**Legenda — risco multi-tenant (preliminar):** `🔴` bloqueante (uniqueness global,
geração de ID por `count`, config singleton, ou rota sem sessão) · `🟠` alto (volume de
models, SQL nativo, integração externa) · `🟡` moderado · `🟢` baixo.

| Módulo | Caminho (`apps/api/src/modules/`) | Controllers (prefixo) | Services | Models/tabelas | Depende de | Rotas públicas | Acopl. | Risco |
|---|---|---|---|---|---|---|:--:|:--:|
| **processos** | `processos/` | `processos.controller` (`processos`) · `movimentacoes.controller` (`processos`, `datajud`, `tipos-movimentacao`) · `partes.controller` (`processos`, `partes-externas`) · `audiencias.controller` (`audiencias-a-agendar`) | `processos`, `datajud`, `audiencias`, `automacao-prazos`, `consulta-previa`, `movimentacoes`, `partes`, `partes-externas`, `sincronizacao-log`, `processos-cron` | processo, parteExterna, parteProcesso, processoAdvogado, movimentacaoProcessual, movimentacaoInterna, tipoAndamento, logSincronizacaoDatajud, anexoDocumento, compromisso, filiado, user, auditoria (13) | `AgendaModule` | — | Alto | 🔴 |
| **eventos** | `eventos/` | inline no `.module` (`eventos`) · `checkin.controller` (`sala`) · `plenario.controller` (`eventos/:eventoId/plenario`, `certificados`, `sala/:eventoId`) | `certificado`, `checkin`, `dossie-evento`, `encerramento`, `presenca-lista`, `sorteio`, `votacao` | evento, presenca, pautaVotacao, votoHabilitacao, votoUrna, sorteioEvento, filiado, filiadoHistorico (8) | `CobrancasModule` | `GET/POST sala/*` (4) · `GET certificados/verificar/:codigo` · `GET sala/:eventoId/ao-vivo` · `POST sala/:eventoId/votar/:pautaId` | Alto | 🔴 |
| **filiados** | `filiados/` | `filiados.controller` (`filiados`) · `admin-filiados.controller` (`admin/filiados`) · `duplicidade.controller` (`filiados/duplicidade`) | `filiados`, `dossie`, `duplicidade` (+ `campos-imutaveis.ts`, `duplicidade.guard.ts`) | filiado, filiadoHistorico, vinculoProfissional, dependente, documento, carteirinha\*, cobranca, parcelaCobranca, presenca, processo, atendimento, compromisso, coloniaReserva, recadastramento, duplicataDecisao (14) | `AnexosModule` | — | Alto | 🔴 |
| **agenda** | `agenda/` | `agenda.controller` (`compromissos`) `@Modulo` · `tipos-evento.controller` (`tipos-evento`) `@Modulo` | `agenda`, `tipos-evento` (+ `desfechos.catalogo.ts`) | compromisso, compromissoHistorico, tipoCompromisso, atendimento, processo, processoAdvogado, parteProcesso, movimentacaoInterna, filiado, user (10) | — (é dependência de `processos`) | — | Alto | 🟠 |
| **colonia** | `colonia/` | `colonia.controller` (`colonia`) | `colonia`, `colonia-seed` | coloniaTemporada, coloniaLote, coloniaQuarto, coloniaReserva, coloniaSorteioInscricao, filiado, filiadoHistorico, vinculoProfissional (8) | — | `GET colonia/disponibilidade` · `POST colonia/reservas` · `POST colonia/sorteio/inscricao` | Médio | 🔴 |
| **importacao** | `importacao/` | `importacao.controller` (`importacoes`) | `importacao`, `relatorio` (+ `mapeamento.util.ts`) | importacao, importacaoLinha, filiado, filiadoHistorico, carteirinha (5) | — | — | Médio | 🔴 |
| **empresas** | `empresas/` | `empresas.controller` (`empresas`) `@Modulo` · `auditoria-contribuicoes.controller` (`cobrancas/contribuicoes-patronais`) `@Modulo` | `empresas`, `brasil-api`, `auditoria-contribuicoes` | empresa, contribuicaoPatronal, contaBancaria, movimentacao (4) | — · **externo: BrasilAPI** | — | Médio | 🔴 |
| **cobrancas** | `cobrancas/` | `cobrancas.controller` (`cobrancas`) `@Modulo` | `cobrancas`, `cobrancas-cron` | cobranca, parcelaCobranca, configuracaoSindicato, contaBancaria, movimentacao, filiado (6) | — (é dependência de `eventos`) | — | Alto | 🔴 |
| **colaboradores** | `colaboradores/` | `cadastros.controller` (`cadastros`) `@Modulo` · `colaboradores.controller` (`colaboradores`) | `cadastros`, `colaboradores` | colaborador, colaboradorHistorico, cargo, departamento, documento (5) | — · **externo: `fetch` não identificado** | — | Médio | 🔴 |
| **portal-empresa** | `portal-empresa/` | `portal-empresa-auth.controller` (`portal-empresa/auth`) · `portal-empresa.controller` (`portal-empresa`) | `portal-empresa-auth`, `contribuicoes`, `empresa-jwt.strategy` | empresa, contribuicaoPatronal, configuracaoSindicato (3) | — (auth próprio) | **todas** (`@Public()` de classe; proteção real = `EmpresaJwtGuard`) | Baixo | 🔴 |
| **dashboard** | `dashboard/` | inline no `.module` (`dashboard`) | inline no `.module` | filiado, processo, compromisso, atendimento, evento, presenca, dependente, colaborador, escalaAdvogado, movimentacaoProcessual, logSincronizacaoDatajud, user (12) | `ProcessosModule` | — | Alto | 🟠 |
| **anexos** | `anexos/` | `anexos.controller` (`anexos`) | `anexos` | anexoDocumento, documento, filiado, processo, atendimento, compromisso (6) | — (é dependência de `filiados`) | — | Médio | 🟠 |
| **recadastramento** | `recadastramento/` | inline no `.module` (`filiados/:id`) · `link-recadastramento.controller` (`filiados/:id/link-recadastramento`, `links-recadastramento`, `recadastro`) | `recadastramento` (inline), `link-recadastramento` | recadastramento, linkRecadastramento, filiado, filiadoHistorico (4) | `FiliadosModule` | `GET recadastro/:token` · `POST recadastro/:token/validar` · `/foto` · `/enviar` | Alto | 🔴 |
| **auth** | `auth/` | `auth.controller` (`auth`) | `auth`, `admin-seed`, `jwt.strategy` | user, refreshToken, passwordReset (3) | — | `POST auth/login` · `/refresh` · `/forgot-password` · `/reset-password` | Médio | 🔴 |
| **atendimentos** | `atendimentos/` | `atendimentos.controller` (`atendimentos`) `@Modulo` | `atendimentos` | atendimento, compromisso, processo, filiado, user (5) | — | — | Baixo | 🟠 |
| **usuarios** | `usuarios/` | `usuarios.controller` (`usuarios`) `@Modulo` | `usuarios` | user (1) | — | — | Baixo | 🔴 |
| **profile** | `profile/` | `profile.controller` (`profile`) | `profile` | user, refreshToken (2) | — | — | Baixo | 🟡 |
| **dependentes** | `dependentes/` | inline no `.module` — `@Controller()` sem prefixo → `filiados/:filiadoId/dependentes`, `dependentes/:id` | inline no `.module` | dependente, filiado, filiadoHistorico (3) | — | — | Médio | 🟡 |
| **carteirinhas** | `carteirinhas/` | inline no `.module` (`filiados/:filiadoId/carteirinha`) | inline no `.module` | carteirinha, filiado, filiadoHistorico (3) | — | — | Baixo | 🔴 |
| **presencas** | `presencas/` | inline no `.module` — `@Controller()` sem prefixo → `validacao/qr`, `eventos/:eventoId/presencas` | inline no `.module` | presenca, evento, filiado, dependente, colaborador (5) | — | — | Médio | 🟠 |
| **escalas** | `escalas/` | `escalas.controller` (`escalas`) `@Modulo` | `escalas` | escalaAdvogado, user (2) | — | — | Baixo | 🟢 |
| **auditoria** | `auditoria/` | inline no `.module` (`auditoria`) | inline no `.module` | auditoria (1) | — | — | Baixo | 🟡 |
| **financeiro** | `financeiro/` | `financeiro.controller` (`financeiro`) | `financeiro` | contaBancaria (1) | — | — | Baixo | 🟢 |
| **health** | `health/` | inline no `.module` (`health`) | — (`$queryRaw SELECT 1`) | — | — | `GET health` | Baixo | 🟢 |

\* `filiados` referencia `carteirinha` via relação; a escrita é de `carteirinhas`/`importacao`.

### Serviços transversais `@Global()` (fora da tabela)

| Módulo | Caminho | Exporta | Observação |
|---|---|---|---|
| Prisma | `apps/api/src/prisma/prisma.module.ts` | `PrismaService` | Singleton, injetado em 51 provedores |
| Storage | `apps/api/src/common/storage/storage.module.ts` | `StorageService`, `ImageService` | Driver `local` \| `s3` |
| QrCode | `apps/api/src/common/qrcode/qrcode.module.ts` | `QrCodeService` | HMAC com segredo único da instalação |
| Audit | `apps/api/src/common/audit/audit.module.ts` | `AuditService` | Grava `auditorias` |

### Grafo de dependências de DI (5 arestas, acíclico)

```
dashboard        → processos → agenda
eventos          → cobrancas
filiados         → anexos
recadastramento  → filiados

Acoplamento implícito (não aparece no grafo do Nest):
  todos os 51 provedores → qualquer tabela, via PrismaService @Global()

Acoplamento por import de código puro (sem DI):
  filiados/campos-imutaveis.ts    → recadastramento (2 arquivos)
  dependentes/dependentes.sync.ts → filiados, recadastramento
  filiados/dto/filiado.dto.ts     → recadastramento (3 arquivos)
```

---

## 3. Inventário de models do Prisma

**51 models.** Classificação **preliminar**, por leitura do schema e do uso real — não
gera nenhuma alteração no schema.

**Legenda:** `TENANT` provavelmente pertencente ao tenant · `GLOBAL` provavelmente global
à instalação · `REL` tabela de relacionamento · `AUDIT` auditoria/operação ·
`❓` classificação ainda incerta.

| # | Model | Tabela | Classe | Nota / motivo da dúvida |
|--:|---|---|:--:|---|
| 1 | `User` | `users` | ❓ | O usuário é *do* sindicato ou *da plataforma*? Um advogado pode atender dois sindicatos. Decide se vira `TENANT` ou `GLOBAL` + tabela de vínculo. **Bloqueia o desenho.** |
| 2 | `RefreshToken` | `refresh_tokens` | AUDIT | Sessão; segue a classe de `User` |
| 3 | `PasswordReset` | `password_resets` | AUDIT | Indexado por **e-mail**, não por FK — se `User` for global, herda a ambiguidade |
| 4 | `Filiado` | `filiados` | TENANT | Hub de dados; 12 relações de saída |
| 5 | `FiliadoHistorico` | `filiado_historico` | AUDIT | Trilha do filiado |
| 6 | `VinculoProfissional` | `vinculos_profissionais` | TENANT | Local de trabalho do filiado |
| 7 | `Dependente` | `dependentes` | TENANT | |
| 8 | `LinkRecadastramento` | `links_recadastramento` | AUDIT | Token de uso único, 24h |
| 9 | `Recadastramento` | `recadastramentos` | TENANT | Submissão a revisar |
| 10 | `Carteirinha` | `carteirinhas` | TENANT | `numero` único global |
| 11 | `Documento` | `documentos` | TENANT | Aponta para chave no storage |
| 12 | `Evento` | `eventos` | TENANT | |
| 13 | `Presenca` | `presencas` | REL | Evento × (filiado \| dependente \| colaborador), com dados próprios |
| 14 | `PautaVotacao` | `pautas_votacao` | TENANT | |
| 15 | `VotoHabilitacao` | `votos_habilitacao` | REL | Pauta × filiado |
| 16 | `VotoUrna` | `votos_urna` | TENANT | Voto desacoplado do eleitor (urna) |
| 17 | `SorteioEvento` | `sorteios_evento` | TENANT | |
| 18 | `ColoniaTemporada` | `colonia_temporadas` | TENANT | **`slug` único global** — resolve rota pública |
| 19 | `ColoniaLote` | `colonia_lotes` | TENANT | |
| 20 | `ColoniaQuarto` | `colonia_quartos` | TENANT | `numero` único global |
| 21 | `ColoniaReserva` | `colonia_reservas` | TENANT | Índices únicos **parciais** feitos à mão |
| 22 | `ColoniaSorteioInscricao` | `colonia_sorteio_inscricoes` | TENANT | |
| 23 | `Departamento` | `departamentos` | ❓ | `nome` único global. Catálogo de apoio: por tenant ou compartilhado? |
| 24 | `Cargo` | `cargos` | ❓ | Idem `Departamento` |
| 25 | `Empresa` | `empresas` | ❓ | **`cnpj` único global.** A mesma empresa pode ser conveniada de dois sindicatos? Tem senha própria (portal) |
| 26 | `Colaborador` | `colaboradores` | TENANT | `cpf` e `matricula` únicos globais |
| 27 | `ColaboradorHistorico` | `colaborador_historico` | AUDIT | |
| 28 | `ConfiguracaoSindicato` | `configuracao_sindicato` | TENANT | **Registro único hoje** (`findFirst`). Guarda logo, assinatura e **chave PIX** |
| 29 | `Cobranca` | `cobrancas` | TENANT | |
| 30 | `ParcelaCobranca` | `parcelas_cobranca` | TENANT | |
| 31 | `ContaBancaria` | `contas_bancarias` | TENANT | |
| 32 | `Movimentacao` | `movimentacoes` | TENANT | Caixa |
| 33 | `Atendimento` | `atendimentos` | TENANT | **`numero` `autoincrement()` único global** |
| 34 | `TipoCompromisso` | `tipos_evento` | ❓ | `slug` único global. Cadastrável pelo usuário → provavelmente `TENANT` |
| 35 | `Compromisso` | `compromissos` | TENANT | `origemCompromissoId` único |
| 36 | `CompromissoHistorico` | `compromissos_historico` | AUDIT | |
| 37 | `EscalaAdvogado` | `escalas_advogados` | TENANT | |
| 38 | `Processo` | `processos` | ❓ | **`numeroCNJ` único global.** Um processo público pode ser acompanhado por dois sindicatos? |
| 39 | `ParteExterna` | `partes_externas` | ❓ | Advogado/parte do tribunal. Entidade do mundo real, compartilhável — ou cópia por tenant? |
| 40 | `ParteProcesso` | `partes_processo` | REL | Processo × filiado/parte externa |
| 41 | `ProcessoAdvogado` | `processos_advogados` | REL | Processo × user |
| 42 | `AnexoDocumento` | `anexos_documentos` | TENANT | Chave de storage |
| 43 | `MovimentacaoProcessual` | `movimentacoes_processuais` | TENANT | Espelho do DataJud |
| 44 | `LogSincronizacaoDatajud` | `logs_sincronizacao_datajud` | AUDIT | |
| 45 | `TipoAndamento` | `tipos_movimentacao` | ❓ | `slug` único global. Catálogo do radar: global ou por tenant? |
| 46 | `MovimentacaoInterna` | `movimentacoes_internas` | TENANT | |
| 47 | `ContribuicaoPatronal` | `contribuicoes_patronais` | TENANT | Ponte com `portal-empresa` |
| 48 | `Auditoria` | `auditorias` | AUDIT | Log central; `userId` nulável |
| 49 | `Importacao` | `importacoes` | AUDIT | Lote de carga |
| 50 | `ImportacaoLinha` | `importacao_linhas` | AUDIT | |
| 51 | `DuplicataDecisao` | `duplicata_decisao` | REL | Par de filiados avaliado |

**Contagem preliminar:** `TENANT` 28 · `AUDIT` 10 · `❓` 8 · `REL` 5 · `GLOBAL` 0 = 51.

> **Observação relevante:** **nenhum model se classifica hoje como claramente global.**
> Não existe tabela de plataforma, de plano, de assinatura nem de organização. Uma
> conversão multi-tenant introduz uma dimensão que o schema não possui em nenhum ponto.

---

## 4. Pontos de acesso à PrismaService

### 4.1 Quantidade e distribuição

- **53 arquivos** referenciam `PrismaService`; descontando `prisma.service.ts` e
  `prisma.module.ts`, são **51 provedores consumidores** — e **51 sítios de injeção**
  (`prisma: PrismaService`), ou seja, 1 injeção por provedor.
- Distribuição: 44 services · 2 estratégias Passport (`jwt.strategy`,
  `empresa-jwt.strategy`) · 2 seeds (`admin-seed`, `colonia-seed`) · `AuditService` ·
  e os provedores embutidos em `dashboard.module`, `carteirinhas.module`,
  `dependentes.module`, `presencas.module`, `auditoria.module`, `health.module`,
  `recadastramento.module`, `eventos.module`.
- **Não há repositórios, DAOs nem query objects.** Nenhum wrapper entre service e Prisma.
- **`PrismaService` não usa `$extends` nem `$use`** — não existe middleware, extensão de
  client nem interceptador de query onde um filtro global pudesse ser aplicado.

### 4.2 Queries nativas (SQL cru)

**9 sítios de chamada em 5 arquivos.** Todas parametrizadas via `Prisma.sql` / template
tag — **nenhum `$queryRawUnsafe` ou `$executeRawUnsafe` no código**.

| Arquivo:linha | Tipo | O que faz |
|---|---|---|
| `modules/cobrancas/cobrancas.service.ts:373` | `$queryRaw` | Listagem agregada de carnês: `GROUP BY` + `HAVING`, busca `ILIKE` em nome/matrícula/CPF, `COUNT(*) FILTER`. **O bloco mais complexo do sistema** (fragmentos montados em `:350-364`) |
| `modules/cobrancas/cobrancas.service.ts:393` | `$queryRaw` | `COUNT` de paginação sobre a subquery acima |
| `modules/dashboard/dashboard.module.ts:602` | `$queryRaw` | Falhas de sincronização DataJud |
| `modules/dashboard/dashboard.module.ts:665` | `$queryRaw` | Série agregada do painel |
| `modules/dashboard/dashboard.module.ts:677` | `$queryRaw` | Série agregada do painel |
| `modules/filiados/duplicidade.service.ts:185` | `$queryRaw` | Candidatos a duplicata (similaridade de nome) |
| `modules/filiados/duplicidade.service.ts:220` | `$queryRaw` | Candidatos a duplicata (variante) |
| `modules/colonia/colonia.service.ts:79` | `$executeRaw` | `pg_advisory_xact_lock(hashtextextended(<chave>, 0))` — lock pessimista do sorteio |
| `modules/health/health.module.ts:20` | `$queryRaw` | `SELECT 1` |

**Nota:** existe também SQL escrito à mão **dentro das migrations** — índices únicos
**parciais** que o Prisma não modela, ex. `ux_colonia_reserva_cpf_temporada` e
`ux_colonia_reserva_vaga` em
`prisma/migrations/20260702180000_colonia_indices_parciais/migration.sql`.

### 4.3 Uso de `$transaction`

**43 ocorrências em 24 arquivos.** Concentração:

| Arquivo | Ocorrências |
|---|--:|
| `modules/colonia/colonia.service.ts` | 6 |
| `modules/processos/partes.service.ts` | 5 |
| `modules/cobrancas/cobrancas.service.ts` | 4 |
| `modules/processos/processos.service.ts` | 3 |
| `modules/importacao/importacao.service.ts` | 3 |
| `agenda`, `atendimentos`, `empresas/auditoria-contribuicoes` | 2 cada |
| outros 16 arquivos | 1 cada |

Predomina a forma **interativa** (`$transaction(async (tx) => …)`), com `tx` repassado a
métodos privados — ver a assinatura `db: Tx | PrismaService = this.prisma` em
`colonia.service.ts:66-68`. Relevante porque qualquer mecanismo de escopo por tenant
teria de valer também dentro de `tx`, não só no client raiz.

### 4.4 `count` usado para gerar identificadores

Padrão **`count() + 1`**, sem transação e sem sequência — já é *race-prone* hoje e passa
a depender do volume dos outros tenants amanhã:

| Local | Código | Gera |
|---|---|---|
| `modules/filiados/filiados.service.ts:102` → `:114` | `const total = await this.prisma.filiado.count()` → `gerarMatricula('SEN', total + 1)` | Matrícula do filiado |
| `modules/colaboradores/colaboradores.service.ts:491` | `gerarMatricula('FUNC', total + 1)` | Matrícula do colaborador |
| `modules/importacao/importacao.service.ts:558` | `let seqFiliado = await this.prisma.filiado.count()` | Sequência da carga em lote |
| `modules/importacao/importacao.service.ts:749` | `const total = await this.prisma.filiado.count()` | Idem |

Formato gerado: `PREFIXO-AAAA-NNNNNN` (`common/utils/matricula.util.ts:2`) — **sem
componente de tenant**.

Identificador correlato, também global: `Atendimento.numero` é
`Int @unique @default(autoincrement())` (`schema.prisma:1435`) — sequência do Postgres
compartilhada por toda a instalação.

### 4.5 Upserts

**6 ocorrências.** Todos dependem de chave única — logo, todos herdam o risco de colisão
entre tenants descrito em 4.6:

| Local | Model | Chave usada |
|---|---|---|
| `modules/colonia/colonia-seed.service.ts:104` | `coloniaTemporada` | `slug` (único global) |
| `modules/colonia/colonia-seed.service.ts:122` | `coloniaLote` | `(temporadaId, numero)` |
| `modules/colonia/colonia-seed.service.ts:129` | `coloniaQuarto` | `numero` (único global) |
| `modules/filiados/duplicidade.service.ts:561` | `duplicataDecisao` | `(filiadoIdA, filiadoIdB)` |
| `modules/filiados/duplicidade.service.ts:664` | `duplicataDecisao` (em `tx`) | idem |
| `modules/processos/partes.service.ts:310` | `processoAdvogado` (em `tx`) | composta |

Complementarmente, há **14 arquivos** usando `createMany`/`updateMany`/`deleteMany` —
escritas em massa cujo `where` precisaria ser escopado (destaque:
`partes.service.ts` com 6 e `cobrancas.service.ts` com 3).

### 4.6 Unicidades que colidem entre tenants

**Inventário completo** (`schema.prisma`). Todas são hoje únicas em **toda a
instalação**; num modelo de banco compartilhado, cada linha é uma colisão potencial.

| Model | Campo(s) | Linha | Colisão plausível? |
|---|---|--:|---|
| `User` | `email` | 225 | **Sim** — mesma pessoa atendendo dois sindicatos |
| `User` | `username` | 226 | **Sim** |
| `Filiado` | `matricula` | 294 | **Sim** — cada sindicato numera do seu jeito |
| `Filiado` | `cpf` | 297 | **Sim** — profissional filiado a dois sindicatos |
| `Filiado` | `qrToken` | 368 | Improvável (UUID), mas o **segredo HMAC é global** |
| `Dependente` | `qrToken` | 459 | Idem |
| `Colaborador` | `cpf` | 1204 | **Sim** |
| `Colaborador` | `matricula` | 1194 | **Sim** |
| `Colaborador` | `qrToken` | 1202 | Idem `qrToken` |
| `Empresa` | `cnpj` | 1151 | **Sim** — empresa conveniada de dois sindicatos |
| `Carteirinha` | `numero` | 710 | **Sim** |
| `Carteirinha` | `filiadoId` | 709 | Não (1:1) |
| `Atendimento` | `numero` (autoincrement) | 1435 | **Sim** — sequência compartilhada |
| `Processo` | `numeroCNJ` | 1665 | **Sim** — processo público acompanhado por dois |
| `ColoniaTemporada` | `slug` | 924 | **Sim** — e resolve rota **pública** |
| `TipoCompromisso` | `slug` | 1500 | **Sim** — catálogo cadastrável |
| `TipoAndamento` | `slug` | 2017 | **Sim** — catálogo cadastrável |
| `Departamento` | `nome` | 1120 | **Sim** — "Jurídico" em dois sindicatos |
| `Cargo` | `nome` | 1133 | **Sim** — "Advogado" em dois sindicatos |
| `ColoniaQuarto` | `numero` | 974 | **Sim** |
| `ColoniaLote` | `(temporadaId, numero)` | 954 | Não (já escopada por temporada) |
| `Presenca` | `(eventoId, filiadoId\|dependenteId\|colaboradorId)` | 565-567 | Não (escopada por evento) |
| `VotoHabilitacao` | `(pautaId, filiadoId)` | 625 | Não (escopada por pauta) |
| `LinkRecadastramento` | `tokenHash` | 199 | Improvável (hash) |
| `ParcelaCobranca` | `movimentacaoId` | 1336 | Não (1:1) |
| `ContribuicaoPatronal` | `movimentacaoId` | 2119 | Não (1:1) |
| `Compromisso` | `origemCompromissoId` | 1674 | Não (1:1) |
| `DuplicataDecisao` | `(filiadoIdA, filiadoIdB)` | 2183 | Não (deriva de `Filiado`) |

**Resumo:** **17 unicidades com colisão plausível**, das quais 2 (`ColoniaTemporada.slug`,
`Processo.numeroCNJ`) também participam de resolução de rota ou de integração externa.

---

## 5. Entradas onde o tenant precisará ser resolvido

Cada linha é um ponto de entrada real do sistema. **Hoje nenhum deles carrega
organização** — o tenant é implícito porque só existe um.

### 5.1 Autenticação da equipe do sindicato

| Item | Onde | Situação hoje |
|---|---|---|
| Emissão do token | `modules/auth/auth.service.ts:83-89` | Claims: `sub`, `email`, `role`, `nome` — **sem organização** |
| Validação por request | `modules/auth/strategies/jwt.strategy.ts:33-52` | Relê `users` no banco a cada request e monta `req.user`. **É o ponto natural de resolução** |
| Objeto de contexto | `common/decorators/current-user.decorator.ts:4-12` | `AuthUser { id, email, role, nome, nomeExibicao, permissoes }` |
| Guards globais | `app.module.ts:74-82` | `Throttler → JwtAuth → Roles → Permissions` |
| Segredos | `.env`: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | **Únicos para a instalação** — token vale em qualquer tenant |
| Refresh | `auth.service.ts:129-172` | Rotação por hash em `refresh_tokens` |

### 5.2 Portal patronal (público externo autenticado)

| Item | Onde | Situação hoje |
|---|---|---|
| Login CNPJ+senha | `modules/portal-empresa/portal-empresa-auth.service.ts` | Resolve pela `Empresa` — **`cnpj` é único global** |
| Validação por request | `modules/portal-empresa/strategies/empresa-jwt.strategy.ts:48-74` | Relê `empresas`; exige claim `tipo: 'empresa'` |
| Guard | `modules/portal-empresa/guards/empresa-jwt.guard.ts` | Declarado **rota a rota**; trava de senha provisória no servidor |
| Segredo | `JWT_EMPRESA_SECRET` (+ derivação em `portal-empresa.secret.ts`) | Único para a instalação |

### 5.3 Rotas públicas por token (sem sessão)

| Rota | Onde | Resolução hoje |
|---|---|---|
| `GET /recadastro/:token` | `modules/recadastramento/link-recadastramento.controller.ts:62-67` | `tokenHash` → `LinkRecadastramento` → `Filiado` |
| `POST /recadastro/:token/validar` | idem `:73` | Desafio CPF+nascimento / COREN |
| `POST /recadastro/:token/foto` | idem `:85` | |
| `POST /recadastro/:token/enviar` | idem `:94` | |
| `GET /certificados/verificar/:codigo` | `modules/eventos/plenario.controller.ts:258-263` | Código do certificado, sem login |

### 5.4 Rotas por slug / ID público

| Rota | Onde | Resolução hoje |
|---|---|---|
| `GET /colonia/disponibilidade` | `modules/colonia/colonia.controller.ts:42-43` | `slug` da campanha → `temporadaAtivaPorSlug` (`colonia.service.ts:66-75`) |
| `POST /colonia/reservas` | idem `:49-51` | Escrita **pública** |
| `POST /colonia/sorteio/inscricao` | idem `:56-58` | Escrita **pública** |
| `GET /sala/:eventoId` + 3 rotas | `modules/eventos/checkin.controller.ts:38-93` | `@Public()` de classe; `eventoId` cru na URL |
| `GET /sala/:eventoId/ao-vivo` | `modules/eventos/plenario.controller.ts:277-291` | Polling público |
| `POST /sala/:eventoId/votar/:pautaId` | idem `:314` | **Voto por rota pública** |
| `GET /health` | `modules/health/health.module.ts:15-20` | Sem tenant por natureza |

### 5.5 Cron jobs

| Job | Onde | Situação hoje |
|---|---|---|
| Sync DataJud | `modules/processos/processos-cron.service.ts:33` | `0 2 * * *` TZ `America/Fortaleza`; varre **todos** os processos ativos; trava de reentrância é flag **em memória do processo** (`this.rodando`, linha 26) — não coordena entre réplicas |
| Vencimento de parcelas | `modules/cobrancas/cobrancas-cron.service.ts:17` | Meia-noite; `marcarParcelasVencidas()` sem escopo |
| Seed do admin | `modules/auth/admin-seed.service.ts:28` | `OnApplicationBootstrap`; condição `user.count() === 0` — **global** |
| Seed da colônia | `modules/colonia/colonia-seed.service.ts:104` | `OnApplicationBootstrap`; upserts por `slug` |

### 5.6 Uploads e arquivos

| Item | Onde | Chave/caminho hoje |
|---|---|---|
| Anexos genéricos | `modules/anexos/anexos.service.ts:98` | `<prefixo>/anexos/<uuid>.<ext>` |
| Documentos do filiado | `modules/filiados/filiados.service.ts:551` | `filiados/<id>/documentos/<ts>.<ext>` |
| Documentos do colaborador | `modules/colaboradores/colaboradores.service.ts:369` | `colaboradores/<id>/documentos/<ts>.<ext>` |
| Dossiê do evento | `modules/eventos/dossie-evento.service.ts:97` | `eventos/<id>/dossie.pdf` |
| Comprovantes patronais | `modules/portal-empresa/contribuicoes.service.ts:163,170` | `<base>/comprovante-<ts>.<ext>`, `<base>/relacao-<ts>.pdf` |
| Fotos e avatares | `common/storage/image.service.ts:44-65` | `<prefix>/foto-<uuid>.webp`, `thumb-`, `avatar-` |
| **Serviço estático** | `main.ts:19-21` | Driver `local` publica tudo em **`/uploads/` sem autenticação** — quem tem a URL lê o arquivo |
| URL assinada | `common/storage/storage.service.ts:163-172` | Só o driver `s3` assina; `local` devolve URL estática permanente |

**Nenhuma chave contém prefixo de tenant.**

### 5.7 Outras dimensões globais ao processo

| Item | Onde | Observação |
|---|---|---|
| Segredo do QR | `common/qrcode/qrcode.service.ts:21-23` | `QR_SIGNING_SECRET` único: QR assinado num tenant valida em outro |
| Config institucional | `schema.prisma:1291` + `cobrancas.service.ts:749` | `findFirst(orderBy createdAt asc)` — registro único; guarda **chave PIX do recebedor** |
| Advisory lock | `colonia.service.ts:79` | Chave sem tenant: sorteio de um cliente serializa o de outro |
| CORS / URL pública | `main.ts:49-52`, `.env.example:69-75` | `CORS_ORIGINS` e `APP_PUBLIC_URL` únicos por deploy |
| Front | `apps/web/src/lib/api.ts`, `lib/auth.tsx`, `middleware.ts` | `NEXT_PUBLIC_API_URL` fixado em **build time**; chaves de storage `senatepi.*` |

---

## 6. Evidências

Cada conclusão do documento, com origem verificável. Comandos executados a partir da
raiz do repositório.

### 6.1 Conclusões → arquivo:linha

| # | Conclusão | Evidência |
|--:|---|---|
| E1 | Monólito de processo único, 24 módulos registrados | `apps/api/src/app.module.ts:41-73` |
| E2 | 4 guards globais + 1 interceptor, nesta ordem | `apps/api/src/app.module.ts:74-82` |
| E3 | `PrismaService` sem `$extends`/`$use` — 13 linhas | `apps/api/src/prisma/prisma.service.ts:1-13` |
| E4 | Prisma é `@Global()` singleton | `apps/api/src/prisma/prisma.module.ts:4-9` |
| E5 | Uma única `DATABASE_URL`, provider `postgresql` | `apps/api/prisma/schema.prisma:10-13` |
| E6 | Contexto do usuário só existe como `req.user` | `apps/api/src/common/decorators/current-user.decorator.ts:4-21` |
| E7 | Usuário relido do banco a cada request | `apps/api/src/modules/auth/strategies/jwt.strategy.ts:33-52` |
| E8 | Claims do token não têm organização | `apps/api/src/modules/auth/auth.service.ts:83-89` |
| E9 | Segundo público com segredo e estratégia próprios | `apps/api/src/modules/portal-empresa/strategies/empresa-jwt.strategy.ts:22-42` |
| E10 | Matrícula gerada por `count() + 1` | `apps/api/src/modules/filiados/filiados.service.ts:102`, `:114` |
| E11 | Formato de matrícula sem tenant | `apps/api/src/common/utils/matricula.util.ts:2-6` |
| E12 | `ConfiguracaoSindicato` é registro único com chave PIX | `apps/api/prisma/schema.prisma:1291-1304`; leitura em `modules/cobrancas/cobrancas.service.ts:749` |
| E13 | Uploads locais servidos sem autenticação | `apps/api/src/main.ts:19-21`; URL estática em `common/storage/storage.service.ts:163-166` |
| E14 | Segredo de QR único da instalação | `apps/api/src/common/qrcode/qrcode.service.ts:21-23` |
| E15 | Trava do cron é flag em memória | `apps/api/src/modules/processos/processos-cron.service.ts:26`, `:35-39` |
| E16 | Seed do admin condicionado a banco vazio global | `apps/api/src/modules/auth/admin-seed.service.ts:28-29` |
| E17 | Advisory lock sem componente de tenant | `apps/api/src/modules/colonia/colonia.service.ts:79` |
| E18 | Escrita pública sem sessão na colônia | `apps/api/src/modules/colonia/colonia.controller.ts:49-58` |
| E19 | Voto por rota pública | `apps/api/src/modules/eventos/plenario.controller.ts:277`, `:314` |
| E20 | Front sem organização; API URL em build time | `apps/web/src/lib/auth.tsx:31-74`; `apps/web/src/lib/api.ts:3`; `.env.example:99` |
| E21 | Proteção de rota privada é client-side | `apps/web/src/middleware.ts:14-19`, `:40-43` |
| E22 | `packages/*` declarado mas inexistente | `package.json:6-9` (diretório ausente no repo) |
| E23 | Migrations aplicadas no boot | `apps/api/package.json:9` |
| E24 | Índices únicos parciais escritos à mão | `apps/api/prisma/migrations/20260702180000_colonia_indices_parciais/migration.sql:5`, `:10` |

### 6.2 Contagens → comando reproduzível

| Número citado | Comando |
|---|---|
| 24 módulos de domínio | `ls apps/api/src/modules` |
| 51 models · 44 enums | `grep -c "^model " apps/api/prisma/schema.prisma` · `grep -c "^enum " …` |
| 41 migrations | `ls apps/api/prisma/migrations \| wc -l` |
| ~27.650 ln na API | `find apps/api/src -name "*.ts" -exec cat {} + \| wc -l` |
| 51 injeções de Prisma | `grep -rn "prisma: PrismaService" apps/api/src --include=*.ts \| wc -l` |
| 43 `$transaction` | `grep -rc "\$transaction" apps/api/src --include=*.ts \| grep -v ":0"` |
| 6 upserts | `grep -rn "\.upsert(" apps/api/src --include=*.ts` |
| 9 sítios de SQL nativo em 5 arquivos | `grep -rn '\$queryRaw\|\$executeRaw' apps/api/src --include=*.ts` |
| 0 `$queryRawUnsafe` | `grep -rn "RawUnsafe" apps/api/src --include=*.ts` |
| 17 `@Public()` | `grep -rn "@Public()" apps/api/src --include=*.ts \| wc -l` |
| 43 `@Controller` | `grep -rn "@Controller(" apps/api/src --include=*.ts \| wc -l` |
| 8 controllers com `@Modulo` | `grep -rn "@Modulo(" apps/api/src --include=*.ts` |
| 5 arestas de DI entre domínios | `grep -rn "Module } from '\.\./" apps/api/src/modules/*/*.module.ts` |
| 0 eventos/filas/Redis | `grep -rni "EventEmitter\|@OnEvent\|bull\|redis\|ioredis" apps/api/src --include=*.ts` |
| 2 crons | `grep -rn "@Cron" apps/api/src --include=*.ts` |
| 0 Server Actions no front | `grep -rn "use server" apps/web/src` |
| 29 unicidades declaradas | `grep -n "@unique\|@@unique" apps/api/prisma/schema.prisma` |

### 6.3 Limites desta evidência

- Os números vêm de **análise estática**. Não houve execução da aplicação, acesso ao
  banco de produção nem inspeção do painel do Railway.
- O mapa de models por módulo foi extraído por padrão textual
  (`prisma|tx|db.<model>.<operação>`). Acessos construídos dinamicamente, se existirem,
  não aparecem.
- A classificação da §3 é **hipótese de leitura**, não decisão de modelagem.

---

## 7. Lacunas e incertezas

### 7.1 Dependem de decisão de negócio *(não há como responder lendo o código)*

| # | Pergunta | Por que bloqueia | Impacto se ficar em aberto |
|--:|---|---|---|
| N1 | **O que é um tenant?** Sindicato/entidade? | Define a coluna, a chave e o escopo de tudo | Bloqueia §3 inteira |
| N2 | **Um usuário pode pertencer a mais de um tenant?** (advogado que atende dois sindicatos) | Decide se `User` é `TENANT` ou `GLOBAL` + tabela de vínculo, e se o token carrega 1 ou N organizações | Bloqueia E7/E8 e o modelo de sessão |
| N3 | **A mesma `Empresa` (CNPJ) pode ser conveniada de dois sindicatos?** | Decide a forma da constraint e como o portal patronal resolve o login | Bloqueia §5.2 |
| N4 | **O mesmo `Processo` (numeroCNJ) pode ser acompanhado por dois tenants?** | Decide se o espelho do DataJud é compartilhado ou duplicado | Bloqueia `processos` (maior módulo) |
| N5 | **`ParteExterna`, `TipoAndamento`, `TipoCompromisso`, `Cargo`, `Departamento` são catálogo da plataforma ou de cada tenant?** | São os 5 `❓` restantes da §3 | Bloqueia 5 models |
| N6 | **Isolamento exigido por contrato/LGPD:** lógico basta, ou é preciso separação física? | É o critério que elimina modelos de tenancy | Bloqueia a etapa 02 |
| N7 | **Roteamento:** subdomínio, path, ou seleção pós-login? | Define como as rotas públicas (§5.3, §5.4) resolvem tenant | Bloqueia o front inteiro |
| N8 | **Migração:** o SENATEPI vira "tenant 1" da base atual, ou multi-tenant nasce em base nova? | Define se há backfill de 51 tabelas | Bloqueia o planejamento de execução |
| N9 | **Numeração (`matricula`, `Atendimento.numero`) reinicia por tenant ou continua global?** | Muda de `count()` para sequência por tenant — ou não muda | Bloqueia §4.4 |
| N10 | **Existe requisito de restore por cliente?** | Restore granular é requisito de modelo, não de implementação | Bloqueia §7.3-T5 |

### 7.2 Respondíveis inspecionando a codebase ou a infraestrutura

| # | Pergunta | Como responder | Custo |
|--:|---|---|---|
| C1 | Qual o destino do `fetch` em `modules/colaboradores/colaboradores.service.ts:497`? Envia dado pessoal? | Ler o método completo e o `.env` | Minutos |
| C2 | `STORAGE_DRIVER` efetivo em produção — `local` ou `s3`? | Painel do Railway / variáveis do serviço | Minutos |
| C3 | Quantas réplicas da API rodam hoje? | Painel do Railway | Minutos |
| C4 | Volume real por tabela em produção | `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 2 DESC` | Minutos |
| C5 | Versão do PostgreSQL e suporte a RLS no plano atual | `SELECT version()` | Minutos |
| C6 | Configuração de pool do Prisma (`connection_limit`, `pgbouncer`) na `DATABASE_URL` | Ler a variável em produção | Minutos |
| C7 | Existe algum acesso a Prisma construído dinamicamente que o grep não pegou? | Revisão dirigida dos 51 provedores | Horas |
| C8 | Cobertura real dos 4 `*.spec.ts` existentes | `npm test --workspace=@senatepi/api -- --coverage` | Minutos |
| C9 | Quais dos 43 controllers ficam sem `@Modulo` **e** sem `@Roles` (autorizados só por estar logado)? | Cruzar `@Controller` × `@Modulo` × `@Roles` | Uma hora |
| C10 | Há FK entre tabelas que atravessariam tenants (ex.: `Presenca` → `Colaborador`)? | Ler o grafo de relações do schema | Uma hora |
| C11 | Rotina de backup atual do Railway (frequência, retenção, granularidade) | Painel do Railway | Minutos |
| C12 | O `duplicidade.guard.ts` e a flag `FILIADOS_DUPLICIDADE` ainda estão ativos em produção? | Variável de ambiente | Minutos |

### 7.3 Riscos que exigem testes de caracterização

> *Teste de caracterização* = teste que registra o comportamento **atual** (mesmo que
> indesejado), para que uma refatoração grande possa provar que não o alterou.
> **O maior risco de execução deste projeto é a ausência de rede:** a API tem apenas
> **4 arquivos `*.spec.ts`** — `common/utils/busca.util.spec.ts`,
> `modules/dependentes/dependentes.regras.spec.ts`,
> `modules/filiados/duplicidade.service.spec.ts`,
> `modules/eventos/configuracoes-evento.spec.ts`.

| # | Risco | Por que precisa de caracterização antes | Sugestão de alvo |
|--:|---|---|---|
| T1 | **Filtro por tenant esquecido em algum dos 51 provedores** | Um `where` sem escopo não gera erro — devolve dado de outro cliente. Falha silenciosa | Teste de integração com 2 tenants semeados, varrendo cada rota de listagem e exigindo isolamento |
| T2 | **Os 9 sítios de SQL nativo** (§4.2) | Não passam por nenhuma abstração; qualquer filtro automático não os alcança. A agregação de carnês tem `GROUP BY`+`HAVING`+`FILTER` | Snapshot do resultado atual por cenário, especialmente `cobrancas.service.ts:350-395` |
| T3 | **Sorteio da colônia sob concorrência** | Depende de advisory lock + índices únicos parciais + transação. Comportamento sob corrida não está testado | Teste concorrente que prove: 1 reserva por CPF/temporada, sem vaga dupla |
| T4 | **Geração de matrícula sob concorrência** (§4.4) | `count()+1` sem transação já pode duplicar hoje; ninguém sabe se acontece | Teste de N criações paralelas verificando unicidade |
| T5 | **Fluxos públicos sem sessão** (§5.3, §5.4) | Recadastro, check-in, voto e reserva não têm login: são a maior superfície de vazamento cruzado | Caracterizar o comportamento atual de token expirado, uso duplo, slug inexistente e evento encerrado |
| T6 | **Importação em lote** (`importacao.service.ts`, 1.264 ln) | Roda síncrona na request, usa `count()` como sequência e escreve em 5 tabelas | Fixture de planilha real → snapshot do resultado |
| T7 | **Refresh token e revogação** | Rotação com hash + revogação em cascata; mudar a identidade do usuário mexe aqui | Caracterizar login → refresh → logout → reset |
| T8 | **Matriz de permissões** (`nivelEfetivo`) | Se o tenant for checado junto da permissão, herda a cobertura parcial de `@Modulo` (8 de 43 controllers) | Tabela-verdade 4 perfis × 13 módulos × 3 níveis |
| T9 | **Dossiê, certificado e carnê em PDF** | Documentos com valor de registro; embutem logo, PIX e assinatura vindos do singleton `ConfiguracaoSindicato` | Snapshot de bytes/estrutura do PDF gerado |

---

## Próximo documento

`02-MODELO_DE_TENANCY.md` — **ainda não iniciado**. Depende das respostas de N1, N2, N6
e N7 (§7.1). Este documento não escolhe modelo, não propõe migration e não altera schema.
