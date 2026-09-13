import {
  CATEGORIA_CANCELAMENTO_LABEL,
  DESFECHO_LABEL,
  JANELA_DESFAZER_CONCLUSAO_MS,
  RECORTES,
  RECORTE_PADRAO,
  TIPOS_COM_HORA,
  acaoPrincipalDoCartao,
  contarFiltrosAtivos,
  cronometroEsquecido,
  dataJaPassou,
  diaBRDe,
  ehMinha,
  filtroDoServidor,
  inicioDoDiaBRMs,
  lerUrlDaAgenda,
  novoInicioPorAtalho,
  podeDesfazerConclusao,
  remarcacaoPermitida,
  type Compromisso,
  type ContagemRecortes,
} from './agenda';

const url = (q: string) => new URLSearchParams(q);
const t = (iso: string) => new Date(iso).getTime();

/**
 * A URL DA AGENDA (C11) — o painel monta, a agenda lê.
 *
 * O número clicável do painel só leva o mesmo recorte que contou se as duas
 * pontas traduzirem a URL do mesmo jeito. A tradução é uma função pura, e é
 * ela que se testa — não a linha que a chama.
 */
describe('lerUrlDaAgenda', () => {
  it('sem nada, abre na aba padrão sem filtro', () => {
    const e = lerUrlDaAgenda(url(''), 'u1');
    expect(e.aba).toBe(RECORTE_PADRAO);
    expect(RECORTE_PADRAO).toBe('hoje');
    expect(e.pessoa).toBeUndefined();
    expect(e.urgentes).toBe(false);
    expect(e.aguardandoSessao).toBe(false);
  });

  it('carteira "Atrasadas": aba e pessoa=eu viram o id de quem está logado', () => {
    const e = lerUrlDaAgenda(url('aba=atrasadas&pessoa=eu'), 'u1');
    expect(e).toMatchObject({ aba: 'atrasadas', pessoa: 'u1', aguardandoSessao: false });
  });

  it('"eu" sem sessão carregada não vira a casa inteira: espera', () => {
    const e = lerUrlDaAgenda(url('aba=7dias&pessoa=eu'), undefined);
    expect(e.pessoa).toBeUndefined();
    expect(e.aguardandoSessao).toBe(true);
  });

  it('"Esperando por": só como responsável, na aba de atenção', () => {
    const e = lerUrlDaAgenda(url('aba=atencao&responsavel=r9&somenteResponsavel=1'), 'u1');
    expect(e).toMatchObject({ aba: 'atencao', responsaveis: 'r9', somenteResponsavel: true });
  });

  it('`somenteResponsavel` sozinho não significa nada', () => {
    expect(lerUrlDaAgenda(url('somenteResponsavel=1'), 'u1').somenteResponsavel).toBe(false);
  });

  it('"Urgentes" e o tipo', () => {
    const e = lerUrlDaAgenda(url('aba=aberto&urgentes=1&tipo=AUDIENCIA'), 'u1');
    expect(e).toMatchObject({ aba: 'aberto', urgentes: true, tipo: 'AUDIENCIA' });
  });

  it('a aba antiga "urgentes" vira o filtro Urgentes sobre Em aberto', () => {
    expect(lerUrlDaAgenda(url('aba=urgentes'), 'u1')).toMatchObject({ aba: 'aberto', urgentes: true });
  });

  it('aba desconhecida não deixa a tela num estado que não existe', () => {
    expect(lerUrlDaAgenda(url('aba=semana'), 'u1').aba).toBe('hoje');
  });

  it('reserva do robô tem parâmetro próprio', () => {
    expect(lerUrlDaAgenda(url('aba=aberto&reservaDe=eu'), 'u1').reservaDe).toBe('u1');
  });
});

describe('filtroDoServidor — o mesmo objeto vai para a lista e para os contadores', () => {
  it('só manda o que está ligado, com os nomes da API', () => {
    expect(
      filtroDoServidor({ pessoa: 'u1', urgentes: true, busca: '   ', tipo: 'PRAZO' }),
    ).toEqual({ pessoa: 'u1', urgente: 'true', tipo: 'PRAZO' });
  });

  it('somenteResponsavel só vai junto de responsáveis', () => {
    expect(filtroDoServidor({ somenteResponsavel: true })).toEqual({});
    expect(filtroDoServidor({ responsaveis: 'a,b', somenteResponsavel: true })).toEqual({
      responsaveis: 'a,b',
      somenteResponsavel: '1',
    });
  });

  it('a busca vai sem os espaços das pontas', () => {
    expect(filtroDoServidor({ busca: ' 0801234 ' })).toEqual({ busca: '0801234' });
  });

  it('nunca carrega o recorte (os contadores são de todas as abas)', () => {
    expect('recorte' in filtroDoServidor({ pessoa: 'u1' })).toBe(false);
  });
});

