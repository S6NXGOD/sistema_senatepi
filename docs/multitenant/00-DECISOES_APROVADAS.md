# 00 — Decisões aprovadas

> **Autoridade.** Este documento é a fonte da verdade sobre as decisões de arquitetura
> multi-tenant. Onde ele conflitar com os documentos 01–06, **ele vence** e o documento
> divergente deve ser corrigido.
>
> **Nada foi implementado.** Nenhum código, schema ou migration alterado.
>
> **Data de aprovação:** 2026-08-02 · **Commit base:** `adc64d8`

---

## Princípio que governa todas elas

> **O sistema precisa continuar funcionando exatamente como funciona hoje para o
> sindicato atual. A única diferença perceptível deve ser que agora existem outros.**

Toda decisão abaixo foi avaliada contra esse critério. Onde uma alternativa teoricamente
melhor exigiria mudar o comportamento atual, ela foi descartada ou adiada.

---

## Sumário das decisões

| # | Decisão | Reversível? |
|--:|---|:--:|
| [D1](#d1--escala-alvo-dezenas-de-sindicatos) | Dezenas de sindicatos, sem impedir centenas | 🟡 Média |
| [D2](#d2--user-global-com-membership-por-tenant) | `User` global + tabela de membership | 🔴 Difícil |
| [D3](#d3--empresa-pertence-ao-tenant) | `Empresa` pertence ao tenant | 🟢 Fácil |
| [D4](#d4--processo-pertence-ao-tenant) | `Processo` pertence ao tenant | 🟡 Média |
| [D5](#d5--catálogos-de-apoio) | Catálogos de apoio pertencem ao tenant | 🟢 Fácil |
| [D6](#d6--isolamento-banco-compartilhado--rls) | Banco compartilhado + RLS | 🟡 Média |
| [D7](#d7--roteamento-subdomínio-no-front-jwt-na-api) | Subdomínio no front, JWT na API | 🟢 Fácil |
| [D8](#d8--backup-total-sem-restore-granular-na-v1) | Backup total, sem restore granular na v1 | 🟢 Fácil |
| [D9](#d9--operador-da-plataforma-é-identidade-separada) | Operador da plataforma separado de `User` | 🟢 Fácil |
| [Q1](#q1--campos-personalizados-controlados-pela-plataforma) | Campos personalizados controlados pela plataforma | 🟢 Fácil |
| [Q2](#q2--módulos-contratados-via-backoffice) | Módulos contratados via backoffice | 🟢 Fácil |
| [Q3](#q3--suspensão--desativação--cancelamento) | Suspensão ≠ desativação ≠ cancelamento | 🟢 Fácil |
| [Q4](#q4--branding-administrado-pela-plataforma) | Branding administrado pela plataforma | 🟢 Fácil |
| [Q5](#q5--domínio-personalizado-fora-da-v1) | Domínio personalizado fora da v1 | 🟢 Fácil |
| [Q6](#q6--limite-de-30-campos-personalizados) | 30 campos personalizados por entidade/tenant | 🟢 Fácil |

---

## D1 — Escala alvo: dezenas de sindicatos

**Decisão.** A plataforma será projetada inicialmente para **dezenas** de sindicatos, sem
impedir crescimento para centenas.

**Justificativa.** É a faixa em que banco compartilhado é claramente superior a
banco-por-tenant. O doc 02 §5-D mostrou que banco dedicado só venceria com **≤ ~10
clientes de alto valor**; e R-4 mostrou que N clientes Prisma esgotam o pool do Postgres
do Railway em ~15–20 tenants por instância. Dezenas coloca a decisão firmemente no
território do compartilhado.

**Consequências.**
- Confirma D6 e encerra a única dúvida capaz de invertê-lo (doc 02 §5-D, §9-D1).
- Onboarding precisa ser **operação de segundos** (`INSERT` + seeds), não provisionamento
  de infraestrutura.
- Índices compostos `(tenant_id, …)` deixam de ser otimização e viram requisito: com
  dezenas de tenants no mesmo índice, um `@@index([situacao])` isolado perde seletividade.
- Custo no Railway permanece de **um** Postgres.

**Documentos afetados.** 02 (§5-D, §9-D1 encerrada), 05 (§18), README.

**Revisão futura.** 🟡 Se a escala passar de centenas, a saída não é trocar de modelo — é
*sharding* por grupo de tenants, mantendo o mesmo schema. D6 já prevê a extração
individual.

---

## D2 — `User` global com membership por tenant

**Decisão.** `User` será identidade **global**, vinculada aos tenants por uma tabela de
membership contendo papel, permissões, status e demais configurações daquele sindicato.

**Justificativa.** É a única forma de atender o caso real que motivou a pergunta: um
advogado que atende dois sindicatos. Duplicar a conta duplicaria senha, MFA futuro e
trilha de auditoria da mesma pessoa. `User.email` permanecer único globalmente é
**consequência desejada**, não efeito colateral.

**Consequências — esta é a decisão de maior custo do conjunto.**

1. **`User.role` e `User.permissoes` deixam de existir em `users`.** Movem para o
   membership. Isso toca:
   `modules/auth/strategies/jwt.strategy.ts:33-52` (monta `AuthUser`) ·
   `modules/auth/auth.service.ts:83-89` (claims) ·
   `modules/auth/guards/roles.guard.ts:24-25` · `common/permissions/permissions.guard.ts:43-68` ·
   `common/permissions/permissoes.constants.ts:130-140` (`nivelEfetivo`) ·
   `common/decorators/current-user.decorator.ts:4-12` (`AuthUser`) ·
   `modules/usuarios/*` · `modules/profile/*` · e o espelho no front
   `apps/web/src/lib/permissoes.ts:90-135`.
   **É mais do que "acrescentar uma tabela".**

2. **A proteção de FK composta não funciona para referências a `User`.** O doc 05 §8.3
   propôs `FOREIGN KEY (tenant_id, filiado_id) REFERENCES filiados (tenant_id, id)`. Com
   `users` sem `tenant_id`, isso é impossível para as ~21 relações que apontam para
   `users` (`Compromisso.responsavelId`, `Compromisso.criadoPor`, `Processo.advogadoId`,
   `ProcessoAdvogado.advogadoId`, `EscalaAdvogado.advogadoId`, `Auditoria.userId`,
   `MovimentacaoInterna.autorId`, `ContribuicaoPatronal.analisadoPor`,
   `Recadastramento.revisorId`, `CompromissoHistorico.autorId`).
   **Solução:** essas FKs compostas referenciam o **membership**, não `users`:
   ```
   FOREIGN KEY (tenant_id, advogado_id)
     REFERENCES tenant_memberships (tenant_id, user_id)
   ```
   Exige `UNIQUE (tenant_id, user_id)` no membership — que já é a PK natural.
   **Efeito colateral positivo:** o banco passa a garantir que só se atribui um processo a
   quem é membro daquele sindicato.

3. **O login ganha uma etapa que hoje não existe** (ver §"Decisões que tomei" — G1).

4. `RefreshToken` e `PasswordReset` continuam ligados ao `User` global e ficam **fora do
   RLS** — são a zona de resolução (doc 03 §4.2).

5. **`User.email` e `User.username` permanecem únicos globalmente.** Isso **corrige** o
   doc 02, que os listava entre as unicidades a converter em compostas.

**Documentos afetados.** 01 (§3 linha 1, §4.6), 02 (§5-B item 11, §9-D2), 03 (§2.3, §4.2,
§5, §10), 05 (§6.3, §8.3), 06 (§1).

**Revisão futura.** 🔴 Difícil. Migrar de global para por-tenant depois exigiria dividir
contas existentes — e decidir qual histórico vai para qual lado. **Decidir agora foi o
certo.**

---

## D3 — `Empresa` pertence ao tenant

**Decisão.** `Empresa` pertence ao tenant. O mesmo CNPJ pode existir em tenants
diferentes, com credenciais, contribuições e configurações independentes.

**Justificativa.** A relação modelada não é "a empresa X existe" — é "a empresa X é
conveniada **deste** sindicato", com senha de portal, histórico de contribuição e
auditoria próprios. Uma empresa com filiais em dois estados negocia com dois sindicatos em
termos diferentes; unificar o registro obrigaria a separar tudo o que pende dele.

**Consequências.**
- `Empresa.cnpj` vira `@@unique([tenantId, cnpj])`.
- **O login do portal patronal precisa saber o tenant antes de resolver o CNPJ**
  (doc 03 §4.2 item 6). Com D7, o subdomínio informa; sem ele, o CNPJ sozinho é ambíguo.
  Ver G2.
- `Empresa.senhaHash` e `primeiroAcesso` passam a ser por tenant — o que já é o
  comportamento desejado.
- `brasil-api.service.ts` (consulta externa de CNPJ) continua global — é dado público,
  não do tenant. **Oportunidade:** cache compartilhado dessa consulta entre tenants,
  economizando chamadas.

**Documentos afetados.** 01 (§3 linha 25), 02 (§9-D3), 03 (§4.2, §5.2), 05 (§6.3), 06.

**Revisão futura.** 🟢 Fácil. Unificar depois é uma tabela de vínculo; separar depois seria
difícil. A escolha conservadora está certa.

---

## D4 — `Processo` pertence ao tenant

**Decisão.** `Processo` pertence ao tenant inicialmente. O mesmo `numeroCNJ` pode existir
em mais de um tenant.

**Justificativa.** O que o sistema guarda **não é o processo** — é o acompanhamento dele:
status interno, movimentações internas com autor, anexos do escritório, prazos na agenda,
equipe designada. Isso é do sindicato, não do tribunal. `MovimentacaoProcessual` é espelho
recriável do DataJud; duplicá-la é barato. Duplicar `MovimentacaoInterna` seria errado — e
ela já está em tabela separada (`schema.prisma:2029-2036`), o que confirma o desenho.

**Consequências.**
- `Processo.numeroCNJ` vira `@@unique([tenantId, numeroCNJ])`.
- **Custo de API a monitorar:** se dois tenants acompanham o mesmo NPU, o cron do DataJud
  consulta o CNJ **duas vezes** para o mesmo dado. A API pública do CNJ é *rate-limited* e
  compartilhada, e o cron já usa delay de 2–3s por processo
  (`processos-cron.service.ts:20-21`). Com dezenas de tenants, a janela noturna cresce
  linearmente **e** pode haver desperdício por duplicidade.
  **Recomendação (não pedida):** medir a taxa de NPU repetido entre tenants via
  `TenantUso`. Se passar de ~5%, introduzir um cache de resposta do DataJud
  **compartilhado e somente-leitura**, mantendo `Processo` por tenant. É otimização de
  custo, não mudança de modelo — e não precisa entrar na v1.
- `ParteExterna` acompanha (D5): duplicada por tenant.

**Documentos afetados.** 01 (§3 linha 38), 02 (§9-D4), 05 (§6.3), 06 (§13).

**Revisão futura.** 🟡 Média. Extrair um espelho global depois é aditivo (nova tabela +
backfill). O `numeroCNJ` continuaria em `Processo` como referência.

---

## D5 — Catálogos de apoio

**Decisão.** `Cargo`, `Departamento`, `TipoCompromisso` e `ParteExterna` pertencem ao
tenant. `TipoAndamento` seria global **somente se comprovadamente catálogo oficial e
imutável**; caso contrário, tenant.

### Veredito sobre `TipoAndamento`: **TENANT** — a condição foi refutada

Evidência levantada no código:

| Evidência | Onde |
|---|---|
| Tem `sistema Boolean @default(false)` — logo, existem tipos **não-sistema** | `schema.prisma:2022` |
| `MovimentacaoInterna.tipo` documentado como *"Slug de TipoMovimentacao (**cadastrável**)"* | `schema.prisma:2040` |
| O código **desambigua slug em loop**, padrão de criação por usuário | `modules/processos/movimentacoes.service.ts:373` |
| Existe controller dedicado de CRUD (`tipos-movimentacao`) | doc 01 §2 |
| Tem `cor`, `ordem`, `ativo` — atributos de apresentação editáveis | `schema.prisma:2019-2021` |

Não é catálogo oficial nem imutável. **É TENANT.**

`TipoCompromisso` tem exatamente a mesma forma (`schema.prisma:1498-1510`, com o comentário
`:1494` dizendo que os tipos de sistema *"não podem ser excluídos (só
renomeados/recoloridos/ocultados)"*) — o que confirma que o próprio projeto já trata
edição como comportamento normal.

**Consequências.**
- Cinco unicidades viram compostas: `Cargo.nome`, `Departamento.nome`,
  `TipoCompromisso.slug`, `TipoAndamento.slug` e (via D3/D4) as demais.
- **Os tipos `sistema = true` passam a ser semeados por tenant no onboarding.** Duplicação
  de poucas dezenas de linhas por tenant — irrelevante em volume, e permite que um
  sindicato renomeie "Audiência" sem afetar outro. Preserva exatamente o comportamento
  atual.
- `ParteExterna` duplicada por tenant: o mesmo advogado de tribunal vira um registro por
  sindicato. Aceito — o dado vem do DataJud e é recriável.

**Documentos afetados.** 01 (§3 linhas 23, 24, 34, 39, 45), 02 (§9-D5), 05 (§6.3).

**Revisão futura.** 🟢 Fácil para `TipoAndamento`/`ParteExterna` (promover a global é
aditivo). Difícil para `Cargo`/`Departamento` — mas não há motivo para querer.

---

## D6 — Isolamento: banco compartilhado + RLS

**Decisão.** Isolamento padrão será banco compartilhado com `tenant_id` e PostgreSQL Row
Level Security. Banco dedicado será possibilidade futura para exigência contratual.

**Justificativa.** Confirma a recomendação do doc 02 §6, agora sem a dúvida de D1. O
critério decisivo permanece: **é o único modelo em que esquecer o tenant produz zero
linhas em vez de linhas de outro sindicato** — e, com 4 arquivos de teste em ~27.650
linhas, essa diferença é a única garantia que não depende de vigilância humana.

**Consequências.**
- **48 das 51 tabelas** recebem `tenant_id` e RLS (número exato agora que as decisões
  fecharam — o doc 05 estimava "~50", o doc 02 estimava "~39"; **o doc 05 estava certo na
  ordem de grandeza**).
- 3 tabelas permanecem globais: `User`, `RefreshToken`, `PasswordReset` (D2).
- Custo confirmado: refatorar os 43 `$transaction` e reescrever `prisma.service.ts`.
- Dois papéis de banco e duas `DATABASE_URL` (doc 03 §4.3).
- **Bloqueio ativo:** os spikes S-1 e S-2 continuam sem execução. O desenho de propagação
  (doc 03 §5) é hipótese até que rodem.

**Documentos afetados.** Todos.

**Revisão futura.** 🟡 Extrair um tenant para banco dedicado é previsto e o schema é
idêntico. Abandonar RLS depois de ligado é `DISABLE ROW LEVEL SECURITY` — instantâneo.

---

## D7 — Roteamento: subdomínio no front, JWT na API

**Decisão.** O frontend usará subdomínio por tenant. A API usará o tenant ativo validado
no JWT. Rotas públicas resolverão tenant pelo recurso, token, slug ou identificador.

**Justificativa.** É exatamente o desenho proposto no doc 03 §2.4, e o de menor mudança de
topologia: `NEXT_PUBLIC_API_URL` é embutida no **build** (`README-DEPLOY.md:78-85`), então
uma API por subdomínio exigiria um build de front por tenant. Com a claim no JWT, são
**um** deploy de API e **um** de front servindo N subdomínios.

**Consequências.**
- **`CORS_ORIGINS` precisa aceitar curinga.** Hoje `main.ts:49-52` faz
  `split(',')` sobre lista fixa. Com `*.senatepi.app`, precisa virar função de origem
  (regex sobre o host). **Item concreto, fácil de esquecer, e que quebra tudo em
  produção se esquecido.**
- O subdomínio é **conferência**, nunca fonte: divergência host × token → 403 + evento de
  segurança (doc 03 §2.4).
- DNS curinga + certificado curinga no Railway — verificar suporte no plano atual.
- A tela de login usa o subdomínio para branding e para pré-selecionar o tenant (Q4).

**Documentos afetados.** 03 (§2.4, §10-D7), 04 (§4), 06 (§11).

**Revisão futura.** 🟢 Fácil. Acrescentar path-based ou seletor pós-login depois é aditivo.

---

## D8 — Backup total, sem restore granular na v1

**Decisão.** A primeira versão terá backup e restore **total**. Restore granular de um
tenant não é requisito de lançamento, mas exportação e evolução futura devem ser previstas.

**Justificativa.** Aceito como decisão de escopo de lançamento.

### ⚠️ Ressalva que registro por dever de honestidade

Esta é **a decisão com que menos concordo**, e o motivo é operacional, não teórico.

Com banco compartilhado e restore apenas total, **não existe caminho para desfazer o erro
de um cliente sem prejudicar os outros**. Se o sindicato A apagar em massa por engano na
terça, a única recuperação é restaurar o banco inteiro para segunda — e todos os demais
tenants perdem um dia de trabalho. Na prática, isso significa que a resposta ao cliente
será *"não dá para recuperar"*.

**O sistema hoje já mitiga isso parcialmente**, e vale preservar: a regra global de que
**apenas o `ADMINISTRADOR` apaga** (`common/permissions/permissions.guard.ts:52-54`)
reduz muito a superfície de exclusão acidental.

**Recomendação (não pedida) — dois itens baratos que eu colocaria na v1:**

1. **Exportação lógica por tenant** (`pg_dump` filtrado ou export aplicacional). Já está
   previsto em "evolução futura"; adiantá-lo custa pouco e é o que torna o restore
   granular possível depois. Sem ele, a v1 não tem sequer como entregar os dados a um
   cliente que cancelar — o que pode ser exigência contratual ou de LGPD (portabilidade).
2. **Soft-delete nas exclusões em massa de alto impacto**, especificamente
   `modules/filiados/duplicidade.service.ts` (que **funde e exclui filiados** — item nº 1
   do mapa de risco do doc 06) e as rotas de exclusão de `filiados` e `processos`.

Nenhum dos dois é restore granular; ambos são o mínimo para que "erro do cliente" não vire
"perda definitiva". **Se forem recusados, que seja com a consequência registrada.**

**Consequências.**
- `TenantBackup` (doc 05 §17.3) nasce como estrutura, mesmo sem uso pleno na v1.
- Política de retenção do Railway precisa ser confirmada (doc 01 C11).

**Documentos afetados.** 02 (§9-D8, critério 16), 05 (§13.3, §17.3).

**Revisão futura.** 🟢 Fácil de acrescentar — desde que a exportação lógica exista.

---

## D9 — Operador da plataforma é identidade separada

**Decisão.** Operador da plataforma será identidade separada de `User`, com acesso
assistido, justificativa, prazo e auditoria.

**Justificativa.** Exatamente o que o doc 05 §17.3 propôs, e pelo mesmo motivo: fundir os
dois faria o suporte ser usuário de algum tenant, e qualquer bug de permissão viraria
acesso cruzado. Separar custa uma tabela e um fluxo de login; fundir custa uma categoria
inteira de vulnerabilidade.

**Consequências.**
- `OperadorPlataforma`, `AcessoAssistido` e `AuditoriaPlataforma` — todas PLATFORM, fora do
  RLS, acessíveis só pelo papel `senatepi_platform`.
- O acesso assistido tem **prazo** e **motivo** obrigatórios; expira sozinho.
- **Reforça D2:** a razão de separar operador de `User` é a mesma que exige que o
  membership seja explícito. Duas identidades, dois modelos de acesso.
- MFA no operador é fortemente recomendado (não está no escopo declarado, mas é a conta
  com maior alcance do sistema inteiro).

**Documentos afetados.** 02 (§9-D9), 03 (§4.1, §10), 05 (§17.3).

**Revisão futura.** 🟢 Fácil de estender; unificar depois seria retrocesso.

---

## Q1 — Campos personalizados controlados pela plataforma

**Decisão.** Campos personalizados serão controlados pela plataforma e poderão ser
limitados por plano ou adicional comercial.

**Justificativa.** Resolve, de saída, o problema apontado no doc 04 §2.4: marcar um campo
como `indexado` é **DDL**. Se fosse botão do cliente, um sindicato criaria índice em
produção pela tela. Com a definição sob a plataforma, `indexado` vira decisão de operação
aplicada por migration — como deve ser.

**Consequências.**
- `CampoPersonalizado` é gerenciado pelo backoffice, não pelo admin do sindicato.
- `Plano.limites` passa a incluir o teto de campos (Q6).
- O sindicato **vê e preenche** os campos; não os cria.
- Reduz o risco de o JSONB virar depósito: quem cria é quem conhece o custo.

**Documentos afetados.** 04 (§2.4, §8-Q1, P6).

**Revisão futura.** 🟢 Abrir self-service depois é fácil; fechar depois seria impopular.

---

## Q2 — Módulos contratados via backoffice

**Decisão.** Módulos serão contratados e administrados pelo backoffice, não livremente
ativados pelo sindicato.

**Consequências.**
- `TenantModulo` é escrito pelo backoffice; a API do tenant só lê.
- As dependências entre módulos (doc 04 §3.3) são validadas no backoffice — e o operador
  precisa de mensagem clara ao tentar ativar `processos` sem `agenda`.
- **Ponto concreto herdado do sistema atual:** a flag `FILIADOS_DUPLICIDADE`
  (`modules/filiados/duplicidade.guard.ts:15-18`) é variável de ambiente **da instalação
  inteira**. Com N tenants, ou vira `TenantModulo`, ou é aposentada.
  **Recomendação:** aposentar. Ela existe para um mutirão de higienização da carga
  legada — trabalho que acontece uma vez, e que o Tenant 1 já fez ou fará antes do
  lançamento. Manter uma tela que exclui filiados ligada para sempre é o risco que o
  próprio comentário do código descreve.

**Documentos afetados.** 04 (§3, §8-Q2).

**Revisão futura.** 🟢 Fácil.

---

## Q3 — Suspensão ≠ desativação ≠ cancelamento

**Decisão.** Suspensão por inadimplência será diferente de desativação ou cancelamento.

**Justificativa.** Os três estados têm respostas HTTP e mensagens diferentes, e confundi-los
gera chamado de suporte ou vazamento de informação.

**Consequências — a tabela normativa:**

| Estado | Rota autenticada | Rota pública | Dados | Interface | Reversível |
|---|:--:|:--:|---|---|:--:|
| **ATIVO** | 200 | 200 | — | Normal | — |
| **SUSPENSO** (inadimplência) | **403** `TENANT_SUSPENSO` | **404** | Preservados | Aviso explicando o motivo — o cliente **precisa** saber por quê | ✅ Imediata |
| **DESATIVADO** (a pedido) | 403 | 404 | Preservados | Tela de acesso encerrado | ✅ |
| **CANCELADO** | **404** | **404** | Retidos por prazo, depois expurgados | Nada — não revelar que existiu | ⚠️ Só dentro do prazo |

- Suspensão devolve 403 **com motivo** em rota autenticada (é preciso comunicar), mas 404
  em rota pública (não expor a situação comercial do sindicato a terceiros).
- Cancelado é 404 em tudo — mesmo tratamento de "nunca existiu".
- **Cron pula tenant suspenso ou cancelado.**
- Prazo de retenção pós-cancelamento é decisão jurídica ainda em aberto (ver
  Inconsistências).

**Documentos afetados.** 03 (§6), 04 (§3.5), 05 (§17.1), 06 (§11).

**Revisão futura.** 🟢 Fácil.

---

## Q4 — Branding administrado pela plataforma

**Decisão.** Branding inicialmente administrado pela plataforma; self-service depois.

**Justificativa.** Resolve o risco do doc 04 §4.6: cor vinda do cliente **não garante
contraste**, e o próprio projeto já registrou o bug de "texto branco sobre fundo branco"
por tom ausente na paleta (`apps/web/tailwind.config.ts`). Com curadoria da plataforma, a
validação WCAG AA vira parte do onboarding em vez de barreira na tela do cliente.

**Consequências.**
- A validação de contraste (doc 04 WL2/WL3) continua obrigatória — **é rede, não
  burocracia**; o operador também erra.
- O fallback neutro (doc 04 §4.7) continua obrigatório: **nunca** cair na marca do
  SENATEPI.
- Onboarding ganha uma etapa de branding.

**Documentos afetados.** 04 (§4, §8-Q4).

**Revisão futura.** 🟢 Fácil.

---

## Q5 — Domínio personalizado fora da v1

**Decisão.** Domínio personalizado não faz parte da primeira versão.

**Consequências.**
- `TenantDominio` nasce como estrutura, mas na v1 só guarda o subdomínio.
- Evita, na v1, a complexidade de TLS/DNS por cliente.
- **Não elimina** a necessidade de CORS curinga (D7) — subdomínio já exige.

**Documentos afetados.** 03 (§2.4), 04 (§8-Q5), 05 (§17.1).

**Revisão futura.** 🟢 Fácil — foi por isso que a estrutura nasce pronta.

---

## Q6 — Limite de 30 campos personalizados

**Decisão.** Limite inicial de 30 campos personalizados por entidade e tenant.

**Justificativa.** Coerente com a escolha de JSONB raso (doc 04 §2.3): acima de ~30 campos
a ergonomia do formulário se degrada antes do desempenho do banco. O limite protege a
tela, não o banco.

**Consequências.**
- Validado na criação da definição, no backoffice.
- `Plano.limites` guarda o teto; 30 é o padrão, não o máximo absoluto.
- 30 campos × 4 entidades = até 120 definições por tenant — irrelevante em volume.

**Documentos afetados.** 04 (§2, §8-Q6).

**Revisão futura.** 🟢 Trivial (é número em configuração).

---

## Decisões que tomei sem que fossem pedidas

Registradas aqui para aprovação ou rejeição explícita. Todas surgiram de lacunas que as
decisões acima abriram.

### G1 · Fluxo de login com identidade global

**Lacuna.** D2 torna `User` global, mas `POST /auth/login` é `@Public()`
(`auth.controller.ts:23-28`) e recebe apenas e-mail e senha. Com o usuário podendo
pertencer a N tenants, **a API não sabe em qual autenticar**.

**Decisão que tomei:**

1. O front envia o tenant do **subdomínio** junto do login (D7).
2. O backend valida credencial e busca os memberships **ativos**.
3. Se o subdomínio informado estiver entre eles → emite o token com aquele `tid`.
4. Se não estiver → **401 genérico**, igual a senha errada. Não revelar que a conta existe
   em outro sindicato.
5. Se não houver subdomínio (acesso pelo domínio raiz) e houver **um** membership →
   auto-seleciona. Se houver **N** → devolve a lista com um token de pré-autenticação de
   vida curta, e o usuário escolhe.

O passo 4 é o que impede que a tela de login vire oráculo de "esta pessoa trabalha em quais
sindicatos".

### G2 · Login do portal patronal

Mesma lacuna com CNPJ (D3). **Decisão:** o portal patronal só é acessível pelo subdomínio
do tenant; o CNPJ sozinho nunca resolve. Sem subdomínio → 404.

### G3 · `RefreshToken` carrega o tenant ativo

**Decisão:** `RefreshToken` permanece global (zona de resolução), mas ganha coluna
`tenantId` indicando o tenant ativo daquela sessão. Sem isso, o refresh não saberia para
qual tenant reemitir o token de quem tem dois.

### G4 · Revogar todas as sessões na virada

**Decisão:** revogar todos os `RefreshToken` no deploy que introduz o `tid` no JWT. Tokens
antigos seriam rejeitados de qualquer forma (doc 03 §6); revogar explicitamente troca
"401 inesperado" por "sessão encerrada, faça login" — comunicável e previsível.

### G5 · Seeds de catálogo por tenant

**Decisão:** os registros `sistema = true` de `TipoCompromisso` e `TipoAndamento` são
semeados **por tenant** no onboarding, não compartilhados. Preserva o comportamento atual
e permite renomeação local.

### G6 · Aposentar `FILIADOS_DUPLICIDADE`

Ver Q2. **Decisão:** aposentar em vez de converter em módulo.

---

## Melhorias que recomendo e que não foram pedidas

| # | Recomendação | Por quê | Custo |
|--:|---|---|:--:|
| **R1** | **Corrigir o serviço de uploads antes da migração** | `main.ts:19-21` + `storage.service.ts:163-166`: com driver `local`, arquivos são servidos **sem autenticação** por URL permanente. **Já é exposição de documento pessoal hoje, com um cliente só.** Multi-tenant só muda a escala | Baixo |
| **R2** | **Exportação lógica por tenant na v1** | Ver D8. Sem ela não há portabilidade LGPD nem caminho para restore granular | Médio |
| **R3** | **Soft-delete em `duplicidade.service.ts`** | Funde e exclui filiados; é o item nº 1 do mapa de risco do doc 06 e sem restore granular (D8) o erro é definitivo | Baixo |
| **R4** | **Fechar os 35 controllers sem `@Modulo` antes de Q2** | Sem isso, "módulo desativado" não desativa nada — a rota continua acessível | Médio |
| **R5** | **Criar `packages/` antes de tudo** | Declarado em `package.json:6-9` e inexistente. `apps/web/src/lib/permissoes.ts` já é cópia manual do backend; D2 vai mexer justamente aí, e sem workspace compartilhado a duplicação triplica | Baixo |
| **R6** | **Rodar S-1 e S-2 antes de escrever qualquer migration** | O desenho de propagação (doc 03 §5) é hipótese não testada. São os dois spikes bloqueantes desde o doc 02 | Baixo |
| **R7** | **MFA no `OperadorPlataforma`** | É a conta com maior alcance do sistema inteiro (D9) | Baixo |
| **R8** | **Métrica de NPU repetido entre tenants** | Decide se o cache compartilhado do DataJud (D4) vale a pena, com número em vez de impressão | Baixo |

---

## Inconsistências ainda abertas

| # | Inconsistência | Onde | Ação |
|--:|---|---|---|
| **I1** | Doc 01 §4.6 diz **17** unicidades colidentes; a contagem real das marcadas "Sim" é **16**. Com D2 (`email` e `username` globais), o número que vira composta é **14** | 01 §4.6, 02 §5-B, 06 §1 | Corrigir os três documentos para **14 compostas + 3 `qrToken` que continuam globais** |
| **I2** | Doc 02 estimou ~39 tabelas com `tenant_id`; doc 05 corrigiu para ~50; o número exato após as decisões é **48** | 02 §5-A/B item 1 | Corrigir o doc 02 |
| **I3** | Doc 02 §5-B item 11 lista `User.email` entre as unicidades a compor — **contradiz D2** | 02 §5-B | Corrigir |
| **I4** | **Prazo de retenção pós-cancelamento** não definido (Q3) | 00 §Q3, 05 §17 | Decisão jurídica pendente |
| **I5** | **S-1 e S-2 continuam sem execução.** Todo o desenho de propagação depende deles | 02 §13, 03 §5 | Executar antes das migrations |
| **I6** | Perguntas de infraestrutura seguem sem resposta: `STORAGE_DRIVER` (C2), réplicas e timeout de health check (C3), volume por tabela (C4), `CONCURRENTLY` no Prisma (B5) | 01 §7.2, 05 §16.3 | Verificar no Railway |
| **I7** | **CORS curinga** exigido por D7 e não previsto em nenhum documento anterior | 03 §2.4 | Registrado aqui; incorporar ao doc 03 |
| **I8** | Doc 03 §4.2 lista 12 consultas na zona de resolução, montadas quando `User` ainda podia ser do tenant. **D2 muda a natureza dos itens 1–5** | 03 §4.2 | Revisar a zona de resolução à luz de D2 |

---

## Referências

| Documento | Papel |
|---|---|
| [`README.md`](./README.md) | Índice e estado da série |
| [`01-ARQUITETURA_ATUAL.md`](./01-ARQUITETURA_ATUAL.md) | Inventário que fundamenta os números |
| [`02-MODELO_DE_TENANCY.md`](./02-MODELO_DE_TENANCY.md) | Comparação que levou a D6 |
| [`03-TENANT_CONTEXT.md`](./03-TENANT_CONTEXT.md) | Contexto e propagação |
| [`04-PERSONALIZACAO_POR_TENANT.md`](./04-PERSONALIZACAO_POR_TENANT.md) | Campos, módulos, branding |
| [`05-MIGRACAO_TENANT_1.md`](./05-MIGRACAO_TENANT_1.md) | **Autoridade** sobre contagem de tabelas |
| [`06-CHECKLIST_SEGURANCA.md`](./06-CHECKLIST_SEGURANCA.md) | Checklist anti-vazamento |
| [`MANIFESTO_TABELAS.md`](./MANIFESTO_TABELAS.md) | Classificação tabela a tabela |
