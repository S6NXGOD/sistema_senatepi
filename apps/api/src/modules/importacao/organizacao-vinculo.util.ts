/**
 * LIGAR O VÍNCULO AO ÓRGÃO CADASTRADO, em vez de guardar só o nome dele.
 *
 * O DEFEITO. `vinculos_profissionais` guarda o empregador em DOIS lugares:
 * `empresa` (texto) e `parteExternaId` (a ligação com o cadastro). A
 * importação da folha preenchia só o texto — nos 963 vínculos do SINDSERM,
 * `parteExternaId` estava NULO em todos, embora as 36 secretarias estivessem
 * cadastradas ali do lado.
 *
 * POR QUE O TEXTO SOZINHO NÃO BASTA:
 *
 *  1. A CONTAGEM QUEBRA. "Quantos filiados na SEMEC?" só pode ser respondido
 *     agrupando por texto. Basta a folha do mês seguinte escrever "SEMEC " com
 *     espaço, ou a razão social por extenso, e vira outro grupo — cada
 *     competência podendo criar uma variação nova.
 *  2. RENOMEAR NÃO PROPAGA. Numa reforma administrativa a secretaria muda de
 *     nome; corrige-se o cadastro e os vínculos seguem com o nome velho.
 *  3. A TELA MENTE. O combobox oferece o cadastro para escolher, mas o que veio
 *     da importação não está ligado a ele — parece ligado e não está.
 *
 * O TEXTO CONTINUA SENDO GRAVADO, e isso é de propósito: ele é a FOTOGRAFIA do
 * que a folha disse, e é o que responde "onde a pessoa trabalha" mesmo depois
 * de a organização ser apagada do cadastro (a FK é `SetNull`).
 *
 * CASAMENTO EXATO, NUNCA POR SEMELHANÇA. Medido no acervo real do SINDSERM:
 * dos 963 vínculos, 949 (98,5%) casam por sigla ou razão social exata. Os 14
 * restantes são "NÃO INFORMADO NA FOLHA" (11) e três órgãos que não estão na
 * lista — e é CERTO que fiquem nulos: um casamento aproximado poria o servidor
 * na secretaria errada, e ninguém descobriria olhando a tela, porque o texto
 * continuaria certo.
 */

/**
 * A forma comparável de um nome de organização.
 *
 * Maiúsculas, sem espaço nas pontas e com espaços internos colapsados. NÃO
 * remove acento de propósito: os dois lados vêm da mesma origem (a planilha da
 * Prefeitura e o cadastro digitado a partir dela), e tirar acento só ampliaria
 * o casamento para nomes que talvez não sejam o mesmo órgão.
 *
 * Esta função precisa concordar com a expressão SQL da migration de backfill.
 * Se divergirem, o backfill liga um conjunto e a importação seguinte liga
 * outro — e a base fica com metade dos vínculos ligados, sem sintoma visível.
 */
export function chaveOrganizacao(valor?: string | null): string {
  return (valor ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** O que o cadastro sabe de uma organização, para efeito de casamento. */
export interface OrganizacaoCandidata {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
}

/**
 * Índice sigla/nome → id, montado UMA vez e usado em todas as linhas.
 *
 * A SIGLA TEM PRECEDÊNCIA sobre a razão social, e não o contrário: a folha da
 * Prefeitura escreve "SEMEC", e é a sigla que o servidor e a secretaria usam.
 * Quando duas organizações disputam a mesma chave, a primeira registrada
 * vence e a segunda é IGNORADA — chave ambígua não pode escolher sozinha qual
 * das duas é a certa.
 */
export function indexarOrganizacoes(
  candidatas: OrganizacaoCandidata[],
): Map<string, string> {
  const porChave = new Map<string, string>();
  const ambiguas = new Set<string>();

  const registrar = (bruto: string | null | undefined, id: string) => {
    const chave = chaveOrganizacao(bruto);
    if (!chave) return;
    const jaTem = porChave.get(chave);
    if (jaTem && jaTem !== id) {
      // Duas organizações com a mesma sigla: nenhuma das duas serve.
      ambiguas.add(chave);
      return;
    }
    porChave.set(chave, id);
  };

  for (const c of candidatas) registrar(c.nomeFantasia, c.id);
  for (const c of candidatas) registrar(c.nome, c.id);

  for (const chave of ambiguas) porChave.delete(chave);
  return porChave;
}

/**
 * O id da organização correspondente ao texto — ou `null` quando não há
 * certeza.
 *
 * `null` é uma resposta legítima e frequente: "NÃO INFORMADO NA FOLHA" não é
 * organização nenhuma. Deixar nulo mantém o estado de hoje; chutar cria um
 * erro que a tela não mostra.
 */
export function organizacaoDoTexto(
  texto: string | null | undefined,
  indice: Map<string, string>,
): string | null {
  return indice.get(chaveOrganizacao(texto)) ?? null;
}
