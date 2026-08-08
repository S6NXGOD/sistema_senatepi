# PLANO — Núcleo reaproveitável (CORE) com aplicação por sindicato

> **Não é multi-tenant.** Um cliente = uma instalação = um banco. O que se
> compartilha é **código**, não dado. Esta distinção governa todo o documento:
> sempre que houver dúvida entre "guardar junto" e "instalar de novo", a
> resposta é instalar de novo.

Data: 07/08/2026 · Repositório: `projeto_senatepi` · Produção: Railway

---

## 1. Decisões já tomadas

| Decisão | Consequência |
|---|---|
| **Banco isolado por cliente** | Nenhuma coluna `tenant_id`. Nenhuma query muda. Zero risco de vazamento entre clientes. |
| **Não é multi-tenant** | Não existe "seletor de cliente" em runtime. O cliente é definido no build/deploy, por variável de ambiente. |
| **Core reaproveitável** | O que é igual para todo sindicato vira pacote. O que varia fica na aplicação do cliente. |
| **DJEN segue bloqueado** | A migração para o VPS da Hostinger continua pendente e é pré-requisito do jurídico completo (ver §12.1). |
| **Monorepo único** | Todos os clientes no mesmo repositório git. Correção de core chega a todos sem processo de release (ver §6). |
| **Cliente nº 2 definido** | **SINDSERM Teresina** — Sindicato dos Servidores Públicos Municipais de Teresina (ver §5). |

---

## 2. Diagnóstico do que existe hoje

Medido no repositório em 07/08/2026:

| Item | Situação |
|---|---|
| Estrutura | **Já é monorepo** — `workspaces: ["apps/*", "packages/*"]` no `package.json` da raiz |
| Gerenciador | npm (`package-lock.json`). **Mantemos npm** — trocar por pnpm agora é risco sem ganho |
| Aplicações | `apps/api` (NestJS, ~33.7k linhas) · `apps/web` (Next.js, ~39.4k linhas) |
| Módulos de API | 23 |
| Banco | 54 models, 50 enums, 77 migrations |
| Acoplamento visual | **871** usos de `senatepi-NNN` (cor) em **111** arquivos |
| Acoplamento textual | **94** ocorrências da string "SENATEPI" no código |
| Acoplamento de domínio | `enum FormacaoProfissional { ENFERMEIRO, TECNICO_ENFERMAGEM, AUXILIAR_ENFERMAGEM }` — o ramo do cliente está no **schema do banco** |
| Módulos com guard `@Modulo()` | 8 de 23 |
| Fontes de dado processual | 2 (DataJud e DJEN), já com coluna `fonte` no log de sincronização |

**Leitura:** a reorganização de pastas é a parte fácil e a menos importante. O que
prende o sistema ao SENATEPI é o **tema**, o **vocabulário** e os **enums do
banco** — e mover arquivo não toca em nenhum dos três.

---

## 3. Arquitetura alvo

```
projeto_senatepi/                     (repositório único, npm workspaces)
├── packages/
│   ├── core-juridico/                Processos, DataJud, DJEN, prazos, audiências
│   ├── core-identidade/              Auth, RBAC, usuários, perfis, auditoria
│   ├── core-infra/                   Storage, avatares, e-mail, PDF, utilitários
│   └── core-ui/                      Tabela, dossiê, linha do tempo, formulários
├── apps/
│   ├── senatepi/
│   │   ├── api/                      NestJS: importa os cores + módulos próprios
│   │   ├── web/                      Next.js: importa core-ui + páginas próprias
│   │   └── tenant.config.ts          Marca, cores, módulos, vocabulário
│   └── sindicato-x/                  (cliente futuro, mesma forma)
└── package.json
```

**Regra para decidir onde algo mora:**

> Se a resposta para *"outro sindicato precisaria disso exatamente igual?"* for
> **sim com certeza**, vai para `packages/`. Se for *"provavelmente"*, **fica no
> app** até o segundo cliente provar. Extrair cedo demais custa duas
> refatorações; extrair tarde custa uma cópia temporária.

Pelo critério acima, hoje:

| Vai para `packages/` | Fica em `apps/senatepi/` |
|---|---|
| Jurídico (DataJud/DJEN não sabem o que é sindicato) | Filiados (53 campos, muda por cliente) |
| Auth, RBAC, matriz de permissões | Colônia de Férias |
| Storage, avatares, auditoria | Eventos, Empresas Patronais |
| UI base (tabela, dossiê, linha do tempo) | Cobranças (regra de contribuição varia) |
| Agenda e prazos | Recadastramento, carteirinhas |

---

## 4. Fases

Tudo na branch `refatoracao-monorepo`. Produção intocada até a Fase 4.
**As fases 0, 1 e 2 valem por si**, mesmo que nunca exista um segundo cliente.

---

### FASE 0 — Tirar o cliente do código (≈ 2 dias · risco baixo)

Nada muda de lugar. Só se cria configuração e se substituem constantes.

**O que você faz:**

1. Criar a branch:
   ```bash
   git checkout -b refatoracao-monorepo
   ```

2. Criar `apps/api/src/tenant/tenant.config.ts` e `apps/web/src/tenant.config.ts`
   com: nome, sigla, CNPJ, logo, paleta, módulos ativos e **vocabulário**
   (`filiado` | `associado` | `sindicalizado`; `matrícula` | `inscrição`).

3. Renomear a paleta no Tailwind: `senatepi-*` → `brand-*`.
   São 871 ocorrências em 111 arquivos — substituição mecânica, mas **faça em
   commit isolado** e confira visualmente as telas principais depois.

4. Substituir as 94 aparições de `"SENATEPI"` por `tenant.nome` / `tenant.sigla`.
   Atenção: **algumas são dado, não marca** — por exemplo o polo ativo
   institucional dos processos, que é o nome da parte no tribunal. Essas
   permanecem como estão.

5. `npm run build` nos dois apps + `npm test -w @senatepi/api`.

**Como você sabe que deu certo:** o build passa, as telas continuam verdes, e
uma busca por `senatepi` no código só encontra o `tenant.config.ts` e nomes de
pacote.

---

### FASE 1 — Módulos que ligam e desligam (≈ 2 dias · risco baixo)

O padrão **já existe** no sistema: `@Modulo()` + `PermissionsGuard` em 8
controllers, e `duplicidade.guard.ts` já responde **404** para funcionalidade
desligada. É só generalizar.

