# 04 — Personalização por tenant: campos, módulos e white-label

> **Escopo.** Proposta técnica para três requisitos de produto SaaS — campos
> personalizados, feature toggles por tenant e white-label — ancorada na stack real
> ([`01`](./01-ARQUITETURA_ATUAL.md)) e no modelo de isolamento escolhido
> ([`02`](./02-MODELO_DE_TENANCY.md), [`03`](./03-TENANT_CONTEXT.md)).
> **Nenhum código foi alterado.** Para inclusão no plano.
>
> **Data:** 2026-08-02 · **Commit base:** `adc64d8` · **Status:** aguardando revisão

---

## Sumário

1. [O que a codebase já oferece](#1-o-que-a-codebase-já-oferece)
2. [Parte 1 — Campos personalizados por tenant](#2-parte-1--campos-personalizados-por-tenant)
3. [Parte 2 — Feature toggles e módulos](#3-parte-2--feature-toggles-e-módulos)
4. [Parte 3 — White-label](#4-parte-3--white-label)
5. [Estruturas de dados propostas](#5-estruturas-de-dados-propostas)
6. [Arquivos afetados](#6-arquivos-afetados)
7. [Testes propostos](#7-testes-propostos)
8. [Riscos e pendências](#8-riscos-e-pendências)

---

## 1. O que a codebase já oferece

Os três requisitos **não partem do zero**. Cada um tem um precedente funcionando em
produção, e a proposta é estendê-lo — não inventar mecanismo paralelo.

| Requisito | Precedente existente | Onde |
|---|---|---|
| **Campos personalizados** | `configuracoes-evento.ts` — JSON tipado com parser, padrões, normalização e **teste** | `modules/eventos/configuracoes-evento.ts` + `.spec.ts` |
| | 22 colunas `Json` já em uso no schema | `schema.prisma` (linhas 236, 399, 499, 587, …) |
| | Validação cruzada por regra de negócio | `common/validators/coren.validator.ts` |
| | Índices únicos **parciais** escritos à mão em migration | `migrations/20260702180000_colonia_indices_parciais/` |
| **Feature toggles** | Catálogo de **13 módulos** + matriz perfil × módulo | `common/permissions/permissoes.constants.ts` |
| | Gating de backend por `@Modulo` + `PermissionsGuard` | `common/permissions/permissions.guard.ts` |
| | Gating de navegação no front (`filtrarNav`) | `apps/web/src/components/nav-items.ts:84-94` |
| | **Feature flag real, com semântica de 404** | `modules/filiados/duplicidade.guard.ts` |
| **White-label** | `ConfiguracaoSindicato` — logo, assinatura, rodapé, PIX | `schema.prisma:1291-1304` |
| | Sistema de variáveis CSS (shadcn) já instalado | `apps/web/src/app/globals.css:5-35` |
| | Cache de asset para PDF | `common/assets.util.ts` |

### 1.1 Três fatos que restringem as soluções

**F1 — A duplicação manual front/back já existe e já é frágil.**
`apps/web/src/lib/permissoes.ts:1-2` abre com o comentário *"Mantém em sincronia com
apps/api/src/common/permissions/permissoes.constants.ts"*. São 13 módulos, 4 perfis e a
função `nivelEfetivo` **escritos duas vezes**. E `package.json:6-9` declara
`workspaces: ["apps/*", "packages/*"]` — mas **`packages/` não existe**. Qualquer coisa
que precise ser conhecida pelos dois lados (tipos de campo, máscaras, catálogo de
módulos) vai triplicar essa dívida, a menos que `packages/` seja finalmente criado.

**F2 — A marca está espalhada em 815 lugares no front.**
`grep -ro "senatepi-[0-9]\+" apps/web/src` → **815 ocorrências em 107 arquivos**. É a
paleta Tailwind literal (`bg-senatepi-800`, `text-senatepi-600`), definida com hex fixo em
`tailwind.config.ts`. Cor de marca resolvida em **build time** não é personalizável em
runtime. Esse número é o custo real do white-label — não o upload do logo.

**F3 — Cinco geradores de PDF embutem o logo por nome de arquivo.**
`lerAsset('senatepi-horizontal-branco.png')` aparece em `carteirinhas.module.ts:190`,
`colaboradores.service.ts:436`, `certificado.service.ts:124`,
`dossie-evento.service.ts:161` e `filiados.service.ts:844`. São documentos com valor de
registro — carteirinha, crachá, certificado, dossiê de assembleia.

---

## 2. Parte 1 — Campos personalizados por tenant

### 2.1 O problema, no concreto deste sistema

O exemplo do requisito **já está resolvido em código, para um vertical só**:

| Campo | Onde está hoje | Para quem serve |
|---|---|---|
| `numeroCoren` | `Filiado` — coluna de primeira classe (`schema.prisma:321`) | Enfermagem |
| `formacao` / `formacaoOutro` | `Filiado` — enum `FormacaoProfissional` | Enfermagem |
| `oab` / `oabUf` | `User` (`schema.prisma:232-233`) | Advogados da equipe |

Ou seja: o sistema tem hoje **campos de conselho profissional cravados no schema**. Um
sindicato de professores precisa de registro no MEC; um de engenheiros, de CREA; um de
comerciários, de nada disso. Multi-tenant significa que **acrescentar um campo não pode
exigir uma migration**.

E há um detalhe que elimina soluções ingênuas: o COREN **não é um campo isolado**. Sua
validação depende de outro campo — `coren.validator.ts:33-40` exige que o sufixo
(`ENF`/`TE`/`AE`) corresponda à `formacao` selecionada. Qualquer motor de campos
personalizados precisa suportar **validação que enxerga o objeto inteiro**, não só o
próprio valor.

### 2.2 Comparação JSONB × EAV

Legenda: `++` claramente melhor · `+` melhor · `~` empate/condicional · `−` pior.

| Aspecto | **JSONB** (valor em coluna `Json`) | **EAV** (tabela valor-a-valor) | Vence |
|---|---|---|:--:|
| **Definição dos campos** | Tabela relacional `CampoPersonalizado` — idêntica nos dois modelos | Idem | `~` |
| **Armazenamento** | 1 coluna na entidade; leitura sem join | 1 linha por campo por registro; N linhas por filiado | **JSONB** `++` |
| **Validação** | Parser tipado no padrão de `configuracoes-evento.ts`; acesso ao objeto inteiro (resolve o caso COREN×formação) | Igual, mas o valor chega solto — validação cruzada exige recompor o objeto | **JSONB** `+` |
| **Máscaras** | String de máscara na definição, aplicada no front e reconferida no back | Idem | `~` |
| **Obrigatoriedade** | `NOT NULL` impossível; validada na aplicação | Também na aplicação (a linha pode simplesmente não existir) | `~` |
| **Pesquisa / filtro** | `WHERE dados->>'crea' = $1`; Prisma suporta `path`/`equals`/`string_contains` | `JOIN` + `WHERE atributo=… AND valor=…`; N filtros = N joins | **JSONB** `+` |
| **Indexação** | GIN no documento + B-tree de expressão nos campos quentes — **migration SQL manual** | B-tree comum `(tenant_id, campo_id, valor)` | **EAV** `+` |
| **Unicidade por campo** | Índice único de expressão `((dados->>'crea'))` — SQL manual, o Prisma não modela | `@@unique([tenantId, campoId, valor])` — declarativo | **EAV** `++` |
| **Relatórios / ordenação** | `ORDER BY dados->>'x'` funciona; agregação exige cast explícito | Tipagem por coluna (`valor_texto`, `valor_num`, `valor_data`) facilita agregação | **EAV** `+` |
| **Manutenção** | Um lugar para ler; risco de lixo acumulado (mitigado pelo normalizador) | Mais tabelas, mais joins, migração de tipo mais trabalhosa | **JSONB** `+` |
| **Impacto no código atual** | 1 coluna nova por entidade; `include` não muda; **os 9 SQLs nativos não quebram** | `Filiado` ganha mais uma relação; **`duplicidade.service.ts` e `cobrancas.service.ts:373` teriam de considerar joins novos** | **JSONB** `++` |
| **Interação com RLS** (doc 02) | Nenhuma tabela nova → nenhuma policy nova | Tabela nova → policy nova + join sob RLS em toda leitura | **JSONB** `+` |
| **Idioma da codebase** | **22 colunas `Json` já em uso**; parser tipado já é padrão testado | Nenhum precedente EAV no projeto | **JSONB** `++` |

### 2.3 Recomendação: JSONB para valores, tabela relacional para definição

> **Definição relacional + valores em JSONB + parser tipado.** Não é "JSONB puro" (que
> aceita qualquer coisa) nem EAV.

**Os três motivos que decidem, ancorados no projeto:**

**M1 — EAV colidiria com o SQL nativo que já existe.** `Filiado` é o hub
([01 §10](./01-ARQUITETURA_ATUAL.md)) e é alvo de duas queries nativas de detecção de
duplicidade (`duplicidade.service.ts:185`, `:220`) e da agregação de carnês
(`cobrancas.service.ts:373`), que já faz `GROUP BY`+`HAVING`+`COUNT FILTER` sobre
`filiados`. Somar joins EAV a essas queries é acrescentar complexidade exatamente onde
ela já está no limite — e onde não há teste (doc 01 T2).

**M2 — JSONB não cria tabela nova, e tabela nova sob RLS custa caro.** No modelo do doc
02, cada tabela precisa de `tenant_id`, policy, índice e verificação em CI. Uma coluna
`Json` na entidade que já tem tudo isso herda o isolamento **de graça**. EAV
acrescentaria uma tabela de altíssimo volume (N campos × M filiados) com policy própria e
join sob RLS em toda leitura de filiado.

**M3 — O padrão já existe, testado.** `configuracoes-evento.ts` resolve exatamente o
problema de "coluna JSON aceita qualquer coisa": parser que aplica padrões, descarta o
desconhecido e **nunca lança**. Tem `.spec.ts`. Reusar um padrão testado num projeto com
4 arquivos de teste vale mais que a elegância teórica do EAV.

**O que se perde, e como compensar** — sem isso a recomendação seria desonesta:

| Perda | Compensação |
|---|---|
| Unicidade declarativa por campo | Índice único de **expressão** em migration SQL manual. O projeto **já faz isso** para índices parciais (`20260702180000_colonia_indices_parciais`) |
| Tipagem forte no banco | Parser tipado na borda + `tipo` na definição; o banco guarda texto/número/booleano JSON |
| Agregação numérica direta | Cast explícito (`(dados->>'x')::numeric`) ou promoção a coluna real (abaixo) |

**Válvula de escape — promoção a coluna real.** Quando um campo personalizado deixa de
ser de um tenant e vira universal, ele **gradua**: migration cria a coluna, backfill move
o valor do JSONB, o parser passa a lê-la. É o caminho inverso do que aconteceu com
`numeroCoren` — e precisa estar documentado desde o início, ou o JSONB vira depósito
permanente.

### 2.4 Como cada aspecto funciona

**Definição** — tabela `CampoPersonalizado` por tenant, com `entidade`
(`FILIADO`/`COLABORADOR`/`EMPRESA`/`DEPENDENTE`), `chave` (slug), `tipo`, `label`,
`obrigatorio`, `mascara`, `regras` (JSONB), `ordem`, `ativo`, `grupo`.

**Armazenamento** — `camposPersonalizados Json @default("{}")` em cada entidade
suportada. Chave = `CampoPersonalizado.chave`. Documento raso (sem aninhamento) — a
restrição existe para manter índices de expressão viáveis.

**Validação** — `lerCamposPersonalizados(definicoes, bruto, objetoCompleto)`, no molde
de `lerConfiguracoes`:
- aplica padrão, descarta chave desconhecida, **nunca lança na leitura**;
- na **escrita** (`normalizarCampos`) valida e **rejeita** com mensagem por campo;
- `regras.dependeDe` cobre o caso COREN×formação — a função recebe o objeto inteiro.

**Máscaras** — string declarativa (`'000.000.000-00'`, `'000000-ENF'`) na definição,
servida pela API e aplicada no front. **A máscara nunca é a validação**: o back reconfere
com a regex derivada, porque máscara é ajuda de digitação e pode ser contornada.

**Obrigatoriedade** — validada na aplicação, com um cuidado herdado do próprio sistema:
tornar um campo obrigatório **não pode travar a edição do acervo existente**. O mesmo
problema já apareceu neste projeto — `modalidadeContribuicao` foi deixada opcional porque
*"exigi-lo retroativamente travaria a edição de 7 mil cadastros"* (`schema.prisma:347-349`).
Proposta: `obrigatorio` vale para **novos registros e para edições que tocam o campo**,
com relatório de pendências em vez de bloqueio retroativo.

**Pesquisa e filtro** — `WHERE camposPersonalizados->>'crea' ILIKE $1`, integrável à busca
existente (`common/utils/busca.util.ts`, que já tem teste). Campos marcados
`pesquisavel: true` na definição entram na busca geral.

**Indexação** — GIN (`jsonb_path_ops`) na coluna + B-tree de expressão para os campos
marcados `indexado`. **Consequência operacional honesta:** criar índice é DDL; se o tenant
puder marcar `indexado` pela tela, isso vira DDL disparado por usuário. Recomendação:
`indexado` é decisão da **plataforma**, aplicada por migration, não botão do cliente.

**Relatórios** — os campos entram nas exportações existentes (`exceljs` já é dependência)
lendo a definição para montar cabeçalho e ordem.

---

## 3. Parte 2 — Feature toggles e módulos

### 3.1 O mecanismo já existe — falta a dimensão do tenant

Hoje: `MODULOS` (13 entradas) × 4 perfis, com `nivelEfetivo(role, permissoes, modulo)`
resolvendo `matriz do usuário → preset do perfil`. Guard global aplica; navegação filtra.

A proposta acrescenta **uma camada acima**, não substitui nada:

```
nível efetivo = MIN(
    módulo contratado e ativo no TENANT,    ← NOVO
    nível do USUÁRIO (matriz → preset)      ← já existe
)
```

Um usuário `ADMINISTRADOR` num tenant que não contratou `colonia` **não vê colônia**. A
regra é de mínimo: o tenant define o teto, o perfil define o quanto dentro dele.

### 3.2 Catálogo global e ativação por tenant

- **`Modulo`** — catálogo **global** (não pertence a tenant): `key`, `label`, `grupo`,
  `descricao`, `dependeDe[]`, `disponivel`. Migra o array literal de
  `permissoes.constants.ts:45-63` para o banco, mantendo as mesmas 13 chaves.
- **`TenantModulo`** — `(tenantId, moduloKey, ativo, ativadoEm, ativadoPor, config Json?)`.

**Por que catálogo no banco e não no código:** hoje o array é duplicado no front
(F1). Servindo o catálogo pela API, o front deixa de ter cópia — resolve uma dívida
existente em vez de dobrá-la.

### 3.3 Dependências entre módulos — já estão no código

O grafo de dependências **não é hipotético**: é o grafo de DI do doc 01 §2.

| Módulo | Depende de | Tipo | Evidência |
|---|---|---|---|
| `processos` | `agenda` | **REQUER** | `processos.module.ts:2` — cria prazos e audiências via `AgendaService` |
| `eventos` | `cobrancas` | **CONDICIONAL** | `eventos.module.ts:22` — só quando `Evento.configuracoes.exigeAdimplencia = true`, cujo padrão é `false` (`configuracoes-evento.ts:71`) |
| `dashboard` | `processos` | **DEGRADA** | `dashboard.module.ts:17` — sem processos o painel perde cards, não quebra |
| `filiados` | `anexos` | **REQUER** | `filiados.module.ts:8` — dossiê |
| `recadastramento` | `filiados` | **REQUER** | `recadastramento.module.ts:33` |

Três tipos, não um:

| Tipo | Regra de ativação | Regra de desativação |
|---|---|---|
| **REQUER** | Bloqueia ativar sem a dependência | Bloqueia desativar se houver dependente ativo |
| **CONDICIONAL** | Permite ativar; avisa que um recurso ficará indisponível | Permite; o recurso dependente se auto-desliga |
| **DEGRADA** | Permite ativar | Permite; o dependente perde parte da tela |

A distinção importa: tratar `eventos → cobrancas` como REQUER obrigaria um sindicato a
contratar cobranças só para fazer assembleia — quando o padrão do sistema é justamente
não exigir adimplência.

### 3.4 Validação no backend

Dois pontos, seguindo precedentes existentes:

1. **`PermissionsGuard` estendido** (`permissions.guard.ts:57-68`): antes de resolver o
   nível do usuário, consulta o módulo no tenant. Inativo → **404**.
2. **`ModuloAtivoGuard`** para controllers sem `@Modulo` — hoje **35 dos 43** controllers
   não declaram módulo (doc 01 §3). Essa lacuna precisa ser fechada **antes** dos toggles,
   ou um módulo "desativado" continua acessível pela rota.

**Por que 404 e não 403:** é o comportamento já escolhido pelo projeto em
`duplicidade.guard.ts:22-27` — *"desligada, as rotas respondem 404, e não 403: guardar o
link não adianta porque a porta não existe"*. Além de coerente, 403 revelaria a existência
de um módulo que o tenant não contratou.

### 3.5 Comportamento no front

`filtrarNav` (`nav-items.ts:84-94`) já filtra por permissão. Passa a filtrar também por
módulo ativo, a partir de um endpoint `GET /tenant/modulos` consumido no bootstrap da
sessão — junto de `/profile/me`, que `auth.tsx:55` já chama.

**Ocultar × desabilitar:**

| Situação | Comportamento | Motivo |
|---|---|---|
| Módulo **não contratado** | **Ocultar** | Não anunciar o que não existe para o cliente |
| Módulo contratado, **usuário sem permissão** | **Ocultar** (comportamento atual) | Mantém o que já existe |
| Módulo contratado e ativo, **sem permissão de editar** | Mostrar sem ação | Já é o padrão (`podeEditar`, `permissoes.ts:113`) |
| Módulo **suspenso por inadimplência** | **Desabilitar com aviso** | Aqui o cliente precisa saber por quê — ocultar geraria chamado de suporte |

### 3.6 Desativação — o que acontece com os dados

> **Desativar módulo nunca apaga dado.** Desativação é de acesso, não de acervo.

| Aspecto | Comportamento |
|---|---|
| Dados | **Preservados integralmente.** Reativar restaura tudo |
| Rotas | 404 |
| Navegação | Item some |
| Crons | Pulam o tenant (`processos-cron` não sincroniza se `processos` inativo) |
| Referências cruzadas | **Permanecem.** Um `Atendimento` que gerou `Processo` mantém o vínculo mesmo com `processos` desligado; a tela mostra o registro sem link navegável |
| Rotas públicas | Sala de evento, colônia e recadastro de tenant com módulo inativo → 404 |
| Permissões | Matriz do usuário **intocada**. Reativar devolve os acessos como estavam — apagar a matriz obrigaria a reconfigurar tudo |

O ponto das referências cruzadas é o mais delicado: `Compromisso.origemCompromissoId`,
`ParcelaCobranca.movimentacaoId` e `Atendimento → Processo` atravessam módulos. Desativar
não pode quebrar integridade referencial — só navegação.

---

## 4. Parte 3 — White-label

### 4.1 O custo real está no front, não no banco

Guardar logo e cor é trivial — `ConfiguracaoSindicato` já guarda `logoUrl` e
`assinaturaPresidenteUrl`. O problema é **F2: 815 usos de `senatepi-*` em 107 arquivos**,
com hex literal em `tailwind.config.ts`. Classe Tailwind é resolvida em build; não há
como trocá-la por tenant em runtime.

**A boa notícia:** o projeto já tem o mecanismo certo instalado e em uso. `globals.css:5-35`
define a paleta shadcn em variáveis CSS HSL (`--primary`, `--background`, `--ring`…), com
tema claro e escuro. Esse sistema **é** personalizável em runtime.

### 4.2 Estratégia: migrar `senatepi-*` para variáveis CSS

Três etapas, nenhuma big bang:

1. **Redefinir a escala `senatepi` em termos de variável CSS.** Em `tailwind.config.ts`,
   `senatepi: { 800: 'hsl(var(--marca-800))', … }`. As 815 ocorrências **continuam
   compilando**, passando a ler variável em vez de hex. Zero alteração nos 107 arquivos.
2. **Injetar as variáveis por tenant** num `<style>` no layout raiz, a partir do branding
   resolvido no servidor.
3. **Renomear gradualmente** `senatepi-*` → `marca-*`. Cosmético, sem pressa, e opcional.

A etapa 1 é o que torna o white-label viável sem tocar em 107 arquivos — e é uma mudança
de uma linha por tom.

> **Escopo a validar:** a paleta tem 10 tons interpolados, e o comentário em
> `tailwind.config.ts` registra que o tom 700 foi escolhido por contraste AA (4.6:1) com
> texto branco. Cor de marca vinda do cliente **não garante contraste**. Ver §4.6.

### 4.3 Onde guardar cada coisa

| Item | Onde | Por quê |
|---|---|---|
| Nome / razão social / sigla | Colunas em `Tenant` | Identidade, não estilo; usado em rota e e-mail |
| Cores da marca | `TenantBranding.tema` (JSONB tipado) | Conjunto coeso que muda junto |
| Logotipo (h/v, cor/branco) | **Storage**, chave em `TenantBranding` | Arquivo binário; `tenants/<id>/branding/…` (doc 03 §5.2) |
| Favicon | Storage + chave | Idem |
| PWA (`manifest.webmanifest`) | **Rota dinâmica** | Hoje é arquivo estático em `apps/web/public/` |
| Assinatura do presidente | Já existe em `ConfiguracaoSindicato` | Migra para o registro por tenant |
| Rodapé de carnê, PIX | Já existem | Idem |
| Fonte, raio de borda | `TenantBranding.tema` | `--radius` já existe (`globals.css:17`) |

**Por que JSONB para o tema e colunas para o nome:** o tema é um conjunto que evolui
junto e é lido inteiro de uma vez — mesmo perfil de `Evento.configuracoes`. O nome do
tenant é buscado, ordenado e exibido isoladamente.

### 4.4 Serviços necessários

| Serviço | Responsabilidade |
|---|---|
| `BrandingService` (API) | Resolve o branding do tenant, aplica padrão, valida contraste, invalida cache |
| `GET /tenant/branding` | Público **por tenant resolvido** — a tela de login precisa dele antes de haver sessão |
| `lerTema()` | Parser tipado do JSONB, molde de `lerConfiguracoes` |
| `assets.util.ts` **por tenant** | `lerAsset` hoje é `Map` global por nome de arquivo (F3) |
| `ThemeProvider` (web) | Injeta variáveis CSS; convive com `next-themes` (claro/escuro já existente) |

### 4.5 PDFs — o ponto que não se resolve no CSS

Os cinco geradores (F3) chamam `lerAsset('senatepi-horizontal-branco.png')`. Proposta:

```
lerAssetDoTenant(tenantId, 'logo-horizontal-branco')
  → storage: tenants/<id>/branding/logo-horizontal-branco.png
  → fallback: asset neutro da plataforma
  → nunca: o logo do SENATEPI
```

**O fallback importa mais do que parece.** Se o branding não resolver e o código cair no
asset padrão atual, um certificado de assembleia de outro sindicato sai **com o logo do
SENATEPI**. Num documento com valor de registro, isso não é bug cosmético — é documento
inválido. Por isso o padrão precisa ser neutro (§4.7).

### 4.6 Validações

| Validação | Regra | Motivo |
|---|---|---|
| Formato de cor | HSL ou hex, convertido para HSL | As variáveis CSS são HSL (`globals.css`) |
| **Contraste** | Cor primária × texto ≥ **4.5:1** (WCAG AA) | O projeto já tratou isso como requisito: o tom 700 foi escolhido "escuro o bastante para passar em contraste AA (4.6:1)". Aceitar cor arbitrária sem conferir reintroduz o bug de "texto branco sobre fundo branco" que o comentário registra ter acontecido |
| Contraste no tema escuro | Conferido **separadamente** | `globals.css:21-34` tem paleta própria para `.dark` |
| Logo | PNG/SVG/WebP, ≤ 1 MB, dimensão mínima | `sharp` já é dependência |
| Favicon | PNG quadrado ≥ 64px | Gerado em múltiplos tamanhos por `sharp` |
| Sanitização de SVG | Remover `<script>`/`onload` | SVG de terceiro é vetor de XSS |
| Nome exibido | Texto puro, sem HTML | Aparece em PDF e e-mail |

### 4.7 Comportamento padrão quando não existe configuração

> **O padrão é uma marca NEUTRA da plataforma — nunca a do SENATEPI.**

Esta é a decisão mais importante da parte 3. O SENATEPI vira Tenant 1 (premissa P4) e
**tem seu branding gravado como dado**, como qualquer outro. O código não pode ter a
identidade dele embutida como fallback, ou todo tenant mal configurado se apresenta como
SENATEPI — em tela, em carnê e em certificado.

| Ausente | Fallback |
|---|---|
| Tema inteiro | Paleta neutra da plataforma (cinza/azul), com contraste AA garantido |
| Cor primária | Neutra |
| Logo | Iniciais do nome do tenant em bloco tipográfico |
| Favicon | Favicon genérico da plataforma |
| Nome | Razão social de `Tenant` |
| Assinatura em PDF | **Espaço em branco** — nunca a assinatura de outro |
| Branding não resolve (erro) | Padrão neutro + **alerta**, sem quebrar a tela |

### 4.8 Cache

O cache atual (`assets.util.ts:4`) é um `Map` global, sem limite e sem TTL, chaveado por
nome de arquivo. Com N tenants ele passa a crescer sem teto e a **misturar tenants na
mesma chave** — um logo servido para o sindicato errado.

| Camada | Estratégia | Invalidação |
|---|---|---|
| Branding (API) | Cache em memória por `tenantId`, **LRU com teto** + TTL 5 min | Explícita ao salvar |
| Assets de PDF | Chave `tenantId + nome`, LRU com teto | Explícita ao trocar logo |
| Front | React Query, `staleTime` longo | Ao salvar |
| Logo/favicon (HTTP) | `Cache-Control` longo + **hash na URL** | URL muda ao trocar arquivo |
| CSS do tema | Inline no HTML | Nunca cacheia separado |

> **Nota de escala:** com uma só instância de API, cache em memória basta. Com múltiplas
> réplicas (doc 01 C3, ainda não respondida), a invalidação não propaga entre elas —
> o TTL de 5 min vira o limite real de propagação. Aceitável para branding; anotar.

---

## 5. Estruturas de dados propostas

Esboço para revisão. **Não é migration, não é schema final** — e depende de as premissas
do doc 02 §9 estarem fechadas.

```
Tenant                          (doc 03)
  id · slug · razaoSocial · nomeExibicao · status · dominios[] · criadoEm

Modulo                          GLOBAL — catálogo da plataforma
  key (PK) · label · grupo · descricao · dependeDe Json · tipoDependencia · disponivel · ordem

TenantModulo
  tenantId · moduloKey · ativo · ativadoEm · ativadoPor · config Json?
  @@id([tenantId, moduloKey])

TenantBranding                  1:1 com Tenant
  tenantId (PK) · tema Json · logoHorizontalKey · logoVerticalKey
  logoBrancoKey · faviconKey · assinaturaKey · atualizadoEm

CampoPersonalizado
  id · tenantId · entidade (enum) · chave · tipo (enum) · label · descricao
  obrigatorio · mascara · regras Json · opcoes Json?
  pesquisavel · indexado · grupo · ordem · ativo
  @@unique([tenantId, entidade, chave])

// valores — coluna nova nas entidades suportadas
Filiado.camposPersonalizados      Json @default("{}")
Colaborador.camposPersonalizados  Json @default("{}")
Empresa.camposPersonalizados      Json @default("{}")
Dependente.camposPersonalizados   Json @default("{}")
```

**`ConfiguracaoSindicato`** deixa de ser registro único e passa a ter um por tenant
(doc 02 R5), absorvendo ou cedendo campos a `TenantBranding` — a definir na revisão.

**Tipos de campo previstos:** `TEXTO`, `TEXTO_LONGO`, `NUMERO`, `DATA`, `BOOLEANO`,
`SELECAO`, `MULTI_SELECAO`, `CPF`, `CNPJ`, `TELEFONE`, `EMAIL`, `REGISTRO_CONSELHO`.

O último é deliberado: COREN, CREA, CRM e OAB são o mesmo formato (número + sufixo/UF, com
regra que depende de outro campo). Tratá-los como um tipo com parâmetros — e não como
texto com regex livre — preserva a validação cruzada que `coren.validator.ts` já faz.

---

## 6. Arquivos afetados

### 6.1 Criar

| Arquivo | Parte |
|---|:--:|
| `packages/shared/` — **workspace hoje declarado e inexistente** (F1): tipos de campo, máscaras, catálogo de módulos | 1,2,3 |
| `apps/api/src/common/campos/campos-personalizados.ts` — parser tipado (molde de `configuracoes-evento.ts`) | 1 |
| `apps/api/src/common/campos/campos.validator.ts` — validação por tipo + `dependeDe` | 1 |
| `apps/api/src/modules/campos-personalizados/*` — CRUD das definições | 1 |
| `apps/api/src/modules/modulos/*` — catálogo + ativação por tenant | 2 |
| `apps/api/src/common/permissions/modulo-ativo.guard.ts` | 2 |
| `apps/api/src/modules/branding/*` — `BrandingService` + `GET /tenant/branding` | 3 |
| `apps/api/src/common/branding/tema.ts` — parser do tema | 3 |
| `apps/api/src/common/branding/contraste.util.ts` — verificação WCAG | 3 |
| `apps/api/src/common/assets-tenant.util.ts` — `lerAsset` por tenant | 3 |
| `apps/web/src/components/campos-personalizados/*` — renderizador de formulário | 1 |
| `apps/web/src/lib/campos.ts` · `modulos.ts` · `branding.ts` | 1,2,3 |
| `apps/web/src/components/branding-provider.tsx` | 3 |
| `apps/web/src/app/manifest.webmanifest/route.ts` — manifesto dinâmico | 3 |

### 6.2 Modificar

| Arquivo | O que muda | Risco |
|---|---|:--:|
| `apps/web/tailwind.config.ts` | Escala `senatepi` passa a ler `hsl(var(--marca-*))` — **destrava as 815 ocorrências sem tocá-las** | 🔴 |
| `apps/web/src/app/globals.css:5-35` | Variáveis de marca ao lado das de tema | 🟠 |
| `apps/web/src/components/logo.tsx:23` | Caminho fixo `/senatepi-*` → logo do branding | 🟠 |
| `apps/web/src/app/layout.tsx` | Injeção do `<style>` do tema + `BrandingProvider` | 🟠 |
| `apps/web/src/lib/permissoes.ts` | Catálogo sai do literal e vem da API (**resolve F1**) | 🟠 |
| `apps/web/src/components/nav-items.ts:84-94` | `filtrarNav` considera módulo ativo | 🟢 |
| `apps/api/src/common/permissions/permissoes.constants.ts:45-63` | `MODULOS` migra para o banco | 🟠 |
| `apps/api/src/common/permissions/permissions.guard.ts:57-68` | Nível efetivo = `MIN(tenant, usuário)` | 🔴 |
| `apps/api/src/common/assets.util.ts` | Cache por tenant, LRU com teto | 🟠 |
| `carteirinhas.module.ts:190` · `colaboradores.service.ts:436` · `certificado.service.ts:124` · `dossie-evento.service.ts:161` · `filiados.service.ts:844` | `lerAsset` → `lerAssetDoTenant` | 🔴 |
| `apps/api/src/modules/filiados/dto/filiado.dto.ts` | Aceita `camposPersonalizados` | 🟠 |
| `filiados.service.ts` · `colaboradores.service.ts` · `empresas.service.ts` | Normalizam campos na escrita | 🟠 |
| `apps/api/src/common/utils/busca.util.ts` | Busca alcança campos `pesquisavel` | 🟠 |
| `apps/api/src/modules/importacao/mapeamento.util.ts` | Importação mapeia campos personalizados | 🟠 |
| Os 35 controllers sem `@Modulo` | Declarar módulo (pré-requisito de §3.4) | 🟠 |
| `apps/web/public/manifest.webmanifest` | Estático → rota dinâmica | 🟢 |

**🔴 = alto risco.** `tailwind.config.ts` porque um erro afeta 815 usos de uma vez;
`permissions.guard.ts` porque está no caminho de toda request; os 5 PDFs porque emitem
documento com valor de registro (§4.5).

---

## 7. Testes propostos

### Campos personalizados
| # | Teste |
|--:|---|
| CP1 | Parser aplica padrão, descarta chave desconhecida e **não lança** (espelha `configuracoes-evento.spec.ts`) |
| CP2 | Campo obrigatório bloqueia criação, **mas não** edição de registro legado |
| CP3 | `dependeDe` reproduz COREN×formação com a mesma matriz de `coren.validator.ts` |
| CP4 | Máscara não substitui validação: valor sem máscara e válido é aceito |
| CP5 | Mesma `chave` em dois tenants não colide |
| CP6 | Busca alcança campo `pesquisavel` e ignora os demais |
| CP7 | Campo desativado some do formulário e **preserva** o valor gravado |
| CP8 | Documento JSONB rejeita aninhamento |

### Módulos
| # | Teste |
|--:|---|
| MD1 | Ativar `processos` sem `agenda` (REQUER) → recusado |
| MD2 | Ativar `eventos` sem `cobrancas` (CONDICIONAL) → permitido, com aviso |
| MD3 | Desativar `agenda` com `processos` ativo → recusado |
| MD4 | Módulo inativo → **404** em todas as rotas (varredura, não amostra) |
| MD5 | Módulo inativo some da navegação |
| MD6 | Desativar e reativar preserva dados **e** a matriz de permissões |
| MD7 | `ADMINISTRADOR` em tenant sem `colonia` não acessa colônia |
| MD8 | Cron pula tenant com módulo inativo |
| MD9 | Rota pública de módulo inativo → 404 |
| MD10 | Referência cruzada (atendimento→processo) sobrevive à desativação |

### White-label
| # | Teste |
|--:|---|
| WL1 | Tenant sem branding → padrão **neutro**, nunca SENATEPI |
| WL2 | Cor com contraste < 4.5:1 é **recusada** no salvamento |
| WL3 | Contraste conferido separadamente em claro e escuro |
| WL4 | SVG com `<script>` é sanitizado |
| WL5 | PDF do tenant B **não** contém o logo do tenant A |
| WL6 | Sem assinatura → espaço em branco, nunca a de outro |
| WL7 | Cache de asset não serve arquivo cruzado entre tenants |
| WL8 | Trocar logo invalida o cache (novo hash na URL) |
| WL9 | Manifesto dinâmico devolve nome/ícone do tenant correto |
| WL10 | **Regressão visual:** as 815 ocorrências renderizam igual após a migração para variável CSS |

WL10 é o teste que protege a etapa mais arriscada. Sem snapshot visual, a migração de
`tailwind.config.ts` é uma mudança de 10 linhas com 815 pontos de falha silenciosa.

---

## 8. Riscos e pendências

| # | Risco | Mitigação |
|--:|---|---|
| P1 | **`packages/` não existe** (F1). Sem ele, tipos de campo, máscaras e catálogo de módulos triplicam a duplicação já existente | Criar o workspace **antes** da parte 1 — é pré-requisito, não melhoria |
| P2 | **35 de 43 controllers sem `@Modulo`** | Fechar a lacuna antes dos toggles, ou "desativar" não desativa |
| P3 | **815 usos de `senatepi-*`** | Etapa 1 de §4.2 preserva todos; WL10 protege |
| P4 | **Contraste com cor do cliente** | WL2/WL3 bloqueiam no salvamento, não no render |
| P5 | **PDF com marca errada** — documento com valor de registro | Fallback neutro (§4.7) + WL5/WL6 |
| P6 | **`indexado` como botão do cliente vira DDL por usuário** | Decisão da plataforma, aplicada por migration (§2.4) |
| P7 | **JSONB vira depósito permanente** | Documentar a promoção a coluna real desde o início (§2.3) |
| P8 | **Cache de branding não propaga entre réplicas** | TTL de 5 min como limite aceito; depende de C3 (nº de réplicas) |
| P9 | **Obrigatoriedade retroativa trava o acervo** | Vale para novos e para edições que tocam o campo (§2.4) |

### Decisões de produto necessárias

| # | Pergunta |
|--:|---|
| **Q1** | Campos personalizados são de **todo plano** ou de plano superior? Muda se a definição é self-service |
| **Q2** | Módulos são **contratados** (comercial) ou **configurados** (o cliente liga e desliga)? Muda quem controla `TenantModulo` |
| **Q3** | Existe **suspensão por inadimplência** distinta de desativação? §3.5 prevê comportamento diferente |
| **Q4** | Branding é self-service ou passa por **aprovação**? Muda se WL2 bloqueia ou apenas avisa |
| **Q5** | Domínio personalizado entra no white-label? Já levantado em D7 (doc 03 §10) |
| **Q6** | Quantos campos personalizados por entidade, no limite? Acima de ~30 o JSONB raso perde ergonomia na tela |

---

## Estado e próximo passo

**Aguardando revisão. Nada implementado.**

Estas três frentes **dependem** de `01`–`03` estarem fechados: sem `Tenant`, `TenantModulo`
e `TenantBranding` não têm dono; sem o contexto do doc 03, o branding não sabe qual tenant
resolver. A ordem sugerida de execução é `packages/` → campos → módulos → white-label,
porque a parte 3 é a de maior risco visual e a que mais se beneficia de ter os testes das
outras já rodando.
