import { contar } from './plural';
import {
  TIPO_PARTE_LABEL, formatDocumento,
  type CamposDaMesclagem, type ComparacaoOrganizacoes, type LadoDaComparacao, type TipoParteExterna,
} from './partes';

/**
 * JUNTAR DUAS ORGANIZAÇÕES SEM PERDER DADO — a regra de O QUE a tela oferece.
 *
 * Pedido de 12/09/2026: "como mesclar sem perder os dados? Vou ficar com o que
 * tem o dado mais enriquecido". A mesclagem já movia processos, vínculos e
 * dossiê, e completava o que estava em branco — mas, quando as duas tinham
 * valores DIFERENTES, valia sempre o da que fica. A FMS/THE continuaria
 * "Empresa", com nome de apelido, embora o CNPJ dela seja o da Fundação
 * Municipal de Saúde.
 *
 * Função pura porque é aqui que se erra: oferecer escolha onde não há
 * ("Teresina" × "TERESINA") treina a pessoa a clicar sem ler; mandar para a
 * API um valor que já era o padrão enche a auditoria de escolhas que ninguém
 * fez.
 */

export type Fonte = 'a' | 'b' | 'receita';

export type CampoEscolhivel =
  | 'nome' | 'nomeFantasia' | 'tipo' | 'ente' | 'email' | 'telefone' | 'cidade' | 'uf';

export const CAMPOS_ESCOLHIVEIS: CampoEscolhivel[] = [
  'nome', 'nomeFantasia', 'tipo', 'ente', 'email', 'telefone', 'cidade', 'uf',
];

export const ROTULO_DO_CAMPO: Record<CampoEscolhivel | 'documento', string> = {
  nome: 'Nome',
  nomeFantasia: 'Sigla',
  tipo: 'Tipo',
  ente: 'Ente público',
  email: 'E-mail',
  telefone: 'Telefone',
  cidade: 'Cidade',
  uf: 'UF',
  documento: 'CPF/CNPJ',
};

export interface Opcao {
  fonte: Fonte;
  valor: string | number;
  texto: string;
}

export type Escolhas = Partial<Record<CampoEscolhivel, Fonte>>;

const limpo = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t ? { valor: t, texto: t } : null;
};

function valorNa(
  c: ComparacaoOrganizacoes,
  fonte: Fonte,
  campo: CampoEscolhivel,
): Omit<Opcao, 'fonte'> | null {
  if (fonte === 'receita') {
    const r = c.receita;
    if (!r) return null;
    switch (campo) {
      case 'nome':
        return limpo(r.razaoSocial);
      case 'nomeFantasia':
        return limpo(r.nomeFantasia);
      case 'tipo':
        return { valor: r.tipoSugerido, texto: TIPO_PARTE_LABEL[r.tipoSugerido] };
      case 'ente':
        return null; // a Receita não diz quem paga a folha
      default:
        return limpo(r[campo]);
    }
  }
  const lado = fonte === 'a' ? c.a : c.b;
  switch (campo) {
    case 'tipo':
      return { valor: lado.tipo, texto: TIPO_PARTE_LABEL[lado.tipo] };
    case 'ente':
      return lado.ente
        ? {
            valor: lado.ente.codigo,
            texto: lado.ente.esfera === 'M' ? `${lado.ente.nome}-${lado.ente.uf}` : lado.ente.nome,
          }
        : null;
    default:
      return limpo(lado[campo]);
  }
}

/** Igualdade de gente: caixa, acento, pontuação e espaço não fazem dois valores. */
export function mesmoValor(campo: CampoEscolhivel, x: string | number, y: string | number): boolean {
  if (typeof x === 'number' || typeof y === 'number') return x === y;
  if (campo === 'telefone') return x.replace(/\D/g, '') === y.replace(/\D/g, '');
  const n = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@]+/g, ' ').trim();
  return n(x) === n(y);
}

/**
 * As opções de um campo: a da que continua, a da que some e a da Receita —
 * nessa ordem, sem repetir valor. A PRIMEIRA É O PADRÃO, e é a regra do
 * servidor: vale o da que continua; em branco nela, o da outra.
 */