**O que você faz:**

1. Pôr `@Modulo('<nome>')` nos 15 controllers que ainda não têm.
2. No `PermissionsGuard`, antes de checar permissão do usuário, checar se o
   módulo está na lista `tenant.modulos`. Fora dela → **404** (não 403: para
   quem não tem o módulo, ele não existe).
3. O menu lateral do front passa a filtrar por `tenant.modulos`.
4. Testar desligando `colonia` e `eventos` localmente.

**Resultado:** um sindicato sem colônia de férias deixa de ver o módulo com uma
linha de configuração — sem `if` espalhado por tela.

---

### FASE 2 — Domínio configurável (≈ 1 a 2 semanas · é funcionalidade, não refactor)

Aqui está o coração do "cada sindicato tem suas particularidades". Três níveis.

**(a) Enums de domínio viram tabela cadastrável.**

`FormacaoProfissional` (ENFERMEIRO, TECNICO_ENFERMAGEM…) é o exemplo mais
gritante: um sindicato de professores não cabe ali sem migration.

Vocês **já fizeram isso duas vezes**: `tipos_evento` e `tipos_movimentacao` são
tabelas cadastráveis com registros "sistema" protegidos contra exclusão. É a
mesma receita:

```
formacoes_profissionais(id, slug, nome, ordem, ativo, sistema)
```

Migration de dados converte a coluna enum em FK, preservando o que existe.

**(b) Campos customizados por cliente.**

Duas tabelas novas resolvem o caso geral sem tocar no `Filiado`:

```
campos_customizados(
  id, entidade,        -- FILIADO | DEPENDENTE | EMPRESA | PROCESSO
  chave, rotulo, tipo, -- TEXTO | NUMERO | DATA | SELECAO | BOOLEANO
  obrigatorio, ordem, secao, opcoes Json, ativo
)
valores_campos_customizados(id, campo_id, registro_id, valor)
```

O formulário de filiado passa a renderizar os 53 campos fixos **mais** os
customizados daquele cliente. Um sindicato pede "matrícula funcional do Estado";
outro pede "número do COREN". Nenhum dos dois precisa de migration.

> **Limite honesto:** campo customizado é ótimo para *guardar e exibir*. Ele é
> ruim para *regra de negócio* (validação complexa, cálculo, integração). Quando
> o campo precisa de comportamento, ele merece coluna real na aplicação daquele
> cliente — que é o nível (c).

**(c) O que não couber em (a) nem (b)** vira módulo próprio em
`apps/<cliente>/api/src/modules/` — exatamente como a Colônia de Férias é do
SENATEPI hoje.

---

### FASE 3 — Extrair os pacotes (≈ 1 semana · risco médio)

> ⚠️ **Esta fase foi executada só até a metade, e de propósito.** A 3a
> extraiu `@core/infra` e provou a mecânica. A 3b mediu o jurídico e
> encontrou dois impedimentos que mudaram o desenho — a leitura abaixo
> continua válida como história, mas **o que valeu está na §15**.

Só agora, e só o que a Fase 0–2 provou ser neutro.

**Ordem recomendada — do menos acoplado para o mais:**

1. `packages/core-infra` (storage, avatares, utilitários) — quase sem
   dependência de domínio.
2. `packages/core-juridico` — o mais valioso e o mais neutro: DataJud, DJEN,
   instâncias, prazos, audiências. **Nenhuma linha dele sabe o que é um filiado**
   (a ligação com o filiado é feita por `partes_processo`, que fica no app).
3. `packages/core-identidade` — auth e RBAC.
4. `packages/core-ui` — por último, porque é o que mais depende do tema.

**Para cada pacote:**
```bash
mkdir -p packages/core-juridico/src
# mover os arquivos
# criar packages/core-juridico/package.json com name "@core/juridico"
# no app: import { ProcessosModule } from '@core/juridico'
```

**Atenção ao Prisma:** o schema fica **no app**, não no pacote. O core recebe o
`PrismaService` por injeção. Isso é o que permite um cliente ter campos a mais
sem que o core saiba.

---

### FASE 4 — Deploy (≈ 1 dia · risco controlado)

> **Reescrito depois da Fase 3b.** A versão anterior previa mover a API para
> `apps/senatepi/api` e trocar o **Root Directory** no Railway. Isso deixou de
> existir: os caminhos não mudam, e o serviço do SENATEPI em produção continua
> apontando para `apps/api` e `apps/web`.

O que o deploy do SENATEPI passa a exigir são **duas variáveis**:

| Serviço | Variável | Valor |
|---|---|---|
| API | `TENANT` | `senatepi` |
| Web | `NEXT_PUBLIC_TENANT` | `senatepi` |

**Esquecê-las derruba o serviço, de propósito** — a alternativa silenciosa seria
subir com o cliente errado por cima do banco certo. Configure-as **antes** do
merge; elas não afetam o código atual, que ainda não as lê.

`NEXT_PUBLIC_TENANT` é lida no **build**, não no start: trocá-la exige rebuild.
Isso é correto, porque a paleta é compilada dentro do CSS pelo Tailwind.

**Ordem segura:**
1. Definir as duas variáveis nos serviços de produção (sem efeito ainda).
2. Merge da branch.
3. Conferir no ar: identidade, menu, e uma tela de cada módulo.
4. Rollback = `git revert` do merge. O schema é aditivo; nada some.

---

## 5. O cliente nº 2: SINDSERM Teresina

Sindicato dos Servidores Públicos Municipais de Teresina. Ter um segundo cliente
**real** muda o plano: as costuras deixam de ser hipótese e passam a ser
requisito. Vale mapear as diferenças agora, porque são elas que definem o que é
core e o que não é.

| Área | SENATEPI | SINDSERM | Consequência |
|---|---|---|---|
| Base | Enfermeiros e técnicos de enfermagem | Servidores públicos municipais | `FormacaoProfissional` (enum) não serve — vira **cargo**, cadastrável |
| Empregador | Hospitais, clínicas, fundações | Prefeitura de Teresina e suas secretarias | "Empresas Patronais" vira "Órgãos" ou é desligado |
| Justiça | **TRT22** (celetista) | **TJPI** para estatutário, TRT22 para celetista | O jurídico precisa dos dois — e já tem |
| Contribuição | Desconto em folha, avulso, pensionista | Desconto em folha da Prefeitura | `ModalidadeContribuicao` provavelmente muda |
| Colônia de férias | Sim | **Não** — têm clube, com entrada por carteirinha/QR | Módulo ligável (Fase 1); o clube virou o módulo `acessos` |
| Vínculo | Formação profissional | Cargo, secretaria de lotação, regime (estatutário/celetista/comissionado), data de posse | **Campos customizados** (Fase 2) |

