import { CATEGORIAS_CANCELAMENTO, categoriaCancelamentoValida } from '../agenda/desfechos.catalogo';
import type { ConsultaDoEncaminhamento } from './encaminhamento.util';
import {
  CATEGORIAS_CANCELAMENTO_ATENDIMENTO, consultasParaCancelar, decidirCancelar, decidirConcluir,
  FRASE_CANCELADO_REABRA, FRASE_CATEGORIA, FRASE_CONCLUIDO_REABRA, FRASE_DIGA_O_QUE_FAZER,
  FRASE_DIGA_SE_ACONTECEU, FRASE_EM_ANDAMENTO, FRASE_JA_CANCELADO, FRASE_JA_CONCLUIDO,
  FRASE_NOTA_CURTA, FRASE_SEM_DESFECHO, motivoDaConsultaCancelada, planoDeFechamento,
  rotuloDoInstanteBR, situacaoNoFechamento,
} from './fechamento.util';

/**
 * O PLANO DE FECHAMENTO — testado com valores, e com o relógio de Teresina.
 *
 * Os casos são os do balcão medidos em 13/09/2026: o #14 (consulta futura com a
 * Dra. Shérad), o #7 (concluído antes da consulta) e a consulta das 9h que às
 * 10h ainda está pendente. "Já começou" é o INSTANTE: a mesma consulta é HOJE
 * para o chip do encaminhamento e COMECOU para o fechamento.
 */

/** Segunda, 14/09/2026, 10:00 em Teresina. */
const AGORA = new Date('2026-09-14T13:00:00.000Z');

const DRA_SHERAD = { id: 'u-sherad', nome: 'Shérad Castro', nomeExibicao: 'Dra. Shérad' };
const DR_MURILO = { id: 'u-murilo', nome: 'Murilo Sousa', nomeExibicao: 'Dr. Murilo' };

function consulta(parcial: Omit<Partial<ConsultaDoEncaminhamento>, 'inicio'> & { inicio: string }): ConsultaDoEncaminhamento {
  return {
    id: 'c-14',
    status: 'PENDENTE',
    local: null,
    linkReuniao: null,
    origemDesfechoId: null,
    createdAt: new Date('2026-09-10T14:00:00.000Z'),
    responsavel: DRA_SHERAD,
    ...parcial,
    inicio: new Date(parcial.inicio),
  };
}

/** Quinta, 17/09/2026, 09:00 em Teresina. */
const QUINTA_9H = '2026-09-17T12:00:00.000Z';
/** Hoje, 09:00 em Teresina: já começou às 10:00. */
const HOJE_9H = '2026-09-14T12:00:00.000Z';
/** Sexta passada, 11/09/2026, 14:00. */
const SEXTA_PASSADA = '2026-09-11T17:00:00.000Z';

const PENDENTE_ENCAMINHADO = { status: 'PENDENTE', desfecho: 'ENCAMINHADO' };

describe('rotuloDoInstanteBR — a mesma grafia do modal', () => {
  it('dia da semana, dia/mês e hora de Teresina', () => {
    expect(rotuloDoInstanteBR(new Date(QUINTA_9H))).toBe('qui, 17/09 às 09:00');
    expect(rotuloDoInstanteBR(new Date('2026-09-15T01:10:00.000Z'))).toBe('seg, 14/09 às 22:10');
  });

  it('as 23h30 daqui já são o dia seguinte em UTC, e continuam no dia daqui', () => {
    expect(rotuloDoInstanteBR(new Date('2026-09-18T02:30:00.000Z'))).toBe('qui, 17/09 às 23:30');
  });

  it('meia-noite e começo de mês sem virar', () => {
    expect(rotuloDoInstanteBR(new Date('2026-10-01T03:00:00.000Z'))).toBe('qui, 01/10 às 00:00');
    expect(rotuloDoInstanteBR(new Date('2026-09-20T15:05:00.000Z'))).toBe('dom, 20/09 às 12:05');
  });
});

