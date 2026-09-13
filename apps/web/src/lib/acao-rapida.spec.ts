import {
  avisoDeConcluida,
  botaoDaLinha,
  hrefDeCadastro,
  observacaoValida,
  pedeModalCompleto,
  podeIniciarNoPainel,
  previaDoSeguimento,
  primarioDoCatalogo,
  rotuloDoBotao,
} from './acao-rapida';
import type { DesfechoOpcao } from './agenda';

/**
 * O CATÁLOGO, COMO A API O SERVE (apps/api/src/modules/agenda/desfechos.catalogo.ts,
 * com `PRAZO_SEM_PECA` da rodada 2). É cópia de propósito: o teste prova a REGRA
 * contra a forma real do catálogo; se o catálogo mudar a ordem, o spec da API
 * (`desfecho-rapido-do-painel.spec.ts`) é quem trava a regra do lado de lá.
 */
const VINCULAR: DesfechoOpcao = { slug: 'VINCULADO_PROCESSO', label: 'Vinculado a processo', ajuda: '', acao: 'VINCULAR_PROCESSO' };
const CRIAR: DesfechoOpcao = { slug: 'PROCESSO_CRIADO', label: 'Virou processo novo', ajuda: '', acao: 'CRIAR_PROCESSO' };
const seg = (titulo: string, emDias: number, obrigatorio?: boolean, sugeridoPara?: string) => ({
  tipo: 'ACOMPANHAMENTO', titulo, emDias, obrigatorio, sugeridoPara,
});

const CATALOGO: Record<string, DesfechoOpcao[]> = {
  AUDIENCIA: [
    { slug: 'AUDIENCIA_ACORDO', label: 'Houve acordo', ajuda: '', exigeObs: true, acao: 'CRIAR_ATIVIDADE', seguimento: seg('Conferir cumprimento do acordo', 30) },
    { slug: 'AUDIENCIA_SEM_ACORDO', label: 'Realizada, sem acordo', ajuda: '' },
    { slug: 'AUDIENCIA_INSTRUCAO', label: 'Instrução encerrada', ajuda: '' },
  ],
  PRAZO: [
    { slug: 'PRAZO_CUMPRIDO', label: 'Peça protocolada', ajuda: '' },
    { slug: 'PRAZO_SEM_PECA', label: 'Analisado — nada a protocolar', ajuda: '', exigeObs: true },
    { slug: 'PRAZO_PERDIDO', label: 'Prazo perdido', ajuda: '', exigeObs: true, alerta: true, acao: 'CRIAR_ATIVIDADE', seguimento: seg('Providência sobre prazo perdido', 2, true) },
  ],
  CONSULTA_JURIDICA: [
    { slug: 'DUVIDA_ESCLARECIDA', label: 'Dúvida esclarecida', ajuda: '', exigeObs: true },
    VINCULAR,
    CRIAR,
  ],
  REUNIAO: [
    { slug: 'REUNIAO_COM_ENCAMINHAMENTOS', label: 'Com encaminhamentos', ajuda: '', exigeObs: true, acao: 'CRIAR_ATIVIDADE', seguimento: seg('Encaminhamento da reunião', 7, true, '2026-09-15T12:00:00.000Z') },
    { slug: 'REUNIAO_SEM_DELIBERACAO', label: 'Sem deliberação', ajuda: '' },
  ],
  DILIGENCIA: [
    { slug: 'DILIGENCIA_CUMPRIDA', label: 'Cumprida', ajuda: '' },
    { slug: 'DILIGENCIA_INFRUTIFERA', label: 'Infrutífera', ajuda: '', exigeObs: true, alerta: true, acao: 'CRIAR_ATIVIDADE', seguimento: seg('Nova tentativa de diligência', 7) },
    VINCULAR,
  ],
  DESPACHO: [
    { slug: 'DESPACHO_OBTIDO', label: 'Despacho obtido', ajuda: '', exigeObs: true },
    { slug: 'DESPACHO_NAO_ATENDIDO', label: 'Não atendido', ajuda: '', exigeObs: true, alerta: true },
  ],
  PERICIA: [
    { slug: 'PERICIA_REALIZADA', label: 'Realizada — laudo pendente', ajuda: '', acao: 'CRIAR_ATIVIDADE', seguimento: seg('Cobrar laudo pericial', 21, true) },
    { slug: 'PERICIA_LAUDO_ENTREGUE', label: 'Laudo entregue', ajuda: '' },
  ],
  CONTATO: [
    { slug: 'CONTATO_CONFIRMADO', label: 'Confirmou presença', ajuda: '' },
    { slug: 'CONTATO_NAO_COMPARECERA', label: 'Avisou que não vai', ajuda: '', exigeObs: true, alerta: true },
    { slug: 'CONTATO_SEM_SUCESSO', label: 'Não conseguimos contato', ajuda: '', exigeObs: true, alerta: true, acao: 'CRIAR_ATIVIDADE', seguimento: seg('Nova tentativa de contato', 1, true) },
  ],
  ACOMPANHAMENTO: [
    { slug: 'ACOMPANHAMENTO_CUMPRIDO', label: 'Cumprido', ajuda: '', exigeObs: true },
    { slug: 'ACOMPANHAMENTO_PENDENTE', label: 'Ainda pendente', ajuda: '', exigeObs: true, alerta: true, acao: 'CRIAR_ATIVIDADE', seguimento: seg('Nova cobrança', 15, true) },
    { slug: 'ACOMPANHAMENTO_SEM_OBJETO', label: 'Perdeu o objeto', ajuda: '', exigeObs: true },
    VINCULAR,
  ],
  COMPROMISSO: [{ slug: 'CONCLUIDA', label: 'Concluída', ajuda: '' }, VINCULAR, CRIAR],
};

