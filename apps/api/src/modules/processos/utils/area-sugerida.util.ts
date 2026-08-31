/**
 * ÁREA JURÍDICA DEDUZIDA DO QUE O CNJ JÁ CONTOU.
 *
 * Por que existe
 * -------------
 * Em 31/08/2026, 42 dos 127 processos da produção estavam sem `categoria`. Não
 * é um campo decorativo: é por ele que se filtra a carteira, que se conta
 * quantas ações trabalhistas o sindicato tem em curso e que se separa o que é
 * defesa de servidor estatutário do que é reclamação celetista. Com um terço da
 * base em branco, todo relatório por área mente por omissão.
 *
 * A informação, porém, JÁ ESTAVA LÁ — só que espalhada em três campos que o
 * DataJud preenche sozinho: o tribunal (Justiça do Trabalho ou Justiça comum), a
 * classe processual e o assunto. Pedir que alguém reclassifique 42 processos à
 * mão seria pedir que redigitasse o que o sistema já sabe.
 *
 * O que esta função NÃO é
 * -----------------------
 * Um chute. Ela devolve `null` sempre que os sinais não bastam — e é isso que
 * a torna utilizável sem supervisão. Preferir o branco honesto a um rótulo
 * plausível é a única forma de o campo continuar significando alguma coisa.
 *
 * Ela também nunca sobrescreve: quem chama só usa o resultado quando
 * `categoria` está vazia. A classificação de uma pessoa vale mais do que a
 * dedução, sempre, mesmo quando a dedução discorda.
 */
import { AREAS_JURIDICAS } from '../areas.catalogo';

export interface SinaisDoProcesso {
  tribunal?: string | null;
  classeProcessual?: string | null;
  assuntoPrincipal?: string | null;
  tipoAcao?: string | null;
  /** Há órgão público no polo passivo? Separa "servidor" de "empregado". */
  reuPublico?: boolean;
}

export interface AreaDeduzida {
  slug: string;
  /** Frase para o histórico do processo: por que esta área, e não outra. */
  porque: string;
}

function normalizar(v?: string | null): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();
}

/**
 * A sigla do tribunal diz o RAMO da Justiça, e o ramo já decide quase tudo.
 *
 * TRT/TST é Justiça do Trabalho: relação de emprego regida pela CLT. TJ é
 * Justiça comum estadual, onde o sindicato litiga pelo servidor ESTATUTÁRIO —
 * outra relação jurídica, outra área. TRF é Justiça Federal.
 */
const TRABALHO = /^(TRT\d*|TST)$/;
const ESTADUAL = /^TJ[A-Z]{2}$/;
const FEDERAL = /^(TRF\d*|STJ|STF)$/;

/** Assuntos que denunciam matéria previdenciária, independentemente do resto. */
const ASSUNTOS_PREVIDENCIARIOS = [
  'APOSENTADORIA',
  'AUXILIO-DOENCA',
  'AUXILIO DOENCA',
  'BENEFICIO PREVIDENCIARIO',
  'PENSAO POR MORTE',
  'SALARIO-MATERNIDADE',
  'RGPS',
  'RPPS',
];

/** Assuntos de conselho de classe — o COREN, no caso do SENATEPI. */
const ASSUNTOS_ETICOS = ['CONSELHO REGIONAL', 'ETICO', 'ETICO-DISCIPLINAR', 'COREN'];

export function areaSugerida(s: SinaisDoProcesso): AreaDeduzida | null {
  const tribunal = normalizar(s.tribunal).trim();
  const assunto = normalizar(s.assuntoPrincipal);

  /**
   * O ASSUNTO VEM PRIMEIRO quando é inequívoco.
   *
   * "Aposentadoria" é previdenciário mesmo tramitando no TRT, e processo ético
   * do conselho é ético-disciplinar mesmo correndo na Justiça comum. São os
   * dois casos em que o ramo do tribunal engana.
   */
  if (assunto && ASSUNTOS_PREVIDENCIARIOS.some((t) => assunto.includes(t))) {
    return { slug: 'PREVIDENCIARIO', porque: `assunto "${s.assuntoPrincipal}"` };
  }
  if (assunto && ASSUNTOS_ETICOS.some((t) => assunto.includes(t))) {
    return { slug: 'ETICO_DISCIPLINAR', porque: `assunto "${s.assuntoPrincipal}"` };
  }

  /**
   * DAQUI EM DIANTE, O RAMO DA JUSTIÇA DECIDE — e essa ordem não é opinião
   * minha: é a convenção que a própria base já pratica.
   *
   * Medido na produção em 31/08/2026, entre os 85 processos JÁ classificados
   * por gente:
   *
   *    41x  Justiça do Trabalho + institucional  ->  SINDICAL_COLETIVO
   *    12x  Justiça do Trabalho + individual     ->  TRABALHISTA
   *    26x  Justiça comum (institucional ou não) ->  ADMINISTRATIVO
   *
   * Zero contraexemplos. Uma primeira versão desta função punha a forma
   * COLETIVA acima do ramo — e teria classificado como SINDICAL_COLETIVO nove
   * ações no TJPI que a base inteira chama de ADMINISTRATIVO. Estaria
   * "defensável" e mesmo assim errada, porque faria o campo significar coisas
   * diferentes conforme a data em que o registro entrou.
   *
   * A convenção é coerente: a área descreve a MATÉRIA, não o rito. Ação civil
   * coletiva contra município sobre adicional de insalubridade de servidor
   * estatutário é matéria administrativa — que ela seja coletiva aparece no
   * selo institucional e na etiqueta da classe, não aqui.
   */
  if (TRABALHO.test(tribunal)) {
    return s.tipoAcao === 'INSTITUCIONAL'
      ? {
          slug: 'SINDICAL_COLETIVO',
          porque: `ação institucional na Justiça do Trabalho (${s.tribunal})`,
        }
      : { slug: 'TRABALHISTA', porque: `tramita no ${s.tribunal} (Justiça do Trabalho)` };
  }

  /**
   * JUSTIÇA COMUM: exige órgão público no polo passivo.
   *
   * Contra o poder público, a causa do sindicato é de servidor ESTATUTÁRIO —
   * progressão, gratificação, insalubridade de quem é regido por estatuto — e
   * isso é administrativo. É o acervo inteiro do TJPI aqui.
   *
   * Sem órgão público identificado, NÃO deduz. A tentação é responder "CIVEL"
   * por eliminação, e seria errado com frequência: o polo passivo pode
   * simplesmente não ter sido cadastrado ainda (existe fila para isso), e aí a
   * ausência do órgão não prova que ele não exista. Rotular por eliminação
   * transforma cadastro incompleto em dado errado, que é pior do que vazio.
   */
  if (ESTADUAL.test(tribunal) || FEDERAL.test(tribunal)) {
    return s.reuPublico
      ? {
          slug: 'ADMINISTRATIVO',
          porque: `${s.tribunal} contra órgão público (servidor estatutário)`,
        }
      : null;
  }

  return null;
}

/** O slug deduzido existe mesmo no catálogo? Guarda contra erro de digitação. */
export function areaSugeridaValida(d: AreaDeduzida | null): boolean {
  return !!d && AREAS_JURIDICAS.some((a) => a.slug === d.slug);
}
