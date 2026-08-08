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

Se as pastas de `apps/senatepi` mantiverem `api/` e `web/` como estão hoje, o
**Root Directory** do Railway muda de `apps/api` para `apps/senatepi/api`. É uma
alteração de configuração, feita com o serviço no ar e revertível em um clique.

**Ordem segura:**
1. Merge da branch com produção **ainda apontando para os caminhos antigos**
   (mantenha `apps/api` como link ou faça o merge só depois do passo 2).
2. Criar um **serviço de teste** no Railway apontando para os caminhos novos e
   para um banco de cópia.
3. Confirmado o teste, trocar o Root Directory dos serviços de produção.
4. Rollback = voltar o Root Directory.

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
| Colônia de férias | Sim | A confirmar | Módulo ligável (Fase 1) |
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
definem os campos customizados:

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

Depois das Fases 0–2, criar um cliente é **dias, não meses**. Roteiro, usando o
SINDSERM como exemplo:

```bash
# 1. estrutura do app, a partir da forma do SENATEPI
apps/sindserm/
├── api/            (NestJS: importa os cores + módulos próprios)
├── web/            (Next.js: importa core-ui + páginas próprias)
└── tenant.config.ts
```

2. `apps/sindserm/tenant.config.ts` — nome, sigla, CNPJ, cores, logo, módulos
   ativos, vocabulário (`servidor` em vez de `filiado`, se for o caso).
3. `apps/sindserm/api/prisma/schema/` — `_core.prisma` (cópia do core) +
   `sindserm.prisma` (models próprios). Ver §11.
4. Projeto novo no Railway: API + Web + Postgres. **Banco vazio e separado.**
5. `prisma migrate deploy` — as migrations rodam do zero no banco novo.
6. Seed do cliente: perfis de acesso, tipos de evento, cargos, campos
   customizados, tipos de andamento.
7. Deploy.

**Nada é compartilhado em runtime.** Se o SINDSERM cair, o SENATEPI não sente —
são bancos, deploys e domínios diferentes.

### O que decidir com o SINDSERM antes do passo 2

- **Módulos ativos:** Colônia de Férias? Eventos? Carteirinha? Empresas
  Patronais (que para eles seriam órgãos da Prefeitura)?
- **Vocabulário:** "filiado", "associado" ou "servidor"? "matrícula" ou
  "inscrição"?
- **Campos próprios do cadastro:** matrícula funcional, secretaria de lotação,
  cargo, regime, data de posse.
- **IP para o DJEN:** se o jurídico deles for usar publicações, o deploy precisa
  sair de um IP que o CNJ aceite (§12.1).

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
