import { api } from './api';

// ---------------------------------------------------------------------------
// Cadastros Base (domínios)
// ---------------------------------------------------------------------------
export interface Departamento { id: string; nome: string }
export interface Cargo { id: string; nome: string }
export interface Empresa { id: string; razaoSocial: string; cnpj: string }

export const listarDepartamentos = async (): Promise<Departamento[]> =>
  (await api.get('/cadastros/departamentos')).data;
export const criarDepartamento = async (nome: string) =>
  (await api.post('/cadastros/departamentos', { nome })).data;
export const atualizarDepartamento = async (id: string, nome: string) =>
  (await api.patch(`/cadastros/departamentos/${id}`, { nome })).data;
export const removerDepartamento = async (id: string) =>
  (await api.delete(`/cadastros/departamentos/${id}`)).data;

export const listarCargos = async (): Promise<Cargo[]> =>
  (await api.get('/cadastros/cargos')).data;
export const criarCargo = async (nome: string) =>
  (await api.post('/cadastros/cargos', { nome })).data;
export const atualizarCargo = async (id: string, nome: string) =>
  (await api.patch(`/cadastros/cargos/${id}`, { nome })).data;
export const removerCargo = async (id: string) =>
  (await api.delete(`/cadastros/cargos/${id}`)).data;

export const listarEmpresas = async (): Promise<Empresa[]> =>
  (await api.get('/cadastros/empresas')).data;
export const criarEmpresa = async (dados: { razaoSocial: string; cnpj: string }) =>
  (await api.post('/cadastros/empresas', dados)).data;
export const atualizarEmpresa = async (id: string, dados: { razaoSocial: string; cnpj: string }) =>
  (await api.patch(`/cadastros/empresas/${id}`, dados)).data;
export const removerEmpresa = async (id: string) =>
  (await api.delete(`/cadastros/empresas/${id}`)).data;

// ---------------------------------------------------------------------------
// Colaboradores
// ---------------------------------------------------------------------------
export type TipoVinculo = 'CLT' | 'PJ' | 'ESTAGIO' | 'TERCEIRIZADO';
export type StatusColaborador = 'ATIVO' | 'INATIVO' | 'AFASTADO' | 'FERIAS' | 'DESLIGADO';

export const TIPO_VINCULO_LABEL: Record<TipoVinculo, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
  ESTAGIO: 'Estágio',
  TERCEIRIZADO: 'Terceirizado',
};
export const TIPOS_VINCULO = Object.keys(TIPO_VINCULO_LABEL) as TipoVinculo[];

export const STATUS_COLAB_LABEL: Record<StatusColaborador, string> = {
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  AFASTADO: 'Afastado',
  FERIAS: 'Férias',
  DESLIGADO: 'Desligado',
};
export const STATUS_COLAB_COR: Record<StatusColaborador, string> = {
  ATIVO: 'bg-senatepi-50 text-senatepi-800',
  INATIVO: 'bg-gray-100 text-gray-600',
  AFASTADO: 'bg-amber-100 text-amber-700',
  FERIAS: 'bg-blue-100 text-blue-700',
  DESLIGADO: 'bg-red-100 text-red-700',
};
export const STATUS_COLAB = Object.keys(STATUS_COLAB_LABEL) as StatusColaborador[];

export interface Colaborador {
  id: string;
  fotoUrl: string | null;
  nome: string;
  cpf: string;
  dataNascimento: string | null;
  telefone: string | null;
  email: string | null;
  dataAdmissao: string | null;
  status: StatusColaborador;
  tipoVinculo: TipoVinculo;
  statusMotivo: string | null;
  dataDesligamento: string | null;
  feriasInicio: string | null;
  feriasRetornoEm: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  vencimentoContrato: string | null;
  instituicaoEnsino: string | null;
  cargoId: string;
  departamentoId: string;
  empresaId: string | null;
  cargo: { id: string; nome: string };
  departamento: { id: string; nome: string };
  empresa: { id: string; razaoSocial: string; cnpj: string } | null;
  documentos?: ColaboradorDocumento[];
  createdAt: string;
  updatedAt: string;
}

export interface ColaboradorPayload {
  nome: string;
  cpf: string;
  tipoVinculo: TipoVinculo;
  status?: StatusColaborador;
  fotoUrl?: string;
  dataNascimento?: string;
  telefone?: string;
  email?: string;
  dataAdmissao?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cargoId: string;
  departamentoId: string;
  empresaId?: string;
  vencimentoContrato?: string;
  instituicaoEnsino?: string;
}

export interface ListaColaboradores {
  data: Colaborador[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listarColaboradores(params: Record<string, string | number>): Promise<ListaColaboradores> {
  return (await api.get('/colaboradores', { params })).data;
}
export async function getColaborador(id: string): Promise<Colaborador> {
  return (await api.get(`/colaboradores/${id}`)).data;
}
export async function criarColaborador(payload: ColaboradorPayload): Promise<Colaborador> {
  return (await api.post('/colaboradores', payload)).data;
}
export async function atualizarColaborador(id: string, payload: Partial<ColaboradorPayload>): Promise<Colaborador> {
  return (await api.patch(`/colaboradores/${id}`, payload)).data;
}
export async function excluirColaborador(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/colaboradores/${id}`)).data;
}

/** Envia a foto do colaborador por upload (multipart). */
export async function enviarFotoColaborador(id: string, file: File): Promise<Colaborador> {
  const fd = new FormData();
  fd.append('foto', file);
  return (await api.post(`/colaboradores/${id}/foto`, fd)).data;
}

export interface AlterarStatusPayload {
  status: StatusColaborador;
  motivo?: string;
  dataDesligamento?: string;
  feriasInicio?: string;
  feriasFim?: string;
}
/** Muda o status (dinâmico: motivo / data de desligamento / início e fim de férias). */
export async function alterarStatusColaborador(id: string, payload: AlterarStatusPayload): Promise<Colaborador> {
  return (await api.patch(`/colaboradores/${id}/status`, payload)).data;
}

export interface ColaboradorHistorico {
  id: string;
  tipo: 'CADASTRO' | 'ALTERACAO' | 'MUDANCA_STATUS' | 'UPLOAD_FOTO';
  descricao: string;
  autor: string | null;
  createdAt: string;
}
export async function getHistoricoColaborador(id: string): Promise<ColaboradorHistorico[]> {
  return (await api.get(`/colaboradores/${id}/historico`)).data;
}

export interface ColaboradorDocumento {
  id: string;
  titulo: string;
  mimeType: string | null;
  url: string | null;
  createdAt: string;
}
/** Anexa um documento ao colaborador (multipart). */
export async function anexarDocumentoColaborador(id: string, file: File, titulo: string) {
  const fd = new FormData();
  fd.append('arquivo', file);
  fd.append('titulo', titulo);
  return (await api.post(`/colaboradores/${id}/documentos`, fd)).data;
}
export async function removerDocumentoColaborador(id: string, documentoId: string) {
  return (await api.delete(`/colaboradores/${id}/documentos/${documentoId}`)).data;
}

/** Máscara de CNPJ (00.000.000/0000-00). */
export function mascararCnpj(cnpj?: string | null): string {
  if (!cnpj) return '';
  const d = cnpj.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
