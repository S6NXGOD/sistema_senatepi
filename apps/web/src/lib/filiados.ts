import { api } from './api';

export type SituacaoFiliado = 'ATIVO' | 'INATIVO' | 'DESFILIADO';
export type FormacaoProfissional =
  | 'ENFERMEIRO'
  | 'TECNICO_ENFERMAGEM'
  | 'AUXILIAR_ENFERMAGEM'
  | 'OUTRO';

/** LOCAL DE TRABALHO do filiado — duplo vínculo é a regra na enfermagem. */
export interface Vinculo {
  id?: string;
  /** Nome do empregador como consta no cadastro (snapshot). */
  empresa: string;
  /** Id no cadastro de organizações, quando escolhido no combobox. */
  parteExternaId?: string | null;
  cargo?: string | null;
  /** Onde trabalha DENTRO do órgão — secretaria, unidade, setor. */
  lotacao?: string | null;
  matricula?: string | null;
  /** A mensalidade é descontada NA FOLHA deste local. */
  descontoEmFolha?: boolean;
  ordem?: number;
}

/**
 * Como o filiado contribui. `DESCONTO_FOLHA` aponta para os locais de trabalho
 * marcados — é lá que se sabe em QUAL folha o desconto acontece.
 */
export type ModalidadeContribuicao = 'DESCONTO_FOLHA' | 'AVULSO' | 'PENSIONISTA';

export const MODALIDADES_CONTRIBUICAO: { valor: ModalidadeContribuicao; label: string }[] = [
  { valor: 'DESCONTO_FOLHA', label: 'Desconto em Folha' },
  { valor: 'AVULSO', label: 'Avulso (PIX / Boleto)' },
  { valor: 'PENSIONISTA', label: 'Pensionista' },
];

export const MODALIDADE_LABEL: Record<ModalidadeContribuicao, string> =
  MODALIDADES_CONTRIBUICAO.reduce(
    (acc, m) => ({ ...acc, [m.valor]: m.label }),
    {} as Record<ModalidadeContribuicao, string>,
  );

export interface Filiado {
  id: string;
  matricula: string;
  nomeCompleto: string;
  cpf: string | null;
  rg?: string | null;
  ufRg?: string | null;
  dataNascimento: string;
  sexo?: string | null;
  estadoCivil?: string | null;
  naturalidade?: string | null;
  telefonePrincipal?: string | null;
  telefoneSecundario?: string | null;
  email?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  formacao?: FormacaoProfissional | null;
  formacaoOutro?: string | null;
  numeroCoren?: string | null;
  dataAdmissao?: string | null;
  /** Vínculo com o EMPREGADOR (≠ `situacao`, que é o vínculo com o sindicato). */
  vinculoFuncional?: 'ATIVO' | 'APOSENTADO' | 'PENSIONISTA' | null;
  situacao: SituacaoFiliado;
  fotoUrl?: string | null;
  vinculos?: Vinculo[];
  /** Como contribui. Nulo na base histórica — o dado nunca foi coletado. */
  modalidadeContribuicao?: ModalidadeContribuicao | null;
  /** Vem preenchido no detalhe do filiado (GET /filiados/:id). */
  dependentes?: DependenteFiliado[];
  /**
   * Quando a pessoa se filiou. NULO quando a informação não veio na carga
   * legada — 1.895 casos. Nulo é a resposta honesta: `createdAt` serve de
   * substituto para ORDENAR (é carimbo de entrada no banco), mas não para
   * AFIRMAR uma data de filiação que ninguém registrou.
   */
  dataFiliacao?: string | null;
  /** Carimbo de quando o registro entrou no banco. */
  createdAt: string;
}

/** Ordenações aceitas por GET /filiados (o padrão é `recentes`). */
export const ORDENACOES_FILIADO = [
  { valor: 'recentes', label: 'Cadastro mais recente' },
  { valor: 'antigos', label: 'Cadastro mais antigo' },
  { valor: 'nome', label: 'Nome (A–Z)' },
  { valor: 'nome_desc', label: 'Nome (Z–A)' },
  { valor: 'filiacao_recente', label: 'Filiação mais recente' },
  { valor: 'filiacao_antiga', label: 'Filiação mais antiga' },
] as const;

export type OrdenacaoFiliado = (typeof ORDENACOES_FILIADO)[number]['valor'];

export type TipoDependente = 'CONJUGE' | 'FILHO' | 'PAI' | 'MAE';

/** Dependente editável junto com o cadastro. Sem `id` = novo. */
export interface DependenteFiliado {
  id?: string;
  tipo: TipoDependente;
  nome: string;
  cpf?: string | null;
  dataNascimento: string;
}

