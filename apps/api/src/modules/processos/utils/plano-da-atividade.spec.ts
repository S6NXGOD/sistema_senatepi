import { planejarAtividade } from './plano-da-atividade.util';
import type { Providencia } from './providencia.util';

/**
 * A PRÉVIA MOSTRA O QUE VAI SER GRAVADO — e é a MESMA função que grava.
 *
 * O pedido foi "não tenho nem um preview de como ela vai ficar". A tentação era
 * a tela calcular por conta própria; seria a quarta vez que esta base cria dois
 * leitores da mesma regra (o `polo` com três critérios, `tipoAcao` derivado num
 * caminho e não no irmão, a lista de status do Diário ao lado da canônica).
 * Prévia que erra por pouco é pior que nenhuma: ela promete.
 *
 * Este arquivo exercita a função PURA com datas fixas — nada de relógio, nada
 * de banco. `agora` entra por parâmetro justamente para isto.
 */
const DIAS_RECENTE = 15;

/** `dataDisponibilizacao` é `@db.Date`: dia de calendário à meia-noite UTC. */
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Um instante qualquer do dia, no fuso do contêiner (UTC). */
const instante = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

const publicacao = (over: Partial<Parameters<typeof planejarAtividade>[0]> = {}) => ({
  nomeOrgao: '2ª Vara do Trabalho de Teresina',
  dataDisponibilizacao: dia('2026-09-10'),
  providencia: 'ELABORAR_MANIFESTACAO' as Providencia,
  prazoMencionadoDias: null,
  ...over,
});

const planejar = (
  over: Partial<Parameters<typeof planejarAtividade>[0]> = {},
  agora = instante('2026-09-11'),
  npu: string | null = '00007351220225220103',
) => planejarAtividade(publicacao(over), npu, agora, DIAS_RECENTE);

describe('o plano da atividade', () => {
  it('leva o título e o tipo da providência', () => {
    const p = planejar();
    expect(p.titulo).toBeTruthy();
    expect(p.tipo).toBeTruthy();
  });

  it('marca a data em dia útil e nunca no passado', () => {
    const p = planejar({}, instante('2026-09-11'));
    expect(p.inicio.getTime()).toBeGreaterThan(instante('2026-09-11').getTime() - 86_400_000);
    expect([0, 6]).not.toContain(p.inicio.getUTCDay());
  });

  it('a descrição diz o processo e o órgão, e NÃO o teor', () => {
    const p = planejar();
    expect(p.descricao).toContain('0000735-12.2022.5.22.0103');
    expect(p.descricao).toContain('2ª Vara do Trabalho de Teresina');
    expect(p.descricao.length).toBeLessThan(400);
  });

  it('processo sem número não quebra a frase', () => {
    expect(planejar({}, instante('2026-09-11'), null).descricao).toContain('(rascunho)');
  });
});

/**
 * A REGRA DA URGÊNCIA, que nasceu de uma medição: na primeira ingestão o DJEN
 * entrega o histórico inteiro do processo. Em 03/09/2026 sete atividades
 * nasceram urgentes de uma vez, todas com o mesmo motivo e o mesmo dia. Sete
 * urgências simultâneas não são sete prioridades — são zero.
 */
describe('urgência exige que o ato seja recente', () => {
  it('atrasado E recente é urgente, com motivo', () => {
    // Publicação de 10 dias atrás: o prazo de 5 dias úteis já venceu.
    const p = planejar({ dataDisponibilizacao: dia('2026-09-01') }, instante('2026-09-11'));
    expect(p.atrasado).toBe(true);
    expect(p.urgente).toBe(true);
    expect(p.urgenteMotivo).toBeTruthy();
    expect(p.descricao).toContain('já venceu');
  });

  it('atrasado e ANTIGO não é urgente — é história', () => {
    const p = planejar({ dataDisponibilizacao: dia('2026-06-01') }, instante('2026-09-11'));
    expect(p.atrasado).toBe(true);
    expect(p.urgente).toBe(false);
    expect(p.urgenteMotivo).toBeNull();
    // A descrição continua avisando, mas sem alarme.
    expect(p.descricao).toContain('sem alarme');
  });

  it('prazo curto num ato recente é urgente', () => {
    const p = planejar(
      { dataDisponibilizacao: dia('2026-09-10'), prazoMencionadoDias: 5 },
      instante('2026-09-11'),
    );
    expect(p.urgente).toBe(true);
    expect(p.urgenteMotivo).toContain('5');
  });

  it('prazo curto num ato ANTIGO também não é urgente', () => {
    const p = planejar(
      { dataDisponibilizacao: dia('2026-06-01'), prazoMencionadoDias: 5 },
      instante('2026-09-11'),
    );
    expect(p.urgente).toBe(false);
  });

  /** Urgente sem motivo é a pior marca da tela — não pode existir. */
  it('nunca há urgência sem porquê', () => {
    for (const data of ['2026-06-01', '2026-09-01', '2026-09-10', '2026-09-11']) {
      for (const prazo of [null, 5, 15]) {
        const p = planejar(
          { dataDisponibilizacao: dia(data), prazoMencionadoDias: prazo },
          instante('2026-09-11'),
        );
        if (p.urgente) expect(p.urgenteMotivo).toBeTruthy();
        else expect(p.urgenteMotivo).toBeNull();
      }
    }
  });
});

/** Puro é puro: mesma entrada, mesma saída, sem tocar no relógio. */
describe('a função não lê o relógio por conta própria', () => {
  it('duas chamadas com o mesmo `agora` dão o mesmo resultado', () => {
    const a = planejar({}, instante('2026-09-11'));
    const b = planejar({}, instante('2026-09-11'));
    expect(a).toEqual(b);
  });

  it('e um `agora` diferente muda a leitura de atraso', () => {
    const antes = planejar({ dataDisponibilizacao: dia('2026-09-10') }, instante('2026-09-11'));
    const depois = planejar({ dataDisponibilizacao: dia('2026-09-10') }, instante('2026-10-11'));
    expect(antes.atrasado).toBe(false);
    expect(depois.atrasado).toBe(true);
  });
});
