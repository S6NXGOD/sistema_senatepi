import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * A CARTEIRA DO ADVOGADO LÊ A TABELA, NUNCA O ATALHO.
 *
 * `Processo.advogadoId` e `Compromisso.responsavelId` são ATALHOS DERIVADOS:
 * guardam só o principal. A verdade está em `processos_advogados` e
 * `compromisso_responsaveis`, que são N:N. Contar pelo atalho responde "de
 * quantos eu sou o principal" — que não é a pergunta que o painel faz.
 *
 * O ERRO JÁ ACONTECEU DUAS VEZES, e nas duas o sintoma foi um ZERO:
 *
 *  · agenda — o segundo advogado de uma audiência via "0 audiências esta
 *    semana" no dia em que tinha uma;
 *  · processos — a Dra. Shérad viu "A ajuizar: 0" com o caso aberto na tela ao
 *    lado. Medido na produção em 21/08/2026: pelo atalho, 0; pela tabela, 1.
 *
 * O que torna isto perigoso é ser um ZERO, e não um erro. Ninguém desconfia de
 * um painel que diz que não há trabalho — só quem sabia do caso percebe.
 *
 * Não é preciso OR com o atalho: a sincronização grava a linha do principal na
 * tabela também (conferido na produção — sete processos com atalho, zero fora
 * da tabela). Somar o atalho ao OR só esconderia uma dessincronização.
 */
const DASHBOARD = readFileSync(
  path.join(__dirname, 'dashboard.module.ts'),
  'utf8',
);

/** Só o trecho da carteira — o resto do painel é escopo global, e ali o atalho não cabe mesmo. */
const carteira = DASHBOARD.slice(
  DASHBOARD.indexOf('const minhaCarteira'),
  DASHBOARD.indexOf('const minhaTriagem'),
);

describe('carteira do advogado', () => {
  it('o trecho existe (o teste não está olhando para o vazio)', () => {
    expect(carteira.length).toBeGreaterThan(500);
  });

  it('NENHUMA contagem usa o atalho `advogadoId`', () => {
    // `advogados: { some: { advogadoId } }` é a forma certa e contém a string;
    // por isso a busca é pelo atalho SOLTO, como chave de primeiro nível.
    const usosDoAtalho = carteira.match(/\n\s*advogadoId: user\.id/g) ?? [];
    expect(usosDoAtalho).toEqual([]);
  });

  it('todas as contagens partem do mesmo `where` da tabela N:N', () => {
    expect(carteira).toMatch(/advogados: \{ some: \{ advogadoId: user\.id \} \}/);
    // Uma constante só, espalhada com `...`: quatro cópias divergem na primeira
    // correção, e foi exatamente assim que uma delas ficou para trás.
    const espalhamentos = carteira.match(/\.\.\.souAdvogadoDoProcesso/g) ?? [];
    expect(espalhamentos.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * A agenda tem o mesmo par atalho/tabela e já foi corrigida — se alguém
   * "simplificar" de volta, o segundo advogado da audiência some do painel dele.
   */
  it('a agenda também soma quem acompanha sem ser o responsável', () => {
    expect(DASHBOARD).toMatch(/equipe: \{ some: \{ usuarioId: user\.id \} \}/);
  });
});