describe('situacaoNoFechamento — em que pé está a consulta vigente', () => {
  it('sem consulta, ou com todas canceladas: NENHUMA', () => {
    expect(situacaoNoFechamento([], AGORA)).toEqual({ situacao: 'NENHUMA', vigente: null });
    expect(situacaoNoFechamento(null, AGORA).situacao).toBe('NENHUMA');
    expect(situacaoNoFechamento([
      consulta({ inicio: QUINTA_9H, status: 'CANCELADO' }),
      consulta({ id: 'c-12', inicio: SEXTA_PASSADA, status: 'CANCELADO' }),
    ], AGORA).situacao).toBe('NENHUMA');
  });

  it.each([
    ['CONCLUIDO', SEXTA_PASSADA, 'ATENDIDA'],
    ['EM_ANDAMENTO', HOJE_9H, 'EM_ANDAMENTO'],
    ['PENDENTE', QUINTA_9H, 'FUTURA'],
    ['PENDENTE', HOJE_9H, 'COMECOU'],
    ['PENDENTE', SEXTA_PASSADA, 'COMECOU'],
  ])('%s em %s → %s', (status, inicio, esperado) => {
    expect(situacaoNoFechamento([consulta({ status, inicio })], AGORA).situacao).toBe(esperado);
  });

  it('a borda é o instante: às 09:00 em ponto já começou; um minuto antes, ainda não', () => {
    const c = consulta({ inicio: HOJE_9H });
    expect(situacaoNoFechamento([c], new Date('2026-09-14T12:00:00.000Z')).situacao).toBe('COMECOU');
    expect(situacaoNoFechamento([c], new Date('2026-09-14T11:59:00.000Z')).situacao).toBe('FUTURA');
  });

  it('a vigente é a mais recente NÃO cancelada — a mesma escolha do encaminhamento', () => {
    const r = situacaoNoFechamento([
      consulta({ id: 'c-antiga', inicio: SEXTA_PASSADA, status: 'PENDENTE', responsavel: DR_MURILO }),
      consulta({ id: 'c-nova', inicio: QUINTA_9H, status: 'CANCELADO' }),
    ], AGORA);
    expect(r.vigente?.id).toBe('c-antiga');
    expect(r.situacao).toBe('COMECOU');
  });

  it('o seguimento que herdou o atendimento não é a consulta', () => {
    const r = situacaoNoFechamento([
      consulta({ id: 'c-14', inicio: SEXTA_PASSADA, status: 'CONCLUIDO' }),
      consulta({ id: 'c-retorno', inicio: QUINTA_9H, status: 'PENDENTE', origemDesfechoId: 'c-14' }),
    ], AGORA);
    expect(r).toMatchObject({ situacao: 'ATENDIDA', vigente: { id: 'c-14' } });
  });
});

