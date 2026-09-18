import { api } from './api';

/**
 * PADRÕES NO ACERVO — o que só aparece olhando os processos juntos.
 *
 * A API devolve CONTAGEM e RÓTULO; a frase é daqui. É de propósito: no dia em
 * que alguém quiser corrigir a redação de uma leitura jurídica, o lugar de
 * mexer é um arquivo de interface, não uma consulta SQL.
 */

export type LeituraConcentracao =
  | 'DESFECHO_SEMPRE_CONTRA'
  | 'DESFECHO_SEMPRE_A_FAVOR'
  | 'COLETIVA_POSSIVEL'
  | 'REINCIDENCIA';

export interface Desfechos {
  julgados: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
}

/**
 * COMO AS AÇÕES TÊM SIDO JULGADAS — todas as ajuizadas, não só as ativas.
 *
 * Os desfechos de fora (`julgados`, `procedentes`…) contam só o acervo ATIVO.
 * Decidido é justamente o que sai do ativo (IMPROCEDENTE, GANHO_EXECUCAO,
 * ENCERRADO), então a pergunta "como têm sido julgadas" olha a história
 * inteira. `comRecursoDepois` conta os julgados com recurso julgado DEPOIS da
 * última sentença: a sentença não é o resultado final.
 *
 * OPCIONAL no tipo: na janela de troca do deploy a API antiga ainda não manda.
 */
export interface Historico extends Desfechos {
  comRecursoDepois: number;
}

/** A natureza da parte contrária. FISICA não sai com nome no papel. */
export type TipoDoAdversario = 'JURIDICA' | 'FISICA' | 'ORGAO_PUBLICO';

export interface PedidoRecorrente {
  assunto: string;
  processos: number;
}

export interface Concentracao extends Desfechos {
  parteExternaId: string;
  adversario: string;
  tipo?: TipoDoAdversario | null;
  processos: number;
  individuais: number;
  desde: string | null;
  pedidos: PedidoRecorrente[];
  historico?: Historico;
  /**
   * Mediana de DIAS da distribuição à sentença. Opcional: a API antiga não a
   * manda, e nula quando há menos de três julgados — mediana de dois é o ponto
   * médio de dois números, não um padrão.
   */
  medianaDias?: number | null;
  leituras: LeituraConcentracao[];
}

export interface PorAno {
  ano: number;
  processos: number;
}

export interface Dispersao extends Desfechos {
  assunto: string;
  processos: number;
  adversarios: number;
  individuais: number;
  desde: string | null;
  historico?: Historico;
  /**
   * Ações por ano, com os anos zerados no meio — a lacuna é informação. Conta
   * TODAS as ajuizadas (a régua de "Ações ajuizadas por ano" dos Relatórios), e
   * não só as que continuam ativas: o ano antigo encolhia por construção.
   */
  porAno: PorAno[];
  /**
   * Mediana de DIAS da distribuição à sentença. Opcional: a API antiga não a
   * manda, e nula quando há menos de três julgados — mediana de dois é o ponto
   * médio de dois números, não um padrão.
   */
  medianaDias?: number | null;
}

export interface NossoPapel {
  autor: number;
  reu: number;
  representando: number;
  /** Ativos sem parte nenhuma — fora dos três cartões. Ausente na API antiga. */
  semPartes?: number;
  /** Sindicato nos dois polos — contado em autor E em réu. Ausente na API antiga. */
  ambosOsPolos?: number;
}

export interface Panorama {
  concentracoes: Concentracao[];
  dispersoes: Dispersao[];
  /**
   * De que lado a entidade está, no acervo ATIVO. As três NÃO somam o acervo, e
   * NUNCA calcule "sem papel" pela diferença: pode dar negativo, porque o
   * sindicato nos dois polos entra em autor E em réu.
   *
   * Desde 18/09/2026 o sindicato como TERCEIRO deixou de cair fora das três —
   * assistente do filiado é "representamos o filiado". O que continua fora é o
   * processo SEM PARTE nenhuma, e ele vem nomeado em `semPartes` para a tela
   * poder dizer isso em vez de deixar a subtração para o leitor.
   */
  nossoPapel: NossoPapel;
  acervoAtivo: number;
  geradoEm: string;
}

