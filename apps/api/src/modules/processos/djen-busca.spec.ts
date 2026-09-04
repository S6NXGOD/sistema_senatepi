import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const CONTROLLER = ler('src/modules/processos/djen.controller.ts');
const BUSCA = ler('src/modules/processos/djen-busca.service.ts');
const MODULO = ler('src/modules/processos/processos.module.ts');

/**
 * A BUSCA NO ACERVO — e por que ela existe.
 *
 * Medido em 03/09/2026: 136 publicações guardadas, 14 viraram atividade. As
 * outras 122 só eram alcançáveis abrindo o processo certo e rolando a aba
 * certa, o que na prática quer dizer que não eram alcançáveis.
 */
describe('busca no acervo de publicações', () => {
  it('está registrada no módulo', () => {
    expect(MODULO).toContain('DjenBuscaService');
  });

  /**
   * O Nest casa rota na ORDEM DE DECLARAÇÃO. Com `@Get('processo/:processoId')`
   * acima, `/djen/publicacoes` entraria por ali com "publicacoes" no lugar do
   * id — 404 silencioso, ou pior, resultado vazio sem erro.
   */
  it('a rota vem antes da que tem parâmetro no caminho', () => {
    expect(CONTROLLER.indexOf("@Get('publicacoes')")).toBeLessThan(
      CONTROLLER.indexOf("@Get('processo/:processoId')"),
    );
    expect(CONTROLLER.indexOf("@Get('publicacoes/facetas')")).toBeLessThan(
      CONTROLLER.indexOf("@Get('processo/:processoId')"),
    );
  });

  /**
   * ARMADILHA DE TDZ, e esta já derrubou a aplicação neste projeto.
   *
   * Com `emitDecoratorMetadata`, o decorador do parâmetro guarda uma referência
   * à classe do DTO avaliada quando o método é definido. Declarar a classe
   * DEPOIS do controller passa no `tsc --noEmit` e explode no carregamento do
   * módulo: "Cannot access 'X' before initialization".
   */
  it('o DTO é declarado antes do controller', () => {
    expect(CONTROLLER.indexOf('export class BuscaPublicacoesDto')).toBeGreaterThan(-1);
    expect(CONTROLLER.indexOf('export class BuscaPublicacoesDto')).toBeLessThan(
      CONTROLLER.indexOf('export class DjenController'),
    );
  });

  /** Desligada, a rota não existe — mesma semântica do resto do DJEN. */
  it('respeita o interruptor da integração', () => {
    const bloco = CONTROLLER.slice(
      CONTROLLER.indexOf("@Get('publicacoes')"),
      CONTROLLER.indexOf('buscar(@Query()'),
    );
    expect(bloco).toContain('@UseGuards(DjenAtivoGuard)');
  });

  /**
   * O QUE O CNJ NÃO FAZ. `nomeParte` e `nomeAdvogado` existem no Comunica PJe e
   * são IGNORADOS pelo servidor deles — mandar um nome inexistente devolve
   * exatamente o mesmo resultado. Os dois vêm DENTRO de cada publicação, e é
   * por isso que a busca por parte é possível aqui e impossível na origem.
   */
  it('procura dentro do JSON de partes e de advogados', () => {
    expect(BUSCA).toContain("jsonb_array_elements(coalesce(c.destinatarios, '[]'::jsonb))");
    expect(BUSCA).toContain("jsonb_array_elements(coalesce(c.advogados, '[]'::jsonb))");
    expect(BUSCA).toContain("a->>'numeroOab'");
  });

  /**
   * O CNJ manda nome SEM acento ("SHERAD", "PIAUI") e teor COM ("JUDICIÁRIO").
   * Quem digita escreve dos dois jeitos, então as duas formas do termo entram
   * no OR — dobrar o dado seria pior, porque o dado é o que tem de ficar como
   * o tribunal mandou.
   */
  it('procura com e sem acento', () => {
    expect(BUSCA).toContain('function semAcento(');
    expect(BUSCA).toContain('const likeSemAcento =');
    expect(BUSCA).toContain('upper(c.texto) LIKE ${like}');
    expect(BUSCA).toContain('upper(c.texto) LIKE ${likeSemAcento}');
  });

  /**
   * Termo sem dígito não pode virar `LIKE '%%'` no número do processo — casaria
   * com o acervo inteiro. O piso de quatro dígitos é o que separa uma busca por
   * NPU de um "2026" digitado por acaso.
   */
  it('só procura por número quando o termo tem dígitos suficientes', () => {
    expect(BUSCA).toContain('length(${digitos}) >= 4');
    // NUNCA o byte nulo: o Postgres o recusa em texto (invalid byte sequence
    // for encoding UTF8) e a consulta inteira morre. Só apareceu ao rodar a
    // busca contra o banco de verdade — o typecheck passava.
    expect(BUSCA).not.toContain("u0000");
    expect(BUSCA).toContain("const oab = digitos || '-';");
  });

  /** Paginação com teto: `limite` de usuário não pode pedir o acervo inteiro. */
  it('tem teto de página', () => {
    expect(BUSCA).toContain('const LIMITE_MAXIMO = 100;');
    expect(BUSCA).toContain('Math.min(Math.max(Number(filtro.limite) || LIMITE_PADRAO, 1), LIMITE_MAXIMO)');
  });

  /** A lista precisa dizer se a publicação já virou trabalho, e qual. */
  it('devolve o processo e a atividade ligados', () => {
    expect(BUSCA).toContain('numeroCNJ: true,');
    expect(BUSCA).toContain('compromisso: { select: { id: true, titulo: true, status: true, inicio: true } }');
  });

  /**
   * E PRECISA DIZER DE QUEM É O PROCESSO. A lista mostrava tribunal, órgão e
   * uma parede de texto do tribunal — quem varre 984 publicações reconhece o
   * caso por "Fulano × Município", não pelo cabeçalho do acórdão.
   */
  it('devolve as partes principais para identificar o caso', () => {
    const trecho = BUSCA.slice(BUSCA.indexOf('          processo: {'));
    expect(trecho.slice(0, 400)).toContain('partes: {');
    expect(trecho.slice(0, 400)).toContain('where: { principal: true }');
    expect(trecho.slice(0, 400)).toContain('select: { nome: true, polo: true }');
  });
});