describe('planoDeFechamento — o que o modal pergunta', () => {
  it('#14: consulta futura só conclui cancelando junto, com nota obrigatória; cancelar pergunta', () => {
    const plano = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: QUINTA_9H })], AGORA);
    expect(plano).toEqual({
      consulta: {
        id: 'c-14', situacao: 'FUTURA', inicio: new Date(QUINTA_9H), local: null, linkReuniao: null,
        responsavel: DRA_SHERAD,
      },
      consultasAbertas: 1,
      concluir: { permitido: true, recusa: null, consulta: 'CANCELAR_PARA_CONCLUIR', nota: 'OBRIGATORIA' },
      cancelar: { permitido: true, recusa: null, consulta: 'ESCOLHER' },
    });
  });

  it.each([
    ['COMECOU', [consulta({ inicio: HOJE_9H })], 'ESCOLHER', 'OBRIGATORIA_SE_CANCELAR', 'ESCOLHER'],
    ['EM_ANDAMENTO', [consulta({ inicio: HOJE_9H, status: 'EM_ANDAMENTO' })], 'SO_MANTER', 'OPCIONAL', 'SO_MANTER'],
    ['ATENDIDA', [consulta({ inicio: SEXTA_PASSADA, status: 'CONCLUIDO' })], 'NENHUMA', 'OPCIONAL', 'ATENDIDA'],
    ['todas canceladas', [consulta({ inicio: SEXTA_PASSADA, status: 'CANCELADO' })], 'NENHUMA', 'OBRIGATORIA', 'NENHUMA'],
    ['sem consulta', [], 'NENHUMA', 'OBRIGATORIA', 'NENHUMA'],
  ])('%s: concluir %s / nota %s; cancelar %s', (_caso, consultas, concluirConsulta, nota, cancelarConsulta) => {
    const plano = planoDeFechamento(PENDENTE_ENCAMINHADO, consultas as ConsultaDoEncaminhamento[], AGORA);
    expect(plano.concluir).toEqual({ permitido: true, recusa: null, consulta: concluirConsulta, nota });
    expect(plano.cancelar).toEqual({ permitido: true, recusa: null, consulta: cancelarConsulta });
  });

  it('NENHUMA sai como consulta nula — é assim que a tela reconhece o caso C', () => {
    expect(planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: SEXTA_PASSADA, status: 'CANCELADO' })], AGORA).consulta)
      .toBeNull();
  });

  it('resolvido no ato: nota opcional, nada a decidir sobre consulta', () => {
    const plano = planoDeFechamento({ status: 'PENDENTE', desfecho: 'RESOLVIDO_ATO' }, [], AGORA);
    expect(plano.concluir).toEqual({ permitido: true, recusa: null, consulta: 'NENHUMA', nota: 'OPCIONAL' });
  });

  it.each([
    ['CONCLUIDO', 'ENCAMINHADO', FRASE_JA_CONCLUIDO, FRASE_CONCLUIDO_REABRA],
    ['CANCELADO', 'ENCAMINHADO', FRASE_CANCELADO_REABRA, FRASE_JA_CANCELADO],
    ['PENDENTE', null, FRASE_SEM_DESFECHO, null],
  ])('atendimento %s com desfecho %s: as recusas vêm prontas no plano', (status, desfecho, recusaConcluir, recusaCancelar) => {
    const plano = planoDeFechamento({ status, desfecho }, [], AGORA);
    expect(plano.concluir).toMatchObject({ permitido: false, recusa: recusaConcluir });
    expect(plano.cancelar).toMatchObject({ permitido: recusaCancelar === null, recusa: recusaCancelar });
  });

  it('consultasAbertas conta as nascidas pendentes e em andamento — sem canceladas, atendidas e seguimento', () => {
    const plano = planoDeFechamento(PENDENTE_ENCAMINHADO, [
      consulta({ id: 'c-a', inicio: QUINTA_9H }),
      consulta({ id: 'c-b', inicio: QUINTA_9H, createdAt: new Date('2026-09-10T14:00:01.000Z') }),
      consulta({ id: 'c-c', inicio: HOJE_9H, status: 'EM_ANDAMENTO' }),
      consulta({ id: 'c-d', inicio: SEXTA_PASSADA, status: 'CANCELADO' }),
      consulta({ id: 'c-e', inicio: SEXTA_PASSADA, status: 'CONCLUIDO' }),
      consulta({ id: 'c-f', inicio: QUINTA_9H, origemDesfechoId: 'c-e' }),
    ], AGORA);
    expect(plano.consultasAbertas).toBe(3);
  });

  it('a consulta vigente leva local, link e responsável com a foto', () => {
    const plano = planoDeFechamento(PENDENTE_ENCAMINHADO, [
      consulta({
        inicio: QUINTA_9H, local: 'Por chamada de vídeo', linkReuniao: 'https://meet.google.com/abc-defg-hij',
        responsavel: { ...DRA_SHERAD, avatarUrl: 'https://fotos/sherad.jpg' } as never,
      }),
    ], AGORA);
    expect(plano.consulta).toMatchObject({
      local: 'Por chamada de vídeo',
      linkReuniao: 'https://meet.google.com/abc-defg-hij',
      responsavel: { id: 'u-sherad', avatarUrl: 'https://fotos/sherad.jpg' },
    });
  });
});

