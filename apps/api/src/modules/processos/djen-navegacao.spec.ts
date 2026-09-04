import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const MOVIMENTACOES = ler('src/modules/processos/movimentacoes.service.ts');
const AGENDA = ler('src/modules/agenda/agenda.service.ts');
const SYNC = ler('src/modules/processos/djen-sync.service.ts');
const PAINEL = ler('src/modules/dashboard/dashboard.module.ts');

/**
 * O VÍNCULO EXISTIA NO BANCO E ERA INVISÍVEL NA TELA.
 *
 * `ComunicacaoDjen` guarda `movimentacaoId` e `compromissoId` desde sempre, e a
 * correlação os preenche. Mas nenhuma das três telas os usava: quem lia
 * "Expedição de documento" na linha do tempo não tinha como saber que o TEOR
 * integral estava numa aba ao lado — muito menos qual das publicações era.
 *
 * O DataJud entrega o rótulo do ato; o DJEN entrega o texto. Medido na
 * produção: `movimentacoes_processuais.conteudo` está vazio em 3.018 de 3.018.
 * Sem esse salto, a informação que permite DECIDIR fica a três cliques e uma
 * busca visual de distância.
 */
describe('a publicação viaja até a tela', () => {
  it('a linha do tempo sabe se o ato tem publicação', () => {
    const bloco = MOVIMENTACOES.slice(
      MOVIMENTACOES.indexOf('movimentacoes: {'),
      MOVIMENTACOES.indexOf('movimentacoesInternas: {'),
    );
    expect(bloco).toContain('comunicacoes: {');
    expect(bloco).toContain('take: 1');
  });

  it('e o item da timeline carrega o id, para a aba abrir na certa', () => {
    expect(MOVIMENTACOES).toContain('publicacao: m.comunicacoes[0]');
    expect(MOVIMENTACOES).toContain('providencia: m.comunicacoes[0].providencia');
  });

  /**
   * Só o id e a providência — não o texto. Trazer o teor de 300 andamentos
   * pesaria a timeline por uma informação que quase nunca é lida ali.
   */
  it('a timeline NÃO carrega o teor junto', () => {
    const bloco = MOVIMENTACOES.slice(
      MOVIMENTACOES.indexOf('comunicacoes: {'),
      MOVIMENTACOES.indexOf('movimentacoesInternas: {'),
    );
    expect(bloco).not.toContain('texto: true');
  });

  it('a atividade da agenda carrega o teor que a originou', () => {
    expect(AGENDA).toContain('origemComunicacoes: {');
    const bloco = AGENDA.slice(AGENDA.indexOf('origemComunicacoes: {'));
    expect(bloco.slice(0, 600)).toContain('texto: true');
    expect(bloco.slice(0, 600)).toContain('prazoMencionadoDias: true');
  });

  /**
   * No CARTÃO não: uma coluna de kanban com quatro cartões carregaria quatro
   * intimações inteiras que ninguém lê dali.
   */
  it('mas o CARTÃO da agenda não carrega o teor', () => {
    const cardSelect = AGENDA.slice(AGENDA.indexOf('const cardSelect = {'), AGENDA.indexOf('} as const;'));
    expect(cardSelect).not.toContain('origemComunicacoes');
  });
});

/**
 * O SISTEMA GRAVA SÓ O QUE É DO ACERVO — e isso não é detalhe de privacidade
 * apenas, é o que torna a integração utilizável.
 *
 * Medido na produção em 03/09/2026, com a ponte no ar: 339 publicações em três
 * dias para oito advogados, citando 121 processos distintos — dos quais apenas
 * CINCO estão cadastrados. A varredura por OAB traz a carteira inteira de cada
 * advogado, e 96% dela é de casos que não são do sindicato.
 */
describe('só entra publicação de processo cadastrado', () => {
  it('a ingestão filtra pelo acervo antes de gravar', () => {
    expect(SYNC).toContain('const doAcervo = comunicacoes.filter((c) => porNpu.has(c.numeroProcesso));');
    expect(SYNC).toContain('const descartadas = comunicacoes.length - doAcervo.length;');
  });

  it('e o que sobra nunca é gravado — nem o número do processo alheio', () => {
    const ingerir = SYNC.slice(SYNC.indexOf('private async ingerir('));
    const create = ingerir.slice(ingerir.indexOf('createMany'), ingerir.indexOf('createMany') + 200);
    expect(create).toContain('data: linhas');
    // `linhas` é derivada de `doAcervo`, nunca de `comunicacoes`.
    expect(ingerir).toContain('const linhas = doAcervo.map(');
  });
});

