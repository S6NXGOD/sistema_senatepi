import { SituacaoFiliado, StatusColaborador } from '@prisma/client';

import { rotuloDoTitular, situacaoDoTitular } from './titular.util';

/**
 * QUEM AUTORIZA A ENTRADA DE UM DEPENDENTE.
 *
 * O dependente ganhou um segundo tipo de titular (colaborador). Estes casos
 * existem para que a portaria e o check-in de evento nunca discordem sobre a
 * mesma pessoa: os dois chamam esta função, e é aqui que a regra está escrita
 * uma vez só.
 */

const HOJE = new Date('2026-08-10T12:00:00Z');

describe('titular filiado', () => {
  it('filiado ativo libera', () => {
    expect(situacaoDoTitular({ filiado: { situacao: SituacaoFiliado.ATIVO } })).toEqual({
      liberado: true,
      motivo: null,
    });
  });

  it('filiado inativo barra, com o motivo na tela', () => {
    const r = situacaoDoTitular({ filiado: { situacao: SituacaoFiliado.INATIVO } });
    expect(r.liberado).toBe(false);
    expect(r.motivo).toMatch(/Filiado responsável inativo/);
  });
});

describe('titular colaborador', () => {
  it('colaborador ativo e com contrato vigente libera', () => {
    const r = situacaoDoTitular(
      { colaborador: { status: StatusColaborador.ATIVO, vencimentoContrato: null } },
      HOJE,
    );
    expect(r).toEqual({ liberado: true, motivo: null });
  });

  it.each([
    [StatusColaborador.DESLIGADO, /desligado/],
    [StatusColaborador.INATIVO, /inativo/],
    [StatusColaborador.AFASTADO, /afastado/],
    [StatusColaborador.FERIAS, /de férias/],
  ])('colaborador %s barra a família', (status, esperado) => {
    const r = situacaoDoTitular({ colaborador: { status, vencimentoContrato: null } }, HOJE);
    expect(r.liberado).toBe(false);
    expect(r.motivo).toMatch(esperado);
  });

  /**
   * A mesma regra que já barra o próprio colaborador em `doColaborador`:
   * terceirizado com contrato vencido não entra, e a família dele também não.
   */
  it('contrato vencido barra, mesmo com o status ATIVO', () => {
    const r = situacaoDoTitular(
      {
        colaborador: {
          status: StatusColaborador.ATIVO,
          vencimentoContrato: new Date('2026-08-01T00:00:00Z'),
        },
      },
      HOJE,
    );
    expect(r.liberado).toBe(false);
    expect(r.motivo).toMatch(/fora de vigência/);
  });

  it('contrato que vence no futuro não barra', () => {
    const r = situacaoDoTitular(
      {
        colaborador: {
          status: StatusColaborador.ATIVO,
          vencimentoContrato: new Date('2027-01-01T00:00:00Z'),
        },
      },
      HOJE,
    );
    expect(r.liberado).toBe(true);
  });
});

/**
 * O CHECK `dependentes_um_titular` impede a linha órfã no banco. Este caso
 * existe porque o tipo do Prisma permite os dois nulos — e "liberado por
 * omissão" seria o pior default possível na portaria.
 */
describe('sem titular', () => {
  it('barra em vez de liberar', () => {
    const r = situacaoDoTitular({ filiado: null, colaborador: null });
    expect(r.liberado).toBe(false);
    expect(r.motivo).toMatch(/sem titular/i);
  });
});

describe('rótulo do titular', () => {
  it('usa o nome de quem existir', () => {
    expect(rotuloDoTitular({ filiado: { nomeCompleto: 'MARIA' } })).toBe('MARIA');
    expect(rotuloDoTitular({ colaborador: { nome: 'JOÃO' } })).toBe('JOÃO');
    expect(rotuloDoTitular({})).toBeNull();
  });
});