export async function carregarPanorama(): Promise<Panorama> {
  return (await api.get<Panorama>('/panorama')).data;
}

/**
 * A LEITURA EM PORTUGUÊS — e cada frase termina numa decisão de quem lê, nunca
 * numa ordem.
 *
 * O sistema soma processos; ele não sabe de estratégia processual, de prazo de
 * prescrição, de conversa que já houve com o empregador. Dizer "ajuíze uma
 * coletiva" com base em três linhas de banco é opinar sobre o ofício de quem
 * está lendo, e basta errar uma vez para o painel inteiro virar ruído.
 *
 * NEM CONSELHO DISFARÇADO. "Vale rever a tese antes da próxima" e "é o
 * histórico mais forte que se leva para uma negociação" não eram imperativo,
 * mas eram estratégia — e no PDF saem com o logo do sindicato, como posição da
 * casa. Cada explicação termina numa constatação.
 */
export const LEITURA: Record<
  LeituraConcentracao,
  { titulo: string; explicacao: string; tom: 'alerta' | 'favoravel' | 'neutro' }
> = {
  DESFECHO_SEMPRE_CONTRA: {
    titulo: 'O resultado tem sido sempre contrário',
    explicacao:
      'Todas as ações já julgadas contra este réu deram improcedentes, sem recurso julgado ' +
      'depois. Cada uma, isolada, parece azar; juntas, é o mesmo argumento não convencendo ' +
      'o mesmo juízo.',
    tom: 'alerta',
  },
  DESFECHO_SEMPRE_A_FAVOR: {
    titulo: 'O resultado tem sido sempre favorável',
    explicacao:
      'Todas as ações já julgadas contra este réu foram procedentes, inteiras ou em ' +
      'parte, sem recurso julgado depois. Nenhuma decisão contrária registrada entre as ' +
      'já julgadas.',
    tom: 'favoravel',
  },
  COLETIVA_POSSIVEL: {
    titulo: 'São ações individuais pedindo a mesma coisa',
    explicacao:
      'O mesmo pedido, contra o mesmo empregador, em processos separados — a situação ' +
      'que a substituição processual existe para resolver. Discutir de uma vez o que ' +
      'hoje se discute em vários autos é uma decisão de quem conduz.',
    tom: 'neutro',
  },
  REINCIDENCIA: {
    titulo: 'O mesmo réu responde de novo pelo mesmo pedido',
    explicacao:
      'Sem desfecho uniforme a registrar e sem maioria de ações individuais — mas a ' +
      'repetição já diz que não é caso isolado.',
    tom: 'neutro',
  },
};

/** "3 de 5 julgadas" em uma linha, sem transformar em porcentagem falsa. */
export function resumoDesfechos(d: Desfechos): string | null {
  if (!d.julgados) return null;
  const partes: string[] = [];
  if (d.procedentes) partes.push(`${d.procedentes} procedente${d.procedentes > 1 ? 's' : ''}`);
  if (d.parciais) partes.push(`${d.parciais} procedente${d.parciais > 1 ? 's' : ''} em parte`);
  if (d.improcedentes) {
    partes.push(`${d.improcedentes} improcedente${d.improcedentes > 1 ? 's' : ''}`);
  }
  return `${d.julgados} já julgada${d.julgados > 1 ? 's' : ''}: ${partes.join(', ')}`;
}

/**
 * A LEITURA DA TENDÊNCIA — e ela só fala quando há o que dizer.
 *
 * Compara os DOIS últimos anos fechados com os dois anteriores, e não o último
 * ano com o penúltimo: um único ano fraco por acaso viraria "está caindo". O
 * ano corrente fica de fora do cálculo — ele está pela metade e puxaria toda
 * série para baixo em janeiro.
 *
 * Devolve `null` quando não há base: menos de quatro anos de série, ou variação
 * pequena demais para significar alguma coisa.
 *
 * `anoCorrente` é parâmetro para o plano do PDF ser puro e testável com ano
 * fixo; a tela usa o padrão.
 */
