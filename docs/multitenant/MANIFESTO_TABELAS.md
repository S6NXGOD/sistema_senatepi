# Manifesto de tabelas — classificação multi-tenant

> **Fonte da verdade** sobre a classificação de cada model Prisma. Serve de entrada para o
> lint de schema em CI (doc 02 §12 mecanismo 5): **model novo sem entrada aqui quebra o
> build**.
>
> Baseado em [`00-DECISOES_APROVADAS.md`](./00-DECISOES_APROVADAS.md) (D1–D9, Q1–Q6) e em
> [`05-MIGRACAO_TENANT_1.md`](./05-MIGRACAO_TENANT_1.md), que é **autoridade** no conflito
> entre a estimativa de ~39 tabelas (doc 02) e a revisão de ~50 (doc 05).
>
> **Nada foi implementado.** Nenhum schema alterado, nenhuma migration criada.
>
> **Data:** 2026-08-02 · **Commit base:** `adc64d8` · **Schema:** `apps/api/prisma/schema.prisma`

---

## Números consolidados

| Classe | Qtd. | `tenant_id` | RLS |
|---|--:|:--:|:--:|
| **TENANT** — dado do sindicato | 35 | ✅ | ✅ |
| **AUDIT** — trilha e operação | 8 | ✅ | ✅ |
| **REL** — relacionamento | 5 | ✅ *(desnormalizado)* | ✅ |
| **GLOBAL** — identidade da pessoa | 3 | ❌ ¹ | ❌ |
| **PLATFORM** — tabelas novas do SaaS | 15 (novas) | ❌ | ❌ |
| **Total de models existentes** | **51** | **48** | **48** |

¹ `RefreshToken` recebe a coluna `tenant_id` como **dado** (tenant ativo da sessão), mas
**não** entra no RLS — pertence à zona de resolução (doc 03 §4.2).

> **Resolução do conflito de contagem.** Doc 02 estimou ~39; doc 05 corrigiu para ~50; com
> as decisões fechadas o número exato é **48**. O doc 05 estava certo na ordem de
> grandeza — a razão é que uma policy RLS não traversa relação com desempenho aceitável,
> então `tenant_id` precisa ser desnormalizado até em tabelas `REL` e `AUDIT`
> (doc 05 §1-A1).

---

## Legenda

**Classificação**
- `TENANT` — dado que pertence a um sindicato
- `AUDIT` — trilha, histórico ou registro de operação
- `REL` — tabela de relacionamento entre entidades
- `GLOBAL` — identidade da pessoa, atravessa tenants (D2)
- `PLATFORM` — tabela do SaaS, fora do escopo de tenant

**Backfill** (todos com `WHERE tenant_id IS NULL`, em lotes — doc 05 §5)
- `BLOCO` — atribuição direta do Tenant 1
- `DERIVA:<x>` — deriva de `<x>`; com um só tenant o resultado é o mesmo, mas a derivação
  é escrita porque é ela que valida consistência (§7 do doc 05) e serve ao onboarding
  futuro
- `ESPECIAL` — tratamento próprio, descrito nas observações

**RLS** — `✅` policy `USING` + `WITH CHECK` · `❌` acessada pelo papel de plataforma

---

## Tabela A — Classificação