const base = {
  podeEditarAgenda: true,
  ehDeOutraPessoa: false,
  sugestaoDeCadastro: null,
  podeCadastrarProcesso: true,
};

describe('o primário é a primeira opção do catálogo sem ação nem alerta', () => {
  it.each([
    ['PRAZO', 'PRAZO_CUMPRIDO'],
    ['DILIGENCIA', 'DILIGENCIA_CUMPRIDA'],
    ['CONSULTA_JURIDICA', 'DUVIDA_ESCLARECIDA'],
    ['DESPACHO', 'DESPACHO_OBTIDO'],
    ['ACOMPANHAMENTO', 'ACOMPANHAMENTO_CUMPRIDO'],
    ['CONTATO', 'CONTATO_CONFIRMADO'],
    ['COMPROMISSO', 'CONCLUIDA'],
  ])('%s → %s', (tipo, slug) => {
    expect(primarioDoCatalogo(CATALOGO[tipo])?.slug).toBe(slug);
  });

  /**
   * A reunião sem deliberação era registrada como "com encaminhamentos" pelo
   * painel — e a API criava, calada, uma tarefa obrigatória para daqui a 7 dias.
   */
  it.each(['REUNIAO', 'AUDIENCIA', 'PERICIA'])('%s não tem um toque: a primeira opção cria seguimento', (tipo) => {
    expect(primarioDoCatalogo(CATALOGO[tipo])).toBeNull();
  });

  it('nunca pula para a segunda opção', () => {
    const lista: DesfechoOpcao[] = [
      { slug: 'RUIM', label: 'Ruim', ajuda: '', alerta: true },
      { slug: 'BOA', label: 'Boa', ajuda: '' },
    ];
    expect(primarioDoCatalogo(lista)).toBeNull();
  });

  it('nenhum primário, em nenhum tipo, cria algo ou é resultado ruim', () => {
    for (const lista of Object.values(CATALOGO)) {
      const p = primarioDoCatalogo(lista);
      if (!p) continue;
      expect(p.acao).toBeUndefined();
      expect(p.alerta).toBeFalsy();
    }
  });

  it('catálogo vazio ou ausente não tem primário', () => {
    expect(primarioDoCatalogo([])).toBeNull();
    expect(primarioDoCatalogo(undefined)).toBeNull();
    expect(primarioDoCatalogo(null)).toBeNull();
  });
});