export function tendencia(
  porAno: PorAno[],
  anoCorrente: number = new Date().getFullYear(),
): 'CRESCENDO' | 'DIMINUINDO' | null {
  const fechados = porAno.filter((a) => a.ano < anoCorrente);
  if (fechados.length < 4) return null;

  const soma = (xs: PorAno[]) => xs.reduce((t, a) => t + a.processos, 0);
  const recentes = soma(fechados.slice(-2));
  const anteriores = soma(fechados.slice(-4, -2));
  if (recentes + anteriores < 4) return null; // amostra pequena demais

  // Metade a mais (ou a menos) é o piso para chamar de movimento.
  if (recentes >= anteriores * 1.5) return 'CRESCENDO';
  if (anteriores >= recentes * 1.5) return 'DIMINUINDO';
  return null;
}

/**
 * OS DESFECHOS QUE SE LEEM — o histórico (todas as ajuizadas), quando a API o
 * manda. Na janela de troca do deploy a API antiga só tem os desfechos das
 * ativas: eles entram no lugar, sem recurso contado, e a tela não diz
 * "no histórico" (ver `julgadasNoHistorico`).
 */
export function desfechosParaLer(d: Desfechos & { historico?: Historico | null }): Historico {
  if (d.historico) return d.historico;
  return {
    julgados: d.julgados,
    procedentes: d.procedentes,
    parciais: d.parciais,
    improcedentes: d.improcedentes,
    comRecursoDepois: 0,
  };
}

/**
 * "9 julgadas no histórico" — o complemento de "7 ativas". As duas perguntas
 * não se misturam: quantas estão em curso e como as ajuizadas foram julgadas.
 * `null` quando a API ainda não manda o histórico: afirmar "no histórico"
 * sobre as ativas seria mentir.
 */
export function julgadasNoHistorico(d: { historico?: Historico | null }): string | null {
  if (!d.historico) return null;
  const n = d.historico.julgados;
  if (!n) return 'nenhuma julgada no histórico';
  return `${n} ${n === 1 ? 'julgada' : 'julgadas'} no histórico`;
}

/**
 * A RESSALVA DO RECURSO — "3 tiveram recurso julgado depois — o resultado
 * final pode ser outro". Medido em 12/09/2026: 49 dos 109 processos ativos
 * julgados tinham acórdão depois da sentença. Sem ela, a barra de desfechos
 * afirmaria um resultado que o tribunal ainda pode ter mudado.
 */
export function ressalvaDoRecurso(h: Historico | null | undefined): string | null {
  const n = h?.comRecursoDepois ?? 0;
  if (!(n > 0)) return null;
  return `${n} ${n === 1 ? 'teve' : 'tiveram'} recurso julgado depois — o resultado final pode ser outro`;
}

/**
 * A MEDIANA EM LINGUAGEM DE GENTE — "cerca de 1 ano e 8 meses".
 *
 * "613 dias" é preciso e não cabe na cabeça de ninguém. Quem lê quer saber se
 * a ação demora meses ou anos, e é essa a pergunta que o filiado faz na porta.
 *
 * O arredondamento é DELIBERADO e o "cerca de" está lá por isso: uma mediana
 * de três ou sete casos não merece precisão de dias, e escrevê-la com dois
 * decimais fingiria uma certeza que a amostra não tem.
 */
export function duracaoEmPalavras(dias: number | null | undefined): string | null {
  if (dias === null || dias === undefined || !Number.isFinite(dias) || dias < 0) return null;
  if (dias < 45) return `cerca de ${dias} dia${dias === 1 ? '' : 's'}`;

  const meses = Math.round(dias / 30.44);
  if (meses < 12) return `cerca de ${meses} meses`;

  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = `${anos} ano${anos === 1 ? '' : 's'}`;
  if (resto === 0) return `cerca de ${parteAnos}`;
  return `cerca de ${parteAnos} e ${resto} ${resto === 1 ? 'mês' : 'meses'}`;
}

/** "2026 (até agora)": o ano corrente não se compara em pé de igualdade com os fechados. */
export function rotuloDoAno(ano: number, anoCorrente: number): string {
  return ano === anoCorrente ? `${ano} (até agora)` : String(ano);
}
