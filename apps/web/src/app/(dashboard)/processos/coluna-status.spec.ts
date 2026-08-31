import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  FASE_AJUDA,
  FASE_LABEL,
  STATUS_PROCESSO_AJUDA,
  STATUS_PROCESSO_LABEL,
  type FaseProcessual,
  type StatusProcesso,
} from '@/lib/processos';

/**
 * A COLUNA "STATUS" EMPILHA DUAS ESCALAS DIFERENTES.
 *
 * Em cima, a situação no SINDICATO (`statusInterno`); embaixo, a fase no
 * TRIBUNAL (`fase`, derivada das instâncias). É o que a torna densa e útil —
 * "Ativo / RECURSAL" diz em duas palavras que o caso está em curso e que há
 * instância recursal viva.
 *
 * Medido na produção de 31/08/2026, nas 127 linhas:
 *
 *    66  Ativo          / CONHECIMENTO
 *    39  Ativo          / RECURSAL
 *    16  Encerrado      / ARQUIVADO
 *     5  Pré-processual / PRÉ-PROCESSUAL   <- a mesma palavra, empilhada
 *     1  Pendente       / CONHECIMENTO
 */
const PAGINA = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');

/** A regra que a tela aplica, reproduzida aqui para poder ser exercitada. */
function mostraAFase(status: StatusProcesso, fase: FaseProcessual): boolean {
  return FASE_LABEL[fase] !== STATUS_PROCESSO_LABEL[status];
}

describe('a segunda linha da coluna de status', () => {
  /** Os 5 pré-processuais liam a mesma palavra duas vezes. */
  it.each<[StatusProcesso, FaseProcessual]>([
    ['PRE_PROCESSUAL', 'PRE_PROCESSUAL'],
    ['RASCUNHO', 'PRE_PROCESSUAL'],
    ['ARQUIVADO', 'ARQUIVADO'],
  ])('some quando repete a de cima: %s / %s', (status, fase) => {
    expect(mostraAFase(status, fase)).toBe(false);
  });

  /**
   * "Encerrado / ARQUIVADO" FICA, mesmo parecendo redundante: são fatos
   * diferentes — o sindicato encerrou, o tribunal deu baixa. É quando eles
   * DISCORDAM ("Encerrado / RECURSAL") que a linha vira alerta, e esconder o
   * par concordante esconderia também o discordante.
   */
  it.each<[StatusProcesso, FaseProcessual]>([
    ['ATIVO', 'CONHECIMENTO'],
    ['ATIVO', 'RECURSAL'],
    ['ATIVO', 'EXECUCAO'],
    ['ENCERRADO', 'ARQUIVADO'],
    ['ENCERRADO', 'RECURSAL'],
    ['PENDENTE', 'CONHECIMENTO'],
    ['GANHO_EXECUCAO', 'EXECUCAO'],
  ])('fica quando acrescenta: %s / %s', (status, fase) => {
    expect(mostraAFase(status, fase)).toBe(true);
  });

  it('a tela aplica exatamente esta regra', () => {
    expect(PAGINA).toContain('if (status && FASE_LABEL[fase] === STATUS_PROCESSO_LABEL[status]) return null;');
  });
});

/**
 * Duas escalas na mesma coluna só funcionam se der para descobrir qual é qual.
 * "Pendente" sozinho não diz nada; a dica diz "distribuído, aguardando a
 * primeira movimentação do tribunal".
 */
describe('cada eixo se explica', () => {
  it('toda situação tem ajuda, e ela nomeia o eixo', () => {
    for (const chave of Object.keys(STATUS_PROCESSO_LABEL) as StatusProcesso[]) {
      const ajuda = STATUS_PROCESSO_AJUDA[chave];
      expect(`${chave}: ${!!ajuda}`).toBe(`${chave}: true`);
      expect(`${chave}: ${ajuda.startsWith('Situação no sindicato')}`).toBe(`${chave}: true`);
    }
  });

  it('toda fase tem ajuda', () => {
    for (const chave of Object.keys(FASE_LABEL) as FaseProcessual[]) {
      expect(`${chave}: ${!!FASE_AJUDA[chave]}`).toBe(`${chave}: true`);
    }
  });

  it('as dicas chegam à tela', () => {
    expect(PAGINA).toContain('title={STATUS_PROCESSO_AJUDA[status]}');
    expect(PAGINA).toContain('title={FASE_AJUDA[fase]}');
  });
});

/**
 * O cartão do celular mostrava só a situação no sindicato — e a metade que
 * sumia era a mais acionável: saber que o caso está em RECURSAL ou em EXECUÇÃO
 * muda o que se faz com ele.
 */
describe('paridade entre a tabela e o cartão', () => {
  it('o celular também mostra a fase', () => {
    const cartao = PAGINA.slice(PAGINA.indexOf('function ProcessoCard('));
    expect(cartao).toContain('<BadgeFase fase={p.fase} status={p.statusInterno} />');
  });

  it('e passa o status junto, senão a regra de repetição não roda', () => {
    const usos = PAGINA.match(/<BadgeFase[^/]*\/>/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(2);
    for (const uso of usos) expect(uso).toContain('status={p.statusInterno}');
  });
});