**A boa notícia sobre o jurídico:** o core já atende os dois. Ao longo do
desenvolvimento do módulo, o sistema foi testado contra o **TJPI** tanto quanto
contra o TRT22 — os códigos de audiência do TJPI (970, 12750, 12753) já estão no
classificador, o STJ já é consultado como tribunal superior de processo
estadual, e a fase processual foi validada nos dois ramos. **O módulo mais
valioso é também o que menos precisa mudar.**

**A má notícia sobre filiados:** é onde está quase toda a diferença. Os 53
campos do `Filiado` foram desenhados para enfermagem. Este é o módulo que
justifica a Fase 2 — e é por isso que ela deixou de ser opcional.

**Três perguntas a fazer ao SINDSERM antes da Fase 2**, porque as respostas
definem os campos customizados. ✅ **Todas respondidas — ver §9.**

1. Quais dados do servidor vocês precisam guardar que o SENATEPI não guarda?
   (matrícula funcional, secretaria, cargo, regime, data de posse, lotação…)
2. A contribuição é só desconto em folha, ou há outras formas?
3. Vocês têm colônia de férias, eventos e emissão de carteirinha?

---

## 6. Estratégia de repositório

**Decidido: monorepo único.** Todos os clientes no mesmo git.

```
projeto_senatepi/              ← um repositório
├── packages/core-*/           ← compartilhado
└── apps/
    ├── senatepi/
    └── sindserm/
```

### Por que único, e não um repositório por cliente

| | Monorepo único | Core publicado + repo por cliente |
|---|---|---|
| Corrigir bug do core | edita e pronto — **todos** recebem | publica versão → atualiza N repos → testa N → deploy N |
| Isolamento de código | nenhum: quem vê um, vê todos | total |
| Cliente travado em versão antiga | não dá | dá |
| Esforço para uma pessoa só | baixo | alto — vira processo de release |

Com uma pessoa cuidando de tudo, o custo do processo de release é o que mata.
Enquanto o problema for *"quero reaproveitar"*, o monorepo resolve de graça.

### Quando migrar para repositórios separados

Só quando um destes acontecer — e aí o caminho já estará preparado, porque o
core estará em `packages/` com `package.json` próprio (basta um `npm publish` e
trocar `workspace:*` por `^1.0.0`):

- contratar um desenvolvedor externo que não pode ver o código de outro cliente;
- um cliente exigir o código-fonte em contrato (comum em licitação pública);
- um cliente precisar ficar travado numa versão antiga do core.

### O que o monorepo único exige em troca

**Um `.gitignore` e um controle de segredo rigorosos.** Com dois clientes no
mesmo repositório, um `.env` versionado por engano expõe os dois. Nenhum
`.env` de cliente entra no git — nunca.

---

## 7. Correção do core × correção do cliente

Com monorepo único, isso é resolvido por **onde o arquivo mora** — não por
processo de git:

```
packages/core-juridico/...   corrige uma vez  →  TODOS os apps recebem
apps/senatepi/...            só o SENATEPI    →  os outros nem compilam
apps/sindserm/...            só o SINDSERM
```

O git é o mesmo, **o deploy é por app**. Corrigiu o core e fez deploy só do
SENATEPI? O SINDSERM continua na versão anterior até você mandar o deploy dele.
Isso é uma vantagem: você escolhe quando cada cliente recebe.

### A armadilha, e as três proteções

Mudar o core pode quebrar um cliente **sem você perceber**. Contra isso:

1. **Testes no core.** Os 221 que existem hoje são quase todos de core — fase
   processual, etiquetas, similaridade de partes, NPU, audiências. São a rede
   que já está armada.
2. **CI que builda TODOS os apps antes do merge** (§8). Se o SINDSERM não
   compila, o merge não entra.
3. **Se a mudança do core quebra um cliente, é sinal** de que aquilo deveria ser
   ponto de extensão, e não alteração — ver §10.

### Fluxo de trabalho no dia a dia

```
Bug no cálculo de instâncias (core)
  → branch fix/instancias
  → corrige em packages/core-juridico
  → npm test + build de todos os apps
  → merge
  → deploy SENATEPI  (agora)
  → deploy SINDSERM  (quando quiser)

Campo novo no cadastro do SINDSERM
  → branch feat/sindserm-lotacao
  → mexe SÓ em apps/sindserm/
  → merge
  → deploy SINDSERM
  → SENATEPI nem sabe que existiu
```

---

## 8. CI: o guarda que impede quebrar um cliente calado

Com dois clientes, o risco novo não é técnico, é de atenção: mudar o core e
descobrir três semanas depois que o outro cliente não compila. Um workflow no
GitHub Actions resolve:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  verificar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx prisma generate --schema apps/senatepi/api/prisma/schema
      - run: npm test --workspaces --if-present
      - run: npm run build --workspaces   # TODOS os apps, inclusive o SINDSERM
