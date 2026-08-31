/**
 * RECONHECE UM ENTE PÚBLICO PELO NOME.
 *
 * Por que existe
 * -------------
 * Na produção de 31/08/2026, DEZOITO partes eram entes públicos cadastrados
 * como pessoa jurídica comum: "ESTADO DO PIAUI", "MUNICÍPIO DE PARNAIBA-PI",
 * "MUN. DE ALTO LONGÁ", "UNIÃO FEDERAL". Nenhuma delas é empresa, e a diferença
 * não é cosmética:
 *
 *  • a área jurídica do processo depende disso — contra o poder público o
 *    sindicato defende SERVIDOR ESTATUTÁRIO (matéria administrativa), contra
 *    empresa defende EMPREGADO CELETISTA (matéria trabalhista);
 *  • "quantas ações temos contra municípios?" é pergunta de reunião de
 *    diretoria, e a resposta vinha errada;
 *  • ente público não tem razão social a conferir na Receita nem CNPJ que o
 *    jurídico precise caçar — deixá-los na fila de "sem CNPJ" enche a fila de
 *    trabalho que não existe.
 *
 * Por que por NOME, e não por CNPJ
 * --------------------------------
 * Porque o CNPJ é justamente o que falta. E porque, aqui, o nome basta: os
 * prefixos abaixo são formas de designação oficial de ente federativo, não
 * palavras que uma empresa use por acaso. Uma clínica não se chama "MUNICÍPIO
 * DE".
 *
 * O que ela deliberadamente NÃO tenta adivinhar
 * ---------------------------------------------
 * Hospital, maternidade, instituto e fundação SEM o qualificador de ente
 * ("municipal", "estadual") ficam de fora. "HOSPITAL SÃO PAULO" é privado;
 * "HOSPITAL GETÚLIO VARGAS" é estadual — e nada no nome distingue os dois. Um
 * palpite ali trocaria a área jurídica de processos inteiros, e é exatamente o
 * tipo de erro que ninguém percebe porque o rótulo continua plausível.
 */

/**
 * Designações que só um ente federativo usa.
 *
 * Ancoradas no INÍCIO do nome de propósito: "SINDICATO DOS SERVIDORES DO
 * MUNICÍPIO DE X" contém "MUNICÍPIO DE" e é uma associação privada.
 */
const PREFIXOS_PUBLICOS = [
  /^MUNICIPIO\b/,
  /^MUNICIPALIDADE\b/,
  /^MUN\.\s/,
  /^PREFEITURA\b/,
  /^ESTADO D[OEA]\b/,
  /^UNIAO FEDERAL\b/,
  /^UNIAO\b/,
  /^DISTRITO FEDERAL\b/,
  /^SECRETARIA (DE|DO|DA|MUNICIPAL|ESTADUAL)\b/,
  /^FUNDACAO (MUNICIPAL|ESTADUAL|PUBLICA)\b/,
  /^AUTARQUIA\b/,
  /^INSTITUTO NACIONAL\b/,
  /^AGENCIA NACIONAL\b/,
  /^GOVERNO D[OEA]\b/,
  /^CAMARA MUNICIPAL\b/,
  /^ASSEMBLEIA LEGISLATIVA\b/,
];

function normalizar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** O nome designa um ente público de forma inequívoca? */
export function pareceOrgaoPublico(nome: string | null | undefined): boolean {
  const n = normalizar(nome ?? '');
  if (!n) return false;
  return PREFIXOS_PUBLICOS.some((re) => re.test(n));
}

/**
 * O tipo que a parte deve ter, dado o nome e o documento.
 *
 * Devolve `null` quando não há motivo para mudar o que já está lá — quem chama
 * não deve reclassificar por reclassificar.
 */
export function tipoCorrigido(
  nome: string,
  tipoAtual: 'FISICA' | 'JURIDICA' | 'ORGAO_PUBLICO',
): 'ORGAO_PUBLICO' | null {
  if (tipoAtual === 'ORGAO_PUBLICO') return null;
  // Nunca promove PESSOA FÍSICA: um homônimo de topônimo ("Maria do Município")
  // é improvável, mas o estrago de transformar gente em órgão é grande.
  if (tipoAtual === 'FISICA') return null;
  return pareceOrgaoPublico(nome) ? 'ORGAO_PUBLICO' : null;
}
