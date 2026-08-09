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
  | 'escalas'
  | 'eventos'
  | 'colonia'
  | 'acessos'
  | 'cobrancas'
  | 'empresas'
  | 'organizacoes'
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
  { key: 'escalas', label: 'Escalas dos Advogados', grupo: 'Operacional' },
  { key: 'eventos', label: 'Eventos', grupo: 'Operacional' },
  { key: 'colonia', label: 'Colônia de Férias', grupo: 'Operacional' },
  { key: 'acessos', label: 'Portaria / Acesso ao Clube', grupo: 'Operacional' },
  { key: 'cobrancas', label: 'Cobranças', grupo: 'Operacional' },
  { key: 'empresas', label: 'Empresas contribuintes (Patronal)', grupo: 'Operacional' },
  /**
   * A TELA de cadastro de órgãos/organizações (`partes_externas`).
   *
   * NÃO é o dado — o dado é de `processos`, e o `PartesExternasController`
   * segue com `@Modulo('processos')` de propósito: os MESMOS endpoints
   * alimentam o seletor de partes do processo e o combobox de empregador do
   * vínculo profissional. Gatear o controller aqui derrubaria as duas coisas
   * num cliente sem esta tela.
   *
   * Existe como módulo separado porque colide com `empresas` em quem tem os
   * dois: no SENATEPI "Empresas" (patronal, faz repasse) e "Organizações"
   * (órgão/parte) apareceriam lado a lado, mesmo ícone, nomes sinônimos, e
   * obrigariam a cadastrar o mesmo hospital duas vezes. Enquanto os dois
   * cadastros não forem unificados, a tela fica só onde não há ambiguidade.
   */
  { key: 'organizacoes', label: 'Organizações (órgãos e partes)', grupo: 'Operacional' },
  // "Cadastros Base" saiu: cargos e departamentos são listas de apoio de
  // Colaboradores e seguem a permissão DELE. Uma linha só para editar duas
  // listas não se pagava — e não valia nada, porque o controller checava
  // `@Roles` em vez do módulo.
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
    escalas: 'EDITAR',
    eventos: 'EDITAR',
    colonia: 'EDITAR',
    // A portaria é operação de balcão: coordenação e triagem validam entrada.
    acessos: 'EDITAR',
    cobrancas: 'EDITAR',
    empresas: 'EDITAR',
    // Espelha `processos` em todos os perfis: é a mesma tabela, vista por
    // outra porta. Divergir daria o absurdo de quem edita a parte dentro do
    // processo não poder corrigir o nome dela na tela de cadastro.
    organizacoes: 'EDITAR',
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
    escalas: 'VISUALIZAR',
    eventos: 'SEM_ACESSO',
    colonia: 'SEM_ACESSO',
    acessos: 'SEM_ACESSO',
    cobrancas: 'SEM_ACESSO',
    empresas: 'SEM_ACESSO',
    // O advogado edita partes dentro do processo; corrigir o cadastro delas
    // é a mesma atribuição.
    organizacoes: 'EDITAR',
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
    escalas: 'SEM_ACESSO',
    eventos: 'SEM_ACESSO',
    colonia: 'SEM_ACESSO',
    // Quem fica no balcão é quem valida a entrada no clube.
    acessos: 'EDITAR',
    cobrancas: 'SEM_ACESSO',
    // A secretaria (Triagem) é quem cadastra a empresa e define a senha provisória.
    empresas: 'EDITAR',
    // Acompanha `processos`, que a Triagem não vê.
    organizacoes: 'SEM_ACESSO',
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
