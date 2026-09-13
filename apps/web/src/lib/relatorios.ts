import { api } from './api';
import { baixarArquivo } from './pdf';

/**
 * RELATÓRIOS — o que a equipe entregou, o que ficou, e como o sindicato está
 * na Justiça.
 *
 * A API não devolve posição, nota nem "melhor do mês", e a tela não inventa
 * nenhum: são nove advogados que se conhecem pelo nome, e uma tabela ordenada
 * por volume vira comparação pública entre casos que não são comparáveis — uma
 * execução simples e uma ação civil pública contam "1" cada.
 *
 * Os blocos novos (`justica`, `proximos`, `publicacoes`, `robo`) são opcionais
 * no tipo pela janela de troca do deploy: web e API sobem separadas, e a tela
 * nova não pode quebrar diante da API de antes.
 */

export interface LinhaEquipe {
  usuarioId: string;
  nome: string;
  papel: string;
  concluidas: number;
  abertas: number;
  /** Abertas e de dia anterior — o dia virou. */
  atrasadas: number;
  /** Mediana em minutos; nulo quando ninguém usou o cronômetro. */
  medianaMinutos: number | null;
  cronometradas: number;
}

export interface Contagem {
  rotulo: string;
  total: number;
}

/** Um texto de "Outro" que se repetiu, com quantas vezes. */
export interface TextoRepetido {
  texto: string;
  total: number;
}

/** Contagem que vira link: `chave` é o id da parte ou o código da comarca. */
export interface ContagemComChave extends Contagem {
  chave: string;
}

export type ResultadoSentenca = 'PROCEDENTE' | 'PARCIAL' | 'IMPROCEDENTE';

export interface SentencasDoAno {
  ano: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
}

export interface AjuizadasDoAno {
  ano: number;
  processos: number;
}

export interface SentencaNoPeriodo {
  processoId: string;
  numeroCNJ: string | null;
  adversario: string | null;
  resultado: ResultadoSentenca;
  data: string;
}

export interface ItemDaAgenda {
  id: string;
  titulo: string;
  tipo: string;
  inicio: string;
  processo: { id: string; numeroCNJ: string | null } | null;
  responsavel: {
    id: string;
    nome: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
  } | null;
}

export interface Justica {
  nossoPapel: { autor: number; representando: number; reu: number };
  institucionais: number;
  individuais: number;
  sentencasPorAno: SentencasDoAno[];
  ajuizadasPorAno: AjuizadasDoAno[];
  sentencasNoPeriodo: SentencaNoPeriodo[];
  totalSentencasNoPeriodo: number;
  adversarios: ContagemComChave[];
  comarcas: ContagemComChave[];
  temas: Contagem[];
}

export interface Proximos {
  dias: number;
  audiencias: ItemDaAgenda[];
  totalAudiencias: number;
  prazos: ItemDaAgenda[];
  totalPrazos: number;
}

export interface Publicacoes {
  recebidas: number;
  viraramTarefa: number;
  dispensadas: number;
  /** Estado de agora, e não do período: o que espera decisão continua esperando. */
  esperandoDecisao: number;
}

export interface Robo {
  criadas: number;
  concluidas: number;
  canceladasPeloRobo: number;
  canceladasPorPessoas: number;
  abertas: number;
}

export interface Relatorio {
  periodo: { de: string; ate: string };
  escopo: 'GLOBAL' | 'PESSOAL';
  /** Preenchido quando a coordenação pediu o espelho de uma pessoa. */
  focoUsuario: { id: string; nome: string } | null;
  equipe: LinhaEquipe[];
  atividades: {
    concluidas: number;
    canceladas: number;
    abertas: number;
    atrasadas: number;
    porDesfecho: Contagem[];
    /** Que TIPO de trabalho — audiência e telefonema não custam o mesmo. */
    porTipo: Contagem[];
    automaticas: number;
    manuais: number;
  };
  processos: {
    /** Entraram no sistema no período — inclui acervo antigo importado. */
    cadastrados: number;
    /** Foram ajuizados no período. É o "caso novo" de verdade. */
    distribuidos: number;
    ativos: number;
    /** Encerrados hoje — estoque, e não fluxo do período. */
    encerrados: number;
    /** Ativos ainda sem data de distribuição no CNJ: ficam fora de "ajuizadas". */
    semDataDeDistribuicao?: number;
    porArea: Contagem[];
    porTribunal: Contagem[];
  };
  atendimentos: {
    registrados: number;
    concluidos: number;
    /** Pessoas diferentes atendidas. */
    filiadosAtendidos?: number;
    porCanal: Contagem[];
    porAtendente: Contagem[];
    /** Sobre o que o filiado procurou — ver `ASSUNTO_LABEL`. */
    porAssunto: Contagem[];
    /** Quantos ficaram sem assunto: sem este número, 3 de 3 viram "100%". */
    assuntoNaoInformado: number;
    /**
     * O que há dentro de "Outro": só os textos que se repetem (2 ou mais),
     * agrupados sem acento nem caixa. Opcional pela janela de troca do deploy.
     */
    outrosAssuntos?: TextoRepetido[];
    /** Quantos textos de "Outro" apareceram uma vez só — viram número, nunca texto. */
    outrosUnicos?: number;
    porSetor: Contagem[];
  };
  justica?: Justica | null;
  proximos?: Proximos | null;
  publicacoes?: Publicacoes | null;
  robo?: Robo | null;
  geradoEm: string;
}

