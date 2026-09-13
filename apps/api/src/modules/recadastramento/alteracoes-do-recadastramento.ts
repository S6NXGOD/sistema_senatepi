import { diferencaDeCampos, ValorDeCampo } from '../../common/audit/audit.diff';
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