```

**Regra:** merge na `main` só com o CI verde. É o único mecanismo que escala
para um gestor sozinho — a alternativa é lembrar de testar tudo à mão, e um dia
você não lembra.

---

## 9. Como nasce um cliente novo

> **Reescrito depois da Fase 3b.** O roteiro anterior criava uma pasta
> `apps/<cliente>/` com api, web e schema próprios. Não é mais assim: os apps
> são únicos e o cliente é configuração. Ver §15.

Criar um cliente é **dias, não meses**. Roteiro, usando o SINDSERM:

1. `apps/api/src/tenant/tenants/<cliente>.ts` — identidade, CNPJ, endereço,
   conta, vocabulário, módulos, campos ocultos.
2. `apps/web/src/tenant/tenants/<cliente>.ts` — o espelho da tela, mais a
   **paleta** (dez tons; o Tailwind não emite classe para tom inexistente).
3. Registrar os dois no `TENANTS` do respectivo `tenant.config.ts`.
4. Acrescentar o cliente à matriz da CI (`.github/workflows/ci.yml`) — sem isso
   ele não é construído a cada push, que é justamente o que impede quebrá-lo em
   silêncio.
5. Projeto novo no Railway: API + Web + Postgres. **Banco vazio e separado.**
   `TENANT` na API, `NEXT_PUBLIC_TENANT` no web, `SEED_ADMIN_EMAIL` e
   `SEED_ADMIN_PASSWORD` no primeiro deploy.
6. `prisma migrate deploy` roda no start e cria o banco do zero.
7. O `AdminSeedService` cria o administrador **só se o banco estiver vazio**, e
   em produção **exige** `SEED_ADMIN_PASSWORD` — sem ela, nenhum admin é criado
   e o log diz por quê.

**Nada é compartilhado em runtime.** Se o SINDSERM cair, o SENATEPI não sente —
são bancos, serviços e domínios diferentes. O que passa a ser compartilhado é o
CÓDIGO, e é por isso que a CI constrói todos os clientes a cada push.

### O que verificar em um cliente novo, sempre

Cada item abaixo já mordeu uma vez:

| Verificar | Por quê |
|---|---|
| Rotas do módulo desligado respondem 404 na API **e** somem do front | guarda de rota não cobre URL digitada; ver `GateDeModulo` |
| Nenhum **seed de boot** de módulo desligado roda | o seed da colônia criava 5 lotes e 30 quartos num sindicato sem colônia |
| Nenhum **cron** de módulo desligado roda | cron não passa por guarda: é registrado no boot e dispara sozinho |
| Campo escondido não é **obrigatório** em lugar nenhum | esconder um campo obrigatório trava o cadastro sem dizer por quê |
| Campo escondido também some da **leitura** | escondido na entrada e visível na lista, no detalhe e no dossiê |
| A cor institucional aparece no CSS **gerado** | a paleta é compilada; o `.next` reaproveita o CSS do build anterior |

### Respostas do SINDSERM

As três perguntas do §5 foram respondidas:

1. **Dados do servidor:** foto, situação funcional (ativo/aposentado/pensionista),
   órgão, lotação, matrícula da Prefeitura, nome, cargo/carreira/especialidade,
   CPF, e-mail, telefone, endereço, admissão, nascimento, desconto do sindicato
   (sim/não), carteirinha com QR e dependentes (pai, mãe, filho e cônjuge).
   **Todos cabem no schema atual** — `vinculo_funcional` e `lotacao` foram as
   duas colunas novas; `PAI` e `MAE` entraram em `TipoDependente`.
2. **Contribuição:** somente desconto em folha da Prefeitura. Por isso
   `cobrancas` fica desligada, e o tenant não tem conta bancária — a linha
   simplesmente não sai no termo.
3. **Módulos:** sem colônia; **com clube**, cuja entrada é validada por
   carteirinha com QR, matrícula ou CPF. Foi o que originou a portaria
   (`acessos`). `empresas` desligada: o empregador é um só, a Prefeitura.

---

## 10. Como um cliente estende o jurídico

> *"Se um cliente quiser conectar mais uma API que atende a realidade dele, como
> faríamos?"*

Esta é a pergunta certa, e o sistema **já tem a forma** para respondê-la: hoje
existem **duas** fontes de dado processual (DataJud e DJEN), com o
`CorrelacaoService` mesclando as duas e a coluna `fonte` no log de
sincronização. O que falta é transformar esse arranjo em um **ponto de extensão
declarado**. São três mecanismos, do mais comum para o mais raro.

### 6.1 Fonte adicional de dados — o caso que você descreveu

O core passa a definir um contrato, e não uma implementação:

```ts
// packages/core-juridico/src/fontes/fonte.ts
export interface FonteDeAndamentos {
  /** Identificador gravado em `logs_sincronizacao.fonte` — 'datajud', 'pje-tjxx'. */
  readonly id: string;
  readonly rotulo: string;
  /** Este processo é atendido por esta fonte? (por tribunal, grau, classe…) */
  suporta(npu: string, tribunal: string): boolean;
  buscarInstancias(npu: string, tribunal: string): Promise<InstanciaProcessual[]>;
}

export const FONTES_DE_ANDAMENTOS = Symbol('FONTES_DE_ANDAMENTOS');
```

O core já traz `DatajudFonte` e injeta **todas** as fontes registradas:

```ts
constructor(
  @Inject(FONTES_DE_ANDAMENTOS)
  private readonly fontes: FonteDeAndamentos[],
) {}
```

O cliente registra a dele **sem tocar no core**:

```ts
// apps/sindicato-x/api/src/juridico/juridico.module.ts
@Module({
  imports: [CoreJuridicoModule],
  providers: [
    ApiDoTribunalXService,
    { provide: FONTES_DE_ANDAMENTOS, useClass: ApiDoTribunalXService, multi: true },
  ],
})
export class JuridicoDoClienteModule {}
```

**Por que isto funciona bem aqui:** a mesclagem já é resolvida —
`InstanciasService.sincronizar` deduplica por
`(instância, data, código, descrição, detalhe)`, então uma segunda fonte que
traga o mesmo ato não duplica nada. E a coluna `fonte` já existe para você saber
de onde veio cada coisa.

**Três cuidados obrigatórios:**
- `suporta()` evita gastar chamada onde a fonte não atende.
- Falha de uma fonte **não pode** derrubar as outras (é o padrão que já usamos
  na consulta ao TST: falhou o superior, segue com o tribunal de origem).
- Cada fonte tem a própria cota e o próprio limitador — o DJEN já tem o dele.

### 6.2 Comportamento adicional — eventos de domínio

Quando o cliente não quer outra fonte, e sim **reagir** a algo (avisar um
sistema interno quando um prazo é criado, gerar uma planilha própria a cada
sentença):

```ts
// no core, ao fim da sincronização
this.eventos.emit('processo.sincronizado', { processoId, novas });
this.eventos.emit('prazo.criado', { compromissoId, processoId });

// no app do cliente
@OnEvent('prazo.criado')
async avisarSistemaInterno(dados: PrazoCriado) { /* ... */ }
```

`@nestjs/event-emitter` resolve isso. O core não sabe quem escuta — e é isso que
mantém o core limpo.

### 6.3 Interface adicional — slots na tela

Quando a diferença é visual (uma aba a mais no dossiê, uma coluna a mais na
lista), o `core-ui` expõe pontos de inserção:

```tsx
<DossieProcesso
  abasExtras={[{ chave: 'convenio', titulo: 'Convênio', render: () => <PainelConvenio /> }]}
