import {
  dataDaColuna, diaCurto, ehDataPuraValida, faixaValida, fraseDaSobreposicao, pessoaNaFrase,
  pessoaNoInicio, procurarSobreposicao, seSobrepoem, textoDaColuna,
} from './escalas.regras';

/**
 * As regras da escala com valores. A produção (12/09/2026) tem 25 plantões,
 * todos 09:00–12:00, um por pessoa por dia — os casos abaixo são os que a
 * tela nova (repetição semanal, troca) passa a produzir.
 */
describe('sobreposição de faixas', () => {
  it.each([
    ['09:00', '12:00', '10:00', '11:00', true],  // uma dentro da outra
    ['09:00', '12:00', '11:00', '14:00', true],  // cruzam
    ['09:00', '12:00', '09:00', '12:00', true],  // idênticas (a duplicata)
    ['09:00', '12:00', '12:00', '15:00', false], // encostam: dois turnos seguidos
    ['09:00', '12:00', '14:00', '17:00', false], // manhã e tarde
    ['14:00', '17:00', '09:00', '12:00', false], // a ordem não importa
  ])('%s–%s com %s–%s → %s', (ai, af, bi, bf, esperado) => {
    expect(seSobrepoem({ horaInicio: ai, horaFim: af }, { horaInicio: bi, horaFim: bf })).toBe(esperado);
    expect(seSobrepoem({ horaInicio: bi, horaFim: bf }, { horaInicio: ai, horaFim: af })).toBe(esperado);
  });

  it('fim igual ou antes do início não é plantão', () => {
    expect(faixaValida({ horaInicio: '09:00', horaFim: '12:00' })).toBe(true);
    expect(faixaValida({ horaInicio: '09:00', horaFim: '09:00' })).toBe(false);
    expect(faixaValida({ horaInicio: '12:00', horaFim: '09:00' })).toBe(false);
  });
});

describe('data pura', () => {
  it('só aceita dia que existe no calendário', () => {
    expect(ehDataPuraValida('2026-09-15')).toBe(true);
    expect(ehDataPuraValida('2028-02-29')).toBe(true);
    expect(ehDataPuraValida('2026-02-29')).toBe(false);
    expect(ehDataPuraValida('2026-02-31')).toBe(false);
    expect(ehDataPuraValida('2026-13-01')).toBe(false);
    expect(ehDataPuraValida('2026-09-15T00:00:00Z')).toBe(false);
  });

  /** A coluna `@db.Date` materializa meia-noite UTC — ida e volta sem andar um dia. */
  it('vai para a coluna e volta como o mesmo dia', () => {
    expect(dataDaColuna('2026-09-15').toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(textoDaColuna(dataDaColuna('2026-12-31'))).toBe('2026-12-31');
    expect(diaCurto('2026-09-05')).toBe('05/09');
  });
});

describe('como a pessoa aparece na frase', () => {
  it('o tratamento dá o artigo; sem tratamento, nenhum artigo é chutado', () => {
    expect(pessoaNaFrase({ nome: 'Shérad Lima', nomeExibicao: 'Dra. Shérad' })).toBe('a Dra. Shérad');
    expect(pessoaNaFrase({ nome: 'Murilo Sá', nomeExibicao: 'Dr. Murilo' })).toBe('o Dr. Murilo');
    expect(pessoaNaFrase({ nome: 'Ana Souza', nomeExibicao: null })).toBe('Ana Souza');
    expect(pessoaNaFrase({ nome: 'Ana Souza', nomeExibicao: '  ' })).toBe('Ana Souza');
    // "Drummond" começa com "Dr" e não é tratamento.
    expect(pessoaNaFrase({ nome: 'Drummond Alves' })).toBe('Drummond Alves');
    expect(pessoaNoInicio({ nome: 'x', nomeExibicao: 'Dra. Shérad' })).toBe('A Dra. Shérad');
  });
});

describe('procurarSobreposicao', () => {
  const nove = { horaInicio: '09:00', horaFim: '12:00' };
  const tarde = { horaInicio: '14:00', horaFim: '17:00' };

  it('recusa o que colide com um plantão gravado, e diz dia e horário', () => {
    const s = procurarSobreposicao(
      [{ data: '2026-09-15', horaInicio: '10:00', horaFim: '11:00' }],
      [{ id: 'e1', data: '2026-09-15', ...nove }],
    );
    expect(s).toEqual({
      tipo: 'EXISTENTE',
      data: '2026-09-15',
      pedido: { data: '2026-09-15', horaInicio: '10:00', horaFim: '11:00' },
      existente: { id: 'e1', data: '2026-09-15', ...nove },
    });
    expect(fraseDaSobreposicao(s!, { nome: 'Shérad Lima', nomeExibicao: 'Dra. Shérad' }))
      .toBe('Em 15/09 a Dra. Shérad já está de plantão 09:00–12:00.');
  });

  it('o mesmo horário em outro dia, ou outro turno no mesmo dia, passa', () => {
    expect(
      procurarSobreposicao(
        [{ data: '2026-09-16', ...nove }, { data: '2026-09-15', ...tarde }],
        [{ id: 'e1', data: '2026-09-15', ...nove }],
      ),
    ).toBeNull();
  });

  /** O lote com a data repetida — o banco ainda não tem nenhuma das duas. */
  it('acha a duplicata dentro do próprio pedido', () => {
    const s = procurarSobreposicao(
      [
        { data: '2026-09-15', ...nove },
        { data: '2026-09-22', ...nove },
        { data: '2026-09-15', horaInicio: '11:00', horaFim: '13:00' },
      ],
      [],
    );
    expect(s?.tipo).toBe('NO_PEDIDO');
    expect(fraseDaSobreposicao(s!, { nome: 'Ana' }))
      .toBe('O pedido repete 15/09 em horários que se sobrepõem (09:00–12:00 e 11:00–13:00).');
  });

  it('a linha que está sendo editada não colide consigo mesma', () => {
    const gravados = [{ id: 'e1', data: '2026-09-15', ...nove }];
    const pedido = [{ data: '2026-09-15', horaInicio: '09:00', horaFim: '11:00' }];
    expect(procurarSobreposicao(pedido, gravados, 'e1')).toBeNull();
    expect(procurarSobreposicao(pedido, gravados, 'outra')?.tipo).toBe('EXISTENTE');
  });
});
