import { FormacaoProfissional, SituacaoFiliado, Sexo, EstadoCivil } from '@prisma/client';

/**
 * Mapeamento das colunas do CSV legado → campos do sistema.
 * A chave é normalizada (minúscula, sem espaços) para casar com variações.
 */
export const MAPA_COLUNAS: Record<string, { campo: string; rotulo: string }> = {
  nrmatricula: { campo: 'matricula', rotulo: 'Matrícula Sindical' },
  nome: { campo: 'nomeCompleto', rotulo: 'Nome Completo' },
  cpf: { campo: 'cpf', rotulo: 'CPF' },
  rg: { campo: 'rg', rotulo: 'RG' },
  datanascimento: { campo: 'dataNascimento', rotulo: 'Data de Nascimento' },
  sexo: { campo: 'sexo', rotulo: 'Sexo' },
  estadocivil: { campo: 'estadoCivil', rotulo: 'Estado Civil' },
  naturalidade: { campo: 'naturalidade', rotulo: 'Naturalidade' },
  uf_naturalidade: { campo: 'ufNaturalidade', rotulo: 'UF Naturalidade' },
  telefone: { campo: 'telefonePrincipal', rotulo: 'Telefone' },
  celular: { campo: 'telefoneSecundario', rotulo: 'Celular' },
  email: { campo: 'email', rotulo: 'E-mail' },
  endereco: { campo: 'endereco', rotulo: 'Endereço' },
  bairro: { campo: 'bairro', rotulo: 'Bairro' },
  cidade: { campo: 'cidade', rotulo: 'Cidade' },
  uf: { campo: 'estado', rotulo: 'Estado' },
  cep: { campo: 'cep', rotulo: 'CEP' },
  profissao: { campo: 'formacao', rotulo: 'Formação/Categoria' },
  empresa: { campo: 'empresa', rotulo: 'Instituição/Empresa' },
  dataadmissao: { campo: 'dataAdmissao', rotulo: 'Data de Admissão' },
  status: { campo: 'situacao', rotulo: 'Situação' },
  datacadastro: { campo: 'dataFiliacao', rotulo: 'Data de Filiação' },
};

/** Códigos de problema de validação e seus rótulos (para o resumo por tipo). */
export const CODIGO_LABEL: Record<string, string> = {
  NOME_AUSENTE: 'Nome ausente',
  CPF_INVALIDO: 'CPF inválido (dígito verificador)',
  CPF_DUP_ARQUIVO: 'CPF repetido no arquivo',
  MATRICULA_DUP_ARQUIVO: 'Matrícula repetida no arquivo',
  SEM_CPF: 'Sem CPF',
  DATA_INVALIDA: 'Data inválida',
  EMAIL_INVALIDO: 'E-mail inválido',
  DUP_SISTEMA_CPF: 'CPF já cadastrado no sistema',
  DUP_SISTEMA_MATRICULA: 'Matrícula já existe no sistema',
};

export function normalizarChave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Detecta o mapeamento automático a partir dos cabeçalhos do CSV. */
export function detectarMapeamento(headers: string[]) {
  return headers.map((header) => {
    const chave = normalizarChave(header).replace(/_/g, '');
    const direto = MAPA_COLUNAS[normalizarChave(header)] ?? MAPA_COLUNAS[chave];
    return {
      coluna: header,
      campo: direto?.campo ?? null,
      rotulo: direto?.rotulo ?? null,
    };
  });
}

// ----------------------------------------------------------------------------
// Validação de CPF
// ----------------------------------------------------------------------------
export function limparCpf(cpf?: string | null): string {
  // Considera só os dígitos (ignora máscara: pontos, traços, espaços)
  const d = (cpf ?? '').replace(/\D/g, '');
  // Bases legadas guardam o CPF como número e perdem os zeros à esquerda
  // (ex.: 019.984.233-05 -> "1998423305"). Recompõe para 11 dígitos.
  if (d.length >= 1 && d.length < 11) return d.padStart(11, '0');
  return d;
}

/**
 * CPF "ausente" para fins de migração: vazio, só zeros ou dígitos repetidos
 * (ex.: 000.000.000-00, 111.111.111-11). Esses casos serão importados sem CPF.
 */