describe('o botão de cada linha', () => {
  it('prazo meu: um toque em "Peça protocolada"', () => {
    const b = botaoDaLinha({ ...base, opcoes: CATALOGO.PRAZO });
    expect(b).toEqual({ tipo: 'UM_TOQUE', opcao: CATALOGO.PRAZO[0] });
    expect(rotuloDoBotao(b)).toBe('Peça protocolada');
  });

  /** D4: a atividade é de outra pessoa — nunca fecha num toque. */
  it('prazo de outra pessoa: abre a folha com o aviso, e o rótulo continua dizendo o desfecho', () => {
    const b = botaoDaLinha({ ...base, opcoes: CATALOGO.PRAZO, ehDeOutraPessoa: true });
    expect(b).toEqual({ tipo: 'FOLHA', opcao: CATALOGO.PRAZO[0], motivo: 'DE_OUTRA_PESSOA' });
    expect(rotuloDoBotao(b)).toBe('Peça protocolada');
  });

  it('consulta: abre a folha já com "Dúvida esclarecida" marcada, porque a observação é o registro', () => {
    const b = botaoDaLinha({ ...base, opcoes: CATALOGO.CONSULTA_JURIDICA });
    expect(b).toEqual({ tipo: 'FOLHA', opcao: CATALOGO.CONSULTA_JURIDICA[0], motivo: 'OBSERVACAO' });
  });

  it('reunião: "Concluir" e a folha inteira', () => {
    const b = botaoDaLinha({ ...base, opcoes: CATALOGO.REUNIAO });
    expect(b).toEqual({ tipo: 'FOLHA', opcao: null, motivo: 'SEM_PRIMARIO' });
    expect(rotuloDoBotao(b)).toBe('Concluir');
  });

  /** Sem o catálogo não se adivinha: a tabela à mão do front era exatamente isso. */
  it('catálogo que ainda não chegou (ou falhou): só a folha', () => {
    expect(botaoDaLinha({ ...base, opcoes: undefined })).toEqual({ tipo: 'FOLHA', opcao: null, motivo: 'CARREGANDO' });
    expect(botaoDaLinha({ ...base, opcoes: [] })).toEqual({ tipo: 'FOLHA', opcao: null, motivo: 'CARREGANDO' });
  });

  /** D5: "Cumprida" fechava a tarefa sem a ação entrar no acervo. */
  it('tarefa "Cadastrar ação do Diário": o primário é cadastrar', () => {
    const b = botaoDaLinha({ ...base, opcoes: CATALOGO.DILIGENCIA, sugestaoDeCadastro: { numeroCNJ: '08053442320218180031' } });
    expect(b).toEqual({ tipo: 'CADASTRAR', href: '/processos?cadastrar=08053442320218180031' });
    expect(rotuloDoBotao(b)).toBe('Cadastrar');
  });

  it('e quem não cadastra processo não ganha o "Cumprida" de um toque', () => {
    const b = botaoDaLinha({
      ...base,
      opcoes: CATALOGO.DILIGENCIA,
      sugestaoDeCadastro: { numeroCNJ: '1' },
      podeCadastrarProcesso: false,
    });
    expect(b.tipo).toBe('FOLHA');
  });

  /** Triagem tem agenda VISUALIZAR: botão que leva 403 não se desenha. */
  it('sem EDITAR na agenda, nenhum botão — nem o de cadastrar', () => {
    expect(botaoDaLinha({ ...base, opcoes: CATALOGO.PRAZO, podeEditarAgenda: false })).toEqual({ tipo: 'NENHUM' });
    expect(
      botaoDaLinha({ ...base, opcoes: CATALOGO.PRAZO, podeEditarAgenda: false, sugestaoDeCadastro: { numeroCNJ: '1' } }),
    ).toEqual({ tipo: 'NENHUM' });
  });

  it('o link de cadastro escapa o número', () => {
    expect(hrefDeCadastro('0805 344&x')).toBe('/processos?cadastrar=0805%20344%26x');
  });
});

describe('Iniciar no painel (D7)', () => {
  // 13/09/2026 10:00 em Teresina = 13:00 UTC.
  const agora = Date.parse('2026-09-13T13:00:00Z');

  it('consulta de hoje, pendente: sim', () => {
    expect(podeIniciarNoPainel({ tipo: 'CONSULTA_JURIDICA', status: 'PENDENTE', inicio: '2026-09-13T17:00:00Z' }, agora)).toBe(true);
  });

  it.each(['REUNIAO', 'AUDIENCIA', 'PERICIA'])('%s de hoje: sim', (tipo) => {
    expect(podeIniciarNoPainel({ tipo, status: 'PENDENTE', inicio: '2026-09-13T12:00:00Z' }, agora)).toBe(true);
  });

  it.each(['PRAZO', 'DILIGENCIA', 'ACOMPANHAMENTO', 'CONTATO', 'DESPACHO'])('%s: nunca — é tarefa, não tem hora', (tipo) => {
    expect(podeIniciarNoPainel({ tipo, status: 'PENDENTE', inicio: '2026-09-13T14:00:00Z' }, agora)).toBe(false);
  });

  it('consulta de amanhã: não', () => {
    expect(podeIniciarNoPainel({ tipo: 'CONSULTA_JURIDICA', status: 'PENDENTE', inicio: '2026-09-14T13:00:00Z' }, agora)).toBe(false);
  });

  /** 23h30 de ontem em Teresina é 02h30 UTC de hoje: o dia é o de Teresina. */
  it('o dia é o de Teresina, não o UTC', () => {
    const quase = Date.parse('2026-09-14T02:30:00Z'); // 13/09 23h30 em Teresina
    expect(podeIniciarNoPainel({ tipo: 'REUNIAO', status: 'PENDENTE', inicio: '2026-09-13T20:00:00Z' }, quase)).toBe(true);
    expect(podeIniciarNoPainel({ tipo: 'REUNIAO', status: 'PENDENTE', inicio: '2026-09-14T04:00:00Z' }, quase)).toBe(false);
  });

  it('em andamento ou fechada: não', () => {
    expect(podeIniciarNoPainel({ tipo: 'REUNIAO', status: 'EM_ANDAMENTO', inicio: '2026-09-13T13:00:00Z' }, agora)).toBe(false);
    expect(podeIniciarNoPainel({ tipo: 'REUNIAO', status: 'CONCLUIDO', inicio: '2026-09-13T13:00:00Z' }, agora)).toBe(false);
  });
});