export async function carregarRelatorio(
  de: string,
  ate: string,
  usuarioId?: string,
): Promise<Relatorio> {
  return (
    await api.get<Relatorio>('/relatorios', {
      params: { de, ate, ...(usuarioId ? { usuarioId } : {}) },
    })
  ).data;
}

/**
 * A PLANILHA CONTINUA, ao lado do PDF: quem pede número quer somar e cruzar, e
 * PDF obriga a redigitar. O PDF é o documento; a planilha é a matéria-prima.
 */
export async function baixarCsvDaEquipe(
  de: string,
  ate: string,
  usuarioId?: string,
): Promise<void> {
  const foco = usuarioId ? `&usuarioId=${usuarioId}` : '';
  await baixarArquivo(
    `/relatorios/equipe.csv?de=${de}&ate=${ate}${foco}`,
    `relatorio-da-equipe-${de}-a-${ate}.csv`,
  );
}

/**
 * SOBRE O QUE O FILIADO PROCUROU.
 *
 * A lista é fechada porque assunto em texto livre vira sinônimo
 * ("insalubridade", "adicional de insalubridade", "INSALUB") e nenhum relatório
 * consegue somar. Os rótulos são os que a equipe usa falando, não os do enum.
 */
export const ASSUNTO_LABEL: Record<string, string> = {
  ANDAMENTO_PROCESSO: 'Andamento de processo',
  DUVIDA_TRABALHISTA: 'Dúvida trabalhista',
  REMUNERACAO: 'Remuneração e atrasados',
  PROGRESSAO_NIVEL: 'Progressão / mudança de nível',
  ADICIONAIS: 'Adicionais (insalubridade, noturno)',
  JORNADA_ESCALA: 'Jornada e escala',
  ASSEDIO_RETALIACAO: 'Assédio ou retaliação',
  CONTRATO_VINCULO: 'Contrato e vínculo',
  FERIAS_LICENCAS: 'Férias e licenças',
  BENEFICIOS_SINDICAIS: 'Benefícios do sindicato',
  FINANCEIRO_SINDICAL: 'Mensalidade e contribuição',
  OUTRO: 'Outro',
};

export const ASSUNTOS = Object.keys(ASSUNTO_LABEL);

/** Quantos textos de "Outro" a frase nomeia antes de resumir o resto. */
export const OUTROS_NA_FRASE = 6;

/**
 * "EM «OUTRO»: APOSENTADORIA (4), PLANO DE SAÚDE (2); 3 COM TEXTO ÚNICO."
 *
 * É o que mostra QUAL categoria falta — "Outro: 9" sozinho não deixa ninguém
 * decidir se vale criar "Aposentadoria". Só entra com nome o que se repete
 * (a API já corta): texto único num PDF da diretoria pode identificar alguém.
 * Nulo quando não há o que dizer — inclusive diante da API de antes.
 */
export function fraseDosOutrosAssuntos(
  outros: TextoRepetido[] | undefined,
  unicos: number | undefined,
): string | null {
  const lista = outros ?? [];
  const nomeados = lista.slice(0, OUTROS_NA_FRASE).map((o) => `${o.texto} (${o.total})`);
  const resto = lista.length - nomeados.length;
  if (resto > 0) nomeados.push(`mais ${resto} ${resto === 1 ? 'texto repetido' : 'textos repetidos'}`);
  const partes: string[] = [];
  if (nomeados.length) partes.push(nomeados.join(', '));
  if (unicos && unicos > 0) partes.push(`${unicos} com texto único`);
  return partes.length ? `Em “Outro”: ${partes.join('; ')}.` : null;
}

/**
 * LISTA DE PESSOAS EM ORDEM ALFABÉTICA. A API ordena as contagens pelo volume,
 * e numa lista de atendentes isso é pódio. Coisa (canal, assunto) continua pelo
 * volume; gente, não.
 */
