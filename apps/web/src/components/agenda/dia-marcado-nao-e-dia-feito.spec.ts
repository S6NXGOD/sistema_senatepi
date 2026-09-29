import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diferencaDoDiaMarcado, doDiaDeTeresina, quandoTerminou } from '@/lib/agenda';
import { visiveisDaColuna } from '@/components/agenda/kanban-view';

const semComentarios = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const CARD = semComentarios('compromisso-card.tsx');
const GAVETA = semComentarios('compromisso-drawer.tsx');

/**
 * "O CERTO NÃO SERIA, SE A ATIVIDADE FOI CONCLUÍDA NO DIA 28, ELA FICAR
 * CONCLUÍDA NO DIA 28 E NÃO NO DIA 29?" — pergunta do dono, 28/09/2026.
 *
 * O caso: "Elaborar manifestação", prazo marcado para 29/09 às 09:00,
 * protocolada às 17h14 do dia 28. O quadro mostrava o cartão no dia 29, com a
 * data "29/09/2026, 09:00", dentro da coluna "Concluído".
 *
 * A RESPOSTA É NÃO, E O MOTIVO É MEDIDO. A agenda é um calendário de
 * COMPROMISSOS: o dia do cartão é o dia para o qual a atividade existia. Mover
 * o cartão para o dia em que foi fechada apagaria a única coisa que um prazo
 * tem a dizer — se foi cumprido a tempo:
 *
 *   86 concluídas na produção
 *   55 (64%) fechadas no mesmo dia para o qual estavam marcadas
 *   21 fechadas DEPOIS — um prazo de 09/09 fechado em 15/09 apareceria no 15/09
 *      e pareceria pontual
 *   10 fechadas ANTES — o caso dele
 *
 * E o dia 29 ficaria vazio, como se nunca tivesse havido compromisso ali.
 *
 * O QUE ESTAVA ERRADO ERA OUTRA COISA: o cartão mostrava UMA data — a do
 * compromisso — debaixo de uma coluna chamada "Concluído". Quem lê entende
 * aquela data como a da conclusão, e em **36% dos casos ela não é**. Faltava o
 * cartão dizer quando foi feito.
 */
describe('diferencaDoDiaMarcado — o dia marcado não é o dia em que se fez', () => {
  /** O caso exato da tela: prazo do dia 29, protocolado às 17h14 do dia 28. */
  it('concluída na véspera diz "1 dia antes"', () => {
    const d = diferencaDoDiaMarcado('2026-09-29T12:00:00Z', '2026-09-28T20:14:00Z');
    expect(d).toEqual({ dias: -1, texto: '1 dia antes' });
  });

  /** Prazo de 09/09 fechado em 15/09 — o que mover o cartão esconderia. */
  it('concluída depois diz quantos dias depois', () => {
    const d = diferencaDoDiaMarcado('2026-09-09T12:00:00Z', '2026-09-15T13:24:00Z');
    expect(d).toEqual({ dias: 6, texto: '6 dias depois' });
  });

  /** A maioria (64%): mesmo dia. Repetir a data ali seria ruído. */
  it('mesmo dia não vira linha nenhuma', () => {
    expect(diferencaDoDiaMarcado('2026-09-28T12:40:00Z', '2026-09-28T14:07:00Z')).toBeNull();
  });

  /**
   * O DIA É O DE TERESINA, E A CONTA É DE CALENDÁRIO.
   *
   * 23h30 do dia 28 em Teresina é 02h30 do dia 29 em UTC: contar em horas
   * corridas, ou no fuso do navegador, daria "zero" onde há um dia inteiro de
   * diferença — o erro que este projeto já pagou em 26 de 28 formatações.
   */
  it('a virada do dia é a de Teresina, não a do UTC', () => {
    // 28/09 23:30 BRT (= 29/09 02:30 UTC) para um compromisso do dia 29.
    expect(diferencaDoDiaMarcado('2026-09-29T12:00:00Z', '2026-09-29T02:30:00Z')).toEqual({
      dias: -1,
      texto: '1 dia antes',
    });
    // E 00:10 BRT do dia 29 para o mesmo compromisso: é o próprio dia.
    expect(diferencaDoDiaMarcado('2026-09-29T12:00:00Z', '2026-09-29T03:10:00Z')).toBeNull();
  });

  /** O caso extremo da produção: reunião de 30/01/2027 concluída em 02/09/2026. */
  it('meses de distância continuam em dias, sem arredondar para semana', () => {
    const d = diferencaDoDiaMarcado('2027-01-30T12:00:00Z', '2026-09-02T18:15:00Z');
    expect(d?.dias).toBe(-150);
    expect(d?.texto).toBe('150 dias antes');
  });

  it('atividade aberta não tem desvio', () => {
    expect(diferencaDoDiaMarcado('2026-09-29T12:00:00Z', null)).toBeNull();
    expect(diferencaDoDiaMarcado(null, '2026-09-28T20:14:00Z')).toBeNull();
  });
});

