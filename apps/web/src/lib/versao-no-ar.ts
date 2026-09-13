/**
 * A TELA ABERTA É A VERSÃO QUE ESTÁ NO AR?
 *
 * Regra pura do aviso de versão nova (`components/avisos/nova-versao.tsx`).
 * Mora aqui, fora do componente, por dois motivos: dá para testar com valores,
 * e o `next.config.ts` importa `versaoCurta` para carimbar o build — por isso
 * este arquivo NÃO importa nada (o config roda fora do Next, sem o alias `@/`).
 *
 * DE ONDE VEM CADA LADO
 *  - `doBuild`: o SHA embutido no JavaScript na hora do build
 *    (`process.env.VERSAO_DO_BUILD`, definido no `next.config.ts`). É o código
 *    que está rodando NESTA aba, e não muda enquanto ela viver.
 *  - `noAr`: o que o `/versao` da própria web responde agora. Muda quando o
 *    contêiner novo da web entra.
 *
 * POR QUE NÃO O `/api/health`
 * Web e API sobem do mesmo push, sem ordem garantida. Vigiando a API, o aviso
 * aparecia antes de a web nova existir (a recarga entregava a tela velha) e
 * depois calava para sempre, porque a base já era o SHA novo da API.
 */

/** O que `/versao` e o build respondem fora do Railway. Não é versão: é "não sei". */
export const VERSAO_DE_DESENVOLVIMENTO = 'dev';

/**
 * O SHA curto, do mesmo jeito que `app/versao/route.ts` monta a resposta
 * (`?? 'dev'` e 7 caracteres). Usado pelo `next.config.ts` para carimbar o build:
 * se os dois lados cortassem diferente, nunca seriam iguais e toda aba se
 * acharia velha.
 */
export function versaoCurta(sha: string | null | undefined): string {
  return (sha ?? VERSAO_DE_DESENVOLVIMENTO).slice(0, 7);
}

/**
 * Uma versão com que dá para decidir alguma coisa — ou `null`.
 * Vazio, 'dev', não-texto ou qualquer coisa que não pareça um SHA (uma página de
 * erro do proxy, por exemplo) valem como "não sei", e "não sei" nunca avisa.
 */
export function versaoUtil(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t === VERSAO_DE_DESENVOLVIMENTO) return null;
  return /^[0-9a-z]{1,40}$/i.test(t) ? t : null;
}

/** Lê `{ versao }` do corpo do `/versao`. Qualquer outro formato é "não sei". */
export function lerVersao(corpo: unknown): string | null {
  if (!corpo || typeof corpo !== 'object') return null;
  return versaoUtil((corpo as { versao?: unknown }).versao);
}

/**
 * A referência desta aba.
 *
 * O normal é o SHA do build. Se ele não veio (o Railway não expôs a variável na
 * hora do build, ou é um build local), a primeira resposta útil do `/versao`
 * vira a base — pior (uma aba aberta na janela de troca nasce "nova" e não é
 * avisada), mas melhor do que um aviso mudo para sempre.
 */
export function baseDaAba(doBuild: string | null | undefined, primeiraNoAr: string | null | undefined): string | null {
  return versaoUtil(doBuild) ?? versaoUtil(primeiraNoAr);
}

export type DecisaoDeVersao = 'nada' | 'oferecer' | 'recarregar';

export interface SituacaoDaVersao {
  /** A base desta aba (ver `baseDaAba`). */
  doBuild: string | null | undefined;
  /** A última resposta útil do `/versao`; `null` antes da primeira ou se falhou. */
  noAr: string | null | undefined;
  /** A pessoa acabou de ir para OUTRA tela (caminho diferente, não só a query). */
  trocouDeTela: boolean;
  /**
   * A versão para a qual esta aba JÁ recarregou sozinha. Se, depois de recarregar,
   * o servidor ainda entrega o código antigo (duas instâncias na troca, cache no
   * meio do caminho), recarregar de novo a cada clique viraria um laço: a partir
   * daí só se oferece.
   */
  jaRecarregouPara?: string | null;
}

/**
 * - 'nada': um dos lados não é versão, ou são iguais.
 * - 'recarregar': há versão nova e a pessoa acabou de trocar de tela — a tela de
 *   destino remonta com o código novo e nada do que ela está digitando se perde,
 *   porque o formulário anterior já foi deixado para trás.
 * - 'oferecer': há versão nova e ela continua na mesma tela (ou já recarregamos
 *   uma vez para essa versão): o aviso aparece, e quem decide é ela.
 *
 * Nunca recarrega por voltar à aba ou por um intervalo: quem saiu para copiar um
 * CPF perderia o formulário.
 */
export function decidirAtualizacao({ doBuild, noAr, trocouDeTela, jaRecarregouPara }: SituacaoDaVersao): DecisaoDeVersao {
  const daAba = versaoUtil(doBuild);
  const doServidor = versaoUtil(noAr);
  if (!daAba || !doServidor || daAba === doServidor) return 'nada';
  if (trocouDeTela && versaoUtil(jaRecarregouPara) !== doServidor) return 'recarregar';
  return 'oferecer';
}

/**
 * O cartão aparece quando há o que oferecer e a pessoa não dispensou ESTA versão.
 * "Agora não" vale só para o SHA dispensado: a versão seguinte avisa de novo —
 * quem passa o dia no balcão numa tela só merece saber da próxima.
 */
export function mostrarAviso({
  decisao,
  noAr,
  dispensadaVersao,
}: {
  decisao: DecisaoDeVersao;
  noAr: string | null | undefined;
  dispensadaVersao: string | null | undefined;
}): boolean {
  if (decisao !== 'oferecer') return false;
  const doServidor = versaoUtil(noAr);
  return doServidor !== null && doServidor !== versaoUtil(dispensadaVersao);
}

/** Só o caminho: sem query, sem âncora, sem a barra do fim (menos na raiz). */
export function caminhoDe(url: string): string {
  const semResto = url.split(/[?#]/, 1)[0] || '/';
  return semResto.length > 1 ? semResto.replace(/\/+$/, '') || '/' : semResto;
}

/**
 * Trocar de tela é mudar o CAMINHO. Abrir uma gaveta por `?compromisso=` ou
 * filtrar por `?aba=` não é: o `useAbrirPorUrl` troca a query da mesma tela, e
 * recarregar ali fecharia o que a pessoa acabou de abrir.
 */
export function trocouDeTela(anterior: string | null | undefined, atual: string | null | undefined): boolean {
  if (anterior == null || atual == null) return false;
  return caminhoDe(anterior) !== caminhoDe(atual);
}