export function cpfVazioOuPlaceholder(cpfRaw?: string | null): boolean {
  const cpf = limparCpf(cpfRaw);
  if (cpf === '') return true;
  if (/^0+$/.test(cpf)) return true;
  if (/^(\d)\1{10}$/.test(cpf)) return true;
  return false;
}

export function cpfValido(cpfRaw?: string | null): boolean {
  const cpf = limparCpf(cpfRaw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos iguais
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let d1 = (soma * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  let d2 = (soma * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10]);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function emailValido(email?: string | null): boolean {
  if (!email) return true; // vazio é tolerado (não obrigatório)
  return EMAIL_REGEX.test(email.trim());
}

// ----------------------------------------------------------------------------
// Datas (aceita dd/mm/aaaa, aaaa-mm-dd, dd-mm-aaaa, ISO)
// ----------------------------------------------------------------------------
export function parseData(valor?: string | null): Date | null | 'INVALIDA' {
  const v = (valor ?? '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let [, d, mes, ano] = m;
    let dia = parseInt(d);
    let mm = parseInt(mes);
    let yyyy = parseInt(ano.length === 2 ? `19${ano}` : ano);
    const dt = new Date(Date.UTC(yyyy, mm - 1, dia));
    if (dt.getUTCFullYear() === yyyy && dt.getUTCMonth() === mm - 1 && dt.getUTCDate() === dia)
      return dt;
    return 'INVALIDA';
  }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const dt = new Date(v);
    return isNaN(dt.getTime()) ? 'INVALIDA' : dt;
  }
  const dt = new Date(v);
  return isNaN(dt.getTime()) ? 'INVALIDA' : dt;
}

// ----------------------------------------------------------------------------
// Mapeamento de domínios (profissão, situação, sexo, estado civil)
// ----------------------------------------------------------------------------
export function mapearFormacao(valor?: string | null): {
  formacao: FormacaoProfissional;
  formacaoOutro: string | null;
} {
  const v = (valor ?? '').toLowerCase();
  if (/enfermeir/.test(v)) return { formacao: 'ENFERMEIRO', formacaoOutro: null };
  if (/t[eé]cnic/.test(v)) return { formacao: 'TECNICO_ENFERMAGEM', formacaoOutro: null };
  if (/auxiliar/.test(v)) return { formacao: 'AUXILIAR_ENFERMAGEM', formacaoOutro: null };
  if (!v.trim()) return { formacao: 'OUTRO', formacaoOutro: null };
  return { formacao: 'OUTRO', formacaoOutro: valor!.trim() };
}

export function mapearSituacao(valor?: string | null): SituacaoFiliado {
  const v = (valor ?? '').trim().toLowerCase();
  // Situações válidas: ATIVO, INATIVO, DESFILIADO.
  if (['desfiliado', 'desligado', 'cancelado'].includes(v)) return 'DESFILIADO';
  if (['inativo', 'i', '0', 'suspenso', 's', 'pendente', 'p'].includes(v)) return 'INATIVO';
  // Padrão para migração de base existente: ativo
  return 'ATIVO';
}

export function mapearSexo(valor?: string | null): Sexo | null {
  const v = (valor ?? '').trim().toLowerCase();
  if (['m', 'masculino'].includes(v)) return 'MASCULINO';
  if (['f', 'feminino'].includes(v)) return 'FEMININO';
  if (!v) return null;
  return 'OUTRO';
}

export function mapearEstadoCivil(valor?: string | null): EstadoCivil | null {
  const v = (valor ?? '').trim().toLowerCase();
  if (/solteir/.test(v)) return 'SOLTEIRO';
  if (/casad/.test(v)) return 'CASADO';
  if (/divorciad/.test(v)) return 'DIVORCIADO';
  if (/vi[uú]v/.test(v)) return 'VIUVO';
  if (/uni[aã]o/.test(v)) return 'UNIAO_ESTAVEL';
  if (!v) return null;
  return 'OUTRO';
}

export function limpar(valor?: string | null): string | undefined {
  const v = (valor ?? '').trim();
  return v === '' ? undefined : v;
}
