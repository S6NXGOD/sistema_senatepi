import type { DesafioRecadastramento } from '@prisma/client';
import { diferencaDeCampos, ValorDeCampo } from '../../common/audit/audit.diff';
import { tenant, TenantConfig } from '../../tenant/tenant.config';
import { protegerImutaveis } from '../filiados/campos-imutaveis';
import { CAMPOS_DO_CADASTRO_PELO_LINK } from './dto/recadastro-publico.dto';

/**
 * O "DE → PARA" DE UM RECADASTRAMENTO — o que a conferência mostra.
 *
 * POR QUE EXISTE (auditoria de 12/09/2026). O recadastro pelo link grava PENDENTE
 * "para o sindicato validar", e a página pública promete que a equipe vai
 * conferir. Nenhuma tela mostrava o que chegou. As colunas `dados_anteriores` e
 * `dados_novos` sempre estiveram lá; faltava lê-las.
 *
 * O cuidado é não INVENTAR mudança. Os dois lados vêm de lugares diferentes:
 *   · `dadosAnteriores` é o registro do banco serializado — data com hora
 *     ("1980-05-10T03:00:00.000Z"), CPF só dígitos, vínculos como objetos;
 *   · `dadosNovos` é o que o formulário mandou — data pura ("1980-05-10"),
 *     CPF talvez com máscara, e no presencial o corpo inteiro, inclusive o
 *     CPF que a proteção de imutáveis descartou.
 * Comparar cru daria "Data de nascimento: 1980-05-10T03:00:00.000Z → 1980-05-10"
 * em quase todo recadastramento.
 */

export interface AlteracaoDoRecadastramento {
  campo: string;
  rotulo: string;
  de: ValorDeCampo;
  para: ValorDeCampo;
}

/** O que `NOME_DO_CAMPO` da auditoria não tem, ou chama de outro jeito. */
const ROTULOS: Record<string, string> = {
  endereco: 'Endereço',
  naturalidade: 'Naturalidade',
  ufRg: 'UF do RG',
  formacaoOutro: 'Formação (qual)',
  vinculos: 'Locais de trabalho',
  dependentes: 'Dependentes',
  modalidadeContribuicao: 'Forma de contribuição',
};

const CAMPOS_DE_DATA = new Set(['dataNascimento', 'dataAdmissao']);

/** Nunca aparecem: confirmação do desafio, chaves e colunas que a aplicação mantém. */
const IGNORAR = [
  'cpfConfirmacao', 'dataNascimentoConfirmacao', 'corenConfirmacao',
  'filiadoId', 'qrToken', 'fotoKey', 'fotoThumbKey',
  'buscaNormalizada', 'cidadeNormalizada',
];

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Relação inteira não cabe numa linha: vira a lista de nomes. */
function nomesDe(lista: unknown, campo: 'empresa' | 'nome'): string[] | undefined {
  if (!Array.isArray(lista)) return undefined;
  return lista
    .map((x) => (ehObjeto(x) ? String(x[campo] ?? '').trim() : ''))
    .filter(Boolean);
}

function normalizarLado(dados: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = { ...dados };
  for (const campo of CAMPOS_DE_DATA) {
    const v = saida[campo];
    if (typeof v === 'string') saida[campo] = v.slice(0, 10) || null;
    else if (v instanceof Date) saida[campo] = v.toISOString().slice(0, 10);
  }
  if (typeof saida.cpf === 'string') saida.cpf = saida.cpf.replace(/\D/g, '') || null;
  if ('vinculos' in saida) saida.vinculos = nomesDe(saida.vinculos, 'empresa');
  if ('dependentes' in saida) saida.dependentes = nomesDe(saida.dependentes, 'nome');
  return saida;
}

/**
 * A ORDEM DA FICHA, e não a do JSON.
 *
 * `dados_novos` e `dados_anteriores` são JSONB, e o Postgres guarda as chaves
 * ordenadas pelo TAMANHO do nome ("cep", "cpf", "email", "cidade"...). Na ordem
 * de chegada, a conferência mostraria "CEP" antes de "Nome" e "Cidade" antes de
 * "Endereço". A lista do que o link grava já está na ordem do formulário; o
 * que não está nela (campos do presencial) vem depois, na ordem em que apareceu.
 */
const ORDEM_DA_FICHA: readonly string[] = [...CAMPOS_DO_CADASTRO_PELO_LINK, 'vinculos', 'dependentes'];
const posicaoNaFicha = (campo: string) => {
  const i = ORDEM_DA_FICHA.indexOf(campo);
  return i < 0 ? ORDEM_DA_FICHA.length : i;
};

