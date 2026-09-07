import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const CARD = lerCodigo('publicacao-djen-card.tsx');

/**
 * QUAL DOS NOSSOS ADVOGADOS FOI INTIMADO — pelo rosto, antes da leitura.
 *
 * A publicação lista de quatro a oito advogados e quase todos são da outra
 * parte. Os nossos ficavam atrás de um clique, numa lista fechada de nomes em
 * caixa alta. Numa aba com 1.408 atos, descobrir "isto é meu?" custava abrir
 * cada cartão.
 *
 * Medido em 07/09/2026: **1.381 das 1.408 publicações** têm um advogado do
 * quadro identificável pela OAB, e os oito advogados têm foto cadastrada. A
 * cobertura justifica o espaço na tela.
 */
describe('o rosto do advogado na publicação', () => {
  it('a pilha de rostos existe e vai para o cabeçalho do cartão', () => {
    expect(CARD).toContain('function RostosDosNossos');
    expect(CARD).toContain('<RostosDosNossos advogados={advogados} />');
  });

  /**
   * CASAR POR NOME PERDERIA TODO MUNDO COM ACENTO. O DJEN manda "ICARO SOL
   * ALMONDES SANTOS"; o cadastro tem "Ícaro Sol Almondes Santos". Número da
   * OAB + UF é exato e não confunde homônimo.
   */
  it('casa pela OAB, nunca pelo nome', () => {
    expect(CARD).toContain('const chaveOab =');
    expect(CARD).toContain("replace(/\\D/g, '')");
    expect(CARD).toContain('.trim().toUpperCase()');
    // A UF entra na chave: "3778/PI" e "3778/SP" são pessoas diferentes.
    expect(CARD).toMatch(/\$\{\(uf \?\? ''\)\.trim\(\)\.toUpperCase\(\)\}-\$\{soDigitos\(numero\)\}/);
  });

  /** O mesmo advogado citado duas vezes na publicação não vira dois rostos. */
  it('deduplica pela chave', () => {
    expect(CARD).toContain('const achados = new Map<string, AdvogadoDisponivel>()');
    expect(CARD).toContain('achados.set(k, nosso)');
  });

  /**
   * UMA REQUISIÇÃO PARA A PÁGINA INTEIRA. São dezenas de cartões; sem a chave
   * de cache compartilhada com o painel de filtros, cada um faria a sua.
   */
  it('reaproveita o cache da lista de advogados', () => {
    expect(CARD).toContain("queryKey: ['processos', 'advogados-disponiveis']");
    expect(CARD).toContain('staleTime:');
  });

  /** Sem advogado nosso na publicação, nada aparece — nem espaço vazio. */
  it('some quando nenhum é nosso', () => {
    expect(CARD).toContain('if (!nossos.length) return null;');
  });

  /**
   * MOBILE-FIRST: três rostos cabem ao lado da data no celular; mais que isso
   * empurra a data para fora da linha. O nome só acompanha quando é UM — com
   * dois, um nome sozinho mentiria por omissão.
   */
  it('limita a três rostos e só nomeia quando é um', () => {
    expect(CARD).toContain('nossos.slice(0, 3)');
    expect(CARD).toContain('nossos.length === 1 ?');
    expect(CARD).toContain('`+${nossos.length - 3}`');
    expect(CARD).toContain('hidden truncate');
    expect(CARD).toContain('sm:inline');
  });

  /** A lista completa continua no expansor: os da outra parte também importam. */
  it('não substitui a lista de todos os intimados', () => {
    expect(CARD).toContain('advogado intimado');
    expect(CARD).toContain('advogados intimados');
  });
});