describe('decidirConcluir — o pedido contra o plano', () => {
  const futura = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: QUINTA_9H })], AGORA);
  const comecou = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: HOJE_9H })], AGORA);
  const emAndamento = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: HOJE_9H, status: 'EM_ANDAMENTO' })], AGORA);
  const semConsulta = planoDeFechamento(PENDENTE_ENCAMINHADO, [], AGORA);
  const NOTA = 'A filiada ligou e a dúvida foi esclarecida por telefone.';

  it('FUTURA sem cancelar junto: a recusa diz com quem e quando', () => {
    expect(decidirConcluir(futura, { nota: NOTA })).toEqual({
      ok: false,
      recusa: 'A consulta com a Dra. Shérad ainda não aconteceu (qui, 17/09 às 09:00). Para concluir agora, cancele a consulta junto.',
    });
    expect(decidirConcluir(futura, { nota: NOTA, consulta: 'MANTER' }).ok).toBe(false);
  });

  it('FUTURA sem nome de responsável não inventa ninguém', () => {
    const semNome = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: QUINTA_9H, responsavel: null })], AGORA);
    expect(decidirConcluir(semNome, {})).toEqual({
      ok: false,
      recusa: 'A consulta ainda não aconteceu (qui, 17/09 às 09:00). Para concluir agora, cancele a consulta junto.',
    });
  });

  it('FUTURA cancelando junto exige nota de pelo menos 10 caracteres, contados sem os espaços das pontas', () => {
    // "resolvido" tem 9 letras: com os espaços teria 15, e mesmo assim não passa.
    expect(decidirConcluir(futura, { consulta: 'CANCELAR', nota: '   resolvido   ' }))
      .toEqual({ ok: false, recusa: FRASE_NOTA_CURTA });
    expect(decidirConcluir(futura, { consulta: 'CANCELAR' })).toEqual({ ok: false, recusa: FRASE_NOTA_CURTA });
    expect(decidirConcluir(futura, { consulta: 'CANCELAR', nota: '  Resolveu no RH.  ' }))
      .toEqual({ ok: true, consulta: 'CANCELAR', texto: 'Resolveu no RH.' });
  });

  it('COMECOU: sem escolha é recusado; "aconteceu" dispensa a nota; "não aconteceu" a exige', () => {
    expect(decidirConcluir(comecou, { nota: NOTA })).toEqual({ ok: false, recusa: FRASE_DIGA_SE_ACONTECEU });
    expect(decidirConcluir(comecou, { consulta: 'MANTER' })).toEqual({ ok: true, consulta: 'MANTER', texto: null });
    expect(decidirConcluir(comecou, { consulta: 'CANCELAR', nota: 'curta' })).toEqual({ ok: false, recusa: FRASE_NOTA_CURTA });
    expect(decidirConcluir(comecou, { consulta: 'CANCELAR', nota: NOTA })).toEqual({ ok: true, consulta: 'CANCELAR', texto: NOTA });
  });

  it('EM_ANDAMENTO: cancelar é recusado, e sem escolha fica mantida', () => {
    expect(decidirConcluir(emAndamento, { consulta: 'CANCELAR', nota: NOTA })).toEqual({ ok: false, recusa: FRASE_EM_ANDAMENTO });
    expect(decidirConcluir(emAndamento, {})).toEqual({ ok: true, consulta: 'MANTER', texto: null });
  });

  it('encaminhado sem consulta viva: a nota é obrigatória, e `consulta` enviada é ignorada sem erro', () => {
    expect(decidirConcluir(semConsulta, { nota: 'ok' })).toEqual({ ok: false, recusa: FRASE_NOTA_CURTA });
    expect(decidirConcluir(semConsulta, { nota: NOTA, consulta: 'CANCELAR' })).toEqual({ ok: true, consulta: null, texto: NOTA });
  });

  it('a recusa do plano vem antes de qualquer outra', () => {
    const concluido = planoDeFechamento({ status: 'CONCLUIDO', desfecho: 'ENCAMINHADO' }, [consulta({ inicio: QUINTA_9H })], AGORA);
    expect(decidirConcluir(concluido, { consulta: 'CANCELAR', nota: NOTA })).toEqual({ ok: false, recusa: FRASE_JA_CONCLUIDO });
  });

  /**
   * O MODAL ABERTO ÀS 08:59 PARA A CONSULTA DAS 09:00. O plano lido na abertura
   * era FUTURA; o servidor recalcula ao gravar, e às 09:00 é COMECOU. O mesmo
   * corpo "cancelar e concluir, com a nota" continua coerente e passa; o corpo
   * sem escolha é recusado com a frase clara, e a tela recarrega.
   */
  it('08:59 → 09:00: o plano é o da hora de gravar', () => {
    const c = [consulta({ inicio: HOJE_9H })];
    const as0859 = planoDeFechamento(PENDENTE_ENCAMINHADO, c, new Date('2026-09-14T11:59:00.000Z'));
    const as0900 = planoDeFechamento(PENDENTE_ENCAMINHADO, c, new Date('2026-09-14T12:00:00.000Z'));
    expect(as0859.concluir.consulta).toBe('CANCELAR_PARA_CONCLUIR');
    expect(as0900.concluir.consulta).toBe('ESCOLHER');
    expect(decidirConcluir(as0900, { consulta: 'CANCELAR', nota: NOTA })).toEqual({ ok: true, consulta: 'CANCELAR', texto: NOTA });
    expect(decidirConcluir(as0900, { nota: NOTA })).toEqual({ ok: false, recusa: FRASE_DIGA_SE_ACONTECEU });
  });
});

