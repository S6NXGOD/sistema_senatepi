# PLAN — Integração DataJud + DJEN

> Documento de planejamento. **Nenhuma linha de código, schema ou migration foi alterada.**
> Base da análise: `adc64d8` (branch `main`) · Verificações contra as APIs do CNJ e do
> DJEN feitas em 06/08/2026.

---

## Contexto

O módulo jurídico está em produção e funciona: consulta o DataJud, espelha movimentações,
cria atividades de prazo e audiência na Agenda e vincula advogados. Três limites reais
foram confirmados no código e contra as APIs ao vivo:

1. **O sistema enxerga uma instância só.** `datajud.service.ts:178` lê `hits.hits[0]._source`
   e descarta os demais. Verifiquei contra a API do CNJ: o NPU `0831236-24.2023.8.18.0140`
   devolve **2 documentos no mesmo índice** — `TJPI_G2` com 16 movimentos e `TJPI_G1` com 42.
   Hoje o sistema guarda um dos dois, conforme a ordenação por relevância do Elasticsearch,
   e perde o outro inteiro. `Processo.numeroCNJ @unique` (`schema.prisma:1665`) impede
   guardar os dois como linhas separadas.
2. **O DataJud não traz o teor do ato.** `MovimentacaoProcessual.conteudo` quase sempre vem
   nulo — o CNJ devolve `nome` + `complementosTabelados`. Por isso a atividade automática é
   genérica: `'Verificação de Intimação / Prazo'` (`automacao-prazos.service.ts:239`),
   "confira no PJe o que pedem".
3. **Não há fonte de publicação/intimação.** O que abre prazo é a publicação no DJEN, e ela
   não é consultada.

O DJEN resolve (2) e (3): confirmei que `https://comunicaapi.pje.jus.br/api/v1/comunicacao`
responde **sem autenticação**, devolve o **texto integral** da intimação e aceita busca por
OAB (varrendo todos os tribunais numa chamada) ou por número de processo.

Resultado esperado: acompanhar todas as instâncias do mesmo NPU, ler o teor da publicação,
transformar isso em atividade específica com providência nomeada — sem gerar atividade
duplicada quando os dois robôs virem o mesmo fato.

### Correções de premissa (verificado no código)

Dois itens do enunciado não existem hoje. O plano é desenhado com isso em conta:

| Premissa | Realidade |
|---|---|
| "Notificação de advogados" | **Não existe notificação.** Sem model `Notificacao`, sem e-mail/push/SMTP no `package.json`. O advogado descobre a tarefa abrindo o app (painéis com `refetchInterval: 60_000`). |
| "Filas / jobs" | **Sem fila.** Nenhum BullMQ/Redis. Dois `@Cron` in-process (`processos-cron`, `cobrancas-cron`), com trava de reentrância em memória. |

O plano **não** cria notificações — respeita "não reescrever o módulo". As atividades novas
aparecem exatamente onde as de hoje aparecem: Agenda, radar de audiências e dashboard.

---

## 1. Arquitetura atual encontrada

```
Importação / botão Sincronizar / Cron 02:00
        │
        ▼
ProcessosService.mesclarDoDatajud()          processos.service.ts:556
        │  ├─ DatajudService.buscarProcessoPorNPU(npu, sigla)   datajud.service.ts:145
        │  │     POST api-publica.datajud.cnj.jus.br/api_publica_<sigla>/_search
        │  │     body: { query: { match: { numeroProcesso } } }   ← sem size, sem sort
        │  │     lê SOMENTE hits.hits[0]._source                  ← ponto 1 do contexto
        │  │
        │  ├─ dedup em memória: chave `epoch(data)|codigo|descricao`   :620-630
        │  ├─ createMany(novas)  +  update(enriquecer)                 :648-666
        │  └─ SincronizacaoLogService.registrar(...)                   :673
        ▼
ProcessosService.dispararAutomacao()          processos.service.ts:752
        │  where: { compromissoId: null, dataMovimento: ≥ 30 dias }, take: 50
        ▼
AutomacaoPrazosService.processar()            automacao-prazos.service.ts:108
        │  classificarMovimentacao(texto, codigoTPU, data)   utils/audiencia.util.ts:151
        │     → PRAZO | AUDIENCIA | PERICIA | PAUTA_CAIU | NENHUM
        ▼
Compromisso (tabela `compromissos`) + carimbo movimentacao.compromissoId  ← trava de idempotência
```

**Fatos que o plano reaproveita:**

- `Compromisso` **é** a "atividade jurídica". Não existe model `Atividade` nem `Audiencia`.
  Audiência é `Compromisso` com `tipo = 'AUDIENCIA'`.
- `Compromisso.tipo` é um **slug de `tipos_evento`** (cadastrável), não enum. 10 tipos-sistema:
  `AUDIENCIA, PRAZO, CONSULTA_JURIDICA, REUNIAO, DILIGENCIA, DESPACHO, PERICIA, COMPROMISSO,
  CONTATO, ACOMPANHAMENTO`.
- **`MovimentacaoProcessual.compromissoId` já é o token de idempotência** do robô
  (`automacao-prazos.service.ts:141` + pré-filtro em `processos.service.ts:755`).
  O plano usa esse mesmo token como chave compartilhada entre DataJud e DJEN.
- O classificador é **função pura** em `utils/`, com spec própria
  (`audiencia.util.spec.ts`). É o padrão de teste da casa — todo código novo de
  classificação vai para `utils/` pelo mesmo motivo.
- `LogSincronizacaoDatajud` já registra toda chamada externa (sucesso e falha) e alimenta
  o widget de saúde do robô no dashboard (`dashboard.module.ts:601`).
- `duplicidade.guard.ts` é o padrão de **feature flag** da casa: env boolean + Guard que
  responde **404** (não 403) + rota `GET .../status` para o front ler em runtime.
