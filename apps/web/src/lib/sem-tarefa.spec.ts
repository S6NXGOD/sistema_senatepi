import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fraseSemTarefa } from './movimentacoes';

const RAIZ = path.resolve(__dirname, '..');
const FICHA = readFileSync(path.join(RAIZ, 'components/processos/processo-detalhe-sheet.tsx'), 'utf8');

/**
 * "ESTÁ ENCHENDO O SISTEMA DE ATIVIDADES E MUITAS VEZES NÃO CONFIAMOS SE É
 * NOSSA PARTE QUE TEM QUE ATUAR." — 17/09/2026.
 *
 * O robô parou de abrir tarefa para andamento que o tribunal informa depois de
 * qualquer prazo ordinário (36 de 48 nasciam assim). Parar não basta: se a
 * agenda simplesmente emagrece, a equipe troca uma desconfiança por outra —
 * "será que o robô deixou passar?". A decisão aparece no andamento.
 */
describe('o robô explica por que não abriu tarefa', () => {
  it('o motivo vira frase de gente, não código', () => {
    const frase = fraseSemTarefa('ANDAMENTO_ANTIGO_SEM_TEOR');
    expect(frase).toContain('não abriu tarefa');
    // 17/09/2026: a frase explica; quem convida é o botão, que nem sempre está na tela.
    expect(frase).not.toContain('marque na Agenda');
    expect(frase).not.toContain('ANDAMENTO_ANTIGO_SEM_TEOR');
  });

  /** Motivo novo, de outra automação, não pode vazar chave técnica na tela. */
  it('sem motivo, ou motivo desconhecido, não mostra nada', () => {
    expect(fraseSemTarefa(null)).toBeNull();
    expect(fraseSemTarefa(undefined)).toBeNull();
    expect(fraseSemTarefa('MOTIVO_QUE_AINDA_NAO_EXISTE')).toBeNull();
  });

  it('a ficha do processo usa a frase no andamento', () => {
    expect(FICHA).toContain('fraseSemTarefa(item.semTarefaMotivo)');
  });
});