| # | Model | Tabela | Classe | `tenant_id` | RLS | Módulo responsável |
|--:|---|---|:--:|:--:|:--:|---|
| 1 | `User` | `users` | **GLOBAL** | ❌ | ❌ | `usuarios` / `auth` |
| 2 | `RefreshToken` | `refresh_tokens` | **GLOBAL** | ⚠️ dado | ❌ | `auth` |
| 3 | `PasswordReset` | `password_resets` | **GLOBAL** | ❌ | ❌ | `auth` |
| 4 | `Filiado` | `filiados` | TENANT | ✅ | ✅ | `filiados` |
| 5 | `FiliadoHistorico` | `filiado_historico` | AUDIT | ✅ | ✅ | `filiados` |
| 6 | `VinculoProfissional` | `vinculos_profissionais` | TENANT | ✅ | ✅ | `filiados` |
| 7 | `Dependente` | `dependentes` | TENANT | ✅ | ✅ | `dependentes` |
| 8 | `LinkRecadastramento` | `links_recadastramento` | AUDIT | ✅ | ✅ | `recadastramento` |
| 9 | `Recadastramento` | `recadastramentos` | TENANT | ✅ | ✅ | `recadastramento` |
| 10 | `Carteirinha` | `carteirinhas` | TENANT | ✅ | ✅ | `carteirinhas` |
| 11 | `Documento` | `documentos` | TENANT | ✅ | ✅ | `filiados` / `colaboradores` |
| 12 | `Evento` | `eventos` | TENANT | ✅ | ✅ | `eventos` |
| 13 | `Presenca` | `presencas` | REL | ✅ | ✅ | `presencas` / `eventos` |
| 14 | `PautaVotacao` | `pautas_votacao` | TENANT | ✅ | ✅ | `eventos` |
| 15 | `VotoHabilitacao` | `votos_habilitacao` | REL | ✅ | ✅ | `eventos` |
| 16 | `VotoUrna` | `votos_urna` | TENANT | ✅ | ✅ | `eventos` |
| 17 | `SorteioEvento` | `sorteios_evento` | TENANT | ✅ | ✅ | `eventos` |
| 18 | `ColoniaTemporada` | `colonia_temporadas` | TENANT | ✅ | ✅ | `colonia` |
| 19 | `ColoniaLote` | `colonia_lotes` | TENANT | ✅ | ✅ | `colonia` |
| 20 | `ColoniaQuarto` | `colonia_quartos` | TENANT | ✅ | ✅ | `colonia` |
| 21 | `ColoniaReserva` | `colonia_reservas` | TENANT | ✅ | ✅ | `colonia` |
| 22 | `ColoniaSorteioInscricao` | `colonia_sorteio_inscricoes` | TENANT | ✅ | ✅ | `colonia` |
| 23 | `Departamento` | `departamentos` | TENANT | ✅ | ✅ | `colaboradores` |
| 24 | `Cargo` | `cargos` | TENANT | ✅ | ✅ | `colaboradores` |
| 25 | `Empresa` | `empresas` | TENANT | ✅ | ✅ | `empresas` |
| 26 | `Colaborador` | `colaboradores` | TENANT | ✅ | ✅ | `colaboradores` |
| 27 | `ColaboradorHistorico` | `colaborador_historico` | AUDIT | ✅ | ✅ | `colaboradores` |
| 28 | `ConfiguracaoSindicato` | `configuracao_sindicato` | TENANT | ✅ | ✅ | `cobrancas` |
| 29 | `Cobranca` | `cobrancas` | TENANT | ✅ | ✅ | `cobrancas` |
| 30 | `ParcelaCobranca` | `parcelas_cobranca` | TENANT | ✅ | ✅ | `cobrancas` |
| 31 | `ContaBancaria` | `contas_bancarias` | TENANT | ✅ | ✅ | `financeiro` |
| 32 | `Movimentacao` | `movimentacoes` | TENANT | ✅ | ✅ | `financeiro` |
| 33 | `Atendimento` | `atendimentos` | TENANT | ✅ | ✅ | `atendimentos` |
| 34 | `TipoCompromisso` | `tipos_evento` | TENANT | ✅ | ✅ | `agenda` |
| 35 | `Compromisso` | `compromissos` | TENANT | ✅ | ✅ | `agenda` |
| 36 | `CompromissoHistorico` | `compromissos_historico` | AUDIT | ✅ | ✅ | `agenda` |
| 37 | `EscalaAdvogado` | `escalas_advogados` | TENANT | ✅ | ✅ | `escalas` |
| 38 | `Processo` | `processos` | TENANT | ✅ | ✅ | `processos` |
| 39 | `ParteExterna` | `partes_externas` | TENANT | ✅ | ✅ | `processos` |
| 40 | `ParteProcesso` | `partes_processo` | REL | ✅ | ✅ | `processos` |
| 41 | `ProcessoAdvogado` | `processos_advogados` | REL | ✅ | ✅ | `processos` |
| 42 | `AnexoDocumento` | `anexos_documentos` | TENANT | ✅ | ✅ | `anexos` |
| 43 | `MovimentacaoProcessual` | `movimentacoes_processuais` | TENANT | ✅ | ✅ | `processos` |
| 44 | `LogSincronizacaoDatajud` | `logs_sincronizacao_datajud` | AUDIT | ✅ | ✅ | `processos` |
| 45 | `TipoAndamento` | `tipos_movimentacao` | TENANT | ✅ | ✅ | `processos` |
| 46 | `MovimentacaoInterna` | `movimentacoes_internas` | TENANT | ✅ | ✅ | `processos` |
| 47 | `ContribuicaoPatronal` | `contribuicoes_patronais` | TENANT | ✅ | ✅ | `empresas` / `portal-empresa` |
| 48 | `Auditoria` | `auditorias` | AUDIT | ✅ | ✅ | `auditoria` |
| 49 | `Importacao` | `importacoes` | AUDIT | ✅ | ✅ | `importacao` |
| 50 | `ImportacaoLinha` | `importacao_linhas` | AUDIT | ✅ | ✅ | `importacao` |
| 51 | `DuplicataDecisao` | `duplicata_decisao` | REL | ✅ | ✅ | `filiados` |