describe('decidirCancelar — a categoria é o motivo obrigatório', () => {
  const futura = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: QUINTA_9H })], AGORA);

  it.each([undefined, '', 'OUTRO', 'SUBSTITUIDA', 'ADIADA_JUIZO'])('categoria %p é recusada', (categoria) => {
    expect(decidirCancelar(futura, { categoria, consulta: 'CANCELAR' })).toEqual({ ok: false, recusa: FRASE_CATEGORIA });
  });

  it('consulta de pé sem escolha: recusado; com escolha, passa e limpa o detalhe', () => {
    expect(decidirCancelar(futura, { categoria: 'DESISTENCIA' })).toEqual({ ok: false, recusa: FRASE_DIGA_O_QUE_FAZER });
    expect(decidirCancelar(futura, { categoria: 'DUPLICIDADE', consulta: 'MANTER', motivo: '   ' }))
      .toEqual({ ok: true, consulta: 'MANTER', texto: null });
    expect(decidirCancelar(futura, { categoria: 'DESISTENCIA', consulta: 'CANCELAR', motivo: ' Arranjou advogado próprio. ' }))
      .toEqual({ ok: true, consulta: 'CANCELAR', texto: 'Arranjou advogado próprio.' });
  });

  it('em andamento não cancela a consulta; atendida ignora a escolha', () => {
    const emAndamento = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: HOJE_9H, status: 'EM_ANDAMENTO' })], AGORA);
    expect(decidirCancelar(emAndamento, { categoria: 'PERDEU_OBJETO', consulta: 'CANCELAR' })).toEqual({ ok: false, recusa: FRASE_EM_ANDAMENTO });
    const atendida = planoDeFechamento(PENDENTE_ENCAMINHADO, [consulta({ inicio: SEXTA_PASSADA, status: 'CONCLUIDO' })], AGORA);
    expect(decidirCancelar(atendida, { categoria: 'PERDEU_OBJETO', consulta: 'CANCELAR' })).toEqual({ ok: true, consulta: null, texto: null });
  });

  it('atendimento concluído não vira cancelado sem reabrir', () => {
    const concluido = planoDeFechamento({ status: 'CONCLUIDO', desfecho: 'RESOLVIDO_ATO' }, [], AGORA);
    expect(decidirCancelar(concluido, { categoria: 'DUPLICIDADE' })).toEqual({ ok: false, recusa: FRASE_CONCLUIDO_REABRA });
  });
});

describe('as categorias são as do catálogo da agenda', () => {
  it('cada slug existe no catálogo e é oferecido a pessoas (não é só do sistema)', () => {
    for (const slug of CATEGORIAS_CANCELAMENTO_ATENDIMENTO) {
      expect(`${slug}: ${categoriaCancelamentoValida(slug)}`).toBe(`${slug}: true`);
      const doCatalogo = CATEGORIAS_CANCELAMENTO.find((c) => c.slug === slug) as { apenasSistema?: boolean };
      expect(`${slug} apenasSistema=${!!doCatalogo.apenasSistema}`).toBe(`${slug} apenasSistema=false`);
    }
  });
});

describe('consultasParaCancelar e o motivo gravado na consulta', () => {
  it('só as nascidas PENDENTES: em andamento é de quem atende; seguimento é do advogado', () => {
    const ids = consultasParaCancelar([
      consulta({ id: 'c-a', inicio: QUINTA_9H }),
      consulta({ id: 'c-b', inicio: HOJE_9H, status: 'EM_ANDAMENTO' }),
      consulta({ id: 'c-c', inicio: SEXTA_PASSADA, status: 'CANCELADO' }),
      consulta({ id: 'c-d', inicio: QUINTA_9H, origemDesfechoId: 'c-x' }),
      consulta({ id: 'c-e', inicio: SEXTA_PASSADA }),
    ]).map((c) => c.id);
    expect(ids).toEqual(['c-a', 'c-e']);
  });

  it.each([
    ['CONCLUIR', 'FUTURA', 'Resolveu no RH.', 'Atendimento #14 concluído antes da consulta: Resolveu no RH.'],
    ['CONCLUIR', 'COMECOU', 'Não compareceu e resolveu por telefone.', 'Atendimento #14 concluído, e a consulta não aconteceu: Não compareceu e resolveu por telefone.'],
    ['CANCELAR', 'FUTURA', 'Arranjou advogado próprio.', 'Atendimento #14 cancelado: Arranjou advogado próprio.'],
    ['CANCELAR', 'COMECOU', null, 'Atendimento #14 cancelado.'],
  ] as const)('%s em %s', (acao, situacao, texto, esperado) => {
    expect(motivoDaConsultaCancelada(acao, 14, situacao, texto)).toBe(esperado);
  });
});
