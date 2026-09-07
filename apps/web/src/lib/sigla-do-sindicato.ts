/**
 * A SIGLA DO SINDICATO DENTRO DO NOME QUE O TRIBUNAL ESCREVEU.
 *
 * O Diário nomeia o cliente por extenso e do jeito dele: "SINDICATO DOS
 * ENFERMEIROS, AUXILIARES E TÉCNICOS EM ENFERMAGEM DO ESTADO DO PIAUÍ -
 * SENATEPI". O cadastro tem outra redação ("...E TÉCNICOS DE ENFERMAGEM..."),
 * então comparar nome inteiro com nome inteiro erra em todas. O que sobrevive à
 * variação é a SIGLA, e a pergunta certa é se ela aparece como PALAVRA.
 *
 * POR QUE ESTE ARQUIVO EXISTE, EM VEZ DE UMA FUNÇÃO SOLTA NO DIÁLOGO
 * Havia duas `normalizarNome` no projeto, com o mesmo nome e semânticas opostas:
 * a de `editor-de-partes` REMOVE pontuação e espaço (certo para comparar dois
 * nomes inteiros, que é o trabalho dela), e a do servidor
 * (`acao-nossa.util.ts`) troca por ESPAÇO. Importei a errada e o SENATEPI passou
 * a entrar como parte AVULSA em vez de institucional: colado, o nome vira
 * "SINDICATODOS…PIAUISENATEPI", `split(' ')` devolve UM elemento e a sigla nunca
 * casa. O bug foi para produção porque o teste que existia afirmava o TEXTO da
 * chamada, não o RESULTADO dela — passava com o código quebrado.
 *
 * Aqui a regra tem casa, nome que não colide e teste de comportamento. Ela é o
 * espelho de `nossoPoloNoAto` no servidor; as duas precisam concordar, e é por
 * isso que os exemplos do spec são publicações reais do acervo.
 */

/** Sem acento, maiúsculo, pontuação virando ESPAÇO — nunca sumindo. */
export function palavrasDoNome(nome: string): string[] {
  return (nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * A sigla aparece como palavra inteira neste nome?
 *
 * PALAVRA INTEIRA, e não trecho: "PROSENATEPINHO LTDA" contém as letras da
 * sigla e não é o sindicato. Sigla com menos de 4 caracteres é recusada pelo
 * mesmo motivo — casaria dentro de qualquer razão social. Mesma trava do
 * servidor.
 */
export function ehOSindicato(nome: string, sigla: string): boolean {
  const alvo = palavrasDoNome(sigla).join('');
  if (alvo.length < 4) return false;
  return palavrasDoNome(nome).includes(alvo);
}