/>
```

### Quando o cliente quer MUDAR, e não acrescentar

Os três mecanismos acima resolvem "fazer mais". Falta o caso de "fazer
diferente" — *"no meu sindicato o prazo de conferência é 10 dias úteis, não 5"*.
Quatro respostas, **nesta ordem**; sempre tente a de cima primeiro:

**① Vira configuração** — cobre a maioria dos casos.
```ts
// apps/sindserm/tenant.config.ts
juridico: { prazoConferenciaDiasUteis: 10 }
```

**② Vira ponto de extensão** — quando é comportamento, e não número: os três
mecanismos das seções anteriores (fonte, evento, slot).

**③ Vira sobrescrita por injeção** — quando o cliente precisa de outra
implementação inteira. O NestJS troca a peça pelo token, sem tocar no core:
```ts
// apps/sindserm/api/src/juridico/juridico.module.ts
@Module({
  imports: [CoreJuridicoModule],
  providers: [
    { provide: AutomacaoPrazosService, useClass: AutomacaoPrazosSindserm },
  ],
})
export class JuridicoSindsermModule {}
```
O core continua intocado; o cliente entrega a própria peça. Use com parcimônia:
sobrescrita é o mecanismo que mais silenciosamente diverge do core — quando ele
evoluir, a peça sobrescrita não evolui junto.

**④ Vira módulo do cliente** — quando não cabe em nenhuma das anteriores. E está
tudo bem: nem tudo precisa ser core.

### 6.4 A regra que evita o pior erro

> **O core nunca contém `if (cliente === 'x')`.** No dia em que aparecer o
> primeiro, o core parou de ser core e virou um emaranhado de exceções. Se a
> diferença não couber em fonte, evento ou slot, ela **não é do core** — é
> módulo do cliente, e está tudo bem.

---

## 11. O schema do Prisma entre clientes — TESTADO

Esta é a peça mais delicada do plano inteiro, porque migration é o único lugar
onde um erro não tem rollback barato. **Testei antes de escrever**, com o Prisma
5.22 que o projeto já usa.

### O que funciona

Schema em **vários arquivos** funciona, com o preview `prismaSchemaFolder`:

```
apps/sindserm/api/prisma/schema/
├── _core.prisma        ← os 54 models compartilhados (vem do core)
└── sindserm.prisma     ← models exclusivos do cliente
```

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["prismaSchemaFolder"]
}
```

Resultado do teste: `The schemas at prisma\schema are valid 🚀` — o Prisma lê a
pasta inteira e mescla os arquivos.

### O que NÃO funciona — e muda o desenho

**Um model do cliente não pode ter `@relation` para um model do core.** Testado:

```
error: The relation field `processo` on model `ServidorMunicipal` is missing an
opposite relation field on the model `Processo`.
```

O Prisma exige os dois lados da relação. Declarar o lado de lá obrigaria a
**editar o arquivo do core** — exatamente o que não pode acontecer, porque esse
arquivo é compartilhado com os outros clientes.

E não dá para contornar reabrindo o model em outro arquivo. Também testado:

```
error: The model "Processo" cannot be defined because a model with that name
already exists.
```

### A saída (validada)

O model do cliente guarda a chave **sem** `@relation`:

```prisma
model ServidorMunicipal {
  id         String  @id @default(uuid())
  matricula  String  @unique
  secretaria String
  /// FK lógica para `processos.id`. Sem `@relation` porque o Prisma exigiria o
  /// campo oposto no model do core, que é compartilhado e não pode ser editado
  /// por um cliente. A integridade é criada por SQL na migration DO CLIENTE, e
  /// o join é feito na aplicação.
  processoId String? @map("processo_id")

  @@index([processoId])
  @@map("servidores_municipais")
}
```

E a migration do cliente cria a FK de verdade, que o Prisma não conhece mas o
Postgres respeita:

```sql
ALTER TABLE "servidores_municipais"
  ADD CONSTRAINT "servidores_municipais_processo_id_fkey"
  FOREIGN KEY ("processo_id") REFERENCES "processos"("id") ON DELETE SET NULL;
```

**O preço:** você perde `include: { processo: true }` naquele model e faz o join
à mão. É um preço pequeno, e ele empurra o desenho na direção certa: **quanto
menos os models do cliente se amarrarem aos do core, mais fácil evoluir o core.**

### Como o core chega ao schema de cada cliente

Duas opções. Recomendo a primeira:

**(a) Um script copia `_core.prisma` do pacote para cada app** (`npm run
core:sync`), rodando junto do CI. O arquivo do cliente nunca é tocado; o do core
é sobrescrito. Se alguém editar `_core.prisma` à mão, o script desfaz — e é
justamente isso que se quer.

**(b) Cada app mantém a cópia manualmente.** Mais simples de entender e mais
fácil de esquecer. Aceitável com dois clientes, ruim com quatro.

### Migrations

Cada cliente tem a **própria pasta** de migrations e o próprio histórico —
inclusive o SENATEPI, com as 77 que já existem. Quando o core ganha uma tabela:

1. gera-se a migration no app de referência (SENATEPI);
2. copia-se o arquivo `.sql` para os demais apps;
3. `prisma migrate deploy` roda em cada banco no deploy.

Parece manual porque é. Com dois ou três clientes é aceitável; se chegar a
cinco, vale automatizar a cópia no mesmo script do `core:sync`.

> **Regra inegociável:** migration do core é sempre **aditiva** (adiciona coluna,
> tabela ou índice; nunca remove nem renomeia). Uma migration destrutiva precisa
> rodar igual em N bancos, e basta um deles estar em estado diferente para o
> deploy travar — e, como `prisma migrate deploy` está acoplado ao `start` da
> API, deploy travado é **serviço fora do ar**.

---

## 12. Riscos e o que **não** fazer

