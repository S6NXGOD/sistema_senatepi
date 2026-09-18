import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { planejarAtividade } from './utils/plano-da-atividade.util';
import {
  diaBR, diaDeCalendarioBR, noveDaManhaDoDiaDeCalendario, somarDiasUteisEmCalendario,
} from './utils/data-br.util';

/**
 * O DIA DO ATO E O DIA DA TAREFA — 17/09/2026.
 *
 * "Não quero tarefas já com prazo matando o advogado." A frente inteira desta
 * rodada tira tarefa inútil do caminho; este arquivo cuida do contrário — que
 * a tarefa que SOBRA caia no dia certo.
 *
 * Dois erros de fuso moravam no mesmo cálculo, um em cada ponta:
 *
 *   NA SAÍDA. `planejarAtividade` soma os dias úteis sobre a data da publicação
 *   (coluna `@db.Date`, meia-noite UTC) e entregava o resultado a
 *   `proximoHorarioUtilBR`, que lê INSTANTE. Meia-noite UTC do dia 9 é 21h do
 *   dia 8 em Teresina, então "as nove da manhã" saíam no dia 8. Toda atividade
 *   nascida do Diário caía um dia antes do prazo que a própria descrição
 *   anunciava — a régua de cinco dias úteis entregava quatro.
 *
 *   NA ENTRADA. A rota "Virar tarefa" passava `movimentacoes.dataMovimento`
 *   cru, que é `DateTime` e carrega a hora do ato. Um ato das 23h20 de Teresina
 *   já é o dia seguinte em UTC e a contagem começava do dia errado. Medido na
 *   produção em 17/09/2026: 5.388 das 20.569 movimentações (26%) foram
 *   praticadas entre 21h e 23h59 — uma a cada quatro.
 */
describe('a tarefa cai no dia que a régua promete', () => {
  const base = { nomeOrgao: null, providencia: 'ANALISAR_INTIMACAO' as const, prazoMencionadoDias: null };

  /**
   * A âncora: o dia que a soma de dias úteis devolve é o dia em que a atividade
   * aparece na agenda. Sem isto, a descrição anuncia um prazo e a agenda marca
   * outro — e quem confere descobre pelo susto.
   */
  it('o dia calculado é o dia da agenda, e não a véspera', () => {
    for (let d = 0; d < 30; d++) {
      const publicacao = new Date(Date.UTC(2027, 2, 1 + d)); // @db.Date
      const agora = new Date(Date.UTC(2027, 2, 1 + d, 12));
      const calculado = somarDiasUteisEmCalendario(publicacao, 5);
      const plano = planejarAtividade({ ...base, dataDisponibilizacao: publicacao }, null, agora, 15);
      /*
        `calculado` é DIA PURO: lê-se em UTC. `plano.inicio` é INSTANTE: lê-se
        em Teresina. Usar a mesma régua nos dois é o próprio erro que este
        arquivo testa — `diaBR` de uma meia-noite UTC devolve a véspera.
      */
      expect(diaBR(plano.inicio)).toBe(calculado.toISOString().slice(0, 10));
    }
  });

  /** E às nove da manhã de Teresina — 12:00 UTC —, nunca às 9h do contêiner. */
  it('às nove da manhã de Teresina', () => {
    const publicacao = new Date(Date.UTC(2027, 2, 2));
    const plano = planejarAtividade(
      { ...base, dataDisponibilizacao: publicacao }, null, new Date(Date.UTC(2027, 2, 2, 12)), 15,
    );
    expect(plano.inicio.toISOString()).toMatch(/T12:00:00/);
  });

  /**
   * O MESMO DIA EM TERESINA É A MESMA TAREFA. Este é o caso que a rota "Virar
   * tarefa" reintroduzia: dois atos do mesmo dia, um de manhã e outro à noite,
   * produziam tarefas em dias diferentes — e o da noite atravessava o fim de
   * semana quando caía numa sexta.
   */
  it('10h e 22h do mesmo dia de Teresina dão a mesma tarefa', () => {
    const divergentes: string[] = [];
    for (let d = 0; d < 40; d++) {
      const manha = new Date(Date.UTC(2027, 2, 1 + d, 13)); // 10h BR
      const noite = new Date(Date.UTC(2027, 2, 2 + d, 1)); //  22h BR do MESMO dia
      const agora = new Date(Date.UTC(2027, 2, 2 + d, 2));
      // É o que `virarTarefa` faz com `dataMovimento` antes de planejar.
      const a = planejarAtividade({ ...base, dataDisponibilizacao: diaDeCalendarioBR(manha) }, null, agora, 15);
      const b = planejarAtividade({ ...base, dataDisponibilizacao: diaDeCalendarioBR(noite) }, null, agora, 15);
      if (a.inicio.getTime() !== b.inicio.getTime()) {
        divergentes.push(`${diaBR(manha)}: 10h → ${diaBR(a.inicio)} | 22h → ${diaBR(b.inicio)}`);
      }
    }
    expect(divergentes).toEqual([]);
  });

  /**
   * A IDADE TAMBÉM É DE DIAS. Ela decide a urgência na fronteira dos 15 dias, e
   * contá-la em horas fazia o ato de hoje envelhecer às 21h de Teresina.
   */
  it('a idade do ato não vira com a hora', () => {
    const publicacao = new Date(Date.UTC(2027, 2, 10));
    const deManha = planejarAtividade(
      { ...base, dataDisponibilizacao: publicacao }, null, new Date(Date.UTC(2027, 2, 10, 13)), 15,
    );
    const deNoite = planejarAtividade(
      { ...base, dataDisponibilizacao: publicacao }, null, new Date(Date.UTC(2027, 2, 11, 1)), 15,
    );
    expect(deManha.idadeDias).toBe(0);
    expect(deNoite.idadeDias).toBe(0);
  });
});

