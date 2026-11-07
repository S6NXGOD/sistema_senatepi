import { chipsAVista, chipsDoDia, noCalendario, CHIPS_POR_DIA } from './agenda-calendario';
import type { Compromisso } from './agenda';

/** Sábado, 07/11/2026, 10h de Teresina. */
const AGORA = new Date('2026-11-07T13:00:00.000Z').getTime();

let seq = 0;
const ativ = (tipo: string, inicio: string, status: Compromisso['status'] = 'PENDENTE', titulo = tipo): Compromisso =>
  ({ id: `c${++seq}`, titulo, tipo, status, inicio, fim: inicio } as unknown as Compromisso);

/**
 * O DIA DO CALENDÁRIO, no visual que o dono mandou de referência (07/11/2026):
 * o mesmo tipo vira uma linha com a contagem, a concluída fica riscada e à
 * parte, e a cancelada sai da grade.
 */
describe('os chips de um dia', () => {
  /* Terça, 03/11/2026: o dia que o dono mostrou no print, com seis tarefas. */
  const terca = [
    ativ('DILIGENCIA', '2026-11-03T12:00:00.000Z', 'PENDENTE', 'Conferir de que lado estamos no processo'),
    ativ('DILIGENCIA', '2026-11-03T12:00:00.000Z', 'PENDENTE', 'Conferir de que lado estamos no processo'),
    ativ('DILIGENCIA', '2026-11-03T12:00:00.000Z', 'PENDENTE', 'Conferir de que lado estamos no processo'),
    ativ('PRAZO', '2026-11-03T12:00:00.000Z', 'PENDENTE', 'Elaborar manifestação'),
    ativ('CONSULTA_JURIDICA', '2026-11-03T13:30:00.000Z', 'CONCLUIDO', 'Consulta Jurídica — CARLA'),
    ativ('CONSULTA_JURIDICA', '2026-11-03T14:00:00.000Z', 'CONCLUIDO', 'Consulta Jurídica — JOSELIA'),
  ];

  it('o mesmo tipo no mesmo dia vira um chip só, com todas dentro', () => {
    const chips = chipsDoDia(terca, AGORA);
    const diligencias = chips.find((g) => g.tipo === 'DILIGENCIA')!;
    expect(diligencias.itens).toHaveLength(3);
    expect(chips).toHaveLength(3);
  });

  it('concluída fica num grupo próprio, depois das abertas', () => {
    const chips = chipsDoDia(terca, AGORA);
    expect(chips.map((g) => [g.tipo, g.feita])).toEqual([
      ['DILIGENCIA', false],
      ['PRAZO', false],
      ['CONSULTA_JURIDICA', true],
    ]);
  });

  it('a mesma consulta, uma feita e outra não, são dois chips', () => {
    const chips = chipsDoDia([
      ativ('CONSULTA_JURIDICA', '2026-11-09T12:00:00.000Z', 'CONCLUIDO'),
      ativ('CONSULTA_JURIDICA', '2026-11-09T13:00:00.000Z'),
    ], AGORA);
    expect(chips.map((g) => g.feita)).toEqual([false, true]);
  });

  /** O calendário responde "o que tem no dia" — o que foi cancelado não tem. */
  it('cancelada sai da grade', () => {
    const chips = chipsDoDia([
      ativ('PRAZO', '2026-11-04T12:00:00.000Z', 'CANCELADO'),
      ativ('PRAZO', '2026-11-04T12:00:00.000Z', 'CANCELADO'),
    ], AGORA);
    expect(chips).toEqual([]);
    expect(noCalendario([ativ('PRAZO', '2026-11-04T12:00:00.000Z', 'CANCELADO')])).toEqual([]);
  });

  /* Âmbar é "pede você": só o que está aberto e ficou para trás. */
  it('pendente de dia passado fica em âmbar; concluída e futura não', () => {
    const chips = chipsDoDia(terca, AGORA);
    expect(chips.find((g) => g.tipo === 'PRAZO')!.atrasada).toBe(true);
    expect(chips.find((g) => g.feita)!.atrasada).toBe(false);
    const futuro = chipsDoDia([ativ('PRAZO', '2026-11-23T12:00:00.000Z')], AGORA);
    expect(futuro[0].atrasada).toBe(false);
  });

  it('abre na ordem da hora do primeiro item', () => {
    const chips = chipsDoDia([
      ativ('REUNIAO', '2026-11-10T17:00:00.000Z'),
      ativ('AUDIENCIA', '2026-11-10T12:00:00.000Z'),
    ], AGORA);
    expect(chips.map((g) => g.tipo)).toEqual(['AUDIENCIA', 'REUNIAO']);
  });
});

describe('o que cabe na célula', () => {
  /** "+N mais" conta atividades, não grupos: é isso que a pessoa vai encontrar ao abrir. */
  it('mostra três chips e conta as ATIVIDADES escondidas', () => {
    const dia = [
      ativ('PRAZO', '2026-11-12T12:00:00.000Z'),
      ativ('REUNIAO', '2026-11-12T12:00:00.000Z'),
      ativ('AUDIENCIA', '2026-11-12T12:00:00.000Z'),
      ativ('CONTATO', '2026-11-12T12:00:00.000Z'),
      ativ('CONTATO', '2026-11-12T13:00:00.000Z'),
      ativ('PERICIA', '2026-11-12T14:00:00.000Z'),
    ];
    const { aVista, escondidas } = chipsAVista(chipsDoDia(dia, AGORA));
    expect(CHIPS_POR_DIA).toBe(3);
    expect(aVista).toHaveLength(3);
    expect(escondidas).toBe(3);
  });

  it('sem nada escondido, não há "+N mais"', () => {
    expect(chipsAVista(chipsDoDia([ativ('PRAZO', '2026-11-12T12:00:00.000Z')], AGORA)).escondidas).toBe(0);
  });
});