export function alteracoesDoRecadastramento(
  anteriores: unknown,
  novos: unknown,
): AlteracaoDoRecadastramento[] {
  if (!ehObjeto(anteriores) || !ehObjeto(novos)) return [];
  // O que a proteção de imutáveis descartou NÃO mudou — não pode aparecer como mudança.
  const { dados: novosProtegidos } = protegerImutaveis(anteriores, novos);
  const antes = normalizarLado(anteriores);
  const depois = normalizarLado(novosProtegidos);
  // Lista ausente nos novos = "não mexeu"; o `undefined` já é pulado pelo diff.
  return diferencaDeCampos(antes, depois, { ignorar: IGNORAR })
    // `sort` é estável: os de fora da lista mantêm a ordem de chegada entre si.
    .sort((a, b) => posicaoNaFicha(a.campo) - posicaoNaFicha(b.campo))
    .map((a) => ({
      campo: a.campo,
      rotulo: ROTULOS[a.campo] ?? a.label,
      de: a.de,
      para: a.para,
    }));
}

/** O recadastro pelo link se reconhece pela observação gravada por ele. */
export function origemDoRecadastramento(observacao: string | null | undefined): 'ONLINE' | 'PRESENCIAL' {
  return (observacao ?? '').startsWith('Recadastramento ONLINE') ? 'ONLINE' : 'PRESENCIAL';
}

const O_QUE_O_LINK_CONFIRMOU: Partial<Record<DesafioRecadastramento, string>> = {
  CPF: 'O link confirmou só o CPF.',
  NASCIMENTO: 'O link confirmou só a data de nascimento.',
  COREN: 'O link confirmou só o COREN.',
  NENHUM: 'O link abriu sem confirmar a identidade.',
};

const vazio = (v: ValorDeCampo) => v === null || v === undefined || v === '';

/**
 * A LINHA ÂMBAR DA CONFERÊNCIA — a âncora de identidade (14/09/2026).
 *
 * Num link de um fator só, quem passou pode preencher o OUTRO campo que estava
 * vazio: o link CPF deixa gravar a data de nascimento, e o link NASCIMENTO, o
 * CPF. Não se trava (preencher é o objetivo do link), mas o que entrou vira a
 * pergunta do PRÓXIMO link — se veio errado, o filiado verdadeiro queima o link
 * dele em 5 tentativas. Então a equipe é avisada para conferir num documento.
 *
 * O COREN entra na lista pelo mesmo motivo (é um fator só e o cadastro dele não
 * tem CPF útil), e o NENHUM também: link vivo de antes de 14/09 que alguém usou
 * para gravar CPF e nascimento é exatamente o sequestro que a mudança fecha.
 *
 * Nasce AQUI, e não na tela, para não haver uma segunda cópia da regra.
 * `null` quando não há o que avisar: presencial, online de antes de 14/09
 * (sem confirmação carimbada), CPF_NASCIMENTO, ou nada de identidade preenchido.
 *
 * QUEM PREENCHEU SE CHAMA COMO O SINDICATO CHAMA (14/09/2026). A frase dizia
 * "filiado" fixo; a palavra vem de `vocabulario.filiado`, a mesma da tela. O
 * tenant entra como parâmetro, com o desta instalação por padrão, para o teste
 * exercitar os dois sindicatos e uma palavra diferente.
 */
export function avisoDaConfirmacao(
  confirmacao: DesafioRecadastramento | null,
  alteracoes: AlteracaoDoRecadastramento[],
  t: TenantConfig = tenant,
): string | null {
  const abertura = confirmacao ? O_QUE_O_LINK_CONFIRMOU[confirmacao] : undefined;
  if (!abertura) return null;
  const preencheu = (campo: string) =>
    alteracoes.some((a) => a.campo === campo && vazio(a.de) && !vazio(a.para));
  const cpf = preencheu('cpf');
  const nascimento = preencheu('dataNascimento');
  if (!cpf && !nascimento) return null;
  const quem =
    cpf && nascimento
      ? 'O CPF e a data de nascimento foram preenchidos'
      : cpf
        ? 'O CPF foi preenchido'
        : 'A data de nascimento foi preenchida';
  return `${abertura} ${quem} pelo próprio ${t.vocabulario.filiado}: confira num documento antes de marcar como conferido.`;
}
