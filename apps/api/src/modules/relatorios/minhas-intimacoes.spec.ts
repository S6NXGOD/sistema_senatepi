import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { temInscricao } from '../processos/utils/publicacoes-que-citam.util';

const ler = (rel: string) => readFileSync(path.join(__dirname, rel), 'utf8');
const SERVICO = ler('relatorios.service.ts');
const UTIL = ler('../processos/utils/publicacoes-que-citam.util.ts');
const PAINEL = ler('../dashboard/dashboard.module.ts');

/**
 * AS INTIMAÇÕES QUE CITAM A PESSOA — o espelho dela, não o contador da casa.
 *
 * Pedido de 18/09/2026: "colocar no relatório individual de cada advogado as
 * intimações que ele teve, ações que tomou". O relatório pessoal não tinha nada
 * disso: publicações eram leitura da casa.
 */
describe('a inscrição na OAB', () => {
  it('sem número ou sem UF não há vínculo por citação', () => {
    expect(temInscricao(null)).toBe(false);
    expect(temInscricao({ oab: '', oabUf: 'PI' })).toBe(false);
    expect(temInscricao({ oab: '12345', oabUf: '' })).toBe(false);
    expect(temInscricao({ oab: '  ', oabUf: 'PI' })).toBe(false);
  });

  /** O cadastro escreve "12.345" e o DJEN manda "12345". */
  it('aceita a inscrição com pontuação', () => {
    expect(temInscricao({ oab: '12.345', oabUf: 'pi' })).toBe(true);
  });
});

describe('a consulta das publicações que citam', () => {
  /**
   * DUAS CÓPIAS DO MESMO SQL DISCORDARIAM no dia em que uma aprendesse algo —
   * foi assim que duas `normalizarNome` com regras opostas chegaram à produção.
   */
  it('o painel do advogado delega à mesma função, e não tem SQL próprio', () => {
    const bloco = PAINEL.slice(PAINEL.indexOf('private async publicacoesQueCitam('));
    const corpo = bloco.slice(0, 900);
    expect(corpo).toContain('return publicacoesQueCitam(this.prisma, advogado, { de: desde });');
    expect(corpo).not.toContain('jsonb_array_elements');
  });

  it('o relatório usa a mesma função', () => {
    expect(SERVICO).toContain("from '../processos/utils/publicacoes-que-citam.util'");
    expect(SERVICO).toContain('publicacoesQueCitam(this.prisma, advogado, { de: inicio, ate: fim })');
  });

  /** Casar por NOME perderia todo mundo com acento e arriscaria homônimo. */
  it('casa por número e UF, nunca por nome', () => {
    expect(UTIL).toContain("regexp_replace(a->>'numeroOab'");
    expect(UTIL).toContain("upper(a->>'ufOab')");
    expect(UTIL).not.toContain("a->>'nome'");
  });

  /*
    O RECORTE DE DATA e o fim exclusivo são cobrados em
    `publicacoes-que-citam.spec`, contra o SQL COZIDO — que é a única forma de
    pegar a barra que some num template literal. Texto de arquivo não pega.
  */
});

describe('o bloco no relatório', () => {
  const BLOCO = SERVICO.slice(
    SERVICO.indexOf('private async minhasIntimacoes('),
    SERVICO.indexOf('O ROBÔ, MEDIDO PELO QUE SOBROU'),
  );

  it('a fatia examinada não está vazia', () => {
    expect(BLOCO.length).toBeGreaterThan(800);
  });

  /** Zero sem OAB é resultado; zero por falta de cadastro é outra coisa. */
  it('diz quando a pessoa não tem OAB, em vez de mostrar zero', () => {
    expect(BLOCO).toContain('temOab: temInscricao(advogado)');
    expect(BLOCO).toContain('if (!vazio.temOab) return vazio;');
  });

  /**
   * A DISPENSA É DO ROBÔ. Somá-la às ações humanas diria que alguém trabalhou
   * onde ninguém tocou.
   */
  it('separa o que o robô dispensou do que a pessoa fez', () => {
    expect(BLOCO).toContain('oRoboDispensou++');
    expect(SERVICO).toContain('Decisão dele, não da pessoa.');
  });

  /** `ABERTOS` já existe no arquivo: duas listas divergiriam. */
  it('usa a régua de "aberto" que o arquivo já tem', () => {
    expect(BLOCO).toContain('ABERTOS as StatusCompromisso[]');
    expect(BLOCO).not.toContain('const emAberto');
  });

  it('só nasce com alvo, e só para quem vê processos', () => {
    expect(SERVICO).toContain('alvo && veProcessos ? this.minhasIntimacoes(alvo, inicio, fim) : null');
  });

  /** Cinco contagens no banco para a mesma fatia é cinco varreduras. */
  it('lê a fatia uma vez e conta em memória', () => {
    expect((BLOCO.match(/this\.prisma\./g) ?? []).length).toBe(2); // o usuário e as linhas
  });
});
