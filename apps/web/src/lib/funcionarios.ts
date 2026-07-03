export type TipoFuncionario =
  | 'FUNCIONARIO'
  | 'PRESTADOR_SERVICO'
  | 'ESTAGIARIO'
  | 'TERCEIRIZADO';

export type StatusFuncionario =
  | 'ATIVO'
  | 'INATIVO'
  | 'AFASTADO'
  | 'FERIAS'
  | 'DESLIGADO';

export interface Funcionario {
  id: string;
  matricula: string;
  nome: string;
  cpf: string;
  dataNascimento?: string | null;
  dataAdmissao?: string | null;
  telefone?: string | null;
  email?: string | null;
  cargo?: string | null;
  departamento?: string | null;
  tipo: TipoFuncionario;
  status: StatusFuncionario;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  fotoUrl?: string | null;
  createdAt: string;
}

export const TIPO_LABEL: Record<TipoFuncionario, string> = {
  FUNCIONARIO: 'Funcionário',
  PRESTADOR_SERVICO: 'Prestador de Serviço',
  ESTAGIARIO: 'Estagiário',
  TERCEIRIZADO: 'Terceirizado',
};

export const STATUS_LABEL: Record<StatusFuncionario, string> = {
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  AFASTADO: 'Afastado',
  FERIAS: 'Férias',
  DESLIGADO: 'Desligado',
};

export const STATUS_COR: Record<StatusFuncionario, string> = {
  ATIVO: 'bg-senatepi-50 text-senatepi-800',
  INATIVO: 'bg-gray-100 text-gray-600',
  AFASTADO: 'bg-amber-100 text-amber-700',
  FERIAS: 'bg-blue-100 text-blue-700',
  DESLIGADO: 'bg-red-100 text-red-700',
};

export const TIPOS = Object.keys(TIPO_LABEL) as TipoFuncionario[];
export const STATUS = Object.keys(STATUS_LABEL) as StatusFuncionario[];