---

## Tabela B — Operação da migração

Índices listados são os **novos/alterados**; os existentes que já cobrem a coluna
permanecem. FK composta segue o padrão `(tenant_id, <fk>) → <pai> (tenant_id, id)`
(doc 05 §8.3).

| # | Model | Backfill | Unique alterada | Índices novos | FK composta | Observações |
|--:|---|---|---|---|---|---|
| 1 | `User` | — | **Nenhuma** — `email` e `username` seguem globais (D2) | — | — | 🔴 `role` e `permissoes` **saem** para `TenantMembership`. Toca 8+ arquivos |
| 2 | `RefreshToken` | ESPECIAL | — | `(user_id, revogado)` | — | Ganha `tenant_id` como **dado** (tenant ativo, G3). Fora do RLS. **Revogar todos na virada** (G4) |
| 3 | `PasswordReset` | ESPECIAL | — | — | — | Sem FK, ligada por e-mail. **Descartar expirados** e não migrar; TTL de 1h (`auth.service.ts:201`) |
| 4 | `Filiado` | BLOCO | `matricula` → `(t,matricula)`; `cpf` → `(t,cpf)` | `(t,situacao)`, `(t,cpf)` | `→ tenants` | Hub: 12 relações de saída. `qrToken` segue único global; HMAC ganha tenant |
| 5 | `FiliadoHistorico` | DERIVA:`filiado` | — | `(t,filiado_id)` | `→ filiados` | |
| 6 | `VinculoProfissional` | DERIVA:`filiado` | — | `(t,filiado_id)` | `→ filiados` | |
| 7 | `Dependente` | DERIVA:`filiado` | — | `(t,filiado_id)` | `→ filiados` | `qrToken` global; HMAC ganha tenant |
| 8 | `LinkRecadastramento` | DERIVA:`filiado` | — | `(t,filiado_id)`, `(t,expira_em)` | `→ filiados` | Zona de resolução: lido por `prismaPlataforma` antes do contexto |
| 9 | `Recadastramento` | DERIVA:`filiado` | — | `(t,status)` | `→ filiados` | `revisorId` → FK composta via **membership** (D2) |
| 10 | `Carteirinha` | DERIVA:`filiado` | `numero` → `(t,numero)` | `(t,filiado_id)` | `→ filiados` | Numeração por tenant (P7) |
| 11 | `Documento` | DERIVA:`filiado`\|`colaborador` | — | `(t,filiado_id)`, `(t,tipo)` | `→ filiados`, `→ colaboradores` | ⚠️ **Ambas as FKs são opcionais** — pode ter as duas nulas. Backfill em BLOCO como rede |
| 12 | `Evento` | BLOCO | — | `(t,status)`, `(t,data_inicio)` | `→ tenants` | Zona de resolução (rota `sala/:eventoId`) |
| 13 | `Presenca` | DERIVA:`evento` | — | `(t,evento_id)` | `→ eventos` | ⚠️ `filiadoId`/`dependenteId`/`colaboradorId` são `SetNull`; só `evento` é obrigatório. `presencaId` é **credencial de sessão** pública |
| 14 | `PautaVotacao` | DERIVA:`evento` | — | `(t,evento_id,ordem)` | `→ eventos` | |
| 15 | `VotoHabilitacao` | DERIVA:`pauta` | — | `(t,pauta_id)` | `→ pautas_votacao` | |
| 16 | `VotoUrna` | DERIVA:`pauta` | — | `(t,pauta_id)` | `→ pautas_votacao` | Voto desacoplado do eleitor — **não** relacionar a filiado |
| 17 | `SorteioEvento` | DERIVA:`evento` | — | `(t,evento_id)` | `→ eventos` | |
| 18 | `ColoniaTemporada` | BLOCO | `slug` → `(t,slug)` | `(t,status)` | `→ tenants` | Zona de resolução (rota pública por slug) |
| 19 | `ColoniaLote` | DERIVA:`temporada` | `(temporadaId,numero)` já escopada | `(t,temporada_id)` | `→ colonia_temporadas` | |
| 20 | `ColoniaQuarto` | DERIVA:`lote` | `numero` → `(t,numero)` | `(t,lote_id)` | `→ colonia_lotes` | |
| 21 | `ColoniaReserva` | DERIVA:`temporada` | — | `(t,temporada_id)`, `(t,status)` | `→ colonia_temporadas`, `→ colonia_lotes` | 🔴 Índices únicos **parciais** manuais precisam incluir `tenant_id` (`20260702180000_colonia_indices_parciais`) |
| 22 | `ColoniaSorteioInscricao` | DERIVA:`temporada` | — | `(t,temporada_id)`, `(t,status)` | `→ colonia_temporadas` | Idem índices parciais |
| 23 | `Departamento` | BLOCO | `nome` → `(t,nome)` | `(t)` | `→ tenants` | D5 |
| 24 | `Cargo` | BLOCO | `nome` → `(t,nome)` | `(t)` | `→ tenants` | D5 |
| 25 | `Empresa` | BLOCO | `cnpj` → `(t,cnpj)` | `(t,razao_social)` | `→ tenants` | D3. Zona de resolução (login patronal). `senhaHash` por tenant |
| 26 | `Colaborador` | BLOCO | `cpf` → `(t,cpf)`; `matricula` → `(t,matricula)` | `(t,status)` | `→ tenants`, `→ cargos`, `→ departamentos`, `→ empresas` | `qrToken` global; HMAC ganha tenant |
| 27 | `ColaboradorHistorico` | DERIVA:`colaborador` | — | `(t,colaborador_id)` | `→ colaboradores` | |
| 28 | `ConfiguracaoSindicato` | ESPECIAL | — | `(t)` **UNIQUE** — 1 por tenant | `→ tenants` | 🔴 Registro **único** hoje (`findFirst`, `cobrancas.service.ts:749`). Recebe o tenant do T1, **não é recriado** — preserva PIX e assinatura |
| 29 | `Cobranca` | DERIVA:`filiado` | — | `(t,filiado_id)` | `→ filiados` | |
| 30 | `ParcelaCobranca` | DERIVA:`cobranca` | — | `(t,status)`, `(t,cobranca_id)` | `→ cobrancas` | Alvo do SQL nativo de agregação (`cobrancas.service.ts:373`) |
| 31 | `ContaBancaria` | BLOCO | — | `(t)` | `→ tenants` | |
| 32 | `Movimentacao` | DERIVA:`conta` | — | `(t,data)`, `(t,tipo)` | `→ contas_bancarias` | `onDelete: Restrict` na conta — preservar |
| 33 | `Atendimento` | DERIVA:`filiado` | `numero` (autoincrement) → `(t,numero)` | `(t,status)`, `(t,created_at)` | `→ filiados`, `→ processos` | 🔴 **Sequência global** vira contador por tenant (P7). Não usar `count()` |
| 34 | `TipoCompromisso` | BLOCO | `slug` → `(t,slug)` | `(t,ativo)` | `→ tenants` | D5. Registros `sistema=true` **semeados por tenant** (G5) |
| 35 | `Compromisso` | ESPECIAL | `origemCompromissoId` 1:1 mantida | `(t,status)`, `(t,inicio)`, `(t,responsavel_id)` | `→ filiados`, `→ atendimentos`, `→ processos`; `responsavelId`/`criadoPor` → **membership** | ⚠️ **Todas** as relações são `SetNull` — pode não ter âncora. Backfill em BLOCO |
| 36 | `CompromissoHistorico` | DERIVA:`compromisso` | — | `(t,compromisso_id,created_at)` | `→ compromissos`; `autorId` → membership | |
| 37 | `EscalaAdvogado` | ESPECIAL | — | `(t,data)`, `(t,advogado_id)` | `advogadoId` → **membership** | Só se relaciona a `User` — deriva do membership, não de tabela de tenant |
| 38 | `Processo` | BLOCO | `numeroCNJ` → `(t,numeroCNJ)` | `(t,status_interno)`, `(t,tribunal)` | `→ filiados`; `advogadoId` → membership | D4. ⚠️ `filiadoId` é `SetNull` — pode não ter filiado |
| 39 | `ParteExterna` | BLOCO | — | `(t,tipo)`, `(t,ativo)` | `→ tenants` | D5 — duplicada por tenant. Dado do DataJud, recriável |
| 40 | `ParteProcesso` | DERIVA:`processo` | — | `(t,processo_id,polo)` | `→ processos`, `→ filiados`, `→ partes_externas` | |
| 41 | `ProcessoAdvogado` | DERIVA:`processo` | — | `(t,advogado_id)` | `→ processos`; `advogadoId` → **membership** | |
| 42 | `AnexoDocumento` | DERIVA:`atendimento`\|`processo`\|`compromisso` | — | `(t,processo_id)`, `(t,storage_key)` | `→ atendimentos`, `→ processos`, `→ compromissos` | 🔴 `resolverAlvo` (`anexos.service.ts:381-420`) confia em ID vindo do DTO. Chave de storage ganha prefixo `tenants/<id>/` |
| 43 | `MovimentacaoProcessual` | DERIVA:`processo` | — | `(t,processo_id)`, `(t,eh_audiencia,dispensado_em)` | `→ processos` | Espelho recriável do DataJud |
| 44 | `LogSincronizacaoDatajud` | DERIVA:`processo` | — | `(t,created_at)`, `(t,sucesso,created_at)` | `→ processos` | ⚠️ `processoId` é `SetNull` — órfão legítimo |
| 45 | `TipoAndamento` | BLOCO | `slug` → `(t,slug)` | `(t,ativo)` | `→ tenants` | **D5 resolvido: TENANT.** `sistema Boolean` + cadastrável (`schema.prisma:2022,2040`). Seeds por tenant (G5) |
| 46 | `MovimentacaoInterna` | DERIVA:`processo` | — | `(t,processo_id,created_at)` | `→ processos`; `autorId` → membership | Conteúdo do escritório — **não** é recriável |
| 47 | `ContribuicaoPatronal` | DERIVA:`empresa` | — | `(t,empresa_id,mes_referencia)`, `(t,status)` | `→ empresas`; `analisadoPor` → membership | |
| 48 | `Auditoria` | BLOCO | — | `(t,created_at)`, `(t,acao)` | `→ tenants`; `userId` → membership *(nullable)* | ⚠️ `userId` é `SetNull` — órfão legítimo. **Não truncar**: registro legal |
| 49 | `Importacao` | BLOCO | — | `(t,status)`, `(t,created_at)` | `→ tenants` | |
| 50 | `ImportacaoLinha` | DERIVA:`importacao` | — | `(t,importacao_id,valido)` | `→ importacoes` | |
| 51 | `DuplicataDecisao` | DERIVA:`filiadoA` | `(filiadoIdA,filiadoIdB)` → `(t,A,B)` | `(t,filiado_id_a)` | `→ filiados` (ambos os lados) | 🔴 Alimenta `duplicidade.service.ts`, que **funde e exclui filiados**. FK composta nos **dois** lados é obrigatória |