describe('contarFiltrosAtivos', () => {
  it('a aba não conta — a tela aberta sem mexer em nada tem zero filtros', () => {
    expect(contarFiltrosAtivos({})).toBe(0);
  });

  it('cada filtro ligado conta um', () => {
    expect(
      contarFiltrosAtivos({ pessoa: 'u1', responsaveis: 'r1', tipo: 'PRAZO', urgentes: true, busca: 'x', reservaDe: 'u1' }),
    ).toBe(6);
    expect(contarFiltrosAtivos({ busca: '  ' })).toBe(0);
  });
});

describe('as abas', () => {
  it('cada aba tem o seu contador, e nenhum se repete', () => {
    const chaves = RECORTES.map((r) => r.chave);
    expect(new Set(chaves).size).toBe(RECORTES.length);
    const contagem: ContagemRecortes = { hoje: 0, atrasadas: 0, atencao: 0, seteDias: 0, aberto: 0, todos: 0, urgentes: 0 };
    for (const c of chaves) expect(c in contagem).toBe(true);
  });

  it('são as seis do contrato, na ordem da tela', () => {
    expect(RECORTES.map((r) => r.valor)).toEqual(['hoje', 'atrasadas', 'atencao', '7dias', 'aberto', 'todos']);
  });

  /** A tela nunca diz "vencida" — diz "ficou para trás". */
  it('o vocabulário é o do produto', () => {
    const textos = RECORTES.map((r) => `${r.rotulo} ${r.ajuda}`).join(' ').toLowerCase();
    expect(textos).not.toMatch(/vencid|atrasad/);
  });
});

/**
 * D7 — QUAL É O BOTÃO CHEIO DO CARTÃO. Medido em 12/09/2026: PRAZO passou por
 * Iniciar em 4 de 12 conclusões, ACOMPANHAMENTO em 0 de 3; CONSULTA em 18 de 22.
 */
describe('acaoPrincipalDoCartao', () => {
  it.each([
    ['PRAZO', false, 'CONCLUIR'],
    ['ACOMPANHAMENTO', false, 'CONCLUIR'],
    ['CONTATO', false, 'CONCLUIR'],
    ['DESPACHO', false, 'CONCLUIR'],
    ['DILIGENCIA', false, 'CONCLUIR'],
    ['TIPO_CRIADO_PELO_SINDICATO', false, 'CONCLUIR'],
    ['CONSULTA_JURIDICA', false, 'INICIAR'],
    ['REUNIAO', false, 'INICIAR'],
    ['AUDIENCIA', false, 'INICIAR'],
    ['PERICIA', false, 'INICIAR'],
    ['AUDIENCIA', true, 'CONCLUIR'],
  ] as const)('%s (robô: %s) → %s', (tipo, origemAutomatica, esperado) => {
    expect(acaoPrincipalDoCartao({ tipo, origemAutomatica })).toBe(esperado);
  });

  it('os tipos com hora são os mesmos da API', () => {
    expect([...TIPOS_COM_HORA].sort()).toEqual(['AUDIENCIA', 'CONSULTA_JURIDICA', 'PERICIA', 'REUNIAO']);
  });
});

describe('cronômetro esquecido só onde há hora marcada', () => {
  const agora = t('2026-09-12T21:00:00-03:00');
  const fimHaDezHoras = '2026-09-12T11:00:00-03:00';

  it('numa tarefa, o dia inteiro de trabalho não é esquecimento', () => {
    expect(cronometroEsquecido(fimHaDezHoras, agora, 'PRAZO')).toBe(false);
    // Tarefa do robô chega com o tipo nulo: também não acusa.
    expect(cronometroEsquecido(fimHaDezHoras, agora, null)).toBe(false);
  });

  it('numa reunião, dez horas além do previsto acende', () => {
    expect(cronometroEsquecido(fimHaDezHoras, agora, 'REUNIAO')).toBe(true);
  });

  it('sem o tipo, a régua antiga continua valendo', () => {
    expect(cronometroEsquecido(fimHaDezHoras, agora)).toBe(true);
  });
});

describe('ehMinha segue a régua daPessoa', () => {
  const base = {
    responsavel: { id: 'dono', nome: 'Dono' },
    equipe: [] as NonNullable<Compromisso['equipe']>,
  } as unknown as Compromisso;

  it('quem responde', () => {
    expect(ehMinha({ ...base, responsavel: { id: 'eu', nome: 'Eu' } }, 'eu')).toBe(true);
  });

  it('quem foi posto na equipe por gente', () => {
    const c = { ...base, equipe: [{ principal: false, origem: null, usuario: { id: 'eu', nome: 'Eu' } }] };
    expect(ehMinha(c, 'eu')).toBe(true);
  });

  it('a reserva do robô NÃO é da pessoa — o painel e a faixa também não contam', () => {
    const c = { ...base, equipe: [{ principal: false, origem: 'AUTOMATICA', usuario: { id: 'eu', nome: 'Eu' } }] };
    expect(ehMinha(c, 'eu')).toBe(false);
  });
});