| Risco | Como evitar |
|---|---|
| Trocar npm por pnpm no meio do caminho | Não troque. npm workspaces já faz o necessário; a troca reconstrói lockfile, Railway e `postinstall` do Prisma sem ganho |
| Renomear 871 tokens de cor e quebrar a tela | Commit isolado, `next build` e revisão visual das 5 telas principais antes de seguir |
| Extrair `core` antes do cliente nº 2 | Fases 0–2 primeiro. Só extraia o que já provou ser neutro |
| Mexer no banco de produção nesta etapa | Nada de migration nova até a Fase 2, e mesmo lá: só aditiva |
| Mudar o Root Directory e derrubar produção | Serviço de teste primeiro; rollback é voltar o campo |
| O cron noturno parar durante a refatoração | Após cada merge, conferir `logs_sincronizacao_datajud` no dia seguinte (às 02:00 Fortaleza) |

---

## 12.1 Dependência externa: DJEN e o VPS

O DJEN continua **bloqueado** a partir do Railway — o CloudFront do CNJ recusa
os IPs de fora do Brasil. Isso não impede nenhuma fase deste plano, mas:

- o módulo jurídico só entrega o teor das publicações depois da migração;
- **cada cliente novo precisará de um IP que o CNJ aceite.** Se o padrão de
  deploy virar "VPS em São Paulo", isso entra no roteiro de nascimento do
  cliente (§9, passo 4).

Quando o VPS estiver de pé, o teste decisivo é uma linha:

```bash
curl -s -D - -o /dev/null \
  "https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroProcesso=00007641120215220002" | head -20
```

Cabeçalho `X-RateLimit-*` presente = liberado. `403` sem esses cabeçalhos =
bloqueio de origem.

---

## 13. Checklist de execução

```
FASE 0 — tirar o cliente do código
[ ] branch refatoracao-monorepo
[ ] apps/api/src/tenant/tenant.config.ts
[ ] apps/web/src/tenant.config.ts
[ ] paleta senatepi-* → brand-* (commit isolado)
[ ] 94 hardcodes de "SENATEPI" → tenant.nome (menos os que são dado)
[ ] build + testes verdes

FASE 1 — módulos ligáveis
[ ] @Modulo() nos 15 controllers restantes
[ ] PermissionsGuard consulta tenant.modulos → 404
[ ] menu lateral filtra por tenant.modulos
[ ] teste local desligando colonia e eventos

FASE 1.5 — CI (fazer JUNTO com a Fase 1, não depois)
[ ] .github/workflows/ci.yml
[ ] npm run build --workspaces passando
[ ] regra: merge na main só com CI verde

FASE 2 — domínio configurável
[ ] levantar com o SINDSERM os campos do cadastro de servidor
[ ] FormacaoProfissional vira tabela cadastrável "cargos" (+ migration de dados)
[ ] campos_customizados + valores_campos_customizados
[ ] formulário de filiado renderiza os customizados
[ ] tela de administração dos campos

FASE 3 — extrair pacotes
[ ] packages/core-infra
[ ] packages/core-juridico  ← o mais valioso
[ ] packages/core-identidade
[ ] packages/core-ui
[ ] contrato FonteDeAndamentos + DatajudFonte + DjenFonte
[ ] schema multi-arquivo + script core:sync (§11)

FASE 4 — deploy
[ ] serviço de teste no Railway com os caminhos novos
[ ] trocar Root Directory da produção do SENATEPI
[ ] conferir o cron das 02:00 no dia seguinte

FASE 5 — nascimento do SINDSERM
[ ] apps/sindserm/ (config, schema, módulos)
[ ] projeto Railway + banco vazio
[ ] migrate deploy + seed
[ ] deploy
```

---

## 14. Recomendação final

**Fases 0, 1 e o CI: comece agora.** São baratas, de baixo risco e deixam o
sistema melhor mesmo que o SINDSERM nunca saia do papel.

**A Fase 2 deixou de ser opcional.** Antes, minha recomendação era segurá-la até
existir um segundo cliente — para não adivinhar quais campos ele quer. Com o
SINDSERM definido, essa dúvida acabou: dá para perguntar. **Mas pergunte antes
de codar** — as três perguntas do §5 são o insumo da Fase 2, e construir os
campos customizados sem elas é repetir o erro que a espera evitava.

**A Fase 3 é a que vende.** O `core-juridico` — DataJud, todas as instâncias até
o TST, radar de audiências pelo complemento do CNJ, correlação com o DJEN,
detecção de partes duplicadas — não existe pronto no mercado para sindicato. E o
SINDSERM prova o ponto: sendo servidor público, o jurídico dele corre no TJPI e
no TRT22, e o core já atende os dois sem uma linha nova.

### A ordem que eu seguiria

```
1. Fase 0 + Fase 1 + CI          ≈ 5 dias   → merge e deploy do SENATEPI
2. Conversa com o SINDSERM       ≈ 1 reunião → responde as 3 perguntas do §5
3. Fase 2                        ≈ 1–2 sem   → campos e domínio configuráveis
4. Fase 3 (core-juridico antes)  ≈ 1 sem     → extração dos pacotes
5. Fase 4 + Fase 5               ≈ 2 dias    → SINDSERM no ar
```

**O SENATEPI passa pela refatoração primeiro.** Não há como testar o core com
outro cliente antes: as Fases 0 e 1 mudam o código que está em produção hoje. O
que a branch garante é que nada chega lá antes de você mandar — e que o rollback
é um `git revert`.

---

## 15. Fase 3b — a bifurcação, medida

> Seção escrita **depois** da Fase 3a, com números colhidos no código e um teste
> executado. Ela corrige o §3 e o §11 deste plano em um ponto que muda o desenho.

### O que a Fase 3a provou

`@core/infra` (storage, QR Code, utilitários) saiu da API e funciona: o
TypeScript acha os tipos, o Node acha o código em produção e a injeção de
dependência do Nest atravessa a fronteira do pacote — a API **compilada** sobe
inteira. 221 testes preservados (199 na API + 22 no pacote).

Essa era a pergunta da Fase 3a, e a resposta é sim.

### O que a medição do jurídico mostrou

O módulo `processos` (11.236 linhas) + `agenda` (2.012, que vem junto) importa
de fora de si mesmo:

| Dependência | Vezes | Natureza |
|---|---|---|
| `prisma/prisma.service` | 14 | **acesso a 14 models do banco** |
| `common/audit/audit.service` | 5 | depende de Prisma |
| `common/permissions/*` | 6 | é o RBAC — ou seja, `core-identidade` |
| `common/decorators/*` | 6 | idem |
| `tenant/tenant.config` | 1 | contrato do tenant |
| `agenda/*` | 2 | outro core |

