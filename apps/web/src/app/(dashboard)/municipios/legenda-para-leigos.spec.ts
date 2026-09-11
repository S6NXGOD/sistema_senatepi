import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PESO_SITUACAO, SITUACAO_FISCAL, type SituacaoFiscal } from '@/lib/municipios';

const TELA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const DRAWER = readFileSync(
  join(__dirname, '../../../components/municipios/municipio-drawer.tsx'),
  'utf8',
);

/**
 * "SE EXISTIR UMA LEGENDA PARA EXPLICAR PARA USUÁRIOS LEIGOS, MELHORARIA MUITO."
 *
 * O selo dizia "52,33% · prudencial" e parava aí. Quem nunca ouviu "limite
 * prudencial" — que é a maior parte do sindicato — via um número e uma palavra
 * sem consequência, e precisava abrir a ficha para descobrir que aquilo
 * significa "esta prefeitura está proibida por lei de conceder aumento".
 *
 * A explicação passou a viajar em três lugares, do mais barato ao mais completo:
 * `title=` no selo (o tooltip deste projeto), a faixa de legenda sob a lista, e
 * a frase do servidor na ficha. Este arquivo cobra os dois primeiros — o
 * terceiro é cobrado do lado da API, onde a regra tem base legal.
 */

const SITUACOES = Object.keys(SITUACAO_FISCAL) as SituacaoFiscal[];

describe('toda situação sabe se explicar', () => {
  it.each(SITUACOES)('%s tem ajuda em português de gente', (sit) => {
    const ajuda = SITUACAO_FISCAL[sit].ajuda;
    expect(ajuda.length).toBeGreaterThan(40);
    // Termina em ponto: é frase, não etiqueta.
    expect(ajuda.trim().endsWith('.')).toBe(true);
  });

  /**
   * A AJUDA DIZ A CONSEQUÊNCIA, não a definição. "RGF é o Relatório de Gestão
   * Fiscal" não ajuda ninguém a negociar; "não pode conceder aumento" ajuda.
   * Cada situação tem de citar o que muda na prática.
   */
  it.each([
    ['ACIMA_DO_TETO', /não poder conceder aumento|recompor|transferências/i],
    ['PRUDENCIAL', /PROIBIDO de conceder aumento/i],
    ['ALERTA', /Tribunal de Contas/i],
    ['REGULAR', /não há impedimento/i],
    ['INCONSISTENTE', /não serve de argumento/i],
    ['SEM_DADO', /irregularidade/i],
    ['NAO_CONSULTADO', /não é falha do ente/i],
  ] as Array<[SituacaoFiscal, RegExp]>)('%s diz o que muda na prática', (sit, padrao) => {
    expect(SITUACAO_FISCAL[sit].ajuda).toMatch(padrao);
  });

  /** Ordenar a legenda exige peso para todas — faltar uma deixaria `undefined`. */
  it('toda situação tem peso de gravidade', () => {
    for (const sit of SITUACOES) expect(typeof PESO_SITUACAO[sit]).toBe('number');
  });
});

describe('a explicação chega à tela', () => {
  /** O selo da lista carrega a ajuda — antes ela só existia no detalhe. */
  it('o selo tem o tooltip do projeto', () => {
    expect(TELA).toContain('title={est.ajuda}');
  });

  /**
   * A LEGENDA MOSTRA SÓ O QUE ESTÁ NA TELA — mesma regra do calendário da
   * agenda. Listar as sete situações sempre ensinaria a ignorar a faixa.
   */
  it('a legenda lista as situações presentes, não todas', () => {
    expect(TELA).toContain('const presentes = [...new Set(itens.map((m) => m.fiscal.situacao))]');
    expect(TELA).not.toContain('Object.keys(SITUACAO_FISCAL)');
  });

  /** Com uma situação só, a faixa repetiria o selo. */
  it('some quando não há o que comparar', () => {
    expect(TELA).toContain('if (presentes.length < 2) return null;');
  });

  /**
   * A RESSALVA DOS 15% NÃO PODE SUMIR. Um sindicato da saúde exibindo "32,26%"
   * ao lado da palavra "mínimo" estaria afirmando algo falso numa negociação.
   */
  it('a tela nunca chama a fatia da saúde de mínimo constitucional', () => {
    expect(DRAWER).toMatch(/não é o mínimo constitucional de 15%/i);
    expect(TELA).toMatch(/não é o mínimo constitucional de 15%/i);
  });

  /**
   * E O VALOR EM REAIS SEMPRE DIZ O PERÍODO: o RREO é acumulado no ano, então
   * "R$ 888/hab" de junho ao lado de "R$ 1.267/hab" de dezembro faz o segundo
   * parecer maior quando, anualizado, é o contrário.
   */
  it('o valor por habitante carrega o período', () => {
    expect(DRAWER).toContain('acumuladoAte(data.saude.exercicio, data.saude.bimestre)');
    expect(DRAWER).toMatch(/mesmo bimestre/);
  });
});