---

## Tabelas novas — PLATFORM e TENANT

Nascem com a migração. **Nenhuma PLATFORM recebe `tenant_id` nem RLS**; são acessíveis só
pelo papel `senatepi_platform` (doc 03 §4.1).

| Model | Tabela | Classe | RLS | Origem | Papel |
|---|---|:--:|:--:|:--:|---|
| `Tenant` | `tenants` | PLATFORM | ❌ | doc 03 §10 | Raiz |
| `TenantMembership` | `tenant_memberships` | PLATFORM ¹ | ❌ | **D2** | `userId`+`tenantId`+`role`+`permissoes`+`status` |
| `TenantDominio` | `tenant_dominios` | PLATFORM | ❌ | D7/Q5 | Subdomínio na v1 |
| `TenantBranding` | `tenant_branding` | PLATFORM | ❌ | Q4 | Tema, logo, favicon |
| `Modulo` | `modulos` | PLATFORM | ❌ | Q2 | Catálogo global (13 chaves atuais) |
| `TenantModulo` | `tenant_modulos` | PLATFORM | ❌ | Q2 | Contratação |
| `Plano` | `planos` | PLATFORM | ❌ | Q1/Q6 | Limites e módulos inclusos |
| `TenantAssinatura` | `tenant_assinaturas` | PLATFORM | ❌ | Q3 | Contrato e status comercial |
| `TenantUso` | `tenant_uso` | PLATFORM | ❌ | D4/D1 | Medição; inclui NPU repetido (R8) |
| `OperadorPlataforma` | `operadores_plataforma` | PLATFORM | ❌ | **D9** | Identidade separada de `User` |
| `AcessoAssistido` | `acessos_assistidos` | PLATFORM | ❌ | **D9** | Motivo, autorização, prazo |
| `AuditoriaPlataforma` | `auditoria_plataforma` | PLATFORM | ❌ | D9 | Trilha do SaaS, separada |
| `TenantProvisionamento` | `tenant_provisionamento` | PLATFORM | ❌ | doc 05 §17.3 | Onboarding |
| `TenantBackup` | `tenant_backups` | PLATFORM | ❌ | D8 | Estrutura na v1, uso pleno depois |
| `MigracaoTenantLog` | `migracao_tenant_log` | PLATFORM | ❌ | doc 05 §12.3 | Retomada e auditoria da migração |
| `CampoPersonalizado` | `campos_personalizados` | **TENANT** | ✅ | Q1/Q6 | Definição; escrita só pelo backoffice |

