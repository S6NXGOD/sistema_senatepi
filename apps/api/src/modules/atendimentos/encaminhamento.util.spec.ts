import {
  ConsultaDoEncaminhamento,
  DIAS_UTEIS_ATE_VOLTAR_A_TRIAGEM,
  filaDoAtendimento,
  LOCAL_DA_MODALIDADE,
  modalidadeRemota,
  situacaoDoEncaminhamento,
} from './encaminhamento.util';

/**
 * EM QUE PÉ ESTÁ O ENCAMINHAMENTO — testado com valores, não com o fonte.
 *
 * O relógio é fixo e o fuso é o de Teresina (UTC-3). Os casos das bordas do
 * dia são os que já custaram caro neste sistema: a consulta das 22h daqui já é
 * "amanhã" em UTC, e a das 23h30 de ontem ainda é "hoje" em UTC.
 */

/** Terça, 15/09/2026, 11:00 em Teresina. */
const AGORA = new Date('2026-09-15T14:00:00.000Z');

const DRA_ANA = { id: 'u-ana', nome: 'Ana Souza', nomeExibicao: 'Dra. Ana' };
const DR_BRUNO = { id: 'u-bruno', nome: 'Bruno Lima', nomeExibicao: null };

function consulta(parcial: Omit<Partial<ConsultaDoEncaminhamento>, 'inicio'> & { inicio: string }): ConsultaDoEncaminhamento {
  return {
    id: 'c-1',
    status: 'PENDENTE',
    local: null,
    linkReuniao: null,
    origemDesfechoId: null,
    responsavel: DRA_ANA,
    ...parcial,
    inicio: new Date(parcial.inicio),
  };
}