**Correção ao §3:** os pacotes não são independentes. `core-juridico` **não pode
vir antes** de `core-identidade` — o §14 recomendava exatamente o contrário
("core-juridico antes"). A ordem real é imposta pelo grafo de dependências, não
por valor comercial.

### O teste que decide

Se cada cliente é um app com o próprio schema (§11), os dois apps convivem no
mesmo workspace. Testei se dois schemas podem coexistir:

```bash
# schema do "cliente 2", com um único model
npx prisma generate --schema apps/api/prisma/_teste/cliente2.prisma
```

| | antes | depois |
|---|---|---|
| `export type Processo` no client gerado | 1 | **0** |
| `export type ServidorMunicipal` | 0 | **1** |

**O segundo `prisma generate` apaga o client do primeiro.** O client é gerado em
`node_modules/.prisma/client`, que o npm workspaces **içou para a raiz** — é um
lugar só, e o último a gerar vence.

A saída seria dar a cada app um `output` próprio. Só que aí um pacote
compartilhado deixa de poder fazer `import { Prisma } from '@prisma/client'` —
e são **14 pontos** no jurídico que perderiam tipagem, ou exigiriam plumbing de
genéricos em 13 mil linhas.

### As duas saídas honestas

**(A) Dois apps + pacotes compartilhados** — o plano como está escrito. Exige,
nesta ordem: `output` de Prisma por app, `core-identidade`, `core-persistencia`,
e só então `core-juridico`. É a arquitetura certa para 5+ clientes. Custo: uma a
duas semanas, sem nada visível para o usuário no fim.

**(B) Um app, cliente escolhido por `TENANT`** — o mesmo código para todos, e a
instalação decide o que existe. Isto **já está construído**: as Fases 0/1/2
entregaram `tenant.config.ts`, `@ModuloTenant`, `ModuloAtivoGuard` (404) e
`camposOcultos`. Falta só o config deixar de ser um arquivo e virar uma escolha
por variável de ambiente. Cada cliente continua com **banco próprio e serviço
próprio no Railway** — a exigência do §1 é atendida igual.

|  | (A) dois apps | (B) um app + `TENANT` |
|---|---|---|
| Bancos isolados | sim | sim |
| Migrations | uma cópia por app, à mão (§11) | **uma história só** |
| Prisma client | um `output` por app | **um só** |
| Módulo desligado no cliente | não é compilado | 404 pelo guard + menu escondido |
| Tabela de outro cliente no banco | não existe | existe, vazia |
| Trabalho restante | 1–2 semanas | ~1 dia |

**O preço real de (B)** é o único ponto em que (A) ganha: o banco do SINDSERM
carregaria as tabelas da colônia do SENATEPI, vazias, e uma migration de um
cliente roda no banco de todos. Com dois a quatro clientes isso é ruído. Com
dez, é bagunça — e aí (A) deixa de ser prematura e passa a ser necessária.

Vale lembrar a régua que este próprio plano fixou no §3: *extrair cedo demais
custa duas refatorações*. Com um cliente em produção e um segundo por nascer,
(B) é o que a régua manda.

### A decisão, nas palavras do cliente

> *"Cada cliente tem seu banco de dados, mas alguns módulos são CORE, como por
> exemplo o jurídico, que não muda muito de um sindicato ao outro. Cada sindicato
> é independente, mas a 'forma de bolo' é a mesma. Se o módulo jurídico
> atualizar, atualiza em todos os sindicatos, mas caso o sindicato queira algo em
> específico no módulo jurídico, faz alterações só no tenant dele. Em resumo, é
> praticamente o mesmo código pra todos, mas alguns módulos vão ficar padrão como
> já está e outros não serão necessários ou serão necessários porém com
> mudanças."*

É a saída **(B)**, e ela está implementada. Um build serve a todos; `TENANT` diz
de qual sindicato é a instalação.

### Os três mecanismos para um cliente variar, em ordem de preferência

| Quero… | Uso | Onde |
|---|---|---|
| que o módulo não exista aqui | `modulos` | menu some **e** a rota some (front) **e** a API responde 404 |
| que um campo não seja pedido | `camposOcultos` | esconde na tela; a coluna continua no banco |
| que se chame outra coisa | `vocabulario` | «servidor» em vez de «filiado» |

**A regra que evita o pior erro:** nunca apagar coluna para agradar um cliente.
O `formacao` some da tela do SINDSERM e continua guardando o histórico inteiro
do SENATEPI. Uma migration destrutiva roda em todos os bancos.

Quando nenhum dos três resolve — o cliente precisa de comportamento **diferente**
no mesmo módulo —, o caminho é um ponto de extensão nomeado no core, não um `if
(tenant.id === 'x')` no meio da lógica. O §10 já descreve os três formatos
(fonte adicional, evento de domínio, slot na tela).

### O que a Fase 4 (deploy) ganha de obrigação

**Duas variáveis novas, e esquecê-las derruba o serviço** — de propósito, porque
a alternativa silenciosa é pior (ver o comentário em `tenant.config.ts`):

| Serviço | Variável | Valor |
|---|---|---|
| API do SENATEPI | `TENANT` | `senatepi` |
| Web do SENATEPI | `NEXT_PUBLIC_TENANT` | `senatepi` |
| API do SINDSERM | `TENANT` | `sindserm` |
| Web do SINDSERM | `NEXT_PUBLIC_TENANT` | `sindserm` |

`NEXT_PUBLIC_TENANT` é lida no **build**, não no start: mudá-la exige rebuild, e
isso é correto — a paleta é compilada dentro do CSS pelo Tailwind.

### O que sobrou pendente do SINDSERM

Os campos marcados «confirmar» em `apps/api/src/tenant/tenants/sindserm.ts`:
CNPJ, registro sindical, endereço, percentual da contribuição, cores
institucionais, e se `cobrancas` e `empresas` ficam mesmo desligadas. Estão
todos num arquivo só, para serem resolvidos numa passada.

### Vocabulário: concluído

`tenant.vocabulario` existia desde a Fase 0 e **não era lido por ninguém** — a
configuração estava lá e a tela continuava com o texto escrito à mão. `V`
(`apps/web/src/lib/vocabulario.ts`) é a ponte, com as quatro formas que o
português exige prontas (`filiado`, `filiados`, `Filiado`, `Filiados`, mais
`matricula`), em vez de espalhar `.toUpperCase()` pela interface.