/**
 * O painel tinha "saúde do robô do DataJud" porque zero é ambíguo. O DJEN tinha
 * o mesmo problema e ele não era hipotético: devolveu zero por um mês inteiro
 * por bloqueio de origem, e a única coisa que a tela dizia era "nenhuma
 * publicação encontrada".
 */
describe('o painel conta se o DJEN está vivo', () => {
  it('devolve situação, volume e as últimas', () => {
    expect(PAINEL).toContain('private situacaoDjen(');
    for (const chave of ['ativa', 'situacao', 'publicacoes7d', 'ultimaEm', 'recentes']) {
      expect(`${chave}: ${PAINEL.includes(`${chave},`) || PAINEL.includes(`${chave}:`)}`)
        .toBe(`${chave}: true`);
    }
  });

  /** Edital e lista de distribuição chegam às dezenas e não pedem nada. */
  it('lista só o que pede providência', () => {
    expect(PAINEL).toContain("providencia: { notIn: ['NENHUMA'] }");
  });

  /**
   * Sem injetar o DjenService: o painel é outro módulo, e puxar o serviço de
   * processos para cá criaria dependência circular por um booleano.
   */
  it('descobre se está ligado sem criar dependência circular', () => {
    expect(PAINEL).toContain("integracaoAtiva('djen', process.env.DJEN_INTEGRACAO)");
    // A palavra aparece no comentário que explica a escolha; o que não pode
    // existir é o IMPORT e a INJEÇÃO.
    expect(PAINEL).not.toMatch(/import \{[^}]*DjenService/);
    expect(PAINEL).not.toMatch(/private readonly \w+: DjenService/);
  });
});

/**
 * O PAREAMENTO QUE CHEGA DEPOIS — o defeito que só apareceu com dado real.
 *
 * A publicação é classificada UMA vez, e isso está certo: sem a trava, a janela
 * de 30 dias seria reclassificada toda noite e o edital voltaria para sempre.
 * Só que a mesma trava fechava a porta do pareamento, e o desenho parava de
 * funcionar na ordem em que os fatos chegam de verdade.
 *
 * O DJEN é MUITO mais rápido que o DataJud — o atraso mediano do índice público
 * do CNJ, medido neste acervo, é de 41 dias. A publicação de hoje chega hoje; a
 * movimentação que descreve o mesmo ato aparece semanas depois. Na primeira
 * passada não há com o que parear, e com a trava nunca haveria uma segunda.
 *
 * Medido em 03/09/2026, antes da correção: 24 publicações ingeridas num
 * processo, ZERO pareadas — ele não tinha movimentação do DataJud desde agosto.
 * Sem esta segunda passada, o botão "Ver teor no DJEN" seria código morto.
 */
describe('publicação espera a movimentação atrasada', () => {
  const CORRELACAO = ler('src/modules/processos/correlacao.service.ts');

  it('existe uma segunda passada só para parear', () => {
    expect(CORRELACAO).toContain('private async parearAtrasadas(');
    expect(CORRELACAO).toContain('await this.parearAtrasadas(processoId, desde, movimentacoes);');
  });

  it('ela pega o que JÁ foi classificado e continua sem movimento', () => {
    const fn = CORRELACAO.slice(CORRELACAO.indexOf('private async parearAtrasadas('));
    expect(fn.slice(0, 1200)).toContain('movimentacaoId: null');
    expect(fn.slice(0, 1200)).toContain('providencia: { not: null }');
  });

  /**
   * Reclassificar seria refazer julgamento já feito; criar atividade aqui
   * duplicaria a que a primeira passada criou. A segunda passada só amarra.
   */
  it('não reclassifica nem cria atividade — só amarra o vínculo', () => {
    const fn = CORRELACAO.slice(
      CORRELACAO.indexOf('private async parearAtrasadas('),
      CORRELACAO.indexOf('Lado DataJud — cenário D'),
    );
    expect(fn).not.toContain('criarAtividade');
    expect(fn).not.toContain('classificarProvidencia');
    expect(fn).not.toContain('providencia: c.providencia');
    // O update toca UM campo só.
    expect(fn).toContain('data: { movimentacaoId: par.movimentacaoId }');
  });

  /** Sem movimentação nova não há o que tentar — sai antes de consultar. */
  it('sai cedo quando não há movimentação', () => {
    const fn = CORRELACAO.slice(CORRELACAO.indexOf('private async parearAtrasadas('));
    expect(fn.slice(0, 400)).toContain('if (!movimentacoes.length) return 0;');
  });
});

