import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DESTINOS_DO_ARRASTO, TRANSICOES, oArrastoPodeSoltar } from '@/lib/agenda';

/**
 * "O DRAG AND DROP NÃO ESTÁ FUNCIONANDO? TENTEI ARRASTAR UMA ATIVIDADE PARA
 * CONCLUÍDA E NÃO ACONTECEU NADA." — o dono, 21/09/2026.
 *
 * Não acontecia mesmo. O quadro perguntava a `TRANSICOES` se a coluna aceitava
 * o cartão, e `TRANSICOES` é o mapa da rota `PATCH /:id/status`, que RECUSA
 * `CONCLUIDO` e `CANCELADO` de propósito — os dois têm rota própria porque
 * exigem desfecho e motivo. Como nenhuma transição leva a "Concluído":
 *
 *  1. `aceita('CONCLUIDO')` era sempre falso;
 *  2. o `onDragOver` não chamava `preventDefault`, então o navegador recusava
 *     o drop e o cartão voltava para o lugar;
 *  3. e as duas linhas que abririam o diálogo eram código INALCANÇÁVEL.
 *
 * Duas perguntas diferentes precisam de dois mapas. Este arquivo prova que elas
 * continuam diferentes — se alguém reaproveitar `TRANSICOES` no quadro de novo,
 * reprova aqui.
 */
describe('as duas perguntas não são a mesma', () => {
  it('a rota de status não aceita concluir nem cancelar — e é por isso que ela não serve ao quadro', () => {
    expect(TRANSICOES.PENDENTE).not.toContain('CONCLUIDO');
    expect(TRANSICOES.PENDENTE).not.toContain('CANCELADO');
    expect(TRANSICOES.EM_ANDAMENTO).not.toContain('CONCLUIDO');
  });

  it('o arrasto aceita, porque ele abre o diálogo em vez de gravar', () => {
    expect(oArrastoPodeSoltar('PENDENTE', 'CONCLUIDO')).toBe(true);
    expect(oArrastoPodeSoltar('PENDENTE', 'CANCELADO')).toBe(true);
    expect(oArrastoPodeSoltar('EM_ANDAMENTO', 'CONCLUIDO')).toBe(true);
    expect(oArrastoPodeSoltar('EM_ANDAMENTO', 'CANCELADO')).toBe(true);
  });
});

describe('o que cada coluna aceita', () => {
  it('a pendente vai para as outras três', () => {
    expect(DESTINOS_DO_ARRASTO.PENDENTE.sort()).toEqual(
      ['CANCELADO', 'CONCLUIDO', 'EM_ANDAMENTO'],
    );
  });

  it('a fechada volta para as duas abertas — reabrir é permitido', () => {
    expect(oArrastoPodeSoltar('CONCLUIDO', 'PENDENTE')).toBe(true);
    expect(oArrastoPodeSoltar('CONCLUIDO', 'EM_ANDAMENTO')).toBe(true);
    expect(oArrastoPodeSoltar('CANCELADO', 'PENDENTE')).toBe(true);
  });

  /**
   * De concluída para cancelada NÃO passa. São dois desfechos opostos, e pular
   * de um para o outro sem reabrir apagaria a conclusão sem que ninguém
   * dissesse por quê — a mesma razão que faz reabrir pedir um diálogo.
   */
  it('de um estado fechado para o outro, não', () => {
    expect(oArrastoPodeSoltar('CONCLUIDO', 'CANCELADO')).toBe(false);
    expect(oArrastoPodeSoltar('CANCELADO', 'CONCLUIDO')).toBe(false);
  });

  it('soltar na própria coluna não é ação nenhuma', () => {
    expect(oArrastoPodeSoltar('PENDENTE', 'PENDENTE')).toBe(false);
    expect(oArrastoPodeSoltar('CONCLUIDO', 'CONCLUIDO')).toBe(false);
  });
});

const FONTE = (arquivo: string) =>
  readFileSync(path.join(__dirname, arquivo), 'utf8');

describe('o quadro usa a régua certa, e o arrasto começa de verdade', () => {
  const KANBAN = FONTE('kanban-view.tsx');

  it('o quadro pergunta ao mapa do arrasto, não ao da rota', () => {
    expect(KANBAN).toContain('oArrastoPodeSoltar(arrastado.status, destino)');
    expect(KANBAN).not.toContain('TRANSICOES[arrastado.status]');
  });

  /**
   * O FIREFOX SÓ COMEÇA UM ARRASTO DEPOIS DO `setData`. Sem ele o `dragstart`
   * dispara, o `drop` nunca chega e o cartão volta ao lugar — exatamente o
   * sintoma relatado, num navegador em que o Chrome não o reproduz.
   */
  it('o cartão escreve no dataTransfer ao começar o arrasto', () => {
    expect(FONTE('compromisso-card.tsx')).toContain(
      "e.dataTransfer?.setData('text/plain', c.id)",
    );
  });

  /** Sair de uma coluna fechada nunca grava direto: passa pelo diálogo. */
  it('soltar fora de uma coluna fechada chama o diálogo de reabertura', () => {
    expect(KANBAN).toContain('if (estaFechado(card.status) && onReabrir) return onReabrir(card, destino);');
  });
});