- `BrasilApiService` / `DatajudService` são o padrão de integração: `fetch` nativo +
  `AbortController` + erro tipado com `statusUpstream` + mensagem em português.

---

## 2. Arquivos e serviços envolvidos

| Arquivo | Papel hoje | O que muda |
|---|---|---|
| `apps/api/src/modules/processos/datajud.service.ts` | Único cliente HTTP do CNJ | **Alterado** — ler todos os hits, novo método `buscarInstanciasPorNPU` |
| `apps/api/src/modules/processos/processos.service.ts` | Import / merge / dedup | **Alterado** — gravar por instância, escolher a principal, correlacionar |
| `apps/api/src/modules/processos/automacao-prazos.service.ts` | Robô de prazos | **Alterado** — consultar o catálogo de providências; dedup em `criarPauta` |
| `apps/api/src/modules/processos/utils/audiencia.util.ts` | Classificador único | **Estendido** — TPU 22/848/893 para status da instância |
| `apps/api/src/modules/processos/processos-cron.service.ts` | Cron 02:00 | **Alterado** — lock no banco |
| `apps/api/src/modules/processos/sincronizacao-log.service.ts` | Log de integração | **Alterado** — aceita `fonte` |
| `apps/api/src/modules/processos/movimentacoes.service.ts` | Dossiê / linha do tempo | **Alterado** — terceira origem `'DJEN'` |
| `apps/api/prisma/schema.prisma` | 51 models | **Aditivo** — 2 models, 3 colunas |
| **`.../processos/djen.service.ts`** | — | **NOVO** — cliente HTTP do Comunica PJe |
| **`.../processos/djen-sync.service.ts`** | — | **NOVO** — varredura + ingestão + correlação |
| **`.../processos/djen-cron.service.ts`** | — | **NOVO** — `@Cron('0 5 * * *')` |
| **`.../processos/djen.controller.ts`** | — | **NOVO** — sincronização manual + status da flag |
| **`.../processos/utils/providencia.util.ts`** | — | **NOVO** — função pura: texto → providência |
| **`.../processos/utils/correlacao.util.ts`** | — | **NOVO** — função pura: pareamento DJEN ↔ DataJud |
| **`.../processos/utils/instancia.util.ts`** | — | **NOVO** — função pura: escolher instância principal |
| `apps/web/src/components/processos/processo-detalhe-sheet.tsx` | Detalhe | **Alterado** — seletor de instância |
| `apps/web/src/components/processos/timeline-movimentacoes.tsx` | Timeline | **Alterado** — badge de grau + card de publicação |

**Não tocados:** `partes.service.ts`, `partes-externas.service.ts`, `audiencias.service.ts`
(radar), `consulta-previa.service.ts`, `agenda.service.ts`, `desfechos.catalogo.ts`.

---

## 3. Problemas atuais identificados

| # | Problema | Evidência | Impacto |
|---|---|---|---|
| P1 | Só o 1º hit do DataJud é lido | `datajud.service.ts:178` | Instância inteira perdida — confirmado ao vivo (16 vs 42 movimentos) |
| P2 | `numeroCNJ @unique` impede 2 graus | `schema.prisma:1665` | Não há onde guardar a 2ª instância |
| P3 | Documento devolvido não é conferido contra o NPU pedido | `datajud.service.ts:376` | Um hit de outro processo entraria sob o NPU pedido |
| P4 | Processo `ENCERRADO` sai da varredura | `processos.service.ts:271` | G2 baixado encerra o processo e o G1 ativo para de ser monitorado — **exatamente o caso do enunciado** |
| P5 | Dedup de movimentação não tem constraint no banco | sem `@@unique` em `movimentacoes_processuais`; `createMany` sem `skipDuplicates` | Sync manual + cron simultâneos duplicam linhas |
| P6 | `criarPauta` não checa duplicata | `automacao-prazos.service.ts:285` | Duas movimentações designando a mesma audiência → 2 atividades |
| P7 | Tarefa `CONTATO` nunca é carimbada | `automacao-prazos.service.ts:320-335` | Sem `compromissoId`, duplica junto com a pauta |
| P8 | `cancelarPauta` carimba só `abertos[0]` | `automacao-prazos.service.ts:378-383` | As demais canceladas perdem o vínculo |
| P9 | Atividade automática é genérica | `automacao-prazos.service.ts:239` | Advogado abre o PJe para saber o que fazer |
| P10 | Trava do cron é booleano em memória | `processos-cron.service.ts:26` | Com >1 réplica no Railway, o robô roda N vezes |
| P11 | Sem retry/backoff | nenhum | 429/timeout do CNJ = espera a próxima madrugada |
| P12 | `DATAJUD_TIMEOUT_MS` não está no `.env.example` | `datajud.service.ts:129` | Config invisível |

---

## 4. Mudanças mínimas recomendadas

**Princípio:** tudo aditivo. Nenhuma coluna existente muda de tipo ou de significado.
Com as duas feature flags desligadas, o comportamento é **byte a byte o de hoje**.

### 4.1 Schema (aditivo)

