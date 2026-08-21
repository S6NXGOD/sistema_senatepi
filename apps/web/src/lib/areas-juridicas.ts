/**
 * ÁREAS JURÍDICAS — o espelho de `areas.catalogo.ts` da API.
 *
 * São dois arquivos pelo mesmo motivo dos tenants: o Next.js não importa de
 * dentro da API. O que garante que os dois concordem não é o compilador — é a
 * CI construindo os dois apps no mesmo push, e o fato de a API RECUSAR
 * categoria que não esteja no catálogo dela. Uma divergência aqui vira erro de
 * validação na hora, e não dado errado gravado em silêncio.
 *
 * A ordem é a mesma da API: a primeira é a que a tela pré-seleciona.
 */

export interface AreaJuridica {
  slug: string;
  nome: string;
  /** Chave de paleta — mesmo vocabulário das cores de tipo de atividade. */
  cor: string;
  ajuda: string;
}

export const AREAS_JURIDICAS: AreaJuridica[] = [
  { slug: 'TRABALHISTA', nome: 'Trabalhista', cor: 'amber', ajuda: 'Verbas, vínculo, insalubridade, horas extras, rescisão.' },
  { slug: 'PREVIDENCIARIO', nome: 'Previdenciário', cor: 'violet', ajuda: 'Aposentadoria, auxílio-doença, revisão de benefício.' },
  { slug: 'ADMINISTRATIVO', nome: 'Administrativo', cor: 'sky', ajuda: 'Servidor estatutário: progressão, sindicância, gratificação.' },
  { slug: 'CIVEL', nome: 'Cível', cor: 'teal', ajuda: 'Indenização, cobrança, obrigação de fazer.' },
  { slug: 'ETICO_DISCIPLINAR', nome: 'Ético-disciplinar', cor: 'rose', ajuda: 'Processo no conselho de classe (COREN e afins).' },
  { slug: 'SINDICAL_COLETIVO', nome: 'Sindical / Coletivo', cor: 'emerald', ajuda: 'Dissídio, acordo coletivo, ação em nome da categoria.' },
  { slug: 'CRIMINAL', nome: 'Criminal', cor: 'red', ajuda: 'Defesa criminal ligada ao exercício profissional.' },
  { slug: 'CONSUMIDOR', nome: 'Consumidor', cor: 'indigo', ajuda: 'Plano de saúde, banco, telefonia.' },
  { slug: 'OUTRA', nome: 'Outra', cor: 'slate', ajuda: 'Não se encaixa nas demais — use o título para descrever.' },
];

export const AREA_LABEL: Record<string, string> = AREAS_JURIDICAS.reduce(
  (acc, a) => ({ ...acc, [a.slug]: a.nome }),
  {} as Record<string, string>,
);

/** Classes do chip por área — cor de fundo suave com texto legível nos dois temas. */
export const AREA_COR: Record<string, string> = {
  TRABALHISTA: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  PREVIDENCIARIO: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  ADMINISTRATIVO: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  CIVEL: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  ETICO_DISCIPLINAR: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  SINDICAL_COLETIVO: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  CRIMINAL: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  CONSUMIDOR: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  OUTRA: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