¹ `TenantMembership` é PLATFORM por ficar **fora do RLS** — precisa ser lida na zona de
resolução, antes de haver contexto. É a exceção mais importante do manifesto.

**Valores em JSONB** (doc 04 §2.3), não são tabelas novas:
`Filiado.camposPersonalizados`, `Colaborador.camposPersonalizados`,
`Empresa.camposPersonalizados`, `Dependente.camposPersonalizados` — todos
`Json @default("{}")`.

---

## Unicidades: 14 viram compostas

**Correção registrada:** o doc 01 §4.6 afirma **17** unicidades colidentes; a contagem das
linhas marcadas "Sim" é **16**. Com D2 (`User.email` e `User.username` seguem globais), as
que efetivamente viram compostas são **14**.

| # | Model | Campo | Vira |
|--:|---|---|---|
| 1 | `Filiado` | `matricula` | `(tenant_id, matricula)` |
| 2 | `Filiado` | `cpf` | `(tenant_id, cpf)` |
| 3 | `Colaborador` | `cpf` | `(tenant_id, cpf)` |
| 4 | `Colaborador` | `matricula` | `(tenant_id, matricula)` |
| 5 | `Empresa` | `cnpj` | `(tenant_id, cnpj)` — D3 |
| 6 | `Carteirinha` | `numero` | `(tenant_id, numero)` |
| 7 | `Atendimento` | `numero` | `(tenant_id, numero)` — + contador por tenant |
| 8 | `Processo` | `numeroCNJ` | `(tenant_id, numero_cnj)` — D4 |
| 9 | `ColoniaTemporada` | `slug` | `(tenant_id, slug)` |
| 10 | `ColoniaQuarto` | `numero` | `(tenant_id, numero)` |
| 11 | `TipoCompromisso` | `slug` | `(tenant_id, slug)` — D5 |
| 12 | `TipoAndamento` | `slug` | `(tenant_id, slug)` — D5 |
| 13 | `Departamento` | `nome` | `(tenant_id, nome)` |
| 14 | `Cargo` | `nome` | `(tenant_id, nome)` |

