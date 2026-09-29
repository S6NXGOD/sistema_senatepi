import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recorteAtrasadas, recorteHoje } from './recortes.util';

const SERVICO = readFileSync(join(__dirname, 'agenda.service.ts'), 'utf8').replace(/\r/g, '');
const DTO = readFileSync(join(__dirname, 'dto/agenda.dto.ts'), 'utf8').replace(/\r/g, '');

/**
 * "E SE UM ADVOGADO CONCLUIR UMA ATIVIDADE ATRASADA? ELA FICA CONCLUÍDA NO DIA
 * OU SE CONCLUI NA DATA ATRASADA?" — pergunta do dono, 28/09/2026.
 *
 * O registro guarda o INSTANTE REAL (`concluidoEm: agora`), o cartão continua
 * no dia para o qual a atividade estava marcada, e desde 28/09 ele diz
 * "Concluída em 28/09/2026 · 6 dias depois". Isso já estava certo.
 *
 * O QUE NÃO ESTAVA: as duas maneiras de olhar "um dia" discordavam.
 *
 *   aba "Hoje" (servidor, `recorteHoje`) ......... 12
 *   célula do calendário de hoje (navegador) ..... 6
 *   fechadas hoje e devidas noutro dia ........... 1 — só a aba via
 *   dias dos últimos 60 com diferença ............ 14; no 02/09 foram OITO
 *
 * A aba já perguntava pelo CARIMBO desde 18/09 — por um pedido do próprio dono
 * ("por que essas tarefas estão aparecendo no filtro de hoje sendo que foram
 * concluídas no dia 15?"). O calendário ficou para trás e seguia só por
 * `inicio`. Duas definições do mesmo dia na mesma tela é o defeito de
 * "atrasada em três estados" outra vez.
 */
describe('concluir uma atrasada: o carimbo é o instante real', () => {
  it('a conclusão grava `agora`, nunca a data marcada', () => {
    const i = SERVICO.indexOf('status: StatusCompromisso.CONCLUIDO,');
    expect(i).toBeGreaterThan(0);
    expect(SERVICO.slice(i, i + 220)).toContain('concluidoEm: agora,');
  });

  /**
   * E ELA SAI DE "FICARAM PARA TRÁS" NA HORA. O recorte exige situação ABERTA,
   * então concluir tira a atividade da fila — sem depender de a tela recarregar
   * com outra régua.
   */
  it('concluída deixa de ser atrasada, pelo próprio recorte', () => {
    const r = recorteAtrasadas(new Date('2026-09-28T12:00:00Z')) as {
      status: { in: string[] };
      inicio: { lt: Date };
    };
    expect(r.status.in).toEqual(expect.arrayContaining(['PENDENTE', 'EM_ANDAMENTO']));
    expect(r.status.in).not.toContain('CONCLUIDO');
    expect(r.status.in).not.toContain('CANCELADO');
  });

  /** E continua visível em "Hoje" até o dia virar: foi o que saiu hoje. */
  it('a aba Hoje pergunta pelo carimbo, não pela data marcada', () => {
    const r = recorteHoje(new Date('2026-09-28T12:00:00Z')) as {
      AND: [{ OR: Array<Record<string, unknown>> }];
    };
    const chaves = r.AND[0].OR.flatMap((o) => Object.keys(o));
    expect(chaves).toContain('concluidoEm');
    expect(chaves).toContain('canceladoEm');
  });
});

/**
 * O PERÍODO DO CALENDÁRIO PRECISA TRAZER O QUE FECHOU NELE.
 *
 * Sem isto, uma atividade devida em 22/08 e concluída em 15/09 **nem chega ao
 * navegador** quando alguém abre o mês de setembro — a consulta do mês filtra
 * por `inicio`. Não adiantaria corrigir só o filtro do dia na tela.
 */
describe('a janela do período, quando pedem, pega o que fechou dentro dela', () => {
  it('o serviço soma os dois carimbos ao `inicio`', () => {
    expect(SERVICO).toContain(
      "{ OR: [{ inicio: range }, { concluidoEm: range }, { canceladoEm: range }] }",
    );
  });

  /**
   * E SÓ QUANDO PEDEM. `dataInicio/dataFim` significam "marcadas no período"
   * para quem já usa; virar o padrão mudaria recorte alheio sem ninguém pedir.
   */
  it('o padrão continua filtrando só por `inicio`', () => {
    const i = SERVICO.indexOf('if (range.gte || range.lte) {');
    const trecho = SERVICO.slice(i, i + 900);
    expect(trecho).toContain(': { inicio: range },');
    expect(trecho).toContain("q.incluirFechadasNoPeriodo === '1'");
  });

  it('a opção existe no contrato, com os valores de sempre', () => {
    expect(DTO).toContain('incluirFechadasNoPeriodo?: string;');
    expect(DTO).toContain("@IsOptional() @IsIn(['1', 'true', '0', 'false']) incluirFechadasNoPeriodo?: string;");
  });
});
