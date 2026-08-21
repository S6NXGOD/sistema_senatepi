import { BadRequestException } from '@nestjs/common';

import { montarUrgencia, normalizarEquipe } from './equipe.util';

/**
 * As duas regras que sustentam a equipe da agenda e a urgência com motivo.
 *
 * Ficam aqui, sem banco, porque é a parte que decide COISAS — quem responde e
 * o que conta como urgente. A parte que escreve (`sincronizarEquipe`) depende
 * do índice único do Postgres e é conferida contra um banco de verdade.
 */

describe('equipe da atividade', () => {
  it('o responsável é sempre o primeiro da lista', () => {
    expect(normalizarEquipe({ principalId: 'ana', participantesIds: ['bruno', 'caio'] }))
      .toEqual(['ana', 'bruno', 'caio']);
  });

  /**
   * O seletor da tela é UM só e devolve todo mundo junto, o responsável
   * incluído. Obrigar o front a separar as duas listas seria transferir para
   * ele uma regra que é nossa.
   */
  it('aceita o responsável repetido dentro dos participantes, sem duplicar', () => {
    expect(normalizarEquipe({ principalId: 'ana', participantesIds: ['bruno', 'ana'] }))
      .toEqual(['ana', 'bruno']);
  });

  it('ignora repetidos e vazios vindos da tela', () => {
    expect(normalizarEquipe({ principalId: 'ana', participantesIds: ['bruno', 'bruno', '', '  '] }))
      .toEqual(['ana', 'bruno']);
  });

  it('atividade sem responsável não existe', () => {
    expect(() => normalizarEquipe({ principalId: '' })).toThrow(BadRequestException);
  });

  it('sem participantes, a equipe é só quem responde', () => {
    expect(normalizarEquipe({ principalId: 'ana' })).toEqual(['ana']);
  });
});

describe('urgência', () => {
  const ctx = { userId: 'u1' };

  /**
   * O PONTO DA MUDANÇA INTEIRA. Urgência sem justificativa não se revisa:
   * ninguém sabe por que aquilo é prioritário, então nada é desmarcado e em
   * poucos meses metade da fila está urgente — que é o mesmo que nada estar.
   */
  it('pessoa NÃO marca urgente sem dizer o motivo', () => {
    expect(() => montarUrgencia(true, undefined, ctx)).toThrow(BadRequestException);
    expect(() => montarUrgencia(true, '   ', ctx)).toThrow(BadRequestException);
  });

  it('com motivo, grava motivo, data e autor', () => {
    const r = montarUrgencia(true, '  Prazo fatal na sexta  ', ctx);
    expect(r.urgente).toBe(true);
    expect(r.urgenteMotivo).toBe('Prazo fatal na sexta');
    expect(r.urgentePor).toBe('u1');
    expect(r.urgenteEm).toBeInstanceOf(Date);
  });

  /**
   * A automação é dispensada da OBRIGAÇÃO, não do motivo: ela passa o dela.
   * Antes, o que o robô criava nascia urgente e mudo — quem abria não sabia se
   * era regra do sistema ou engano de alguém.
   */
  it('a automação marca com o próprio motivo', () => {
    const r = montarUrgencia(true, 'Prazo vence em 3 dias', { origem: 'AUTOMACAO' });
    expect(r.urgente).toBe(true);
    expect(r.urgenteMotivo).toBe('Prazo vence em 3 dias');
  });

  it('a automação sem motivo nenhum não é barrada (não pode derrubar o robô)', () => {
    expect(() => montarUrgencia(true, undefined, { origem: 'AUTOMACAO' })).not.toThrow();
  });

  /** Desmarcar limpa tudo: guardar o motivo de algo que deixou de ser urgente
   *  é manter uma frase que não vale mais. */
  it('desmarcar limpa motivo, data e autor', () => {
    expect(montarUrgencia(false, undefined, ctx)).toEqual({
      urgente: false, urgenteMotivo: null, urgenteEm: null, urgentePor: null,
    });
  });

  /** Campo ausente é "não mexa" — diferente de `false`, que é "desmarque". */
  it('campo ausente não altera nada', () => {
    expect(montarUrgencia(undefined, undefined, ctx)).toEqual({});
  });

  it('quem já está urgente não é obrigado a redigitar o motivo ao salvar de novo', () => {
    const atual = {
      urgente: true, urgenteMotivo: 'Prazo fatal', urgenteEm: new Date(), urgentePor: 'u0',
    };
    expect(() => montarUrgencia(true, undefined, ctx, atual)).not.toThrow();
    expect(montarUrgencia(true, undefined, ctx, atual)).toEqual({});
  });

  it('mas ainda dá para corrigir só o texto do motivo', () => {
    const atual = {
      urgente: true, urgenteMotivo: 'Prazo fatal', urgenteEm: new Date(), urgentePor: 'u0',
    };
    expect(montarUrgencia(undefined, 'Prazo fatal — audiência antecipada', ctx, atual))
      .toEqual({ urgenteMotivo: 'Prazo fatal — audiência antecipada' });
  });

  /** Estava urgente SEM motivo (registro migrado da etiqueta): ao reafirmar
   *  pela tela, o motivo volta a ser exigido — é a oportunidade de corrigir. */
  it('urgente antigo e sem motivo volta a exigir justificativa', () => {
    const migrado = { urgente: true, urgenteMotivo: null, urgenteEm: null, urgentePor: null };
    expect(() => montarUrgencia(true, undefined, ctx, migrado)).toThrow(BadRequestException);
  });
});