/**
 * DOIS DEFEITOS QUE SÓ APARECERAM COM DADO REAL, na primeira ingestão de
 * verdade em 03/09/2026 — quatro processos, 136 publicações.
 */
describe('a primeira ingestão não pode inundar a agenda', () => {
  const CORRELACAO = ler('src/modules/processos/correlacao.service.ts');
  const PRAZOS = ler('src/modules/processos/automacao-prazos.service.ts');

  /**
   * SETE atividades urgentes de uma vez, todas com o mesmo motivo e todas
   * vencendo no mesmo dia. Na primeira ingestão o DJEN entrega o histórico
   * inteiro do processo, não só o dia — e tudo que é velho nasce "atrasado".
   * Sete urgências simultâneas não são sete prioridades; são zero.
   */
  it('urgência exige que a publicação seja recente', () => {
    expect(CORRELACAO).toContain('const recente = idadeDias <= DIAS_ATO_RECENTE;');
    expect(CORRELACAO).toContain('const urgente = recente && (atrasado || prazoCurto);');
  });

  /** Publicação velha que mencionava 5 dias também não é urgente — é história. */
  it('o prazo curto também passa pela régua da idade', () => {
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('const recente = idadeDias'));
    expect(bloco.slice(0, 300)).toContain('const prazoCurto = (c.prazoMencionadoDias ?? 99) <= 5;');
    expect(bloco.slice(0, 300)).not.toMatch(/urgente = \(atrasado \|\| prazoCurto\)/);
  });

  /**
   * A régua é COMPARTILHADA com o robô de prazos. As duas automações escrevem
   * na mesma agenda; réguas diferentes fariam duas noções de "urgente"
   * conviverem na mesma coluna.
   */
  it('as duas automações usam a mesma régua', () => {
    expect(PRAZOS).toContain('export const DIAS_ATO_RECENTE = 15;');
    expect(CORRELACAO).toMatch(/import \{[^}]*DIAS_ATO_RECENTE[^}]*\} from '\.\/automacao-prazos\.service'/);
  });

  /**
   * O DJEN publica UMA comunicação POR DESTINATÁRIO: a mesma intimação, num
   * processo com três advogados, chega três vezes. Medido: três "Avaliar
   * recurso" do mesmo processo vencendo no mesmo dia, mais dois pares iguais.
   */
  it('publicação irmã enriquece a atividade em vez de criar outra', () => {
    expect(CORRELACAO).toContain('const irma = await this.prisma.comunicacaoDjen.findFirst({');
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('const irma = await'));
    expect(bloco.slice(0, 700)).toContain('providencia: c.providencia');
    expect(bloco.slice(0, 700)).toContain('compromissoId: { not: null }');
  });

  /**
   * A CHAVE NÃO INCLUI O DIA — e essa foi a segunda correção, feita depois de
   * ver a tela.
   *
   * A primeira versão usava (processo, providência, DIA) e só resolvia as
   * cópias por destinatário. Sobrou o caso de atos DIFERENTES que pedem o
   * MESMO trabalho: dois acórdãos do processo 0000542-92.2025.5.22.0005, de
   * 12/08 e 27/08, geraram dois cartões "Avaliar recurso" com o mesmo título,
   * o mesmo responsável e o mesmo horário — indistinguíveis na agenda, e uma
   * decisão só a tomar. A atividade é unidade de TRABALHO, não de publicação.
   */
  it('a chave da irmã é (processo, providência) — sem o dia', () => {
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('const irma = await'), CORRELACAO.indexOf('(A3) PUBLICAÇÃO VELHA'));
    expect(bloco).not.toContain('dataDisponibilizacao: c.dataDisponibilizacao');
    // A mais recente primeiro: é a que descreve o estado atual do processo.
    expect(bloco).toContain("orderBy: { dataDisponibilizacao: 'desc' }");
  });

  /**
   * A CONSULTA POR NPU TRAZ O HISTÓRICO INTEIRO, não uma janela. Medido: a
   * publicação mais antiga das 136 é de 14/05/2024 — 842 dias. Sem trava,
   * cadastrar um processo antigo despeja na agenda prazos vencidos há dois
   * anos. Classificar sim; fingir que é trabalho pendente, não.
   */
  it('publicação velha demais é classificada mas não vira tarefa', () => {
    expect(CORRELACAO).toContain('const DIAS_LIMITE_TAREFA = 60;');
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('(A3) PUBLICAÇÃO VELHA'), CORRELACAO.indexOf('// (B) e (C)'));
    expect(bloco).toContain('if (idadeDias > DIAS_LIMITE_TAREFA) {');
    expect(bloco).toContain('providencia: c.providencia');
    expect(bloco).not.toContain('criarAtividade');
    expect(bloco).toContain('resumo.antigas++');
  });

  /** E não pode casar consigo mesma. */
  it('a busca pela irmã exclui a própria publicação', () => {
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('const irma = await'));
    expect(bloco.slice(0, 700)).toContain('id: { not: c.id }');
  });

  /**
   * Dois atos DIFERENTES no mesmo dia existem e têm de nascer separados — a
   * chave inclui a providência justamente para não colapsá-los.
   */
  it('atos diferentes no mesmo dia continuam separados', () => {
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('const irma = await'), CORRELACAO.indexOf('(A3) PUBLICAÇÃO VELHA'));
    expect(bloco).toContain('providencia: c.providencia');
  });

  /**
   * O TEOR APARECIA TRÊS VEZES na gaveta: uma na descrição, onde o robô o
   * copiava, e uma por publicação irmã vinculada — e cinco das seis atividades
   * da produção tinham duas irmãs. A descrição diz o que fazer; o teor é do
   * cartão da publicação, que agrupa as cópias e mostra uma vez só.
   */
  it('a descrição não carrega o teor da publicação', () => {
    expect(CORRELACAO).not.toContain('blocoTeor');
    expect(CORRELACAO).not.toContain('Publicação (DJEN)');
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('A DESCRIÇÃO DIZ O QUE FAZER'));
    expect(bloco.slice(0, 900)).toContain('Processo ${NpuUtils.formatar(processo.numeroCNJ)');
  });

  /**
   * O PRAZO MAIS CURTO MANDA. Uma tarefa aberta que recebe publicação nova com
   * prazo mais apertado tem de antecipar: a agenda diria quinta enquanto o
   * prazo real virou terça. Só encurta — adiar esconderia um vencimento.
   */
  it('publicação nova com prazo menor antecipa a tarefa', () => {
    const fn = CORRELACAO.slice(CORRELACAO.indexOf('private async enriquecer('));
    expect(fn.slice(0, 2500)).toContain('if (novo < atual.inicio) antecipar = novo;');
    expect(fn.slice(0, 2500)).toContain('...(antecipar');
  });
});

