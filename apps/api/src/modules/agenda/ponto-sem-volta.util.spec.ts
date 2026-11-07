import {
  fraseDaPerda, perdeuOSentido, pontoSemVolta, emRecessoForense,
  NUNCA_VENCEM_POR_TEMPO, type PontoSemVolta,
} from './ponto-sem-volta.util';

/** Um DIA de calendário, como o Postgres materializa `date`. */
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Um instante em Teresina (UTC−3), escrito como se lê no relógio daqui. */
const emTeresina = (iso: string, hora = '09:00') => new Date(`${iso}T${hora}:00.000-03:00`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * QUANDO UMA ATIVIDADE PERDE O SENTIDO — com datas de verdade.
 *
 * Novembro de 2026 tem dois feriados nacionais em dia útil: Finados (segunda,
 * 02/11) e Consciência Negra (sexta, 20/11). E o recesso forense (20/12 a 20/01)
 * suspende prazo. São os três jeitos de errar uma conta de dias úteis.
 */
describe('o prazo do ato do Diário', () => {
  /*
    Disponibilizado na sexta, 30/10. A publicação é o 1º dia útil seguinte (03/11,
    porque 02/11 é Finados) e o prazo começa no próximo (04/11). Cinco dias úteis:
    04, 05, 06, 09 e 10/11. Mais dois de margem: 11 e 12/11.
  */
  const ato = { dataDisponibilizacao: dia('2026-10-30'), prazoMencionadoDias: 5 };
  const tarefa = { tipo: 'PRAZO', inicio: emTeresina('2026-11-04'), publicacoes: [ato] };

  it('o último dia é o fim do prazo mais a margem, e não o dia marcado da tarefa', () => {
    const p = pontoSemVolta(tarefa) as Extract<PontoSemVolta, { tipo: 'PRAZO_DO_ATO' }>;
    expect(p.tipo).toBe('PRAZO_DO_ATO');
    expect(ymd(p.fimDoPrazo)).toBe('2026-11-12');
    expect(ymd(p.ultimoDia)).toBe('2026-11-12');
  });

  /**
   * O ERRO QUE ESTA REGRA EXISTE PARA NÃO COMETER. A tarefa está marcada para
   * 04/11 — o dia de sentar, com folga. Cancelá-la em 05/11 apagaria o lembrete
   * com o prazo ainda aberto por uma semana.
   */
  it('no dia seguinte ao marcado, com o prazo aberto, NÃO cancela', () => {
    expect(perdeuOSentido(pontoSemVolta(tarefa), emTeresina('2026-11-05'))).toBe(false);
    expect(perdeuOSentido(pontoSemVolta(tarefa), emTeresina('2026-11-10', '17:00'))).toBe(false);
  });

  it('o último dia inteiro ainda vale, inclusive às 23h59 de Teresina', () => {
    expect(perdeuOSentido(pontoSemVolta(tarefa), emTeresina('2026-11-12', '23:59'))).toBe(false);
  });

  it('cancela a partir do dia seguinte ao último', () => {
    expect(perdeuOSentido(pontoSemVolta(tarefa), emTeresina('2026-11-13', '00:01'))).toBe(true);
  });

  /*
    Sem prazo citado, 15 dias úteis + 1 + 2 = 18 a partir de 30/10, e no caminho
    está a Consciência Negra (sexta, 20/11), que não conta.
  */
  it('o ato que não diz prazo ganha 15 dias úteis, e o feriado do meio não conta', () => {
    const p = pontoSemVolta({ ...tarefa, publicacoes: [{ ...ato, prazoMencionadoDias: null }] });
    expect(p && ymd(p.ultimoDia)).toBe('2026-11-27');
  });

  /* 18/12 + 8 dias de prazo: o recesso suspende de 21/12 a 20/01, e a conta recomeça em 21/01. */
  it('o recesso forense suspende a contagem', () => {
    expect(emRecessoForense(dia('2026-12-20'))).toBe(true);
    expect(emRecessoForense(dia('2027-01-20'))).toBe(true);
    expect(emRecessoForense(dia('2027-01-21'))).toBe(false);
    const p = pontoSemVolta({
      tipo: 'PRAZO', inicio: emTeresina('2026-12-18'),
      publicacoes: [{ dataDisponibilizacao: dia('2026-12-18'), prazoMencionadoDias: 5 }],
    });
    expect(p && ymd(p.ultimoDia)).toBe('2027-02-01');
  });

  it('com duas cópias do ato, vale a que dá mais tempo', () => {
    const p = pontoSemVolta({
      ...tarefa,
      publicacoes: [ato, { dataDisponibilizacao: dia('2026-11-03'), prazoMencionadoDias: 5 }],
    });
    expect(p && ymd(p.ultimoDia)).toBe('2026-11-13');
  });

  /*
    O histórico do Diário traz ato de meses atrás, e a tarefa nasce hoje. O prazo
    já acabou em setembro, mas ninguém pode abrir a agenda e achar cancelada uma
    tarefa que nasceu ontem: ela ganha a folga do dia marcado. A frase cita o fim
    do prazo, que é o fato.
  */
  it('a tarefa que nasceu depois do prazo ainda ganha a folga do dia marcado', () => {
    const p = pontoSemVolta({
      tipo: 'PRAZO', inicio: emTeresina('2026-11-03'),
      publicacoes: [{ dataDisponibilizacao: dia('2026-09-01'), prazoMencionadoDias: 5 }],
    }) as Extract<PontoSemVolta, { tipo: 'PRAZO_DO_ATO' }>;
    // 8 dias que contam a partir de 01/09, pulando a Independência (segunda, 07/09).
    expect(ymd(p.fimDoPrazo)).toBe('2026-09-14');
    expect(ymd(p.ultimoDia)).toBe('2026-11-10');
  });
});

describe('a tarefa sem ato do Diário', () => {
  /*
    UMA SEMANA DE EXPEDIENTE. Com um dia só, a simulação contra a produção
    mostrou 15 de 33 tarefas do robô atropeladas: o "Cadastrar ação" é concluído
    em lote, dias depois. Terça, 03/11: 04, 05, 06, 09 e 10/11.
  */
  it('ganha uma semana de expediente depois do dia marcado', () => {
    const p = pontoSemVolta({ tipo: 'DILIGENCIA', inicio: emTeresina('2026-11-03'), publicacoes: [] });
    expect(p?.tipo).toBe('DIA_MARCADO');
    expect(perdeuOSentido(p, emTeresina('2026-11-05'))).toBe(false);
    expect(perdeuOSentido(p, emTeresina('2026-11-10', '23:59'))).toBe(false);
    expect(perdeuOSentido(p, emTeresina('2026-11-11', '05:00'))).toBe(true);
  });

  it('a semana pula fim de semana e feriado: a da sexta antes de Finados vai até 09/11', () => {
    const sexta = pontoSemVolta({ tipo: 'CONTATO', inicio: emTeresina('2026-11-06'), publicacoes: [] });
    expect(sexta && ymd(sexta.ultimoDia)).toBe('2026-11-13');
    const antesDeFinados = pontoSemVolta({ tipo: 'CONTATO', inicio: emTeresina('2026-10-30'), publicacoes: [] });
    expect(antesDeFinados && ymd(antesDeFinados.ultimoDia)).toBe('2026-11-09');
  });

  /* 21h de Teresina já é o dia seguinte em UTC; o dia marcado é o daqui. */
  it('o dia marcado é o de Teresina, não o de Greenwich', () => {
    const p = pontoSemVolta({ tipo: 'DILIGENCIA', inicio: emTeresina('2026-11-03', '22:30'), publicacoes: [] });
    expect(p?.tipo === 'DIA_MARCADO' && ymd(p.diaMarcado)).toBe('2026-11-03');
  });
});

describe('o que nunca vence por tempo', () => {
  it.each([...NUNCA_VENCEM_POR_TEMPO])('%s: aconteceu ou não, e o sistema não sabe', (tipo) => {
    const p = pontoSemVolta({ tipo, inicio: emTeresina('2026-01-05'), publicacoes: [] });
    expect(p).toBeNull();
    expect(perdeuOSentido(p, emTeresina('2026-11-07'))).toBe(false);
  });
});

describe('a frase do cancelamento', () => {
  const ponto = pontoSemVolta({
    tipo: 'PRAZO', inicio: emTeresina('2026-11-04'),
    publicacoes: [{ dataDisponibilizacao: dia('2026-10-30'), prazoMencionadoDias: 5 }],
  })!;

  it('diz o que o dono pediu: falta de interação do advogado, prazo ou sentido perdido', () => {
    expect(fraseDaPerda(ponto, { nome: 'Carlos Henrique', role: 'ADVOGADO' }, false)).toBe(
      'Cancelada pelo sistema por falta de interação do advogado responsável (Carlos): ' +
        'o prazo de 5 dia(s) que o ato menciona terminou até 12/11 sem que ninguém iniciasse, ' +
        'anotasse ou concluísse a atividade, e o prazo ou o sentido dela se perdeu. ' +
        'A conta é uma estimativa com folga: dias úteis, feriados nacionais e recesso forense. ' +
        'Se ela foi cumprida fora do sistema, reabra e conclua.',
    );
  });

  /** Culpar quem nunca viu a tarefa seria jogar nele um problema de alcance. */
  it('diz quando o responsável nem entrou no sistema', () => {
    expect(fraseDaPerda(ponto, { nome: 'Morgana Sousa', role: 'ADVOGADO' }, true)).toContain(
      'Morgana não entrou no sistema desde que ela foi criada.',
    );
  });

  it('não chama de advogado quem não é', () => {
    const frase = fraseDaPerda(ponto, { nome: 'Ícaro Lima', role: 'TRIAGEM' }, false);
    expect(frase).toContain('de quem era responsável (Ícaro)');
    expect(frase).not.toContain('advogado');
  });

  it('a tarefa sem ato cita o dia marcado, sem inventar prazo', () => {
    const p = pontoSemVolta({ tipo: 'DILIGENCIA', inicio: emTeresina('2026-11-03'), publicacoes: [] })!;
    const frase = fraseDaPerda(p, { nome: 'Ícaro Lima', role: 'ADVOGADO' }, false);
    expect(frase).toContain('o dia marcado, 03/11, passou sem que ninguém');
    expect(frase).not.toContain('estimativa');
  });

  /** O sistema não sabe se a peça foi protocolada: a frase nunca afirma que não foi. */
  it('termina dizendo como desfazer', () => {
    expect(fraseDaPerda(ponto, { nome: 'Carlos', role: 'ADVOGADO' }, false)).toMatch(
      /Se ela foi cumprida fora do sistema, reabra e conclua\.$/,
    );
  });
});
