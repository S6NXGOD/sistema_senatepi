import { FormacaoProfissional, SituacaoFiliado } from '@prisma/client';

/**
 * O QUE VAI ESCRITO NO CARTÃO — e por que não é o enum.
 *
 * O cartão imprimia `filiado.formacao` e `filiado.situacao` crus:
 * "TECNICO_ENFERMAGEM" e "ATIVO" em caixa alta com underline, num documento
 * que a pessoa carrega na carteira e mostra no balcão. É o mesmo defeito do
 * dossiê do processo, no papel de outra gente.
 *
 * Os textos são OS MESMOS da tela (`apps/web/src/lib/filiados.ts`): quem
 * confere o cartão contra o sistema tem de ler a mesma palavra nos dois.
 */
export const ROTULO_FORMACAO: Record<FormacaoProfissional, string> = {
  ENFERMEIRO: 'Enfermeiro(a)',
  TECNICO_ENFERMAGEM: 'Técnico(a) em Enfermagem',
  AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem',
  OUTRO: 'Outro',
};

export const ROTULO_SITUACAO_FILIADO: Record<SituacaoFiliado, string> = {
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  DESFILIADO: 'Desfiliado',
};

/**
 * A categoria como ela deve sair impressa.
 *
 * `OUTRO` existe justamente porque a lista não cobre todo mundo, e o texto
 * livre que a pessoa escreveu vale mais no cartão do que a palavra "Outro".
 */
export function categoriaDoCartao(
  formacao: FormacaoProfissional | null,
  formacaoOutro: string | null,
): string {
  const livre = formacaoOutro?.trim();
  if (formacao === 'OUTRO' && livre) return livre;
  if (!formacao) return livre || '—';
  return ROTULO_FORMACAO[formacao];
}

/** Partículas que não entram no monograma: "IVO RAMOS DOS SANTOS" é I.S., não I.D. */
const PARTICULAS = new Set(['da', 'de', 'di', 'do', 'das', 'dos', 'e', 'del', 'van', 'von']);

/**
 * AS INICIAIS, PARA QUANDO NÃO HÁ FOTO — que é o caso de quase todo mundo.
 *
 * MEDIDO: **1 de 5.810** filiados ativos tem foto. O desenho antigo reservava
 * 110x132pt (um terço do cartão) e, sem foto, pintava um RETÂNGULO CINZA ali.
 * Cinco mil e oitocentos cartões com um buraco cinza no meio.
 *
 * O monograma ocupa o mesmo lugar, parece intencional, e vira foto de verdade
 * no dia em que alguém subir uma.
 */
export function iniciaisDoNome(nome: string): string {
  const partes = nome
    .trim()
    .split(/\s+/)
    .filter((p) => p && !PARTICULAS.has(p.toLowerCase()));
  if (!partes.length) return '?';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}

/**
 * O primeiro e o último nome, para o cartão não estourar a linha.
 *
 * Nomes de quatro e cinco partes são a regra ("MARIA DAS GRAÇAS PEREIRA DOS
 * SANTOS"); o cartão tem 330pt de largura útil. Encolher a fonte até caber
 * deixa o nome menor do que a matrícula — o contrário do que um documento de
 * identificação quer dizer. Só encurta quando o nome inteiro NÃO couber.
 */
export function nomeParaCartao(nome: string, cabe: (texto: string) => boolean): string {
  const limpo = nome.trim().replace(/\s+/g, ' ');
  if (cabe(limpo)) return limpo;

  const partes = limpo.split(' ');
  if (partes.length < 3) return limpo;

  // Primeiro + último: o que as pessoas usam para se apresentar.
  const curto = `${partes[0]} ${partes[partes.length - 1]}`;
  return cabe(curto) ? curto : limpo;
}
