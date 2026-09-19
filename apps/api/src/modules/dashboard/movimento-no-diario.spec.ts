import { movimentoNoDiario, type LinhaDoDiario } from './painel.regras';
import { semanaBR, semanaDaDataPura } from '../processos/utils/data-br.util';

/**
 * O GRÁFICO DO ADVOGADO — 18/09/2026.
 *
 * "Não há mais gráficos e informações que deveriam aparecer para os advogados?"
 * A conta do dia respondeu: a Triagem tinha quatro gráficos no painel e o
 * advogado, zero. Escolhi o Diário porque é o que se move — nos acervos dos
 * nove advogados da produção, o DataJud entregou 0 movimentações em 7 dias e o
 * DJEN entregou 19 para um deles.
 */

/** Data pura, como o Postgres materializa uma coluna `@db.Date`. */
const dia = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ato = (iso: string, link: string | null, providencia: string | null = null): LinhaDoDiario => ({
  link,
  providencia,
  dataDisponibilizacao: dia(iso),
});

/** 21/09/2026 é uma segunda-feira; as barras vão de 03/08 a 21/09. */
const HOJE = '2026-09-21';
const correr = (linhas: LinhaDoDiario[], semanas = 8) =>
  movimentoNoDiario(linhas, semanaDaDataPura, semanaDaDataPura(dia(HOJE)), semanas);

describe('a semana de uma coluna `date` não anda para trás', () => {
  /**
   * O DEFEITO QUE ESTA FUNÇÃO EXISTE PARA NÃO TER. `semanaBR` desconta as três
   * horas de Teresina antes de ler o dia — numa data pura isso volta 24h, e a
   * publicação de SEGUNDA cai na semana anterior. Seria uma publicação perdida
   * por semana, toda semana, sempre a primeira.
   */
  it('segunda-feira pura fica na própria semana, e `semanaBR` a jogaria para trás', () => {
    const segunda = dia('2026-09-21');
    expect(semanaDaDataPura(segunda)).toBe('2026-09-21');
    expect(semanaBR(segunda)).toBe('2026-09-14');
  });

  it('domingo pertence à semana que começou na segunda anterior', () => {
    expect(semanaDaDataPura(dia('2026-09-20'))).toBe('2026-09-14');
  });
});

describe('a grade tem sempre o mesmo tamanho', () => {
  it('oito semanas, da mais antiga para a mais nova, terminando em hoje', () => {
    const m = correr([]);
    expect(m.semanas).toHaveLength(8);
    expect(m.semanas[0].semana).toBe('2026-08-03');
    expect(m.semanas[7].semana).toBe(HOJE);
  });

  /** Recesso é informação: pular a semana vazia encosta duas barras distantes. */
  it('semana sem publicação aparece zerada, não some', () => {
    const m = correr([ato('2026-08-03', 'a'), ato(HOJE, 'b')]);
    expect(m.semanas.map((s) => s.total)).toEqual([1, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('sem publicação nenhuma, oito barras zeradas e pico 0 — e ninguém divide por ele', () => {
    const m = correr([]);
    expect(m.total).toBe(0);
    expect(m.pico).toBe(0);
    expect(m.providencias).toEqual([]);
  });
});

describe('conta ATOS, não cópias', () => {
  /**
   * O DJEN manda uma linha por destinatário. Um ato que intima quatro
   * advogados viraria quatro barras — a mesma régua do contador de 7 dias.
   */
  it('quatro cópias do mesmo link são uma publicação só', () => {
    const m = correr([
      ato(HOJE, 'link-1'), ato(HOJE, 'link-1'), ato(HOJE, 'link-1'), ato(HOJE, 'link-1'),
    ]);
    expect(m.total).toBe(1);
    expect(m.semanas[7].total).toBe(1);
  });

  it('sem link, cada linha conta por si — é o palpite seguro', () => {
    expect(correr([ato(HOJE, null), ato(HOJE, null)]).total).toBe(2);
  });

  /** Entre duas cópias, vence a que tem providência: é o mesmo documento. */
  it('a cópia sem providência não apaga a classificação da irmã', () => {
    const m = correr([ato(HOJE, 'x', null), ato(HOJE, 'x', 'ELABORAR_MANIFESTACAO')]);
    expect(m.providencias).toEqual([{ chave: 'ELABORAR_MANIFESTACAO', total: 1 }]);
  });
});

describe('o que pediram', () => {
  const muitas = [
    ...Array.from({ length: 5 }, (_, i) => ato(HOJE, `r${i}`, 'AVALIAR_RECURSO')),
    ...Array.from({ length: 4 }, (_, i) => ato(HOJE, `m${i}`, 'ELABORAR_MANIFESTACAO')),
    ...Array.from({ length: 3 }, (_, i) => ato(HOJE, `s${i}`, 'ANALISAR_SENTENCA')),
    ...Array.from({ length: 2 }, (_, i) => ato(HOJE, `i${i}`, 'ANALISAR_INTIMACAO')),
    ato(HOJE, 'j1', 'JUNTAR_DOCUMENTOS'),
  ];

  it('as quatro mais frequentes, em ordem', () => {
    expect(correr(muitas).providencias).toEqual([
      { chave: 'AVALIAR_RECURSO', total: 5 },
      { chave: 'ELABORAR_MANIFESTACAO', total: 4 },
      { chave: 'ANALISAR_SENTENCA', total: 3 },
      { chave: 'ANALISAR_INTIMACAO', total: 2 },
    ]);
  });

  /**
   * NENHUMA FICA DE FORA. É o edital e a lista de distribuição — 18 dos 114
   * atos do maior acervo medido. Eles contam no total (chegaram) e não na
   * lista (não pedem nada de ninguém).
   */
  it('"NENHUMA" e o nulo entram no total e não na lista', () => {
    const m = correr([
      ato(HOJE, 'a', 'NENHUMA'), ato(HOJE, 'b', null), ato(HOJE, 'c', 'AVALIAR_RECURSO'),
    ]);
    expect(m.total).toBe(3);
    expect(m.providencias).toEqual([{ chave: 'AVALIAR_RECURSO', total: 1 }]);
  });

  /** Ordem estável: sem o desempate, a lista pula entre dois recarregamentos iguais. */
  it('empate resolve pelo nome, sempre igual', () => {
    const empatadas = [ato(HOJE, '1', 'ZETA'), ato(HOJE, '2', 'ALFA')];
    expect(correr(empatadas).providencias.map((p) => p.chave)).toEqual(['ALFA', 'ZETA']);
    expect(correr([...empatadas].reverse()).providencias.map((p) => p.chave)).toEqual(['ALFA', 'ZETA']);
  });
});

describe('o número escrito bate com a soma das barras', () => {
  /**
   * A consulta pega 63 dias corridos para não cortar a barra mais antiga pela
   * metade; o que sobra fora da grade não entra no total, senão o "N em 8
   * semanas" ficaria maior que a soma do que se vê.
   */
  it('publicação anterior à primeira barra não entra em lugar nenhum', () => {
    const m = correr([ato('2026-07-27', 'velha'), ato(HOJE, 'nova')]);
    expect(m.total).toBe(1);
    expect(m.semanas.reduce((t, s) => t + s.total, 0)).toBe(m.total);
  });

  it('o pico é a maior barra — é a escala do desenho', () => {
    const m = correr([
      ato(HOJE, 'a'), ato(HOJE, 'b'), ato(HOJE, 'c'), ato('2026-09-14', 'd'),
    ]);
    expect(m.pico).toBe(3);
  });
});