/**
 * OS IRMÃOS DO MESMO DEFEITO — porque consertar um caminho não basta.
 *
 * Eu corrigi `planejarAtividade` e dei por encerrado. A varredura do repositório
 * achou mais DOIS lugares fazendo exatamente a mesma coisa:
 *
 *   · `criarPreparoDaPauta` — o preparo de "dois dias úteis antes" da audiência
 *     nascia TRÊS dias antes;
 *   · `antecipar`, na correlação — quando o teor do Diário pede um prazo mais
 *     curto que o da atividade existente, a antecipação ia 24h além do pedido.
 *
 * A regra é simples e o teste a aplica ao repositório inteiro: o resultado de
 * `somarDiasUteisEmCalendario` é um DIA, e DIA só entra nas funções que leem
 * dia. Um teste que olhasse só o arquivo que eu consertei ficaria verde com os
 * irmãos no ar — foi assim que isto passou despercebido na primeira volta.
 */
describe('nenhum dia de calendário entra em função que lê instante', () => {
  const RAIZ = path.resolve(__dirname, '..', '..');

  /** Todo `.ts` de produção do serviço (sem testes). */
  function fontes(dir: string, achados: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) fontes(p, achados);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) achados.push(p);
    }
    return achados;
  }

  it('ninguém passa `somarDiasUteisEmCalendario` para quem lê instante', () => {
    const culpados: string[] = [];
    for (const arquivo of fontes(RAIZ)) {
      const fonte = readFileSync(arquivo, 'utf8');
      // A chamada aninhada, em uma linha ou quebrada em várias.
      const re = /\b(noveDaManhaBR|proximoHorarioUtilBR)\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?somarDiasUteisEmCalendario/g;
      for (const m of fonte.matchAll(re)) {
        culpados.push(`${path.relative(RAIZ, arquivo)}: ${m[1]}(somarDiasUteisEmCalendario(...))`);
      }
    }
    expect(culpados).toEqual([]);
  });

  /**
   * E a varredura não olha para o vazio: as funções existem, são usadas, e a
   * versão de DIA tem leitores de verdade.
   */
  it('a varredura tem o que varrer', () => {
    const todos = fontes(RAIZ).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(todos).toContain('somarDiasUteisEmCalendario(');
    expect(todos).toContain('noveDaManhaBR(');
    expect(
      (todos.match(/noveDaManhaDoDiaDeCalendario|proximoHorarioUtilDoDiaDeCalendario/g) ?? []).length,
    ).toBeGreaterThanOrEqual(4);
  });
});

/**
 * NENHUMA TAREFA DO ROBÔ NASCE NUM SÁBADO — 18/09/2026.
 *
 * O aviso ao filiado dizia "2 dias úteis de antecedência" e subtraía 2 dias
 * CORRIDOS, com uma função que não empurra fim de semana. Pauta na segunda
 * mandava o telefonema para sábado; pauta na terça, para domingo. Dois em cinco.
 * E na segunda o item já apareceria na faixa como ATRASADO, com a audiência
 * acontecendo antes de alguém ligar para o filiado.
 *
 * Nunca chegou a acontecer (zero tarefas deste título na produção — o aviso
 * exige pauta com filiado vinculado), então este bloco é a rede, não o conserto.
 */
describe('a antecedência do robô é em dias ÚTEIS', () => {
  const diaDaSemanaBR = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).getUTCDay();

  /**
   * As duas contas que o robô faz para trás: o preparo do advogado e o aviso da
   * secretaria. Percorre um ano inteiro de pautas — se alguma cair no fim de
   * semana, o teste nomeia o dia.
   */
  it('nem o preparo nem o aviso caem em sábado ou domingo, em 365 pautas', () => {
    const caidos: string[] = [];
    for (let i = 0; i < 365; i++) {
      const pauta = new Date(Date.UTC(2027, 0, 4 + i, 13)); // 10h BR
      for (const dias of [2, 3]) {
        const quando = noveDaManhaDoDiaDeCalendario(
          somarDiasUteisEmCalendario(diaDeCalendarioBR(pauta), -dias),
        );
        const dow = diaDaSemanaBR(quando);
        if (dow === 0 || dow === 6) {
          caidos.push(`pauta ${diaBR(pauta)} (−${dias} úteis) → ${diaBR(quando)} (dow ${dow})`);
        }
      }
    }
    expect(caidos).toEqual([]);
  });

  /** E a antecedência é real: sempre ANTES da pauta, nunca no dia dela. */
  it('a tarefa nasce antes da pauta, sempre', () => {
    for (let i = 0; i < 60; i++) {
      const pauta = new Date(Date.UTC(2027, 1, 1 + i, 13));
      const quando = noveDaManhaDoDiaDeCalendario(
        somarDiasUteisEmCalendario(diaDeCalendarioBR(pauta), -2),
      );
      expect(quando.getTime()).toBeLessThan(pauta.getTime());
    }
  });

  /**
   * E o fonte não pode voltar a contar dias corridos. Mira a subtração de
   * milissegundos sobre a data da pauta, que é a forma exata do defeito.
   */
  it('o robô não subtrai 48 horas da pauta para achar o dia', () => {
    const fonte = readFileSync(path.join(__dirname, 'automacao-prazos.service.ts'), 'utf8');
    expect(fonte).not.toMatch(/inicio\.getTime\(\)\s*-\s*\d+\s*\*\s*24\s*\*\s*3_600_000/);
    expect(fonte).toContain('-DIAS_UTEIS_DE_AVISO');
  });
});