**71 trocas em 36 arquivos.** Zero ocorrência de «filiado» sobrou em texto de
tela.

O que o inventário mostrou, e por que a substituição automática teria sido um
desastre:

| | Quantidade | Ação |
|---|---|---|
| Identificadores — `/filiados` (rota), `'filiados'` (chave), `filiadoId`, `type Filiado` | **383** | **intocados** — trocar qualquer um quebra o sistema sem mudar uma palavra na tela |
| Texto de tela — JSX, `label`, `placeholder`, `title`, `toast` | 68 | trocados |
| Rótulos em `lib/` — desfecho, providência, aviso legal | 6 | trocados |

Ficaram de fora, de propósito: `'FILIADO' | 'COLABORADOR'` (valor que vem da
API), `'CARTEIRA_FILIADO'` (enum) e a menção em comentário de `permissoes.ts`,
que é registro histórico e não tela.

Verificado executando com os dois tenants: menu, matriz de permissões, rótulo de
cancelamento e providência do DJEN saem «Filiado…» no SENATEPI e «Servidor…» no
SINDSERM.

---

## 16. O SINDSERM já roda — como testar hoje, sem Railway

Não é projeção: o segundo cliente foi levantado localmente e verificado.

### O que foi feito, e o resultado

```bash
# 1. banco novo, vazio, separado
CREATE DATABASE sindserm_dev;

# 2. o histórico INTEIRO de migrations roda do zero
DATABASE_URL=".../sindserm_dev" npx prisma migrate deploy
#   → All migrations have been successfully applied.

# 3. a API sobe como SINDSERM contra o banco dele
TENANT=sindserm DATABASE_URL=".../sindserm_dev" \
  SEED_ADMIN_EMAIL="admin@sindserm.org.br" node dist/src/main.js
```

| Verificação | Resultado |
|---|---|
| Migrations do zero em banco novo | ✅ todas aplicadas |
| API sobe como SINDSERM | ✅ |
| Admin criado com o e-mail do cliente certo | ✅ `admin@sindserm.org.br` |
| Avisa que a senha padrão é insegura | ✅ (e em produção **recusa** criar sem `SEED_ADMIN_PASSWORD`) |
| Seed da colônia **não** roda | ✅ nenhuma linha no log |
| Portaria (`acessos`) montada | ✅ rotas mapeadas |
| `GET /api/colonia/disponibilidade` (módulo desligado) | ✅ **HTTP 404** |
| `GET /api/health` | ✅ HTTP 200 |
| `POST /api/acessos/validar` | ✅ HTTP 401 (existe, pede autenticação) |

O 404 da colônia é a prova que importa: não é menu escondido, é rota que **não
existe** naquela instalação.

### Rodar os dois, lado a lado

```bash
npm run dev            # SENATEPI  ·  API 3333  ·  web 3000  ·  banco "senatepi"
npm run dev:sindserm   # SINDSERM  ·  API 3334  ·  web 3001  ·  banco "sindserm_dev"
```

Podem ficar no ar ao mesmo tempo, em dois terminais. Cada um tem porta, banco e
diretório de build próprios.

Entre no SINDSERM com `admin@sindserm.org.br`. O que muda em relação ao
SENATEPI: **azul**, «Servidores» no menu, sem Colônia, sem Cobranças, sem
Empresas, **com Portaria**, e o cadastro sem Formação e sem COREN.

**O que faz isso funcionar** (`scripts/dev.js` e os arquivos de ambiente):

| Arquivo | Conteúdo |
|---|---|
| `apps/api/.env` | base comum: segredos, JWT, storage |
| `apps/api/.env.<cliente>` | **só o que muda**: `DATABASE_URL`, `API_PORT`, `SEED_ADMIN_EMAIL` |
| `apps/web/.env.local` | base do front |
| `apps/web/.env.<cliente>` | **só o que muda**: `NEXT_PUBLIC_API_URL` |

O arquivo do cliente vence — funciona sem gambiarra porque o `ConfigModule` do
Nest só grava em `process.env` a chave que ainda não existe. Nenhum `.env` vai
para o git.

O script é Node, e não variável na linha do npm, porque `TENANT=x npm run dev`
funciona no bash e falha no cmd do Windows.

### Onde se define a identidade visual

| O quê | Onde | Efeito |
|---|---|---|
| **Paleta** (10 tons) | `apps/web/src/tenant/tenants/<cliente>.ts` | tudo: `bg-brand-*`, gráficos, cor da aba do navegador |
| **Logo** | `apps/web/public/<cliente>-<horizontal\|vertical>-<cor\|branco>.png` | 4 arquivos por sindicato |
| **Nome, sigla, vocabulário** | `tenant/tenants/<cliente>.ts` (nos dois apps) | títulos, menu, documentos |
| **Favicon / ícone do PWA** | `apps/web/public/` | aba e app instalado |

Sobre a paleta: **os dez degraus são obrigatórios**. O Tailwind não emite classe
para tom inexistente, então um degrau faltando vira `bg-brand-700 text-white`
como texto branco sobre fundo branco — já aconteceu. E o 700 precisa passar em
contraste AA com texto branco, porque é o tom dos botões primários e das abas.

Sobre o logo: se os arquivos ainda não existirem, o componente **cai para a
sigla escrita** na cor da marca. Um cliente novo entra no ar apresentável antes
de o designer entregar os arquivos, e um `id` com typo vira texto em vez do
ícone de imagem quebrada no topo de todas as telas.

### O que ainda falta para o SINDSERM em PRODUÇÃO

Nada de código. O que falta é do sindicato e da infraestrutura:

1. Os campos «confirmar» de `tenant/tenants/sindserm.ts`: CNPJ, endereço,
   registro sindical, percentual da contribuição e as cores institucionais
   reais (a paleta azul de hoje é provisória).
2. Projeto no Railway: API + Web + Postgres, com `TENANT`,
   `NEXT_PUBLIC_TENANT`, `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD`.
3. Carga inicial da base de servidores (a importação por CSV já existe).
4. **Se o jurídico deles for usar o DJEN**, o IP do deploy precisa ser aceito
   pelo CNJ — é a mesma pendência do SENATEPI (§12.1), e é o único item que não
   depende só de nós.