describe('situacaoDoEncaminhamento', () => {
  it('sem consulta não há encaminhamento a mostrar', () => {
    expect(situacaoDoEncaminhamento([], AGORA)).toBeNull();
    expect(situacaoDoEncaminhamento(null, AGORA)).toBeNull();
    expect(situacaoDoEncaminhamento(undefined, AGORA)).toBeNull();
  });

  describe('o estado de uma consulta só', () => {
    const casos: [string, Omit<Partial<ConsultaDoEncaminhamento>, 'inicio'> & { inicio: string }, string][] = [
      ['pendente amanhã', { inicio: '2026-09-16T13:00:00.000Z' }, 'AGENDADA'],
      ['pendente hoje, ainda por vir', { inicio: '2026-09-15T17:00:00.000Z' }, 'HOJE'],
      // Às 11h, a das 9h ainda PENDENTE é de hoje: talvez só não apertaram "Iniciar".
      ['pendente hoje, hora já passou', { inicio: '2026-09-15T12:00:00.000Z' }, 'HOJE'],
      // 22h de Teresina do dia 15 é dia 16 em UTC — e continua sendo hoje aqui.
      ['pendente às 22h daqui (dia seguinte em UTC)', { inicio: '2026-09-16T01:00:00.000Z' }, 'HOJE'],
      ['pendente ontem', { inicio: '2026-09-14T13:00:00.000Z' }, 'FICOU_PARA_TRAS'],
      // 23h30 de ontem aqui é 02h30 de HOJE em UTC — ficou para trás mesmo assim.
      ['pendente às 23h30 de ontem (hoje em UTC)', { inicio: '2026-09-15T02:30:00.000Z' }, 'FICOU_PARA_TRAS'],
      ['em andamento', { inicio: '2026-09-15T13:00:00.000Z', status: 'EM_ANDAMENTO' }, 'EM_CONSULTA'],
      // Iniciada ontem e esquecida aberta: continua em consulta, não "para trás".
      ['em andamento desde ontem', { inicio: '2026-09-14T13:00:00.000Z', status: 'EM_ANDAMENTO' }, 'EM_CONSULTA'],
      ['concluída', { inicio: '2026-09-14T13:00:00.000Z', status: 'CONCLUIDO' }, 'ATENDIDA'],
      ['cancelada', { inicio: '2026-09-16T13:00:00.000Z', status: 'CANCELADO' }, 'CANCELADA'],
    ];

    it.each(casos)('%s', (_nome, dados, esperado) => {
      expect(situacaoDoEncaminhamento([consulta(dados)], AGORA)?.estado).toBe(esperado);
    });
  });

  it('a borda do dia anda com o relógio de Teresina, não com o de UTC', () => {
    const c = consulta({ inicio: '2026-09-15T02:30:00.000Z' }); // 23h30 do dia 14 aqui
    // Às 23h40 do dia 14 (ainda o mesmo dia aqui) é hoje...
    expect(situacaoDoEncaminhamento([c], new Date('2026-09-15T02:40:00.000Z'))?.estado).toBe('HOJE');
    // ...e à 00h10 do dia 15 já ficou para trás.
    expect(situacaoDoEncaminhamento([c], new Date('2026-09-15T03:10:00.000Z'))?.estado).toBe('FICOU_PARA_TRAS');
  });

  it('entre várias, vale a mais recente que não foi cancelada', () => {
    const r = situacaoDoEncaminhamento(
      [
        consulta({ id: 'antiga', inicio: '2026-09-10T13:00:00.000Z', status: 'CANCELADO' }),
        consulta({ id: 'de-pe', inicio: '2026-09-17T13:00:00.000Z', responsavel: DR_BRUNO }),
        consulta({ id: 'nova-cancelada', inicio: '2026-09-18T13:00:00.000Z', status: 'CANCELADO' }),
      ],
      AGORA,
    );
    expect(r).toMatchObject({ estado: 'AGENDADA', compromissoId: 'de-pe', responsavel: DR_BRUNO });
  });

  it('só quando todas foram canceladas o estado é CANCELADA — e aponta a mais recente', () => {
    const r = situacaoDoEncaminhamento(
      [
        consulta({ id: 'primeira', inicio: '2026-09-10T13:00:00.000Z', status: 'CANCELADO' }),
        consulta({ id: 'segunda', inicio: '2026-09-12T13:00:00.000Z', status: 'CANCELADO' }),
      ],
      AGORA,
    );
    expect(r).toMatchObject({ estado: 'CANCELADA', compromissoId: 'segunda' });
  });

  it('a consulta reencaminhada depois de atendida substitui a atendida', () => {
    const r = situacaoDoEncaminhamento(
      [
        consulta({ id: 'atendida', inicio: '2026-09-08T13:00:00.000Z', status: 'CONCLUIDO' }),
        consulta({ id: 'nova', inicio: '2026-09-15T18:00:00.000Z' }),
      ],
      AGORA,
    );
    expect(r).toMatchObject({ estado: 'HOJE', compromissoId: 'nova' });
  });

  /**
   * A agenda copia `atendimentoId` para o seguimento criado na conclusão. Se ele
   * contasse, a consulta atendida que gera "Retorno ao filiado" voltaria a
   * aparecer como agendada — e a triagem nunca veria "atendida".
   */
  it('o seguimento criado na conclusão não é a consulta', () => {
    const r = situacaoDoEncaminhamento(
      [
        consulta({ id: 'consulta', inicio: '2026-09-14T13:00:00.000Z', status: 'CONCLUIDO' }),
        consulta({ id: 'retorno', inicio: '2026-09-18T12:00:00.000Z', origemDesfechoId: 'consulta', responsavel: DR_BRUNO }),
      ],
      AGORA,
    );
    expect(r).toMatchObject({ estado: 'ATENDIDA', compromissoId: 'consulta', responsavel: DRA_ANA });

    expect(
      situacaoDoEncaminhamento(
        [consulta({ id: 'retorno', inicio: '2026-09-18T12:00:00.000Z', origemDesfechoId: 'x' })],
        AGORA,
      ),
    ).toBeNull();
  });

  it('empate no horário: vale a criada por último', () => {
    const r = situacaoDoEncaminhamento(
      [
        consulta({ id: 'primeiro-registro', inicio: '2026-09-17T13:00:00.000Z', createdAt: new Date('2026-09-10T10:00:00Z') }),
        consulta({ id: 'segundo-registro', inicio: '2026-09-17T13:00:00.000Z', createdAt: new Date('2026-09-11T10:00:00Z') }),
      ],
      AGORA,
    );
    expect(r?.compromissoId).toBe('segundo-registro');
  });

  it('o responsável, o link e o local vêm da CONSULTA', () => {
    const r = situacaoDoEncaminhamento(
      [
        consulta({
          id: 'c-video',
          inicio: '2026-09-16T13:00:00.000Z',
          responsavel: DR_BRUNO,
          local: 'Por chamada de vídeo',
          linkReuniao: 'https://meet.google.com/abc-defg-hij',
        }),
      ],
      AGORA,
    );
    expect(r).toEqual({
      estado: 'AGENDADA',
      compromissoId: 'c-video',
      inicio: new Date('2026-09-16T13:00:00.000Z'),
      responsavel: DR_BRUNO,
      linkReuniao: 'https://meet.google.com/abc-defg-hij',
      local: 'Por chamada de vídeo',
      remarcacoes: 0,
      dataOriginal: null,
    });
  });

  it('a consulta remarcada leva quantas vezes e a data de antes, para a triagem avisar o filiado', () => {
    const r = situacaoDoEncaminhamento(
      [consulta({ inicio: '2026-09-17T12:00:00.000Z', remarcacoes: 1, dataOriginal: new Date('2026-09-15T12:00:00.000Z') })],
      AGORA,
    );
    expect(r).toMatchObject({ estado: 'AGENDADA', remarcacoes: 1, dataOriginal: new Date('2026-09-15T12:00:00.000Z') });
  });

  it('campos ausentes saem nulos, nunca undefined', () => {
    const r = situacaoDoEncaminhamento(
      [{ id: 'c', status: 'PENDENTE', inicio: new Date('2026-09-16T13:00:00.000Z'), responsavel: DRA_ANA }],
      AGORA,
    );
    expect(r?.linkReuniao).toBeNull();
    expect(r?.local).toBeNull();
  });
});