describe('quandoTerminou — concluída ou cancelada, é o mesmo fato', () => {
  it('usa a conclusão quando há', () => {
    expect(quandoTerminou({ concluidoEm: '2026-09-28T20:14:00Z', canceladoEm: null })).toBe(
      '2026-09-28T20:14:00Z',
    );
  });

  it('e o cancelamento quando foi esse o fim', () => {
    expect(quandoTerminou({ concluidoEm: null, canceladoEm: '2026-09-27T10:00:00Z' })).toBe(
      '2026-09-27T10:00:00Z',
    );
  });

  it('aberta não terminou', () => {
    expect(quandoTerminou({ concluidoEm: null, canceladoEm: null })).toBeNull();
    expect(quandoTerminou({})).toBeNull();
  });
});

/**
 * "O QUE FECHAMOS ULTIMAMENTE" ERA ORDENADO PELO DIA MARCADO — o mesmo defeito,
 * na mesma coluna.
 *
 * `visiveisDaColuna` ordenava as terminais por `inicio` e cortava em 10. Medido
 * na produção em 28/09/2026: no topo de "Concluído" estava uma **reunião
 * marcada para 30/01/2027 e concluída em 02/09/2026** — fechada havia quase um
 * mês, liderando por causa de uma data futura. E o corte empurrava para fora
 * uma atividade realmente recente.
 */