```prisma
/// Uma instância (grau) do MESMO NPU. O DataJud devolve um documento por grau
/// no mesmo índice do tribunal (_id = "TJPI_G1_<npu>"), e até hoje só o
/// primeiro era lido. Cada instância tem seus próprios movimentos e seu
/// próprio ciclo de vida: o G2 pode estar baixado enquanto o G1 corre.
model ProcessoInstancia {
  id         String @id @default(uuid())
  processoId String @map("processo_id")
  /// _id do documento no DataJud — chave natural, estável entre sincronizações.
  docId      String @map("doc_id")
  grau       String                       // G1, G2, JE, TR
  tribunal   String

  classeProcessual    String?   @map("classe_processual")
  classeCodigo        Int?      @map("classe_codigo")
  orgaoJulgador       String?   @map("orgao_julgador")
  orgaoJulgadorCodigo String?   @map("orgao_julgador_codigo")
  dataDistribuicao    DateTime? @map("data_distribuicao")
  nivelSigilo         Int?      @map("nivel_sigilo")
  formato             String?
  sistema             String?
  atualizadoNoCnjEm   DateTime? @map("atualizado_no_cnj_em")

  /// Data do movimento MAIS RECENTE desta instância. É por ela que se decide
  /// qual instância está viva — e NÃO por `dataHoraUltimaAtualizacao`, que é o
  /// carimbo de ingestão do CNJ e vem quase igual nos dois graus (verificado).
  ultimoMovimentoEm DateTime? @map("ultimo_movimento_em")
  /// Recebeu Baixa Definitiva (TPU 22) ou Trânsito em julgado (848) sem
  /// Desarquivamento (893) posterior.
  baixada   Boolean @default(false)
  /// Instância exibida nos atalhos de `Processo` e usada nos filtros de lista.
  principal Boolean @default(false)

  ultimaSincronizacao DateTime? @map("ultima_sincronizacao")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  processo      Processo                 @relation(fields: [processoId], references: [id], onDelete: Cascade)
  movimentacoes MovimentacaoProcessual[]

  @@unique([processoId, docId])
  @@index([processoId])
  @@map("processos_instancias")
}

/// Publicação/intimação do DJEN (API Comunica PJe). Complementa o DataJud com
/// o TEOR do ato — o que o DataJud não entrega.
model ComunicacaoDjen {
  id   String @id @default(uuid())
  /// Hash do DJEN. Chave natural ÚNICA — é a idempotência que falta ao DataJud:
  /// aqui a duplicata é impossível por constraint, não por acordo em memória.
  hash String @unique

  numeroProcesso String  @map("numero_processo")   // 20 dígitos
  processoId     String? @map("processo_id")
  instanciaId    String? @map("instancia_id")
  siglaTribunal  String  @map("sigla_tribunal")

  tipoComunicacao String? @map("tipo_comunicacao")  // Intimação | Edital | Citação | Lista de distribuição
  tipoDocumento   String? @map("tipo_documento")    // texto livre por tribunal — não usar em regra
  nomeOrgao       String? @map("nome_orgao")
  nomeClasse      String? @map("nome_classe")
  meio            String?                           // D (diário) | E (edital)
  link            String?
  /// Teor integral da publicação. LGPD: contém nomes das partes — ver §10.
  texto           String
  dataDisponibilizacao DateTime @map("data_disponibilizacao") @db.Date

  destinatarios Json?
  advogados     Json?

  /// Providência classificada a partir do texto (catálogo de providencia.util.ts).
  providencia        String?
  /// Prazo em dias que o TEXTO menciona. SUGESTÃO — nunca vira vencimento.
  prazoMencionadoDias Int? @map("prazo_mencionado_dias")

  /// Atividade criada ou enriquecida por esta comunicação.
  compromissoId  String? @map("compromisso_id")
  /// Movimentação do DataJud que descreve o MESMO fato (regra do §7).
  movimentacaoId String? @map("movimentacao_id")

  createdAt DateTime @default(now()) @map("created_at")

  processo      Processo?               @relation(fields: [processoId], references: [id], onDelete: Cascade)
  instancia     ProcessoInstancia?      @relation(fields: [instanciaId], references: [id], onDelete: SetNull)
  compromisso   Compromisso?            @relation(fields: [compromissoId], references: [id], onDelete: SetNull)
  movimentacao  MovimentacaoProcessual? @relation(fields: [movimentacaoId], references: [id], onDelete: SetNull)

  @@index([processoId, dataDisponibilizacao])
  @@index([numeroProcesso])
  @@index([compromissoId])
  @@map("comunicacoes_djen")
}
```

Colunas adicionadas a models existentes:

```prisma
model MovimentacaoProcessual {
  instanciaId String? @map("instancia_id")   // NULO = histórico anterior ao backfill
  instancia   ProcessoInstancia? @relation(fields: [instanciaId], references: [id], onDelete: SetNull)
  comunicacoes ComunicacaoDjen[]
  @@index([instanciaId])
}

model Processo {
  instancias   ProcessoInstancia[]
  comunicacoes ComunicacaoDjen[]
}

model LogSincronizacaoDatajud {
  /// DATAJUD | DJEN. Default preserva as linhas já gravadas.
  fonte String @default("DATAJUD")
}
```

**Índice único que fecha P5** (índice parcial, criado direto no SQL da migration):

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "movimentacoes_processuais_dedup_key"
  ON "movimentacoes_processuais"("processo_id","data_movimento","codigo_movimento","descricao")
  WHERE "codigo_movimento" IS NOT NULL;
