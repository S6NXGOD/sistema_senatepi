# Multi-tenant — SENATEPI → SaaS

Série de documentos de análise e planejamento para converter o sistema atual
(single-tenant, em produção com um sindicato real) em SaaS multi-tenant.

> **Estado geral: planejamento. Nenhuma linha de código, schema ou migration foi
> alterada.** Todos os documentos são de leitura e decisão.
>
> **Commit base de toda a análise:** `adc64d8` (branch `main`) · **Data:** 2026-08-02

---

## Documentos

| # | Documento | Conteúdo | Status |
|--:|---|---|---|
| 01 | [Arquitetura atual](./01-ARQUITETURA_ATUAL.md) | Inventário auditável: 24 módulos, 51 models, pontos de acesso ao Prisma, entradas de tenant, evidências | ✅ Aprovado |
| 02 | [Modelo de tenancy](./02-MODELO_DE_TENANCY.md) | Comparação A–E, recomendação, riscos, transição expand-and-contract | ⏳ Aguardando revisão |
| 03 | [Tenant Context](./03-TENANT_CONTEXT.md) | Identificação na entrada, propagação, zona de resolução, casos de falha | ⏳ Aguardando revisão |
| 04 | [Personalização por tenant](./04-PERSONALIZACAO_POR_TENANT.md) | Campos personalizados (JSONB × EAV), feature toggles, white-label | ⏳ Aguardando revisão |
| 05 | [Migração do Tenant 1](./05-MIGRACAO_TENANT_1.md) | Estratégia de migração sem perda de dados, backoffice de tenants | ⏳ Aguardando revisão |
| 06 | [Checklist de segurança](./06-CHECKLIST_SEGURANCA.md) | Checklist operacional anti-vazamento + mapa de risco | ⏳ Aguardando revisão |

**Próximo:** `07-PLANO_DE_EXECUCAO.md` — só faz sentido depois das decisões abaixo e dos
spikes S-1/S-2.

---

## Decisão tomada

**Modelo de isolamento:** banco compartilhado com `tenant_id` + **PostgreSQL Row Level
Security**, com a resolução de conexão desenhada desde o início para mover um tenant a
banco dedicado sob demanda (doc 02 §6).

O que decide, em uma frase: **é o único modelo em que esquecer o tenant produz zero linhas
em vez de linhas de outro sindicato** — e, com 4 arquivos de teste em ~27.650 linhas, essa
diferença é a única garantia que não depende de vigilância humana.

---

## Decisões de negócio ainda abertas

Bloqueiam a escrita das migrations e o documento 07.

| # | Pergunta | Bloqueia |
|--:|---|---|
| **D1** | Quantos sindicatos a plataforma pretende atender — unidades, dezenas, centenas? | Única decisão capaz de inverter o modelo escolhido (doc 02 §5-D) |
| **D2** | `User` é do tenant ou global com tabela de vínculo? | Modelo de sessão, claim do token, seletor de organização (docs 02, 03, 05) |
| **D3** | A mesma `Empresa` (CNPJ) pode ser conveniada de dois sindicatos? | Login do portal patronal |
| **D4** | O mesmo `Processo` (numeroCNJ) pode ser acompanhado por dois tenants? | Maior módulo do sistema (5.571 ln) |
| **D5** | Quais catálogos são globais? (`ParteExterna`, `TipoAndamento`, `TipoCompromisso`, `Cargo`, `Departamento`) | 5 tabelas sem classe definida |
| **D6** | Isolamento contratual/LGPD: lógico basta ou exige separação física? | Pode transformar o modelo em banco dedicado |
| **D7** | Roteamento: subdomínio, path ou seletor pós-login? | Rotas públicas, CORS, build do front |
| **D8** | Restore por cliente é requisito contratual? | Ferramenta própria no modelo compartilhado |
| **D9** | Existe papel de operador da plataforma (suporte, cobrança)? | Policy de bypass e trilha de auditoria própria |

