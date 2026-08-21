/**
 * ÁREA JURÍDICA do caso — a `categoria` do processo.
 *
 * POR QUE ELA PRECISA EXISTIR
 * -----------------------------------------------------------------------
 * Enquanto o caso é PRÉ-PROCESSUAL ele não tem NPU e, portanto, não tem classe
 * nem assunto do CNJ. Na lista, ele aparecia como uma linha sem classificação
 * nenhuma — dava para ver o nome do filiado e nada mais. A área é justamente o
 * que a equipe sabe desde o primeiro minuto do atendimento, muito antes de
 * qualquer distribuição.
 *
 * Depois do ajuizamento ela NÃO vira redundante: a classe do CNJ é a
 * nomenclatura do tribunal ("Ação Trabalhista - Rito Ordinário"), enquanto a
 * área é como o sindicato organiza o próprio trabalho e distribui carteira.
 *
 * POR QUE TEXTO VALIDADO, E NÃO ENUM NEM TABELA
 * -----------------------------------------------------------------------
 * Mesma escolha de `Compromisso.tipo` e dos desfechos, e pelo mesmo motivo: a
 * lista muda com o uso, e um enum exigiria migração a cada ajuste. Mas, ao
 * contrário de `etiquetas`, aqui o valor é CONFERIDO na entrada — é o que
 * mantém o campo filtrável e contável. Foi exatamente a falta dessa conferência
 * que estragou a etiqueta "Urgente", que convivia em quatro grafias.
 *
 * Uma tabela cadastrável (como `tipos_evento`) foi considerada e descartada:
 * são ~8 linhas quase fixas, e um CRUD inteiro — menu, permissão, tela — para
 * mantê-las é a mesma desproporção já documentada em `sindserm.ts` sobre os 36
 * órgãos da Prefeitura.
 */

export interface AreaJuridica {
  slug: string;
  nome: string;
  /** Chave de paleta usada pela tela (mesmo vocabulário de `TipoCompromisso.cor`). */
  cor: string;
  ajuda: string;
}

/**
 * A ordem é a de frequência esperada num sindicato — a primeira opção é a que
 * a tela pré-seleciona.
 *
 * TRABALHISTA e PREVIDENCIARIO cobrem a maioria em qualquer um dos dois
 * clientes; ADMINISTRATIVO é o que mais aparece no SINDSERM (servidor
 * estatutário não tem reclamação trabalhista, tem processo administrativo); e
 * ETICO_DISCIPLINAR existe por causa do SENATEPI, onde o COREN instaura
 * processo ético contra o profissional de enfermagem e o sindicato defende.
 */
export const AREAS_JURIDICAS: AreaJuridica[] = [
  {
    slug: 'TRABALHISTA',
    nome: 'Trabalhista',
    cor: 'amber',
    ajuda: 'Verbas, vínculo, insalubridade, horas extras, rescisão.',
  },
  {
    slug: 'PREVIDENCIARIO',
    nome: 'Previdenciário',
    cor: 'violet',
    ajuda: 'Aposentadoria, auxílio-doença, revisão de benefício.',
  },
  {
    slug: 'ADMINISTRATIVO',
    nome: 'Administrativo',
    cor: 'sky',
    ajuda: 'Servidor estatutário: progressão, sindicância, gratificação.',
  },
  {
    slug: 'CIVEL',
    nome: 'Cível',
    cor: 'teal',
    ajuda: 'Indenização, cobrança, obrigação de fazer.',
  },
  {
    slug: 'ETICO_DISCIPLINAR',
    nome: 'Ético-disciplinar',
    cor: 'rose',
    ajuda: 'Processo no conselho de classe (COREN e afins).',
  },
  {
    slug: 'SINDICAL_COLETIVO',
    nome: 'Sindical / Coletivo',
    cor: 'emerald',
    ajuda: 'Dissídio, acordo coletivo, ação em nome da categoria.',
  },
  {
    slug: 'CRIMINAL',
    nome: 'Criminal',
    cor: 'red',
    ajuda: 'Defesa criminal ligada ao exercício profissional.',
  },
  {
    slug: 'CONSUMIDOR',
    nome: 'Consumidor',
    cor: 'indigo',
    ajuda: 'Plano de saúde, banco, telefonia.',
  },
  {
    slug: 'OUTRA',
    nome: 'Outra',
    cor: 'slate',
    ajuda: 'Não se encaixa nas demais — use o título para descrever.',
  },
];

export const AREA_LABEL: Record<string, string> = AREAS_JURIDICAS.reduce(
  (acc, a) => ({ ...acc, [a.slug]: a.nome }),
  {} as Record<string, string>,
);

/**
 * Normaliza e valida. Devolve `null` para vazio (a categoria é opcional) e
 * LANÇA para valor desconhecido.
 *
 * Falhar em vez de aceitar é o ponto: aceitar em silêncio é como "Urgente"
 * virou quatro etiquetas diferentes. O erro é barato — a tela só oferece a
 * lista —, e quem chegar por API recebe as opções na mensagem.
 */
export function normalizarCategoria(valor?: string | null): string | null {
  const bruto = (valor ?? '').trim();
  if (!bruto) return null;
  const alvo = bruto.toUpperCase().replace(/[\s-]+/g, '_');
  const achada = AREAS_JURIDICAS.find((a) => a.slug === alvo);
  if (achada) return achada.slug;
  throw new Error(
    `Categoria "${bruto}" não existe. Opções: ${AREAS_JURIDICAS.map((a) => a.slug).join(', ')}.`,
  );
}

export const categoriaValida = (slug?: string | null): boolean =>
  !slug || AREAS_JURIDICAS.some((a) => a.slug === slug);