describe('o dia é o de Teresina', () => {
  it('23h30 em Teresina ainda é o mesmo dia, mesmo já sendo amanhã em UTC', () => {
    expect(diaBRDe('2026-09-13T02:30:00Z')).toBe('2026-09-12');
    expect(diaBRDe('2026-09-13T03:00:00Z')).toBe('2026-09-13');
  });

  it('o início do dia é meia-noite de Teresina', () => {
    expect(new Date(inicioDoDiaBRMs(t('2026-09-12T23:30:00-03:00'))).toISOString()).toBe('2026-09-12T03:00:00.000Z');
  });
});

/**
 * REMARCAR PELO ATALHO. "Amanhã" numa tarefa de 02/09 remarcada em 12/09 ia
 * para 03/09 — ainda no passado, ainda atrasada, com +1 no contador.
 */
describe('novoInicioPorAtalho', () => {
  const agora = t('2026-09-12T15:00:00-03:00');

  it('data que já passou: conta a partir de hoje e mantém a hora', () => {
    expect(novoInicioPorAtalho('2026-09-02T10:30:00-03:00', 1, agora)).toBe('2026-09-13T13:30:00.000Z');
    expect(novoInicioPorAtalho('2026-09-02T10:30:00-03:00', 7, agora)).toBe('2026-09-19T13:30:00.000Z');
  });

  it('data futura: soma à própria data', () => {
    expect(novoInicioPorAtalho('2026-09-20T09:00:00-03:00', 7, agora)).toBe('2026-09-27T12:00:00.000Z');
  });

  it('hoje, mesmo às 23h30 (já amanhã em UTC), soma a partir de hoje', () => {
    const tarde = t('2026-09-12T23:30:00-03:00');
    expect(novoInicioPorAtalho('2026-09-12T08:00:00-03:00', 1, tarde)).toBe('2026-09-13T11:00:00.000Z');
  });

  it('vira o mês sem erro', () => {
    expect(novoInicioPorAtalho('2026-09-29T09:00:00-03:00', 3, agora)).toBe('2026-10-02T12:00:00.000Z');
  });

  it('dataJaPassou compara dias, não horas', () => {
    expect(dataJaPassou('2026-09-12T08:00:00-03:00', agora)).toBe(false);
    expect(dataJaPassou('2026-09-11T23:59:00-03:00', agora)).toBe(true);
  });

  it('remarcar para antes de hoje é recusado; hoje mais cedo vale', () => {
    expect(remarcacaoPermitida('2026-09-11T23:59:00-03:00', agora)).toBe(false);
    expect(remarcacaoPermitida('2026-09-12T08:00:00-03:00', agora)).toBe(true);
    expect(remarcacaoPermitida('não é data', agora)).toBe(false);
  });
});

describe('podeDesfazerConclusao — espelho da regra da API (D6)', () => {
  const agora = t('2026-09-12T15:00:00-03:00');
  const recente = new Date(agora - 30_000).toISOString();
  const base = { seguimentoCriado: null, preProcessualCriado: null, desfecho: 'PRAZO_CUMPRIDO', concluidoEm: recente };

  it('conclusão simples de agora pode', () => {
    expect(podeDesfazerConclusao(base, agora)).toBe(true);
  });

  it('passou da janela de 120 s, não', () => {
    expect(JANELA_DESFAZER_CONCLUSAO_MS).toBe(120_000);
    expect(podeDesfazerConclusao({ ...base, concluidoEm: new Date(agora - 121_000).toISOString() }, agora)).toBe(false);
  });

  it('criou seguimento, processo ou vínculo: não', () => {
    expect(podeDesfazerConclusao({ ...base, seguimentoCriado: { id: 's', titulo: 'x', inicio: recente, tipo: 'PRAZO' } }, agora)).toBe(false);
    expect(podeDesfazerConclusao({ ...base, preProcessualCriado: { id: 'p', titulo: null } }, agora)).toBe(false);
    expect(podeDesfazerConclusao({ ...base, desfecho: 'VINCULADO_PROCESSO' }, agora)).toBe(false);
  });
});

describe('rótulos novos', () => {
  it('PRAZO_SEM_PECA (D3)', () => {
    expect(DESFECHO_LABEL.PRAZO_SEM_PECA).toBe('Analisado — nada a protocolar');
  });

  it('SUBSTITUIDA deixa de aparecer como código cru', () => {
    expect(CATEGORIA_CANCELAMENTO_LABEL.SUBSTITUIDA).toBe('Substituída por nova conclusão');
  });
});
