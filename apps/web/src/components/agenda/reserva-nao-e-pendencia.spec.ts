import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ehReserva } from '@/lib/agenda';

const GAVETA = readFileSync(join(__dirname, 'compromisso-drawer.tsx'), 'utf8');
const CARTAO = readFileSync(join(__dirname, 'compromisso-card.tsx'), 'utf8');
const EQUIPE_UTIL = readFileSync(
  join(__dirname, '../../../../api/src/modules/agenda/equipe.util.ts'),
  'utf8',
);

/**
 * O ROBÔ CONVIDA, MAS NÃO COBRA.
 *
 * A tarefa criada por robô nascia com uma pessoa só: das 39 da produção, ZERO
 * tinham participante. Agora os advogados do caso entram como reserva — e a
 * distinção entre "reserva" e "participante escolhido por gente" é o que impede
 * o mesmo prazo de tocar o sino de quatro pessoas.
 *
 * Estes testes existem porque a distinção é INVISÍVEL no banco: uma coluna de
 * texto. Se a tela parar de lê-la, ninguém percebe — só some a diferença.
 */
describe('reserva do robô', () => {
  it('só `AUTOMATICA` é reserva; ausência e nulo são gente', () => {
    expect(ehReserva({ origem: 'AUTOMATICA' })).toBe(true);
    expect(ehReserva({})).toBe(false);
    expect(ehReserva({ origem: null })).toBe(false);
    expect(ehReserva({ origem: 'MANUAL' })).toBe(false);
  });

  it('a gaveta diz que reserva não vira pendência de ninguém', () => {
    expect(GAVETA).toContain('ehReserva(e)');
    expect(GAVETA).toContain('Não entra na lista de pendências deles');
  });

  it('e o cartão marca a reserva no próprio nome', () => {
    expect(CARTAO).toContain("ehReserva(e) ? ' (reserva)' : ''");
  });
});

/**
 * ASSUMIR — o botão que dá sentido à reserva.
 *
 * Sem ele, "você é reserva" é informação sem saída: para pegar a tarefa a
 * pessoa teria de abrir a edição e trocar o campo de responsável. O botão usa a
 * MESMA rota da edição, então o histórico continua registrando "Responsável
 * alterado" com nome e hora.
 */
describe('assumir a atividade', () => {
  it('só aparece na própria linha e só enquanto a atividade está aberta', () => {
    expect(GAVETA).toContain('user?.id === e.usuario.id && !estaFechado(c.status)');
  });

  it('troca o responsável pela rota de sempre', () => {
    expect(GAVETA).toContain("atualizarCompromisso(id, { responsavelId: user!.id })");
  });

  it('e limpa o sino, o painel e o quadro — que mudam junto', () => {
    for (const chave of ['compromissos', 'compromisso', 'agenda-alertas', 'minhas-pendencias', 'dashboard']) {
      expect(GAVETA).toContain(`'${chave}'`);
    }
  });

  /**
   * QUEM ASSUME DEIXA DE SER RESERVA — e isto é regra de banco, não de tela.
   *
   * A marca fica na linha da equipe. Promover alguém a responsável sem limpá-la
   * deixaria o registro dizendo que o robô pôs ali quem, na verdade, decidiu
   * assumir.
   */
  it('a promoção apaga a marca de reserva na equipe', () => {
    expect(EQUIPE_UTIL).toContain("where: { compromissoId, principal: true, origem: ORIGEM_RESERVA }");
    expect(EQUIPE_UTIL).toContain('data: { origem: null }');
  });
});

/**
 * QUANDO QUEM CRIA É GENTE, O SISTEMA OFERECE — NÃO IMPÕE.
 *
 * O gatilho do banco só põe reserva em tarefa de robô. No formulário, sobrescrever
 * a equipe que a pessoa acabou de escolher seria trocar a decisão dela pela do
 * sistema; então a tela mostra quem mais atua no caso e deixa incluir num toque.
 */
describe('a equipe do caso no formulário', () => {
  const FORM = readFileSync(join(__dirname, 'compromisso-form-modal.tsx'), 'utf8');

  it('não entra sozinha — só pelo botão', () => {
    expect(FORM).toContain('Incluir na atividade');
    // A negativa mira CÓDIGO: nenhum efeito reage ao processo escolhido, que é
    // o único jeito de a equipe do caso entrar sem alguém pedir.
    expect(FORM).not.toContain('}, [processoId]');
  });

  it('não oferece quem já está lá nem o próprio responsável', () => {
    expect(FORM).toContain(
      'a.advogado.id !== responsavelId && !participantes.includes(a.advogado.id)',
    );
  });

  it('e o gatilho do banco só age em tarefa de robô com processo', () => {
    const MIGRACAO = readFileSync(
      join(__dirname, '../../../../api/prisma/migrations/20260911160000_advogados_do_ato/migration.sql'),
      'utf8',
    );
    expect(MIGRACAO).toContain('IF NEW."origem_automatica" AND NEW."processo_id" IS NOT NULL THEN');
    expect(MIGRACAO).toContain('AND pa."advogado_id" <> NEW."responsavel_id"');
    expect(MIGRACAO).toContain('AND u."ativo"');
  });
});