export function opcoesDoCampo(
  c: ComparacaoOrganizacoes,
  campo: CampoEscolhivel,
  ficaId: string,
): Opcao[] {
  const continua: Fonte = ficaId === c.a.id ? 'a' : 'b';
  const some: Fonte = continua === 'a' ? 'b' : 'a';
  const opcoes: Opcao[] = [];
  for (const fonte of [continua, some, 'receita'] as Fonte[]) {
    const v = valorNa(c, fonte, campo);
    if (!v || opcoes.some((o) => mesmoValor(campo, o.valor, v.valor))) continue;
    opcoes.push({ fonte, ...v });
  }
  // Só a Receita tem o valor: isso não é juntar, é cadastrar — fica para a edição.
  return opcoes.length === 1 && opcoes[0].fonte === 'receita' ? [] : opcoes;
}

/** A que vale num campo: a marcada, se ainda existe entre as opções; senão o padrão. */
export function opcaoEscolhida(opcoes: Opcao[], marcada: Fonte | undefined): Opcao | undefined {
  return opcoes.find((o) => o.fonte === marcada) ?? opcoes[0];
}

/** Os campos em que as duas discordam — só estes pedem decisão. */
export function camposEmConflito(
  c: ComparacaoOrganizacoes,
  ficaId: string,
): { campo: CampoEscolhivel; opcoes: Opcao[] }[] {
  return CAMPOS_ESCOLHIVEIS.map((campo) => ({ campo, opcoes: opcoesDoCampo(c, campo, ficaId) })).filter(
    (x) => x.opcoes.length > 1,
  );
}

/** O que vai para a API: só onde a escolha difere do padrão. */
export function camposDaEscolha(
  c: ComparacaoOrganizacoes,
  ficaId: string,
  escolhas: Escolhas,
): CamposDaMesclagem {
  const campos: CamposDaMesclagem = {};
  for (const { campo, opcoes } of camposEmConflito(c, ficaId)) {
    const escolhida = opcaoEscolhida(opcoes, escolhas[campo]);
    if (!escolhida || escolhida === opcoes[0]) continue;
    if (campo === 'ente') campos.enteCodigo = Number(escolhida.valor);
    else if (campo === 'tipo') campos.tipo = escolhida.valor as TipoParteExterna;
    else campos[campo] = String(escolhida.valor);
  }
  return campos;
}

/**
 * O que vem da que some sem ninguém escolher: estava em branco na que continua.
 *
 * O documento entra aqui. Ele não é escolhível (CNPJ diferente recusa a
 * mesclagem), mas herdar o CNPJ é justamente o dado que mais importa não perder.
 */
export function herdadosSemPerguntar(
  c: ComparacaoOrganizacoes,
  ficaId: string,
): { campo: CampoEscolhivel | 'documento'; texto: string }[] {
  const continua = ficaId === c.a.id ? c.a : c.b;
  const some = ficaId === c.a.id ? c.b : c.a;
  const fonteDaQueSome: Fonte = ficaId === c.a.id ? 'b' : 'a';
  const herdados: { campo: CampoEscolhivel | 'documento'; texto: string }[] = [];
  if (!continua.documento && some.documento) {
    herdados.push({ campo: 'documento', texto: formatDocumento(some.documento) });
  }
  for (const campo of CAMPOS_ESCOLHIVEIS) {
    const opcoes = opcoesDoCampo(c, campo, ficaId);
    if (opcoes.length === 1 && opcoes[0].fonte === fonteDaQueSome) {
      herdados.push({ campo, texto: opcoes[0].texto });
    }
  }
  return herdados;
}

/** Qual continua quando a comparação abre: a sugerida — a não ser que a regra a recuse. */
export function ladoInicial(c: ComparacaoOrganizacoes): string {
  const recusada = c.sugestaoFica === c.a.id ? c.recusaSeFicar.a : c.recusaSeFicar.b;
  if (!recusada) return c.sugestaoFica;
  return c.sugestaoFica === c.a.id ? c.b.id : c.a.id;
}

/** A recusa do servidor para "esta continua"; nulo quando pode. */
export function recusaDoSentido(c: ComparacaoOrganizacoes, ficaId: string): string | null {
  return ficaId === c.a.id ? c.recusaSeFicar.a : c.recusaSeFicar.b;
}

/** "10 processos e 15 vínculos de trabalho" — o que está preso à organização. */
export function oQueEstaPreso(l: LadoDaComparacao): string | null {
  const itens = [
    l._count.participacoes ? contar(l._count.participacoes, 'processo', 'processos') : null,
    l._count.vinculos ? contar(l._count.vinculos, 'vínculo de trabalho', 'vínculos de trabalho') : null,
    l.dossiePatronal ? 'o dossiê patronal' : null,
  ].filter((x): x is string => !!x);
  if (!itens.length) return null;
  return itens.length === 1 ? itens[0] : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}