**D1, D2, D6 e D7 são as que travam tudo.**

---

## Perguntas técnicas sem resposta

Respondíveis por inspeção — nenhuma exige decisão de negócio.

| # | Pergunta | Onde responder |
|--:|---|---|
| C2 | `STORAGE_DRIVER` efetivo em produção (`local` ou `s3`)? | Painel do Railway |
| C3 | Quantas réplicas da API e qual o timeout de health check? | Painel do Railway |
| C4 | Volume real por tabela | `pg_stat_user_tables` |
| C5 | Versão do PostgreSQL e suporte a RLS no plano atual | `SELECT version()` |
| B5 | O Prisma aceita `CREATE INDEX CONCURRENTLY`? (ele envolve migrations em transação) | Ensaio em cópia |
| B6 | É permitido copiar dado real para ambiente de ensaio? | Jurídico / LGPD |

---

## Spikes bloqueantes

Sem eles, o desenho do doc 03 §5 é hipótese, não projeto.

| # | Spike | Pergunta |
|--:|---|---|
| **S-1** | RLS + Prisma 5.22 com 2 tenants | O padrão `$transaction` + `set_config(…, true)` isola de fato? Qual o custo em latência? |
| **S-2** | `$extends` dentro de `$transaction` | A extensão do client raiz permanece ativa no `tx`? |

---

## Achados que mudaram o plano no caminho

Registrados aqui porque contradizem suposições naturais e valem para quem entrar depois.

1. **O Prisma não aceita `tenantId` no `where` de `findUnique`.** São 22 chamadas em 13
   arquivos sobre campos únicos simples (`cpf`, `email`, `cnpj`, `slug`, `numeroCNJ`).
   Converter as 17 unicidades em compostas não é otimização — é pré-requisito. (doc 02 R-1)
2. **O Prisma não permite transação aninhada.** O tipo do `tx` remove `$transaction` e
   `$extends`. Isso colide com os 43 `$transaction` existentes e é o custo real do RLS.
   (doc 02 R-2)
3. **Sob RLS, ~50 das 51 tabelas precisam da coluna — não ~39.** Policy não traversa
   relação com desempenho aceitável; `tenant_id` precisa ser desnormalizado até em tabelas
   de relacionamento. (doc 05 A1)
4. **Migration e deploy estão acoplados.** `apps/api/package.json:9` roda
   `prisma migrate deploy` dentro do `start`. Toda migration é obrigatoriamente compatível
   com a versão anterior da aplicação. (doc 05 A3)
5. **O ALS não pode ser aberto num Guard** — `run()` precisa envolver a execução seguinte,
   e Guard devolve `boolean`. Middleware abre, Guard preenche. (doc 03 §3.1)
6. **Existe um problema de ovo e galinha na autenticação:** para saber o tenant de um
   login é preciso consultar `users`, mas consultar `users` sob RLS exige saber o tenant.
   Resolvido por uma zona de 12 consultas explicitamente isentas. (doc 03 §4)
7. **815 usos de `senatepi-*` em 107 arquivos** no front. O custo do white-label está aí,
   não no upload do logo. (doc 04 F2)
8. **174 buscas por `id` cru em 43 arquivos** — a superfície de IDOR que o multi-tenant
   abre de uma vez. (doc 06 §0)
9. **Uploads locais são servidos sem autenticação** em `/uploads/`, com URL permanente.
   **Já é um problema hoje**, com um cliente só. (doc 06 §14.1)

---

## Como ler esta série

- **Decisor de produto:** README → doc 02 §6 (recomendação) → decisões abertas acima.
- **Quem vai implementar:** 01 (inventário) → 02 (modelo) → 03 (contexto) → 05 (migração)
  → 06 (checklist).
- **Quem vai revisar segurança:** 06, depois 03 §4 e §6.
- **Quem entrou agora no projeto:** 01, e os 9 achados acima.