/**
 * ENRIQUECER O QUE FOI DESCARTADO É ESCREVER NUM PAPEL JOGADO FORA.
 *
 * O cenário (A) enriquecia qualquer atividade vinculada à movimentação,
 * inclusive CANCELADA. Medido na produção em 03/09/2026: 3 das 14 publicações
 * apontavam para atividade fechada — e o link "Abrir a atividade na Agenda",
 * que acabei de criar no painel e na aba, levava a uma tarefa que ninguém
 * executaria. A publicação nova sobre um ato cuja tarefa foi descartada é
 * trabalho NOVO, não anotação em tarefa morta.
 */
describe('só atividade aberta recebe a publicação', () => {
  const CORRELACAO = ler('src/modules/processos/correlacao.service.ts');

  it('a movimentação traz o status da atividade, não só o id', () => {
    expect(CORRELACAO).toContain('compromisso: { select: { status: true } }');
  });

  it('o cenário A exige atividade aberta', () => {
    expect(CORRELACAO).toContain("movimentacao?.compromisso?.status === 'PENDENTE'");
    expect(CORRELACAO).toContain("movimentacao?.compromisso?.status === 'EM_ANDAMENTO'");
    expect(CORRELACAO).toContain('if (movimentacao?.compromissoId && atividadeAberta) {');
  });

  it('e a busca pela irmã também', () => {
    const bloco = CORRELACAO.slice(CORRELACAO.indexOf('const irma = await'));
    expect(bloco.slice(0, 900)).toContain("compromisso: { status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } }");
  });
});