describe('a coluna terminal ordena pelo que terminou por último', () => {
  const item = (id: string, inicio: string, concluidoEm: string | null) => ({
    id,
    inicio,
    concluidoEm,
    canceladoEm: null,
  });

  /** Os quatro primeiros da produção, com a reunião de 2027 no meio. */
  const REAIS = [
    item('reuniao-fms', '2027-01-30T12:00:00Z', '2026-09-02T18:15:00Z'),
    item('manifestacao', '2026-09-29T12:00:00Z', '2026-09-28T20:14:00Z'),
    item('nadia', '2026-09-28T12:40:00Z', '2026-09-28T15:05:00Z'),
    item('ligia', '2026-09-28T14:30:00Z', '2026-09-28T14:44:00Z'),
  ];

  it('a reunião de 2027 sai do topo; quem fechou por último lidera', () => {
    const ordem = visiveisDaColuna(REAIS, 'CONCLUIDO', true).map((c) => c.id);
    expect(ordem[0]).toBe('manifestacao');
    expect(ordem[ordem.length - 1]).toBe('reuniao-fms');
  });

  /** Cancelada usa o próprio carimbo — é o mesmo "terminou". */
  it('a coluna de canceladas ordena pelo cancelamento', () => {
    const itens = [
      { id: 'velha', inicio: '2026-09-27T12:00:00Z', concluidoEm: null, canceladoEm: '2026-09-20T10:00:00Z' },
      { id: 'nova', inicio: '2026-09-10T12:00:00Z', concluidoEm: null, canceladoEm: '2026-09-26T10:00:00Z' },
    ];
    expect(visiveisDaColuna(itens, 'CANCELADO', true).map((c) => c.id)).toEqual(['nova', 'velha']);
  });

  /**
   * LINHA ANTIGA SEM CARIMBO NÃO SOME. Antes de as colunas existirem havia
   * atividades fechadas sem `concluidoEm`; sem a reserva por `inicio` elas
   * cairiam todas no fim da lista, como se fossem de 1970.
   */
  it('sem carimbo, vale o dia marcado', () => {
    const itens = [
      item('sem-carimbo', '2026-09-25T12:00:00Z', null),
      item('com-carimbo', '2026-09-01T12:00:00Z', '2026-09-20T10:00:00Z'),
    ];
    expect(visiveisDaColuna(itens, 'CONCLUIDO', true).map((c) => c.id)).toEqual([
      'sem-carimbo',
      'com-carimbo',
    ]);
  });

  /** As colunas abertas (não terminais) continuam na ordem que a página deu. */
  it('pendente não é reordenada aqui', () => {
    const ordem = visiveisDaColuna(REAIS, 'PENDENTE', true).map((c) => c.id);
    expect(ordem).toEqual(REAIS.map((c) => c.id));
  });

  /** E o corte de 10 continua valendo, agora escolhendo os certos. */
  it('o corte fica com os dez que terminaram por último', () => {
    const muitos = Array.from({ length: 14 }, (_, i) =>
      item(`c${i}`, '2026-01-01T12:00:00Z', `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );
    const vistos = visiveisDaColuna(muitos, 'CONCLUIDO', false);
    expect(vistos).toHaveLength(10);
    expect(vistos[0].id).toBe('c13');
    expect(vistos.map((c) => c.id)).not.toContain('c0');
  });
});

describe('o cartão e a gaveta dizem em que dia foi feito', () => {
  it('o cartão mostra a data da conclusão quando é outro dia', () => {
    expect(CARD).toContain('const desvio = diferencaDoDiaMarcado(c.inicio, quandoTerminou(c));');
    expect(CARD).toContain('Concluída em {formatData(c.concluidoEm)}');
  });

  /** A cancelada tem o mesmo problema e a mesma linha, com a palavra certa. */
  it('a cancelada também, e diz "Cancelada"', () => {
    expect(CARD).toContain('Cancelada em {formatData(c.canceladoEm)}');
  });

  /**
   * SEM COR. Fechar antes é boa notícia, fechar depois já aconteceu: nenhum dos
   * dois pede alguém, e âmbar aqui gastaria o alarme à toa.
   */
  it('a linha do desvio não é alarme', () => {
    const i = CARD.indexOf('Concluída em {formatData(c.concluidoEm)}');
    const trecho = CARD.slice(Math.max(0, i - 400), i + 200);
    expect(trecho).not.toContain('amber');
    expect(trecho).not.toContain('destructive');
  });

  /** Na gaveta, a conta vem pronta ao lado do instante da conclusão. */
  it('a gaveta põe a diferença ao lado do desfecho', () => {
    expect(GAVETA).toContain('const desvio = c ? diferencaDoDiaMarcado(c.inicio, quandoTerminou(c)) : null;');
    expect(GAVETA).toContain('{desvio.texto}');
  });
});

/**
 * DUAS LINHAS NÃO PODEM ABRIR COM A MESMA PALAVRA QUERENDO DIZER OUTRA COISA.
 *
 * Com a data da conclusão no cartão, ele passaria a ter:
 *
 *   ⏱ Concluída em 2h15          (quanto durou)
 *   ✓ Concluída em 28/09/2026    (que dia)
 *
 * Ler as duas juntas obriga a reparar no TIPO do valor para saber do que se
 * fala — exatamente o defeito de `ultimaMovimentacao.data`, que misturava
 * instante e dia de calendário num campo só. "Levou" não vira data.
 */
describe('duração e data não se confundem no cartão', () => {
  it('a duração diz "Levou", não "Concluída em"', () => {
    expect(CARD).toContain('Levou {duracaoEntre(c.iniciadoEm, c.concluidoEm)}');
    expect(CARD).not.toContain('Concluída em {duracaoEntre');
  });

  /** E sobra uma única "Concluída em" no cartão: a da data. */
  it('só há uma "Concluída em", e é a do dia', () => {
    expect(CARD.match(/Concluída em/g)).toHaveLength(1);
    expect(CARD).toContain('Concluída em {formatData(c.concluidoEm)}');
  });
});

/**
 * O DIA DO CALENDÁRIO MOSTRA O QUE FECHOU NELE — a outra metade da pergunta.
 *
 * "E se um advogado concluir uma atividade atrasada? Ela fica concluída no dia
 * ou se conclui na data atrasada?" — o dono, 28/09/2026.
 *
 * O registro guarda o instante real e o cartão fica no dia marcado (acima). Mas
 * as duas maneiras de olhar um DIA discordavam na mesma tela: a aba "Hoje"
 * conta pelo carimbo desde 18/09; a célula do calendário, não.
 *
 *   aba "Hoje" ....................... 12
 *   célula de hoje ................... 6
 *   dias dos últimos 60 com diferença . 14 — no 02/09, OITO atividades
 */
describe('doDiaDeTeresina — o dia são as marcadas nele e as que fecharam nele', () => {
  const ATIVIDADE = {
    id: 'prazo',
    inicio: '2026-09-22T12:00:00Z', // 22/09 em Teresina
    concluidoEm: '2026-09-28T13:24:00Z', // 28/09 em Teresina
    canceladoEm: null,
  };

  it('aparece no dia para o qual foi marcada', () => {
    expect(doDiaDeTeresina([ATIVIDADE], '2026-09-22')).toHaveLength(1);
  });

  /** E no dia em que saiu — dois fatos verdadeiros, e o cartão diz qual é qual. */
  it('e no dia em que foi concluída', () => {
    expect(doDiaDeTeresina([ATIVIDADE], '2026-09-28')).toHaveLength(1);
  });

  it('e em nenhum outro', () => {
    expect(doDiaDeTeresina([ATIVIDADE], '2026-09-25')).toEqual([]);
  });

  /** Cancelar é um desfecho: o dia do cancelamento conta igual. */
  it('o cancelamento conta como fim', () => {
    const cancelada = { id: 'c', inicio: '2026-09-10T12:00:00Z', concluidoEm: null, canceladoEm: '2026-09-26T13:00:00Z' };
    expect(doDiaDeTeresina([cancelada], '2026-09-26')).toHaveLength(1);
    expect(doDiaDeTeresina([cancelada], '2026-09-10')).toHaveLength(1);
  });

  /** Aberta continua só no dia dela. */
  it('atividade aberta não aparece em dia nenhum além do seu', () => {
    const aberta = { id: 'a', inicio: '2026-09-22T12:00:00Z', concluidoEm: null, canceladoEm: null };
    expect(doDiaDeTeresina([aberta], '2026-09-22')).toHaveLength(1);
    expect(doDiaDeTeresina([aberta], '2026-09-28')).toEqual([]);
  });

  /** Fechada no mesmo dia entra UMA vez — a lista não pode duplicar o cartão. */
  it('fechada no mesmo dia não duplica', () => {
    const mesmoDia = { id: 'm', inicio: '2026-09-28T12:00:00Z', concluidoEm: '2026-09-28T14:07:00Z', canceladoEm: null };
    expect(doDiaDeTeresina([mesmoDia], '2026-09-28')).toHaveLength(1);
  });

  /**
   * O DIA É O DE TERESINA. 23h30 do dia 27 em Teresina é 02h30 do dia 28 em
   * UTC: contar no fuso errado poria a atividade na célula seguinte.
   */
  it('a virada do dia é a de Teresina', () => {
    const noite = { id: 'n', inicio: '2026-09-10T12:00:00Z', concluidoEm: '2026-09-28T02:30:00Z', canceladoEm: null };
    expect(doDiaDeTeresina([noite], '2026-09-27')).toHaveLength(1);
    expect(doDiaDeTeresina([noite], '2026-09-28')).toEqual([]);
  });
});

/**
 * E A CONSULTA DO MÊS PRECISA TRAZER ESSAS ATIVIDADES.
 *
 * Filtrar o dia na tela não adianta se o navegador nunca recebeu a atividade:
 * a consulta do mês vai por `inicio`, então uma devida em 22/08 e concluída em
 * 15/09 não chega quando alguém abre setembro.
 */
describe('a grade do mês pede o que fechou no mês', () => {
  const PAGINA = readFileSync(join(__dirname, '../../app/(dashboard)/agenda/page.tsx'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('a janela do calendário manda a opção', () => {
    expect(PAGINA).toContain("incluirFechadasNoPeriodo: '1'");
  });
});
