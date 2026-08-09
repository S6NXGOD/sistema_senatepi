/**
 * O QUE NÃO PODE MORAR NUM ARQUIVO DE AMBIENTE GENÉRICO.
 *
 * O DEFEITO QUE ISTO IMPEDE, e que aconteceu de verdade.
 *
 * O `.env.local` do desenvolvedor tinha, com o nome de um cliente dentro:
 *
 *     NEXT_PUBLIC_API_URL="http://localhost:3333/api"   ← a API do SENATEPI
 *     NEXT_PUBLIC_TENANT=senatepi
 *
 * O Next lê esse arquivo em QUALQUER build. Um `next build` do SINDSERM que não
 * passasse a URL explicitamente tinha a lacuna preenchida pelo `.env.local` — e
 * compilava o front do SINDSERM apontando para a API do SENATEPI. O sintoma foi
 * "Network Error" numa tela azul do SINDSERM, e levou uma investigação inteira
 * para descobrir que a causa era um arquivo de configuração local.
 *
 * É a MESMA doença que este projeto passou semanas extirpando do código —
 * recurso identificado por nome fixo de um cliente —, só que morando no
 * ambiente de desenvolvimento, onde nenhum teste de conformidade olhava.
 *
 * A REGRA, E POR QUE ELA É ABSOLUTA
 *
 * Num repositório que serve vários sindicatos, estas duas chaves são SEMPRE
 * específicas de um cliente. Não existe valor delas que sirva para todos:
 * `NEXT_PUBLIC_TENANT` É a identidade da instalação, e `NEXT_PUBLIC_API_URL`
 * aponta para a API de UM sindicato, com o banco de UM sindicato atrás.
 *
 * Logo, elas nunca podem vir de um arquivo de nome genérico. Devem morar em
 * `.env.<cliente>`, que só é lido quando aquele cliente é o alvo.
 *
 * A regra é a PRESENÇA, e não a divergência de valor. A primeira versão desta
 * trava só reprovava quando o `.env.local` declarava um cliente DIFERENTE do
 * que estava sendo construído. Ela teria pego o caso acima — mas deixaria
 * passar um `.env.local` sem `NEXT_PUBLIC_TENANT` e com apenas a
 * `NEXT_PUBLIC_API_URL` do SENATEPI: o SINDSERM compilaria falando com a API
 * errada e nada acusaria. Proibir a presença fecha os dois de uma vez, e é uma
 * regra que se explica numa frase.
 */

/** As chaves que identificam UM cliente e por isso não podem ser genéricas. */
export const CHAVES_DO_CLIENTE = ['NEXT_PUBLIC_TENANT', 'NEXT_PUBLIC_API_URL'] as const;

/**
 * Quais dessas chaves o arquivo declara, na ordem em que aparecem.
 *
 * Comentário não conta: uma linha começando com `#` é documentação, e é comum
 * deixar o exemplo comentado ao lado da variável de verdade. Reprovar por causa
 * de um exemplo ensinaria a apagar o comentário, não a arrumar a configuração.
 */
export function chavesDoClienteEm(conteudo: string): string[] {
  const achadas: string[] = [];
  for (const linha of (conteudo ?? '').split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    // `export FOO=` é aceito por dotenv e apareceria igual num `.env`.
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(limpa);
    if (!m) continue;
    const chave = m[1];
    if ((CHAVES_DO_CLIENTE as readonly string[]).includes(chave) && !achadas.includes(chave)) {
      achadas.push(chave);
    }
  }
  return achadas;
}

/**
 * A mensagem que o build imprime antes de morrer — ou `null` se está tudo bem.
 *
 * Ela diz QUAL arquivo, QUAIS chaves e PARA ONDE mover. Uma trava que só diz
 * "configuração inválida" transfere o problema para quem foi barrado; o resto
 * deste projeto falha dizendo a causa na primeira linha, e aqui não é diferente.
 *
 * `tenant` vazio = `next build` avulso, sem cliente declarado. Aí o `distDir` é
 * o `.next` neutro e não há cliente para contaminar — não se reprova nada.
 */
export function conferirEnvLocal(
  conteudo: string | null,
  tenant: string,
  arquivo = 'apps/web/.env.local',
): string | null {
  if (!tenant || conteudo === null) return null;

  const proibidas = chavesDoClienteEm(conteudo);
  if (proibidas.length === 0) return null;

  return [
    `${arquivo} declara ${proibidas.join(' e ')}, e o build é do cliente "${tenant}".`,
    '',
    'Essas chaves identificam UM sindicato: NEXT_PUBLIC_TENANT é a identidade da',
    'instalação e NEXT_PUBLIC_API_URL aponta para a API de um cliente, com o banco',
    'dele atrás. Num arquivo de nome genérico elas viram padrão para TODOS os',
    'clientes — foi assim que um build do SINDSERM saiu falando com a API do',
    'SENATEPI, e o sintoma foi "Network Error" numa tela que parecia certa.',
    '',
    `Mova essas linhas de ${arquivo} para apps/web/.env.<cliente>`,
    `(por exemplo apps/web/.env.${tenant}), que só é lido quando o alvo é ele.`,
    'O que sobrar em .env.local deve valer para qualquer sindicato.',
  ].join('\n');
}