```
> ⚠️ `CONCURRENTLY` não roda dentro da transação que o Prisma abre em toda migration —
> confirmar em ensaio. Se falhar, cair para índice normal: a tabela é pequena e a janela
> de lock é curta. **Rodar um `SELECT` de duplicatas ANTES** e limpá-las; senão a migration
> falha e, como `apps/api/package.json:9` acopla `prisma migrate deploy` ao `start`,
> **o deploy não sobe**.

### 4.2 Feature flags (padrão `duplicidade.guard.ts`)

| Flag | Default | Gateia |
|---|---|---|
| `DATAJUD_MULTI_INSTANCIA` | `false` | Ler >1 hit. Desligada: `size:1`, comportamento idêntico ao de hoje |
| `DJEN_INTEGRACAO` | `false` | Cron do DJEN + rotas `/djen/*` (404 quando off) |

Ambas com `GET /djen/status` e `GET /processos/instancias/status` para o front decidir em
runtime — não `NEXT_PUBLIC_*`, pelo motivo já documentado em `duplicidade.controller.ts:39-55`
(as `NEXT_PUBLIC_*` são resolvidas no build; desligar exigiria rebuild).

Novos itens no `.env.example` (junto com os dois que faltam hoje — P12):
`DJEN_BASE_URL`, `DJEN_TIMEOUT_MS`, `DJEN_JANELA_DIAS`, `DJEN_INTEGRACAO`,
`DATAJUD_MULTI_INSTANCIA`, `DATAJUD_TIMEOUT_MS`.

---

## 5. Estrutura necessária para múltiplas instâncias

### 5.1 A consulta

```ts
// datajud.service.ts — substitui o body atual
body: JSON.stringify({
  size: 20,                              // hoje: default 10, e só o [0] era lido
  query: { match: { numeroProcesso: numero } },
  sort: [{ 'dataHoraUltimaAtualizacao': { order: 'desc' } }],
})
```

E o parse passa a percorrer **todos** os hits, **conferindo o NPU** (fecha P3):

```ts
const hits = json?.hits?.hits ?? [];
const instancias = hits
  .filter((h) => String(h._source?.numeroProcesso ?? '').replace(/\D/g, '') === numero)
  .map((h) => this.mapearInstancia(h._id, h._source));
```

`buscarProcessoPorNPU()` **continua existindo** com a assinatura de hoje, agora implementado
como `buscarInstanciasPorNPU()[principal]`. Nada que já chama esse método precisa mudar
(`consulta-previa.service.ts`, `formalizar`, importação).

> **Fora de escopo (deliberado):** tribunais superiores. Quando o processo sobe ao STJ/TST o
> índice muda (`api_publica_stj`), e varrer índices extras multiplicaria as chamadas ao CNJ.
> **O DJEN cobre esse buraco de graça**: a varredura por OAB devolve publicações de todos os
> tribunais numa chamada só — verifiquei 22 siglas distintas (incl. TRF5) numa única consulta.

### 5.2 Qual instância é a "principal"

Função pura em `utils/instancia.util.ts`:

```
1. Descarta as baixadas (TPU 22 ou 848, sem 893 posterior).
2. Entre as vivas, a de MAIOR `ultimoMovimentoEm`.
3. Empate ou nenhuma viva → menor grau (G1 < JE < TR < G2).
```

O passo 1 é o que atende ao exemplo do enunciado: **G2 com baixa definitiva + G1 com
movimentação recente ⇒ o G1 volta a ser a instância principal e o processo volta a ATIVO.**

> Detalhe descoberto na verificação e que muda o desenho: `dataHoraUltimaAtualizacao` **não
> serve** para isso. No NPU `0831236-24.2023.8.18.0140` os dois graus vêm com
> `2026-08-03` — é o carimbo de ingestão do CNJ. O último movimento real é `2026-05-13` no
> G2 e `2025-11-05` no G1. Por isso a coluna é `ultimoMovimentoEm`, calculada dos
> `movimentos[]`.

### 5.3 Atalhos em `Processo`

`Processo.grau/tribunal/classeProcessual/orgaoJulgador/...` viram **atalhos da instância
principal**, exatamente como `filiadoId`/`advogadoId` já são atalhos de `partes_processo`
(`schema.prisma:1676-1687`). Mesma regra, escrita no mesmo lugar do schema:

> **Um único escritor:** `ProcessosService.sincronizarInstancias()`, sempre na mesma
> transação da escrita em `processos_instancias`.

Assim lista, dashboard, radar de audiências e "meus processos" continuam com `WHERE`
indexado direto, sem join e sem alteração.

### 5.4 Varredura: fechar P4

`idsParaSincronizar()` (`processos.service.ts:269`) passa a incluir os `ENCERRADO` que
tenham **alguma instância não baixada**:

```ts
where: {
  numeroCNJ: { not: null },
  OR: [
    { statusInterno: { in: ['ATIVO', 'PENDENTE'] } },
    { statusInterno: 'ENCERRADO', instancias: { some: { baixada: false } } },
  ],
}
```

E, ao fim de cada sync, se o processo está `ENCERRADO` e apareceu movimento novo em
instância não baixada → volta para `ATIVO` + registra uma `MovimentacaoInterna` explicando
(o histórico do processo precisa dizer por que ele reabriu; a Agenda já usa esse mesmo padrão).

### 5.5 Backfill

Migration de dados, sem chamar o CNJ: para cada `Processo` com `numeroCNJ`, cria **uma**
`ProcessoInstancia` (`docId = '<TRIBUNAL>_<grau|G1>_<npu>'`, `principal = true`) com os
metadados que já estão em `Processo`, e aponta todas as `movimentacoes_processuais` do
processo para ela. Idempotente. As instâncias que faltam entram na primeira varredura
noturna após ligar `DATAJUD_MULTI_INSTANCIA`.

---

## 6. Forma de integração com o DJEN

### 6.1 O que a API entrega (verificado ao vivo, 06/08/2026)

`GET https://comunicaapi.pje.jus.br/api/v1/comunicacao` — **sem autenticação**, HTTP 200.

Parâmetros úteis: `numeroOab`, `ufOab`, `numeroProcesso` (20 dígitos), `siglaTribunal`,
`dataDisponibilizacaoInicio`, `dataDisponibilizacaoFim`, `pagina`, `itensPorPagina`.

Resposta: `{ status, message, count, items[] }`. Campos de cada item:

```
id, hash, numero_processo, numeroprocessocommascara, siglaTribunal,
tipoComunicacao, tipoDocumento, nomeOrgao, idOrgao, nomeClasse, codigoClasse,
meio, meiocompleto, link, texto, data_disponibilizacao, ativo, status,
motivo_cancelamento, data_cancelamento,
destinatarios[{nome, polo}], destinatarioadvogados[{advogado:{nome, numero_oab, uf_oab}}]
```

Amostra real (TJPI, 04/08/2026):
> `"texto": "… ATO ORDINATÓRIO Intimo a parte autora a apresentar réplica no prazo de 15
> dias. CONTESTAÇÃO TEMPESTIVA …"` — é exatamente o teor que falta ao DataJud.

Observações que viram regra:
- `hash` é a chave natural → `@unique` no banco.
- `numero_processo` vem com os 20 dígitos, **idêntico ao NPU do DataJud** → correlação direta.
- `tipoDocumento` é **texto livre por tribunal** (numa amostra de 100: `Sentença`, `87`,
  `DESPACHO/DECISÃO`, `Devedores`…). **Não construir regra sobre ele.** Usar `tipoComunicacao`
  (4 valores limpos: Intimação, Edital, Citação, Lista de distribuição) + o `texto`.
- `count` satura em 10000 → **paginar sempre, nunca confiar no total**.
- 5 chamadas em sequência: nenhum 429. Ainda assim, mesma cadência conservadora do DataJud.

### 6.2 Estratégia de varredura — decisão tomada

**Varre por OAB (transporte), ingere só o que já está cadastrado (filtro).**

- Uma chamada por advogado ativo com `oab` + `oabUf` preenchidos (`User.oab`/`User.oabUf`
  já existem — `schema.prisma:230-233`), janela `D-3..D+0`. Cobre todos os tribunais.
- **Ao ingerir, descarta tudo cujo `numero_processo` não case com um `Processo.numeroCNJ`
  cadastrado.** Nada de processo não cadastrado é gravado — nem texto, nem parte, nem OAB.
  Os descartados entram apenas como **contagem** na linha de log (`"N publicação(ões)
  descartada(s) — processo não cadastrado"`), sem conteúdo, para que o volume seja visível
  sem criar caixa de entrada nem persistir dado de terceiro.
- **Complemento por NPU:** processos `ATIVO`/`PENDENTE` sem nenhuma comunicação casada nos
  últimos 30 dias recebem `GET ?numeroProcesso=<npu>`. Pega o caso em que a OAB do sindicato
  não está registrada no polo (processo herdado, substabelecimento não lançado).

Custo estimado no acervo atual: ~1 chamada por advogado + a cauda de processos sem casamento.

### 6.3 Serviços

**`DjenService`** — molde de `BrasilApiService`/`DatajudService`: `fetch` + `AbortController`,
`DJEN_BASE_URL` / `DJEN_TIMEOUT_MS` (30 s) via `ConfigService` com default literal,
`DjenIndisponivelError extends ServiceUnavailableException` carregando `statusUpstream`,
mensagens em português. Dois métodos: `buscarPorOab(oab, uf, de, ate)`,
`buscarPorProcesso(npu)`. Paginação interna com teto de páginas.

**`DjenSyncService`** — ingestão + correlação. `createMany({ skipDuplicates: true })` sobre
`hash` (a constraint faz a idempotência; rodar duas vezes é inofensivo). Log em
`logs_sincronizacao_datajud` com `fonte: 'DJEN'`, uma linha por processo que recebeu
publicação.

**`DjenCronService`** — `@Cron('0 5 * * *', { name: 'djen-sync', timeZone: 'America/Fortaleza' })`.
Às 05:00 de propósito: 3 h depois do DataJud, então as movimentações do dia já existem e a
correlação tem a que se ligar. Mesmo desenho do `processos-cron`: lote de 10, jitter 2–3 s,
pausa de 5 s, falha isolada por item.

**Lock no banco (fecha P10, agora com 3 crons):**

```ts
const [{ locked }] = await this.prisma.$queryRaw<{locked:boolean}[]>`
  SELECT pg_try_advisory_lock(${CHAVE_JOB}) AS locked`;
if (!locked) { this.logger.warn('[DJEN-SYNC] Outra réplica já está rodando — pulando.'); return; }
// ... finally: SELECT pg_advisory_unlock(${CHAVE_JOB})
```
Aplicar também ao `processos-cron` — o bug já existe hoje e o 3º job só o agrava.

**Dashboard:** o SQL de saúde do robô (`dashboard.module.ts:601`) ganha
`AND l.fonte = 'DATAJUD'` para manter o significado atual. O contador do DJEN entra depois,
como widget próprio.

---

## 7. Regra de correlação DataJud + DJEN

**O que já existe e será reaproveitado:** `MovimentacaoProcessual.compromissoId` é o token
de idempotência do robô. O robô pula qualquer movimentação carimbada
(`automacao-prazos.service.ts:141`) e o pré-filtro nem a carrega (`processos.service.ts:755`).
**A correlação apenas passa a carimbar esse mesmo campo a partir do DJEN.** Nenhum mecanismo
de dedup novo.

### 7.1 Pareamento (função pura, `utils/correlacao.util.ts`)

Uma comunicação `c` e uma movimentação `m` descrevem o mesmo fato quando:

| # | Condição |
|---|---|
| 1 | Mesmo `processoId` |
| 2 | `0 ≤ (c.dataDisponibilizacao − m.dataMovimento) ≤ 3 dias` — a publicação sai depois do ato; 3 dias corridos absorvem o fim de semana |
| 3 | `classificarMovimentacao(m)` retorna **`PRAZO`** (intimação/publicação/despacho). Pauta é tratada no caso especial abaixo |
| 4 | Nem `m` nem `c` já estão pareadas com outra |

Havendo mais de um candidato, vence o de **menor Δt**. Empate → o de menor `id` (determinismo).

**Caso especial — pauta:** se `classificarMovimentacao(m)` dá `AUDIENCIA`/`PERICIA` e o texto
de `c` também traz designação, o par vale (condição 3 dispensada) e a comunicação vira
**fonte de data preferencial** — o texto do DJEN traz "designada para 15/08/2026 às 14h00"
com muito mais frequência que o `nome` do movimento do DataJud.

### 7.2 Os quatro cenários

| # | Situação | Ação | Atividades criadas |
|---|---|---|---|
| **A** | `m` existe **e já gerou** atividade (`m.compromissoId ≠ null`) | **Enriquece** a atividade existente: título vira a providência específica, teor + link entram na descrição, `urgente` sobe se o prazo mencionado for curto. Grava `c.movimentacaoId = m.id`, `c.compromissoId = m.compromissoId` | **0 novas** |
| **B** | `m` existe e **não gerou** (classificou `NENHUM`, ou foi agrupada) | O DJEN cria a atividade (ele tem o texto; o DataJud tinha só o rótulo). Grava `c.movimentacaoId`, `c.compromissoId` **e carimba `m.compromissoId`** | 1 |
| **C** | Nenhuma `m` casa (**DJEN chegou primeiro** — comum) | O DJEN cria a atividade com `c.movimentacaoId = null` | 1 |
| **D** | DataJud chega **depois**, para um fato já publicado (fecha o C) | Antes de `AutomacaoPrazosService` rodar, `dispararAutomacao` roda a correlação **no sentido inverso**: `m` nova que casa com `c` já resolvida recebe `m.compromissoId = c.compromissoId`. O robô então a pula pela trava que já existe | **0 novas** |

O cenário **D** é o fecho do circuito: com ele, **nenhum fato gera duas atividades,
independentemente de qual fonte chegar primeiro**. O ponto de inserção é uma linha em
`processos.service.ts:dispararAutomacao()`, antes do `findMany` de pendentes.

### 7.3 Instância

`c.instanciaId` é resolvido por `nomeOrgao`/`siglaTribunal` contra
`processos_instancias.orgaoJulgador`; sem casamento, fica nulo e a comunicação pendura no
processo. Não bloqueia nada.

---

## 8. Melhorias nas atividades automáticas

### 8.1 Catálogo de providências (`utils/providencia.util.ts`)

Função pura, testável como `audiencia.util.ts`. **Decisão tomada: título específico sobre os
tipos existentes** — nenhum tipo novo em `tipos_evento`, nenhuma entrada nova em
`desfechos.catalogo.ts`, nenhuma tela da Agenda revisada.

```ts
export type Providencia =
  | 'ANALISAR_INTIMACAO' | 'ELABORAR_MANIFESTACAO' | 'JUNTAR_DOCUMENTOS'
  | 'ANALISAR_SENTENCA'  | 'AVALIAR_RECURSO'        | 'PREPARAR_AUDIENCIA'
  | 'SOLICITAR_DOCUMENTOS_FILIADO' | 'COMUNICAR_FILIADO' | 'NENHUMA';

export function classificarProvidencia(
  texto: string, tipoComunicacao?: string | null,
): { providencia: Providencia; prazoMencionadoDias: number | null };
```

| Providência | Tipo (existente) | Título da atividade | Gatilho no texto |
|---|---|---|---|
| `ANALISAR_INTIMACAO` | `PRAZO` | Analisar intimação | **fallback** de qualquer `tipoComunicacao = Intimação` |
| `ELABORAR_MANIFESTACAO` | `PRAZO` | Elaborar manifestação | manifestar, réplica, impugnar, contrarrazões, contestar |
| `JUNTAR_DOCUMENTOS` | `PRAZO` | Juntar documentos | juntar, acostar, apresentar documento, comprovante |
| `ANALISAR_SENTENCA` | `PRAZO` | Analisar sentença | sentença, julgo procedente/improcedente, extingo |
| `AVALIAR_RECURSO` | `PRAZO` | Avaliar recurso | acórdão, prazo recursal, apelação, recorrer |
| `PREPARAR_AUDIENCIA` | `ACOMPANHAMENTO` | Preparar audiência | designada/aprazada + data legível |
| `SOLICITAR_DOCUMENTOS_FILIADO` | `CONTATO` | Solicitar documentos ao filiado | emenda à inicial, documento faltante |
| `COMUNICAR_FILIADO` | `CONTATO` | Comunicar filiado | acordo homologado, resultado do julgamento |
| `NENHUMA` | — | — | edital sem providência, lista de distribuição |

Os desfechos existentes já servem sem tocar em nada: `PRAZO` oferece "Peça protocolada" /
"Prazo perdido" (com seguimento obrigatório em 2 dias) — que é exatamente o que se quer
perguntar ao concluir "Elaborar manifestação".

### 8.2 Fallback preservado

`'Verificação de Intimação / Prazo'` **continua sendo o título** sempre que:
a flag `DJEN_INTEGRACAO` estiver desligada; a movimentação não tiver comunicação correlata;
ou a classificação der `NENHUMA`. **Nada regride.** Toda melhoria é aditiva sobre o texto do
DJEN — se ele não veio, o comportamento é o de hoje.

### 8.3 Prazo: sugestão, nunca cálculo

Respeitando a restrição do enunciado:

- A data da atividade **continua sendo `somarDiasUteis(base, 5)`** — um lembrete de
  conferência, não um vencimento.
- Se o texto menciona um prazo (`"no prazo de 15 dias"`), o número é gravado em
  `prazoMencionadoDias` e **antecipa** o lembrete:
  `inicio = somarDiasUteis(base, min(5, max(1, mencionado − 2)))`.
  **Antecipar é seguro; calcular vencimento não é.** Um prazo de 5 dias vira lembrete no 3º.
- A descrição diz, textualmente:
  `⚠ O texto menciona prazo de 15 dias. Confira a contagem oficial (dias úteis, feriados
  da comarca, forma de intimação) — o sistema não calcula vencimento.`

### 8.4 Correções de duplicidade (P6, P7, P8)

Independentes do DJEN e pequenas:

- **P6** — `criarPauta` ganha o mesmo `findFirst` que `criarPrazo` já tem: mesma
  `processoId` + `tipo` + `origemAutomatica` + `inicio` no mesmo dia (BR) → agrupa em vez
  de criar. Reaproveita `diaBR()` de `audiencias.service.ts:39`.
- **P7** — a tarefa `CONTATO` passa a nascer com `origemMovimentacoes` ligada e o mesmo
  `findFirst` antes de criar.
- **P8** — `cancelarPauta` carimba **todas** as pautas derrubadas, não só `abertos[0]`.

---

## 9. Etapas de implementação, em ordem

Cada fase é entregável e reversível sozinha.

| Fase | Escopo | Migration | Flag | Efeito visível |
|---|---|---|---|---|
| **0** | `.env.example` completo; `fonte` no log; advisory lock nos crons; correções P6/P7/P8 | aditiva | — | Nenhum (só menos duplicata) |
| **1** | `ProcessoInstancia` + `MovimentacaoProcessual.instanciaId` + índice único de dedup + backfill | aditiva + dados | — | Nenhum |
| **2** | `datajud.service` lê todos os hits; `sincronizarInstancias`; `instancia.util`; atalhos; `idsParaSincronizar` inclui ENCERRADO com instância viva | — | `DATAJUD_MULTI_INSTANCIA` | **Todas as instâncias sincronizadas** |
| **3** | `ComunicacaoDjen`; `DjenService`; `DjenSyncService` (só ingestão + descarte de não cadastrados); `DjenCronService`; rotas + status | aditiva | `DJEN_INTEGRACAO` | Publicações gravadas; **nenhuma atividade nova** |
| **4** | `correlacao.util`; cenários A–D; sentido inverso em `dispararAutomacao` | — | `DJEN_INTEGRACAO` | Atividades enriquecidas com o teor; zero duplicata |
| **5** | `providencia.util` + catálogo; títulos específicos; antecipação do lembrete | — | `DJEN_INTEGRACAO` | Atividades nomeadas pela providência |
| **6** | Front: seletor de instância, badge de grau na timeline, card de publicação com teor e link, aba "Publicações" no dossiê | — | ambas | Tela |

**Ordem inegociável:** a fase 3 entra **sem criar atividade**. Uma semana ingerindo e
comparando com o que o DataJud já produz é o que dá confiança para ligar a fase 4 — e é
barato, porque desligar a flag apaga o efeito sem apagar os dados coletados.

---

## 10. Riscos e cuidados

| Risco | Mitigação |
|---|---|
| **Migration derruba o deploy.** `apps/api/package.json:9` roda `prisma migrate deploy` dentro do `start` — migration que falha = serviço que não sobe | Toda migration aditiva e compatível com a versão anterior do app. Rodar o `SELECT` de duplicatas **antes** do índice único; se houver, limpar na mesma migration antes de criar o índice |
| **LGPD — dado novo, natureza nova.** O DataJud traz metadado público; o DJEN traz **nome das partes no corpo do texto**. Isso é uma mudança de categoria de dado no sistema | (a) **Nunca** logar `texto` — o log leva só NPU + tribunal, como o DataJud já faz (`datajud.service.ts:10-20`); (b) a rota fica sob `@Modulo('processos')`, como o resto; (c) o `AuditInterceptor` grava `req.route.path`, não o corpo — conferir que segue assim; (d) **publicação de processo não cadastrado nunca é persistida** (decisão do §6.2) |
| **Ordenação do Elasticsearch.** Confiar em `hits[0]` é o bug de origem | Nunca usar posição. Filtrar por `numeroProcesso` conferido e escolher por regra explícita (`instancia.util.ts`), testada |
| **`dataHoraUltimaAtualizacao` engana** — vem igual nos dois graus | Usar `ultimoMovimentoEm`, derivado dos `movimentos[]`. Verificado ao vivo |
| **`tipoDocumento` do DJEN é texto livre por tribunal** | Regra construída sobre `tipoComunicacao` (4 valores) + `texto`. `tipoDocumento` só é armazenado |
| **`count` do DJEN satura em 10000** | Paginar até `items` vazio, com teto de páginas por consulta |
| **Volume de chamadas ao CNJ cresce.** Multi-instância não muda o nº de requisições (1 por NPU, vários hits), mas o DJEN acrescenta um job | Cron às 05:00, separado do das 02:00; mesma cadência (lote 10, 2–3 s, pausa 5 s); advisory lock impede réplicas concorrentes |
| **Classificação errada gera atividade errada** | O fallback é sempre a atividade genérica de hoje. Classificação específica só quando o padrão bate — na dúvida, `ANALISAR_INTIMACAO`. Ruído numa agenda que a equipe precisa levar a sério é pior que genérico |
| **Prazo automático** | §8.3 — antecipa lembrete, não calcula vencimento; o texto avisa explicitamente |
| **Sem retry (P11)** | Fora do escopo. O DJEN, sendo diário com janela de 3 dias, se auto-cura: a falha de hoje é coberta pela varredura de amanhã |

**Rollback:** desligar as duas flags devolve o comportamento exato de hoje. O schema é
aditivo — código antigo ignora tabelas e colunas novas, sem migration de volta. Se for
preciso reverter dados: `DELETE FROM comunicacoes_djen` e
`UPDATE movimentacoes_processuais SET instancia_id = NULL`.

---

## 11. Testes necessários

**Unitários** (funções puras em `utils/`, como `audiencia.util.spec.ts` — o padrão da casa;
sem DB, sem HTTP, sem `Test.createTestingModule`):

| Arquivo | Cobre |
|---|---|
| `utils/instancia.util.spec.ts` | G2 baixada + G1 recente → **principal = G1** (caso do enunciado); todas baixadas → menor grau; `893` depois de `22` desfaz a baixa; empate determinístico |
| `utils/providencia.util.spec.ts` | Tabela com textos **reais** do DJEN. Casos já coletados: *"apresentar réplica no prazo de 15 dias"* → `ELABORAR_MANIFESTACAO`, 15; *"apresentar contrarrazões no prazo legal"* → `AVALIAR_RECURSO`, `null`. Mais: sentença, edital sem providência (`NENHUMA`), lista de distribuição |
| `utils/correlacao.util.spec.ts` | Janela 0–3 dias (limites inclusive/exclusive); Δt menor vence; par já ligado é excluído; publicação anterior ao movimento **não** pareia; caso especial de pauta |
| `utils/audiencia.util.spec.ts` (estender) | TPU 22/848/893 → baixada/desarquivada |

**Integração manual** (não há harness e2e — `test:e2e` aponta para um `jest-e2e.json`
inexistente; não vale criar um só para isso):

1. **Multi-instância, contra a API real.** Dois NPUs já verificados com 2 graus:
   `0808285-04.2025.8.18.0031` (G2 Apelação / G1 Ação Popular) e
   `0831236-24.2023.8.18.0140` (G2 16 movimentos / G1 42 movimentos).
   Importar, conferir 2 linhas em `processos_instancias` e a soma dos movimentos.
2. **Idempotência.** Rodar a sincronização 3× seguidas → `SELECT count(*) FROM
   movimentacoes_processuais` e `comunicacoes_djen` estáveis; `compromissos` estável.
3. **Concorrência.** Disparar `PATCH /:id/sincronizar` e o cron ao mesmo tempo → o índice
   único de dedup deve segurar (hoje duplica — P5).
4. **Correlação, os 4 cenários.** Escolher um processo com publicação recente no DJEN
   (`GET ?numeroProcesso=…` mostra o histórico antes) e forçar cada ordem de chegada:
   DataJud→DJEN (A/B), DJEN→DataJud (C→D). **Critério: `compromissos` cresce no máximo 1
   por fato, em qualquer ordem.**
5. **Descarte.** Confirmar que a varredura por OAB não grava linha nenhuma para NPU não
   cadastrado, e que o log traz a contagem de descartados.
6. **Flags off.** Com as duas desligadas, `git diff` do comportamento = zero: mesma
   quantidade de movimentações, mesmos títulos de atividade, rotas `/djen/*` respondendo 404.

**Regressão obrigatória:** `npm test -w @senatepi/api` (as 5 specs existentes) + a suíte nova.

---

## 12. Critérios de conclusão

- [ ] Um NPU com 2+ graus grava **uma linha por instância**, e a soma dos movimentos bate com
      a soma dos `movimentos[]` que o CNJ devolve. Verificável nos dois NPUs do §11.
- [ ] Processo com **G2 baixado e G1 com movimentação recente** volta a `ATIVO`, tem o G1 como
      instância principal e continua na varredura noturna.
- [ ] Nenhum documento do DataJud é gravado sem que `numeroProcesso` confira com o NPU pedido.
- [ ] Sincronizar 3× seguidas não altera contagem de movimentação, publicação nem atividade.
- [ ] `comunicacoes_djen.hash` é `UNIQUE` no banco; `movimentacoes_processuais` tem índice
      único de dedup e a inserção usa `skipDuplicates`.
- [ ] Nos 4 cenários de ordem de chegada, **um fato = no máximo uma atividade**.
- [ ] Atividade com publicação correlata mostra título de providência, teor e link do PJe.
      Sem publicação, mostra `'Verificação de Intimação / Prazo'` — idêntico a hoje.
- [ ] Nenhuma atividade tem data de vencimento calculada a partir de prazo do texto; quando há
      prazo mencionado, o lembrete é **antecipado** e a descrição traz o aviso de conferência.
- [ ] Publicação de processo não cadastrado **não existe no banco** — só na contagem do log.
- [ ] `texto` do DJEN nunca aparece em log de aplicação.
- [ ] Com `DJEN_INTEGRACAO=false` e `DATAJUD_MULTI_INSTANCIA=false`, o sistema se comporta
      exatamente como antes das mudanças; rotas `/djen/*` respondem **404**.
- [ ] Três crons com advisory lock — duas réplicas não executam o mesmo job.
- [ ] `npm test -w @senatepi/api` verde, incluindo as 4 specs novas.
- [ ] `.env.example` documenta as 6 variáveis (incluindo `DATAJUD_TIMEOUT_MS`, hoje ausente).

---

## Verificação end-to-end

```bash
# 1. Testes
npm test -w @senatepi/api

# 2. Migration em cópia do banco ANTES do deploy (o start acopla migrate deploy)
#    Conferir duplicatas que impediriam o índice único:
#    SELECT processo_id, data_movimento, codigo_movimento, descricao, count(*)
#      FROM movimentacoes_processuais
#     GROUP BY 1,2,3,4 HAVING count(*) > 1;

# 3. Subir com as flags DESLIGADAS e conferir que nada mudou
npm run dev                       # api + web (NUNCA com next build simultâneo)

# 4. Ligar DATAJUD_MULTI_INSTANCIA e importar um NPU de 2 graus
curl -X POST localhost:3333/api/processos/importar \
     -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
     -d '{"numeroCNJ":"08312362420238180140","tribunal":"TJPI"}'
#    → esperado: 2 linhas em processos_instancias, 58 movimentações (16 + 42)

# 5. Ligar DJEN_INTEGRACAO e disparar a varredura manual
curl -X POST localhost:3333/api/djen/sincronizar -H 'Authorization: Bearer <token>'
#    → conferir comunicacoes_djen, e a linha de log com fonte='DJEN'

# 6. Rodar a mesma varredura 2× e conferir que nada duplicou
```

> Lembrete de ambiente: o Prisma trava com a API rodando — parar o `dev` antes de
> `prisma migrate dev`; e **nunca** rodar `next build` com `next dev` ativo.
