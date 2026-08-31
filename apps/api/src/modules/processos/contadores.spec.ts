import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { FILTRO_RAPIDO, PRE_PROCESSUAIS } from './processos.service';

/**
 * OS NÚMEROS DAS ABAS.
 *
 * O risco desta funcionalidade não é errar a conta: é o número DISCORDAR da
 * lista. A aba diz "3", a pessoa clica, aparecem 2 — e a partir daí ela não
 * confia em número nenhum da tela, inclusive os que estão certos. Por isso as
 * duas leituras saem do mesmo `FILTRO_RAPIDO`, e é isso que estes casos
 * protegem.
 */
const RAIZ = path.resolve(__dirname, '../../..');
const svc = readFileSync(path.join(RAIZ, 'src/modules/processos/processos.service.ts'), 'utf8');

describe('contadores das abas', () => {
  it('a aba pré-processual busca os DOIS rótulos', () => {
    expect(FILTRO_RAPIDO.preProcessuais()).toEqual({
      statusInterno: { in: PRE_PROCESSUAIS },
    });
  });

  it('"sem réu" é ausência de polo passivo, não réu em branco', () => {
    // `none` e não `some: { nome: null }`: o processo sem NENHUMA parte passiva
    // é o caso que a fila existe para pescar.
    expect(FILTRO_RAPIDO.semReu()).toEqual({ partes: { none: { polo: 'PASSIVO' } } });
  });

  it('"sem filiado" cobre o atalho E a tabela de partes', () => {
    const w = FILTRO_RAPIDO.semFiliado();
    expect(w).toHaveProperty('filiadoId', null);
    // O atalho sozinho não basta: um processo pode ter o filiado só na tabela
    // de partes (ação plúrima), e ele não é pendência nenhuma.
    expect(w).toHaveProperty('partes');
  });

  /**
   * O ALARME FALSO QUE O CONTADOR REVELOU.
   *
   * Enquanto a aba não tinha número, ninguém percebia que ela apontava seis
   * processos institucionais — todos corretos. Ação institucional é movida pelo
   * sindicato em nome da categoria: não há filiado "dono", e o schema diz, com
   * essas palavras, que cobrar o vínculo ali "seria forçar um dado que não
   * existe". Fila que aponta trabalho inexistente esconde o trabalho real.
   */
  it('"sem filiado" ignora ação institucional', () => {
    expect(FILTRO_RAPIDO.semFiliado()).toHaveProperty('tipoAcao', 'INDIVIDUAL');
  });

  /**
   * Sem `agora` injetado, o teste dependeria do relógio de quem o roda.
   *
   * O `OR` com a nota interna SAIU: o chip passou a contar só o andamento do
   * tribunal, e o rótulo passou a dizer isso. Contar o trabalho da equipe sob o
   * nome "movimentação" era o que fazia a tela listar processo de "há 1 ano"
   * dentro de um filtro de dias.
   */
  it('"recentes" recua exatamente a janela pedida', () => {
    const agora = new Date('2026-08-21T12:00:00Z');
    const w = FILTRO_RAPIDO.recentes(7, agora) as any;
    const desde = w.movimentacoes.some.dataMovimento.gte as Date;
    expect(desde.toISOString()).toBe('2026-08-14T12:00:00.000Z');
  });

  it('"recentes" olha SÓ o andamento do CNJ', () => {
    const w = FILTRO_RAPIDO.recentes(30, new Date()) as any;
    expect(w.movimentacoes).toBeDefined();
    expect(JSON.stringify(w)).not.toMatch(/movimentacoesInternas/);
  });

  /**
   * A LISTA E O CONTADOR TÊM DE LER DO MESMO LUGAR.
   *
   * Se alguém reescrever um dos dois com um `where` na mão, o número volta a
   * poder mentir — e mentir em silêncio, que é o pior tipo.
   */
  it('a listagem usa FILTRO_RAPIDO, não WHERE solto', () => {
    const listar = svc.slice(svc.indexOf('async listar('), svc.indexOf('async detalhe('));
    for (const chave of ['meus', 'semFiliado', 'semReu', 'urgentes', 'recentes']) {
      expect(`listar usa ${chave}: ${listar.includes(`FILTRO_RAPIDO.${chave}(`)}`)
        .toBe(`listar usa ${chave}: true`);
    }
  });

  it('o contador usa FILTRO_RAPIDO para todas as abas', () => {
    const cont = svc.slice(svc.indexOf('async contadores('), svc.indexOf('async listar('));
    for (const chave of ['preProcessuais', 'meus', 'semFiliado', 'semReu', 'recentes', 'urgentes']) {
      expect(`contador usa ${chave}: ${cont.includes(`FILTRO_RAPIDO.${chave}(`)}`)
        .toBe(`contador usa ${chave}: true`);
    }
  });

  /**
   * A lista padrão esconde o pré-processual; as OUTRAS abas herdam essa
   * exclusão. Sem isto, "sem réu cadastrado" contaria um caso que ainda nem foi
   * ajuizado — a aba prometeria três e entregaria dois.
   */
  it('as demais abas descontam o pré-processual, como a lista faz', () => {
    const cont = svc.slice(svc.indexOf('async contadores('), svc.indexOf('async listar('));
    expect(cont).toMatch(/notIn: PRE_PROCESSUAIS/);
    // E a aba pré-processual NÃO pode herdar a exclusão — ficaria sempre zero.
    expect(cont).toMatch(/where: FILTRO_RAPIDO\.preProcessuais\(\)/);
  });

  /** Sem usuário no contexto, "meus" tem de dar zero — nunca o total. */
  it('"meus" sem usuário não vira o total', () => {
    const cont = svc.slice(svc.indexOf('async contadores('), svc.indexOf('async listar('));
    expect(cont).toMatch(/usuarioId\s*\n?\s*\?/);
    expect(cont).toMatch(/where: \{ id: '' \}/);
  });
});