/**
 * DE QUEM É A VEZ — com a triagem ou aguardando a consulta (15/09/2026, E3).
 * Os casos são os do balcão de 14/09: o #13 (consulta de seg 14/09 às 09:00,
 * sem registro às 18:38) e o #14 (consulta de qui 17/09).
 */
describe('filaDoAtendimento', () => {
  const ENCAMINHADO = { status: 'PENDENTE', desfecho: 'ENCAMINHADO' };
  const TREZE = consulta({ id: 'c-13', inicio: '2026-09-14T12:00:00.000Z' });

  it('o corte é de dois dias úteis', () => {
    expect(DIAS_UTEIS_ATE_VOLTAR_A_TRIAGEM).toBe(2);
  });

  it.each([
    ['seg 14/09, 18:38', '2026-09-14T21:38:00.000Z', { fila: 'CONSULTA', motivo: 'AGUARDANDO' }],
    ['ter 15/09, 10:00', '2026-09-15T13:00:00.000Z', { fila: 'CONSULTA', motivo: 'AGUARDANDO' }],
    ['ter 15/09, 23:59 (já quarta em UTC)', '2026-09-16T02:59:00.000Z', { fila: 'CONSULTA', motivo: 'AGUARDANDO' }],
    ['qua 16/09, 00:01', '2026-09-16T03:01:00.000Z', { fila: 'TRIAGEM', motivo: 'CONSULTA_SEM_REGISTRO' }],
    ['qui 17/09, 09:00', '2026-09-17T12:00:00.000Z', { fila: 'TRIAGEM', motivo: 'CONSULTA_SEM_REGISTRO' }],
  ])('#13 em %s', (_quando, agora, esperado) => {
    expect(filaDoAtendimento(ENCAMINHADO, [TREZE], new Date(agora))).toEqual(esperado);
  });

  it('fim de semana não conta: a consulta de sexta volta à triagem só na terça', () => {
    const sexta = [consulta({ inicio: '2026-09-11T12:00:00.000Z' })];
    expect(filaDoAtendimento(ENCAMINHADO, sexta, new Date('2026-09-12T13:00:00.000Z'))?.fila).toBe('CONSULTA');
    expect(filaDoAtendimento(ENCAMINHADO, sexta, new Date('2026-09-14T13:00:00.000Z'))?.fila).toBe('CONSULTA');
    expect(filaDoAtendimento(ENCAMINHADO, sexta, new Date('2026-09-15T03:30:00.000Z'))).toEqual({
      fila: 'TRIAGEM', motivo: 'CONSULTA_SEM_REGISTRO',
    });
  });

  it('#14, consulta de quinta: aguardando a consulta, e remarcada continua neutra', () => {
    expect(filaDoAtendimento(ENCAMINHADO, [consulta({ inicio: '2026-09-17T12:00:00.000Z' })], AGORA))
      .toEqual({ fila: 'CONSULTA', motivo: 'AGUARDANDO' });
    expect(filaDoAtendimento(ENCAMINHADO, [consulta({ inicio: '2026-09-17T12:00:00.000Z', remarcacoes: 2 })], AGORA))
      .toEqual({ fila: 'CONSULTA', motivo: 'AGUARDANDO' });
  });

  it('em andamento: de hoje é o advogado atendendo; iniciada num dia anterior conta a partir do início marcado', () => {
    // AGORA é ter 15/09, 11:00.
    expect(filaDoAtendimento(ENCAMINHADO, [consulta({ inicio: '2026-09-15T12:00:00.000Z', status: 'EM_ANDAMENTO' })], AGORA))
      .toEqual({ fila: 'CONSULTA', motivo: 'AGUARDANDO' });
    expect(filaDoAtendimento(ENCAMINHADO, [consulta({ inicio: '2026-09-14T13:00:00.000Z', status: 'EM_ANDAMENTO' })], AGORA))
      .toEqual({ fila: 'CONSULTA', motivo: 'AGUARDANDO' });
    expect(filaDoAtendimento(ENCAMINHADO, [consulta({ inicio: '2026-09-11T13:00:00.000Z', status: 'EM_ANDAMENTO' })], AGORA))
      .toEqual({ fila: 'TRIAGEM', motivo: 'CONSULTA_SEM_REGISTRO' });
  });

  it.each<[string, { status: string; desfecho: string | null }, ConsultaDoEncaminhamento[], unknown]>([
    ['concluído', { status: 'CONCLUIDO', desfecho: 'ENCAMINHADO' }, [TREZE], null],
    ['cancelado', { status: 'CANCELADO', desfecho: null }, [], null],
    ['sem desfecho', { status: 'PENDENTE', desfecho: null }, [], { fila: 'TRIAGEM', motivo: 'SEM_DESFECHO' }],
    ['resolvido no ato', { status: 'PENDENTE', desfecho: 'RESOLVIDO_ATO' }, [], { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' }],
    ['encaminhado sem consulta', ENCAMINHADO, [], { fila: 'TRIAGEM', motivo: 'SEM_CONSULTA' }],
    ['encaminhado só com o seguimento', ENCAMINHADO, [consulta({ inicio: '2026-09-18T12:00:00.000Z', origemDesfechoId: 'c-x' })], { fila: 'TRIAGEM', motivo: 'SEM_CONSULTA' }],
    ['consulta registrada (contêiner antigo não fechou)', ENCAMINHADO, [consulta({ inicio: '2026-09-14T12:00:00.000Z', status: 'CONCLUIDO' })], { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' }],
    ['todas canceladas', ENCAMINHADO, [consulta({ inicio: '2026-09-17T12:00:00.000Z', status: 'CANCELADO' })], { fila: 'TRIAGEM', motivo: 'CONSULTA_CANCELADA' }],
  ])('%s', (_caso, at, consultas, esperado) => {
    expect(filaDoAtendimento(at, consultas, AGORA)).toEqual(esperado);
  });

  it('a cópia aberta do laço antigo não esconde que a consulta vigente já foi registrada', () => {
    const r = filaDoAtendimento(ENCAMINHADO, [
      consulta({ id: 'copia', inicio: '2026-09-14T13:00:00.000Z', createdAt: new Date('2026-09-10T10:00:00Z') }),
      consulta({ id: 'registrada', inicio: '2026-09-14T13:00:00.000Z', status: 'CONCLUIDO', createdAt: new Date('2026-09-10T10:01:00Z') }),
    ], AGORA);
    expect(r).toEqual({ fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' });
  });

  it('a cancelada e a nova marcada: vale a nova, aguardando a consulta', () => {
    const r = filaDoAtendimento(ENCAMINHADO, [
      consulta({ id: 'caiu', inicio: '2026-09-10T13:00:00.000Z', status: 'CANCELADO' }),
      consulta({ id: 'nova', inicio: '2026-09-18T13:00:00.000Z' }),
    ], AGORA);
    expect(r).toEqual({ fila: 'CONSULTA', motivo: 'AGUARDANDO' });
  });
});

describe('modalidade da consulta', () => {
  it('vira o local da atividade; na sede o local fica vazio', () => {
    expect(LOCAL_DA_MODALIDADE).toEqual({
      SEDE: null,
      VIDEO: 'Por chamada de vídeo',
      TELEFONE: 'Por telefone',
    });
  });

  it('vídeo e telefone são remotos; sede e ausência, não', () => {
    expect(modalidadeRemota('VIDEO')).toBe(true);
    expect(modalidadeRemota('TELEFONE')).toBe(true);
    expect(modalidadeRemota('SEDE')).toBe(false);
    expect(modalidadeRemota(null)).toBe(false);
    expect(modalidadeRemota(undefined)).toBe(false);
  });
});