describe('a observação e o modal completo', () => {
  it.each([
    ['', false],
    ['  ok ', false],
    ['ok!', true],
    [null, false],
    ['Orientada sobre o adicional', true],
  ])('%p → %p', (texto, esperado) => {
    expect(observacaoValida(texto as string | null)).toBe(esperado);
  });

  it('vincular e criar processo pedem o modal completo; o resto cabe na folha', () => {
    expect(pedeModalCompleto(VINCULAR)).toBe(true);
    expect(pedeModalCompleto(CRIAR)).toBe(true);
    expect(pedeModalCompleto(CATALOGO.REUNIAO[0])).toBe(false);
    expect(pedeModalCompleto(null)).toBe(false);
  });
});

describe('a prévia do seguimento (D2)', () => {
  const morgana = { nome: 'Morgana Lima Sousa', nomeExibicao: null };

  it('usa a data que o servidor calculou, no fuso de Teresina', () => {
    expect(previaDoSeguimento(CATALOGO.REUNIAO[0], morgana)).toBe(
      'Vai criar: «Encaminhamento da reunião» em ter., 15/09, para Morgana.',
    );
  });

  it('prefere o nome de exibição', () => {
    expect(previaDoSeguimento(CATALOGO.REUNIAO[0], { nome: 'Carlos Henrique', nomeExibicao: 'Dr. Carlos' })).toContain(
      'para Dr. Carlos.',
    );
  });

  /** Sem `sugeridoPara` (API de antes): não soma dias no navegador, não promete dia. */
  it('sem a data do servidor, não promete dia', () => {
    expect(previaDoSeguimento(CATALOGO.PERICIA[0], morgana)).toBe('Vai criar: «Cobrar laudo pericial», para Morgana.');
  });

  it('opção sem seguimento não tem prévia', () => {
    expect(previaDoSeguimento(CATALOGO.PRAZO[0], morgana)).toBeNull();
    expect(previaDoSeguimento(null, morgana)).toBeNull();
  });
});

describe('o aviso depois de concluir (D6)', () => {
  const agora = Date.parse('2026-09-13T13:00:00Z');
  const simples = {
    desfecho: 'PRAZO_CUMPRIDO',
    seguimentoCriado: null,
    preProcessualCriado: null,
    concluidoEm: '2026-09-13T12:59:58Z',
  };

  it('conclusão simples: diz o desfecho e oferece desfazer', () => {
    expect(avisoDeConcluida(simples, 'Peça protocolada', agora)).toEqual({ texto: 'Peça protocolada', desfazer: true });
  });

  /** "Concluída." escondia a tarefa nova na agenda de alguém. */
  it('com seguimento: diz a tarefa criada e não oferece desfazer', () => {
    const r = avisoDeConcluida(
      { ...simples, desfecho: 'REUNIAO_COM_ENCAMINHAMENTOS', seguimentoCriado: { id: 's', titulo: 'Reunião X — Encaminhamento da reunião', inicio: '2026-09-15T12:00:00Z', tipo: 'ACOMPANHAMENTO' } },
      'Com encaminhamentos',
      agora,
    );
    expect(r.desfazer).toBe(false);
    expect(r.texto).toBe('Com encaminhamentos. Tarefa criada: «Reunião X — Encaminhamento da reunião» para ter., 15/09.');
  });

  it('caso aberto ou vínculo: sem desfazer', () => {
    expect(avisoDeConcluida({ ...simples, preProcessualCriado: { id: 'p', titulo: null } }, 'Virou processo novo', agora).desfazer).toBe(false);
    expect(avisoDeConcluida({ ...simples, desfecho: 'VINCULADO_PROCESSO' }, 'Vinculado a processo', agora).desfazer).toBe(false);
  });

  it('passada a janela da API, sem desfazer', () => {
    expect(avisoDeConcluida({ ...simples, concluidoEm: '2026-09-13T12:50:00Z' }, 'Peça protocolada', agora).desfazer).toBe(false);
  });
});