**Permanecem globais:** `User.email`, `User.username` (D2) · `Filiado.qrToken`,
`Dependente.qrToken`, `Colaborador.qrToken` (UUID; o **HMAC** é que ganha o tenant —
doc 06 §8) · `LinkRecadastramento.tokenHash` (hash) · as 1:1 (`Carteirinha.filiadoId`,
`ParcelaCobranca.movimentacaoId`, `ContribuicaoPatronal.movimentacaoId`,
`Compromisso.origemCompromissoId`).

**Ordem obrigatória:** criar a composta **antes** de derrubar a simples (doc 05 §9.2).

---

## Órfãos legítimos — não "corrigir"

Relações `SetNull` que produzem linhas sem pai **por desenho**. Uma limpeza de órfãos
ingênua destruiria trilha de auditoria e histórico de assembleia.

| Tabela | Coluna | Por quê |
|---|---|---|
| `auditorias` | `user_id` | Usuário excluído; a trilha sobrevive |
| `presencas` | `filiado_id`, `dependente_id`, `colaborador_id` | Presença sem vínculo resolvido |
| `processos` | `filiado_id`, `advogado_id` | Processo em rascunho ou sem parte |
| `compromissos` | **todas** | Compromisso avulso |
| `logs_sincronizacao_datajud` | `processo_id` | Log de tentativa em processo removido |
| `documentos` | `filiado_id` **e** `colaborador_id` | Ambas opcionais |
| `recadastramentos` | `revisor_id` | Revisor desligado |
| `vinculos_profissionais` | `parte_externa_id` | — |

---

## Como manter este manifesto vivo

1. **Lint em CI:** model no `schema.prisma` sem entrada aqui → **build quebra**
   (doc 02 §12 mecanismo 5).
2. **Coerência automática:** entrada `TENANT`/`AUDIT`/`REL` sem `tenant_id`, sem índice ou
   sem policy → build quebra.
3. **`CODEOWNERS`** em `schema.prisma` e neste arquivo — alteração exige revisão.
4. **Fonte legível por máquina:** o CI lê a Tabela A; considerar espelhá-la em
   `manifesto-tabelas.json` para não parsear Markdown.

---

## Referências

[`00-DECISOES_APROVADAS.md`](./00-DECISOES_APROVADAS.md) ·
[`01-ARQUITETURA_ATUAL.md`](./01-ARQUITETURA_ATUAL.md) ·
[`05-MIGRACAO_TENANT_1.md`](./05-MIGRACAO_TENANT_1.md) *(autoridade em contagem)* ·
[`06-CHECKLIST_SEGURANCA.md`](./06-CHECKLIST_SEGURANCA.md)
