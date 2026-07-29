import { UserRole } from '@prisma/client';

/**
 * Modelo de permissões por módulo (matriz por usuário).
 *
 * Cada usuário tem um PERFIL (UserRole) que define um preset de permissões, e
 * pode ter uma matriz própria (`User.permissoes`) que sobrescreve o preset,
 * módulo a módulo. A resolução efetiva é: matriz do usuário → preset do perfil.
 *
 * O ADMINISTRADOR tem acesso total e é o ÚNICO que pode apagar (DELETE) qualquer
 * coisa no sistema — regra aplicada globalmente no PermissionsGuard.
 */

export type NivelPermissao = 'SEM_ACESSO' | 'VISUALIZAR' | 'EDITAR';

/** Ranking para comparação (EDITAR abrange VISUALIZAR). */
export const RANK_NIVEL: Record<NivelPermissao, number> = {
  SEM_ACESSO: 0,
  VISUALIZAR: 1,
  EDITAR: 2,
};

export type ModuloKey =
  | 'dashboard'
  | 'atendimentos'
  | 'processos'
  | 'agenda'
  | 'filiados'
  | 'colaboradores'
  | 'eventos'
  | 'colonia'
  | 'cobrancas'
  | 'cadastros'
  | 'auditoria'
  | 'usuarios';

export interface ModuloInfo {
  key: ModuloKey;
  label: string;
  grupo: 'Principal' | 'Operacional' | 'Administração';
}

/** Registro dos módulos permissionáveis (ordem de exibição na matriz). */
export const MODULOS: ModuloInfo[] = [
  { key: 'dashboard', label: 'Dashboard', grupo: 'Principal' },
  { key: 'atendimentos', label: 'Triagem / Atendimento', grupo: 'Principal' },
  { key: 'processos', label: 'Processos', grupo: 'Principal' },
  { key: 'agenda', label: 'Agenda e Prazos', grupo: 'Principal' },
  { key: 'filiados', label: 'Filiados', grupo: 'Principal' },
  { key: 'colaboradores', label: 'Colaboradores', grupo: 'Principal' },
  { key: 'eventos', label: 'Eventos', grupo: 'Operacional' },
  { key: 'colonia', label: 'Colônia de Férias', grupo: 'Operacional' },
  { key: 'cobrancas', label: 'Cobranças', grupo: 'Operacional' },
  { key: 'cadastros', label: 'Cadastros Base', grupo: 'Administração' },
  { key: 'auditoria', label: 'Logs de Auditoria', grupo: 'Administração' },
  { key: 'usuarios', label: 'Usuários e Perfis', grupo: 'Administração' },
];

export const MODULO_KEYS = MODULOS.map((m) => m.key);

type MatrizPermissoes = Record<ModuloKey, NivelPermissao>;

const todos = (nivel: NivelPermissao): MatrizPermissoes =>
  MODULO_KEYS.reduce((acc, k) => ({ ...acc, [k]: nivel }), {} as MatrizPermissoes);

/**
 * Presets por perfil. O admin picar um perfil no formulário pré-preenche a matriz
 * com estes valores (que podem então ser ajustados módulo a módulo).
 */
export const PRESETS_PERFIL: Record<UserRole, MatrizPermissoes> = {
  ADMINISTRADOR: todos('EDITAR'),

  COORDENACAO: {
    dashboard: 'VISUALIZAR',
    atendimentos: 'EDITAR',
    processos: 'EDITAR',
    agenda: 'EDITAR',
    filiados: 'EDITAR',
    colaboradores: 'EDITAR',
    eventos: 'EDITAR',
    colonia: 'EDITAR',
    cobrancas: 'EDITAR',
    cadastros: 'EDITAR',
    auditoria: 'VISUALIZAR',
    usuarios: 'SEM_ACESSO',
  },

  ADVOGADO: {
    dashboard: 'VISUALIZAR',
    atendimentos: 'VISUALIZAR',
    processos: 'EDITAR',
    agenda: 'EDITAR',
    filiados: 'VISUALIZAR',
    colaboradores: 'SEM_ACESSO',
    eventos: 'SEM_ACESSO',
    colonia: 'SEM_ACESSO',
    cobrancas: 'SEM_ACESSO',
    cadastros: 'SEM_ACESSO',
    auditoria: 'SEM_ACESSO',
    usuarios: 'SEM_ACESSO',
  },

  TRIAGEM: {
    dashboard: 'VISUALIZAR',
    atendimentos: 'EDITAR',
    processos: 'SEM_ACESSO',
    agenda: 'VISUALIZAR',
    filiados: 'VISUALIZAR',
    colaboradores: 'SEM_ACESSO',
    eventos: 'SEM_ACESSO',
    colonia: 'SEM_ACESSO',
    cobrancas: 'SEM_ACESSO',
    cadastros: 'SEM_ACESSO',
    auditoria: 'SEM_ACESSO',
    usuarios: 'SEM_ACESSO',
  },
};

/** Nível efetivo de um usuário em um módulo (matriz própria → preset do perfil). */
export function nivelEfetivo(
  role: UserRole,
  permissoes: unknown,
  modulo: ModuloKey,
): NivelPermissao {
  if (role === UserRole.ADMINISTRADOR) return 'EDITAR';
  const matriz = (permissoes ?? {}) as Partial<Record<ModuloKey, NivelPermissao>>;
  const doUsuario = matriz?.[modulo];
  if (doUsuario && doUsuario in RANK_NIVEL) return doUsuario;
  return PRESETS_PERFIL[role]?.[modulo] ?? 'SEM_ACESSO';
}

/** Sanitiza uma matriz recebida do cliente, mantendo só módulos/níveis válidos. */
export function sanitizarPermissoes(entrada: unknown): Partial<Record<ModuloKey, NivelPermissao>> {
  const out: Partial<Record<ModuloKey, NivelPermissao>> = {};
  if (!entrada || typeof entrada !== 'object') return out;
  for (const k of MODULO_KEYS) {
    const v = (entrada as Record<string, unknown>)[k];
    if (typeof v === 'string' && v in RANK_NIVEL) out[k] = v as NivelPermissao;
  }
  return out;
}
