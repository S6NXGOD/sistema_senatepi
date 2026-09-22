/**
 * DUAS FICHAS COM O MESMO NOME — como a lista deixa escolher — 22/09/2026.
 *
 * O QUE O DONO VIU: ao buscar "erica" na abertura de um atendimento, a lista
 * trouxe **duas "ÉRICA CINARA FRAZÃO PESSOA" absolutamente idênticas** na tela.
 * Ele leu isso como "os duplicados não foram removidos". São duas coisas
 * diferentes, e só uma é defeito:
 *
 *  · que EXISTAM duas fichas com o mesmo nome — medido: 145 grupos, 317 fichas.
 *    Nos 3 grupos em que dá para saber (as duas fichas têm CPF), os CPFs são
 *    DIFERENTES: são pessoas diferentes, não duplicatas. Inclusive um par com
 *    o mesmo nome, a mesma cidade, criado no mesmo dia e com matrículas
 *    consecutivas (5879 e 5880) — e dois CPFs válidos distintos.
 *  · que a lista não deixe DISTINGUIR as duas. Isto é defeito, e é este
 *    arquivo: a linha de apoio mostrava só o CPF mascarado, e 62% dos ativos
 *    não têm CPF. Sem CPF, a linha ficava vazia e as duas ficavam iguaizinhas.
 *
 * A REGRA: mostrar o dado mais forte que a ficha TEM, nesta ordem —
 *
 *   1. CPF (mascarado) — identifica a pessoa;
 *   2. cidade — localiza;
 *   3. vínculo/empregador — localiza pelo trabalho;
 *   4. desde quando é filiado — distingue duas entradas do mesmo nome.
 *
 * E a MATRÍCULA entra sempre que o nome se repete NA LISTA, porque é o único
 * campo preenchido em 100% das fichas e distinto em todas. Ela não prova que
 * são pessoas diferentes (é chave do registro, não da pessoa) — ela dá à
 * pessoa que escolhe um jeito de dizer "é a 3496, não a 2617".
 */

export interface FichaNaLista {
  id: string;
  nome: string;
  cpfMascarado?: string | null;
  matricula?: string | null;
  cidade?: string | null;
  estado?: string | null;
  dataFiliacao?: string | Date | null;
  vinculos?: Array<{ empresa?: string | null }> | null;
}

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Mesma normalização de comparação de nome do resto do projeto: sem acento e sem caixa. */
export function nomeComparavel(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quais nomes aparecem mais de uma vez NESTA lista. */
export function nomesRepetidos(fichas: FichaNaLista[]): Set<string> {
  const contagem = new Map<string, number>();
  for (const f of fichas) {
    const n = nomeComparavel(f.nome);
    contagem.set(n, (contagem.get(n) ?? 0) + 1);
  }
  return new Set([...contagem].filter(([, n]) => n > 1).map(([n]) => n));
}

/** "desde 2014" — o ano basta; o dia não ajuda a escolher e ocupa a linha. */
function desdeQuando(data: string | Date | null | undefined): string {
  if (!data) return '';
  const iso = data instanceof Date ? data.toISOString() : String(data);
  const ano = iso.slice(0, 4);
  return /^\d{4}$/.test(ano) ? `desde ${ano}` : '';
}

/**
 * A linha de apoio da ficha na lista.
 *
 * `repetido` vem de fora porque depende da LISTA, não da ficha: o mesmo
 * cadastro aparece sem matrícula numa busca em que é único e com matrícula
 * numa busca em que há outro igual. Poluir toda linha com a matrícula
 * resolveria o caso raro e pioraria o comum.
 */
export function comoDistinguir(ficha: FichaNaLista, repetido = false): string {
  const partes: string[] = [];

  const cpf = texto(ficha.cpfMascarado);
  if (cpf) partes.push(cpf);

  const cidade = texto(ficha.cidade);
  if (cidade) partes.push(texto(ficha.estado) ? `${cidade}/${texto(ficha.estado)}` : cidade);

  if (partes.length < 2) {
    const empresa = texto(ficha.vinculos?.find((v) => texto(v?.empresa))?.empresa);
    if (empresa) partes.push(empresa);
  }

  if (partes.length < 2) {
    const desde = desdeQuando(ficha.dataFiliacao);
    if (desde) partes.push(desde);
  }

  /*
    A MATRÍCULA FECHA A LINHA quando o nome se repete — e é o ÚNICO caso em que
    ela aparece. Sem ela, duas fichas sem CPF, sem cidade e sem vínculo
    continuariam idênticas na tela, que é exatamente o print do dono.
  */
  const matricula = texto(ficha.matricula);
  if (repetido && matricula) partes.push(`matrícula ${matricula}`);

  return partes.join(' · ');
}

/**
 * O AVISO DA LISTA: há nome repetido aqui, e escolher no automático erra.
 *
 * Uma frase só, e só quando há repetição — senão vira cabeçalho, e cabeçalho
 * ninguém lê. Ela não acusa duplicata: a medição diz que homônimo é o caso
 * comum nesta base, e chamar de duplicata o que é outra pessoa levaria alguém
 * a apagar a ficha errada.
 */
export function avisoDeNomeRepetido(fichas: FichaNaLista[]): string | null {
  const repetidos = nomesRepetidos(fichas);
  if (repetidos.size === 0) return null;
  return repetidos.size === 1
    ? 'Há duas ou mais fichas com este mesmo nome. Confira o dado ao lado antes de escolher.'
    : 'Há nomes repetidos nesta lista. Confira o dado ao lado antes de escolher.';
}