export function emOrdemAlfabetica<T extends Contagem>(itens: T[]): T[] {
  return [...itens].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/*
  O TIPO DE ATIVIDADE É CADASTRÁVEL — não existe lista fixa aqui de propósito.
  `compromissos.tipo` guarda o SLUG de `tipos_evento`, que a administração
  edita; um mapa chumbado neste arquivo mostraria "PERICIA" para um tipo que
  alguém renomeou e esconderia os que forem criados. A tela usa `rotuloTipo`
  de `@/lib/agenda`, alimentado por `listarTiposEvento`.
*/

/** "1h20" em vez de "80 min" — ninguém pensa a própria tarde em minutos. */
export function duracao(minutos: number | null): string {
  if (minutos == null) return '—';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** AAAA-MM-DD no fuso local, que é o que o `<input type="date">` fala. */
export function comoData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** "2026-09-12" → "12/09/2026", sem passar por `Date` (e sem o dia andar para trás). */
export function dataDoInput(valor: string): string {
  const [ano, mes, dia] = valor.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

/**
 * OS PERÍODOS QUE REALMENTE SE PEDEM.
 *
 * Sete, trinta e noventa dias para o dia a dia; "este ano" para a prestação de
 * contas — é o recorte da assembleia, e digitar 01/01 toda vez é o atrito que
 * faz um relatório não ser usado. Trimestre não entrou: quem precisa dele muda
 * as duas datas.
 */
export const ATALHOS: { rotulo: string; inicio: (hoje: Date) => Date }[] = [
  { rotulo: '7 dias', inicio: (hoje) => new Date(hoje.getTime() - 7 * 86_400_000) },
  { rotulo: '30 dias', inicio: (hoje) => new Date(hoje.getTime() - 30 * 86_400_000) },
  { rotulo: '90 dias', inicio: (hoje) => new Date(hoje.getTime() - 90 * 86_400_000) },
  { rotulo: 'Este ano', inicio: (hoje) => new Date(hoje.getFullYear(), 0, 1) },
];

export const RESULTADO_LABEL: Record<ResultadoSentenca, string> = {
  PROCEDENTE: 'Procedente',
  PARCIAL: 'Procedente em parte',
  IMPROCEDENTE: 'Improcedente',
};

export function totalDoAno(a: SentencasDoAno): number {
  return a.procedentes + a.parciais + a.improcedentes;
}

/**
 * A FRASE DO ANO — a que a diretoria repete na assembleia.
 *
 * "A favor" é procedente por inteiro OU em parte, e a frase diz quantas de cada
 * uma: juntar sem mostrar inflaria a vitória, e separar sem somar esconderia
 * que a procedência parcial também é ganho. O ano é o último FECHADO com
 * sentença — o corrente está pela metade e não se compara com um ano inteiro.
 */
export function fraseDasSentencas(serie: SentencasDoAno[], anoCorrente: number): string | null {
  const fechados = serie.filter((a) => a.ano < anoCorrente && totalDoAno(a) > 0);
  const ano = fechados[fechados.length - 1];
  if (!ano) return null;
  const total = totalDoAno(ano);
  const aFavor = ano.procedentes + ano.parciais;
  const sentencas = total === 1 ? 'sentença foi' : 'sentenças foram';
  return (
    `Em ${ano.ano}, ${aFavor} de ${total} ${sentencas} a favor, ao menos em parte ` +
    `(${ano.procedentes} por inteiro e ${ano.parciais} em parte).`
  );
}

/** "qua., 16/09" — o dia da semana decide se cabe na agenda de alguém. */
export function diaCurto(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Fortaleza',
  });
}

export function horaDoItem(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza',
  });
}

export function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Fortaleza',
  });
}

/**
 * OS LINKS DAS LISTAS DO ACERVO LEVAM `status=ATIVO` — o recorte que elas contam.
 *
 * Sem ele a listagem traz também os encerrados, e o "7" do relatório vira "9"
 * na chegada. Atalho que muda o número ao ser clicado é pior que atalho nenhum.
 */
export function hrefDaComarca(c: ContagemComChave): string {
  return `/processos?comarca=${c.chave}&comarcaNome=${encodeURIComponent(c.rotulo)}&status=ATIVO`;
}

export function hrefDaParteContraria(c: ContagemComChave): string {
  return `/processos?parteExternaId=${c.chave}&status=ATIVO`;
}

export function hrefDoAssunto(c: Contagem): string {
  return `/processos?assunto=${encodeURIComponent(c.rotulo)}&status=ATIVO`;
}
