import { BadRequestException } from '@nestjs/common';
import { FiliadosService } from './filiados.service';

/**
 * "O SISTEMA IMPEDE CRIAÇÃO COM CPF IGUAL? RG TAMBÉM E OUTRAS COISAS QUE SÃO
 * CHAVE ÚNICA?" — o dono, 22/09/2026.
 *
 * A resposta medida: o BANCO garantia `cpf`, `matricula` e `qr_token`. O COREN
 * não — apesar de o recadastramento (`garantirUnicidade`) já o RECUSAR quando é
 * de outra ficha. Um caminho do código assumia a unicidade, o banco não a
 * impunha, e o cadastro normal gravava por cima sem dizer nada.
 *
 * Aqui ficam as duas metades do conserto:
 *
 *  1. o SERVIÇO recusa antes de gravar, com o nome de quem já tem o número —
 *     mensagem de gente, não "Unique constraint failed";
 *  2. o que vai para o banco é o número APARADO, porque o índice único é sobre
 *     `btrim(numero_coren)`. Se as duas travas não comparassem a mesma coisa,
 *     " 12345" passaria pela tela e quebraria no banco.
 *
 * RG e e-mail ficam de fora de propósito — ver o cabeçalho da migração
 * `20260922200000_coren_unico`: RG se repete entre estados e família divide
 * e-mail. Barrar os dois recusaria cadastro legítimo.
 */

/** O que `corenGravavel` é: uma função pura escondida atrás do `private`. */
const gravavel = (v: string | null | undefined) =>
  (FiliadosService as unknown as { corenGravavel: (x: unknown) => unknown }).corenGravavel(v);

describe('o COREN que vai para o banco', () => {
  it('é gravado aparado — o índice único é sobre o valor aparado', () => {
    expect(gravavel('  123456  ')).toBe('123456');
  });

  /**
   * VAZIO COLIDE, NULL NÃO. Em Postgres vários NULL convivem num índice único;
   * várias strings vazias, não. Gravar '' faria a SEGUNDA ficha sem COREN
   * quebrar — e a base importada tem milhares de campo em branco.
   */
  it.each(['', '   ', null])('campo em branco (%p) vira NULL, nunca string vazia', (v) => {
    expect(gravavel(v)).toBeNull();
  });

  /** `undefined` num PATCH parcial quer dizer "não mexi nisso". */
  it('undefined continua undefined: PATCH parcial não afirma nada', () => {
    expect(gravavel(undefined)).toBeUndefined();
  });
});

describe('a recusa quando o COREN já é de outra ficha', () => {
  function montar(linhas: { nomeCompleto: string; matricula: string }[]) {
    const consultas: unknown[][] = [];
    const prisma = {
      $queryRaw: (_s: TemplateStringsArray, ...args: unknown[]) => {
        consultas.push(args);
        return Promise.resolve(linhas);
      },
    };
    const svc = new FiliadosService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    const exigir = (
      svc as unknown as {
        exigirCorenLivre: (c: string | null | undefined, e?: string) => Promise<void>;
      }
    ).exigirCorenLivre.bind(svc);
    return { exigir, consultas };
  }

  it('recusa dizendo de QUEM é o número — ninguém adivinha um P2002', async () => {
    const { exigir } = montar([{ nomeCompleto: 'Maria de Sousa', matricula: 'SEN-2026-000123' }]);
    await expect(exigir('123456')).rejects.toBeInstanceOf(BadRequestException);
    await expect(exigir('123456')).rejects.toThrow(/Maria de Sousa/);
    await expect(exigir('123456')).rejects.toThrow(/SEN-2026-000123/);
  });

  it('e aponta a saída certa: a fila de possíveis duplicados', async () => {
    const { exigir } = montar([{ nomeCompleto: 'Maria', matricula: 'X' }]);
    await expect(exigir('123456')).rejects.toThrow(/duplicados/i);
  });

  it('sem COREN não consulta nada — o campo é opcional', async () => {
    const { exigir, consultas } = montar([{ nomeCompleto: 'Maria', matricula: 'X' }]);
    await exigir('   ');
    await exigir(null);
    await exigir(undefined);
    expect(consultas).toHaveLength(0);
  });

  /**
   * NA EDIÇÃO, A PRÓPRIA FICHA NÃO É CONCORRENTE. Sem isto, salvar a ficha sem
   * mexer no COREN acusaria ela mesma e ninguém conseguiria editar mais nada.
   */
  it('a edição compara o número APARADO e ignora a própria ficha', async () => {
    const { exigir, consultas } = montar([]);
    await exigir('  123456 ', 'id-da-ficha');
    expect(consultas[0]).toEqual(['123456', 'id-da-ficha']);
  });

  it('na criação não há ficha a excluir, e o parâmetro não pode virar NULL', async () => {
    const { exigir, consultas } = montar([]);
    await exigir('123456');
    expect(consultas[0]).toEqual(['123456', '']);
  });
});