/**
 * Só FILHO tem limite de idade (18 anos) — a regra vive no back
 * (`dependenteValidoParaEvento`). Cônjuge, pai e mãe não perdem a condição
 * com o tempo.
 */
export const TIPOS_DEPENDENTE: Array<{ valor: TipoDependente; rotulo: string }> = [
  { valor: 'FILHO', rotulo: 'Filho(a)' },
  { valor: 'CONJUGE', rotulo: 'Cônjuge' },
  { valor: 'PAI', rotulo: 'Pai' },
  { valor: 'MAE', rotulo: 'Mãe' },
];

export const SITUACAO_LABEL: Record<SituacaoFiliado, string> = {
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  DESFILIADO: 'Desfiliado',
};

export const SITUACAO_COR: Record<SituacaoFiliado, string> = {
  ATIVO: 'bg-brand-50 text-brand-800',
  INATIVO: 'bg-gray-100 text-gray-600',
  DESFILIADO: 'bg-red-100 text-red-700',
};

export const FORMACAO_LABEL: Record<FormacaoProfissional, string> = {
  ENFERMEIRO: 'Enfermeiro(a)',
  TECNICO_ENFERMAGEM: 'Técnico(a) em Enfermagem',
  AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem',
  OUTRO: 'Outro',
};

export const SITUACOES = Object.keys(SITUACAO_LABEL) as SituacaoFiliado[];
export const FORMACOES = Object.keys(FORMACAO_LABEL) as FormacaoProfissional[];

/** Regex de validação do COREN-PI: COREN-PI 000000-SSS (até 6 dígitos + 3 letras). */
export const COREN_REGEX = /^COREN-PI \d{1,6}-[A-Z]{3}$/;

/**
 * Máscara progressiva do COREN-PI. Sempre prefixa "COREN-PI ", limita a
 * 6 dígitos e 3 letras maiúsculas da categoria (ex.: COREN-PI 123456-ENF).
 */
export function mascararCoren(input: string): string {
  // Remove o prefixo fixo (em qualquer estágio de digitação) e normaliza
  const corpo = input
    .toUpperCase()
    .replace(/^\s*COREN\s*-?\s*PI\s*/, '')
    .trim();
  const digitos = (corpo.match(/\d/g) ?? []).join('').slice(0, 6);
  const letras = (corpo.replace(/[^A-Z]/g, '') ?? '').slice(0, 3);

  let out = 'COREN-PI ';
  out += digitos;
  // mostra o hífen assim que houver categoria (ou os 6 dígitos preenchidos)
  if (letras.length > 0 || corpo.includes('-')) out += '-' + letras;
  return out;
}

/** Sugere a categoria (ENF/TEC/AUX) a partir da formação selecionada. */
export const CATEGORIA_POR_FORMACAO: Record<string, string> = {
  ENFERMEIRO: 'ENF',
  TECNICO_ENFERMAGEM: 'TEC',
  AUXILIAR_ENFERMAGEM: 'AUX',
};

// ============================================================================
// API — gestão de filiados
// ============================================================================

/** Desfilia um associado (PATCH /filiados/:id/desfiliar), com motivo opcional. */
/**
 * Motivos de desfiliação. Lista fechada e espelhada do enum da API — é ela que
 * permite responder "quantos saíram por inadimplência este ano?", pergunta que
 * o motivo em texto livre nunca respondeu.
 */
export type MotivoDesfiliacao =
  | 'APOSENTADORIA'
  | 'MUDANCA_ESTADO'
  | 'MUDANCA_PROFISSAO'
  | 'SOLICITACAO_PESSOAL'
  | 'INADIMPLENCIA'
  | 'OUTROS';

export const MOTIVOS_DESFILIACAO: { valor: MotivoDesfiliacao; label: string }[] = [
  { valor: 'APOSENTADORIA', label: 'Aposentadoria / Saída da Categoria' },
  { valor: 'MUDANCA_ESTADO', label: 'Mudança de Estado / Transferência' },
  { valor: 'MUDANCA_PROFISSAO', label: 'Mudança de Profissão' },
  { valor: 'SOLICITACAO_PESSOAL', label: 'Solicitação Pessoal' },
  { valor: 'INADIMPLENCIA', label: 'Inadimplência' },
  { valor: 'OUTROS', label: 'Outros' },
];

export const MOTIVO_DESFILIACAO_LABEL: Record<MotivoDesfiliacao, string> =
  MOTIVOS_DESFILIACAO.reduce(
    (acc, m) => ({ ...acc, [m.valor]: m.label }),
    {} as Record<MotivoDesfiliacao, string>,
  );

export interface DesfiliarInput {
  motivo: MotivoDesfiliacao;
  observacoes?: string;
  /** Data do pedido (AAAA-MM-DD). Omitida, a API usa hoje. */
  dataPedido?: string;
  /** Última mensalidade a cobrar (AAAA-MM) — o corte da folha. */
  mesCorte?: string;
}

export async function desfiliarFiliado(id: string, dto: DesfiliarInput): Promise<Filiado> {
  return (await api.patch(`/filiados/${id}/desfiliar`, dto)).data;
}

/**
 * O QUE FICA PENDURADO NESTE FILIADO.
 *
 * A saída era decidida às cegas: o modal pedia motivo e mês de corte e mais
 * nada. Mas o cadastro é o centro de meia dúzia de módulos — dívida aberta,
 * processo em curso, dependentes que perdem acesso junto, atividade na agenda
 * de um advogado — e nenhum deles aparecia na hora de confirmar.
 *
 * Números, não listas: a pergunta é "tem algo pendurado?".
 */
export interface VinculosDoFiliado {
  nome: string;
  situacao: SituacaoFiliado;
  parcelasAbertas: number;
  valorAberto: number;
  dependentes: number;
  processos: number;
  atividadesAbertas: number;
  atendimentosAbertos: number;
  carteirinhas: number;
}

export async function vinculosDoFiliado(id: string): Promise<VinculosDoFiliado> {
  return (await api.get(`/filiados/${id}/vinculos`)).data;
}

/**
 * Reativação. Porta PRÓPRIA, e não o seletor de situação do formulário: voltar
 * a ATIVO sem limpar motivo, data e mês de corte deixava o cadastro afirmando
 * uma desfiliação que já tinha sido desfeita — e o Termo, se reemitido, saía
 * com o motivo antigo.
 */
export async function reativarFiliado(id: string, motivo: string): Promise<Filiado> {
  return (await api.patch(`/filiados/${id}/reativar`, { motivo })).data;
}

/**
 * Anexa um documento ao filiado. `tipo` faz o arquivo aparecer CATEGORIZADO na
 * aba Documentos — sem ele, o termo assinado cairia no genérico "OUTRO", junto
 * com RG e comprovante de residência.
 */
export async function anexarDocumentoFiliado(
  id: string,
  file: File,
  titulo: string,
  tipo?: 'TERMO_DESFILIACAO' | 'FICHA_FILIACAO' | 'TERMO_CONSENTIMENTO' | 'DOCUMENTO_PESSOAL' | 'CONTRATO' | 'OUTRO',
) {
  const fd = new FormData();
  fd.append('arquivo', file);
  fd.append('titulo', titulo);
  if (tipo) fd.append('tipo', tipo);
  return (await api.post(`/filiados/${id}/documentos`, fd)).data;
}

/**
 * Atualização cadastral — mesmo alcance do recadastramento.
 * A API descarta alteração em CPF, RG, nascimento e naturalidade já
 * preenchidos e devolve em `camposProtegidos` o que foi ignorado.
 */
export async function atualizacaoCadastralFiliado(
  id: string,
  dados: Record<string, unknown>,
): Promise<Filiado & { camposProtegidos?: string[] }> {
  return (await api.patch(`/filiados/${id}/atualizacao-cadastral`, dados)).data;
}

/** Exclui permanentemente um filiado (DELETE /filiados/:id). */
export async function excluirFiliado(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/filiados/${id}`)).data;
}

// ---------------------------------------------------------------------------
// Link de recadastramento online (gerado pela equipe, usado pelo filiado)
// ---------------------------------------------------------------------------

export type DesafioLink = 'CPF_NASCIMENTO' | 'COREN' | 'NENHUM';

export interface LinkRecadastramento {
  id: string;
  desafio: DesafioLink;
  expiraEm: string;
  usadoEm?: string | null;
  revogadoEm?: string | null;
  tentativas?: number;
  createdAt?: string;
  /** Só vem na CRIAÇÃO — depois o token é irrecuperável. */
  url?: string;
  token?: string;
}

/** Rótulo do que o filiado terá de confirmar para abrir o link. */
export const DESAFIO_LABEL: Record<DesafioLink, string> = {
  CPF_NASCIMENTO: 'Confirma CPF + data de nascimento',
  COREN: 'Confirma o número do COREN',
  NENHUM: 'Acesso direto (cadastro sem CPF/nascimento/COREN)',
};

export async function gerarLinkRecadastramento(filiadoId: string): Promise<LinkRecadastramento> {
  return (await api.post(`/filiados/${filiadoId}/link-recadastramento`)).data;
}
export async function listarLinksRecadastramento(filiadoId: string): Promise<LinkRecadastramento[]> {
  return (await api.get(`/filiados/${filiadoId}/link-recadastramento`)).data;
}
export async function revogarLinkRecadastramento(linkId: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/links-recadastramento/${linkId}`)).data;
}
