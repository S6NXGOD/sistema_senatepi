// Espelho (frontend) do modelo de permissões definido no backend.
// Mantém em sincronia com apps/api/src/common/permissions/permissoes.constants.ts

import { V } from '@/lib/vocabulario';

export type PerfilUsuario = 'ADMINISTRADOR' | 'COORDENACAO' | 'ADVOGADO' | 'TRIAGEM';
export type NivelPermissao = 'SEM_ACESSO' | 'VISUALIZAR' | 'EDITAR';

export const RANK_NIVEL: Record<NivelPermissao, number> = {
  SEM_ACESSO: 0,
  VISUALIZAR: 1,
  EDITAR: 2,
};

export const NIVEL_LABEL: Record<NivelPermissao, string> = {
  SEM_ACESSO: 'Sem acesso',
  VISUALIZAR: 'Só visualizar',
  EDITAR: 'Visualizar e editar',
};

export type ModuloKey =
  | 'dashboard' | 'atendimentos' | 'processos' | 'agenda' | 'filiados' | 'colaboradores'
  | 'escalas' | 'eventos' | 'colonia' | 'acessos' | 'cobrancas' | 'empresas' | 'auditoria' | 'usuarios';

export interface ModuloInfo {
  key: ModuloKey;
  label: string;
  grupo: 'Principal' | 'Operacional' | 'Administração';
}

export const MODULOS: ModuloInfo[] = [
  { key: 'dashboard', label: 'Dashboard', grupo: 'Principal' },
  { key: 'atendimentos', label: 'Triagem / Atendimento', grupo: 'Principal' },
  { key: 'processos', label: 'Processos', grupo: 'Principal' },
  { key: 'agenda', label: 'Agenda e Prazos', grupo: 'Principal' },
  { key: 'filiados', label: V.Filiados, grupo: 'Principal' },
  { key: 'colaboradores', label: 'Colaboradores', grupo: 'Principal' },
  { key: 'escalas', label: 'Escalas dos Advogados', grupo: 'Operacional' },
  { key: 'eventos', label: 'Eventos', grupo: 'Operacional' },
  { key: 'colonia', label: 'Colônia de Férias', grupo: 'Operacional' },
  { key: 'acessos', label: 'Portaria / Acesso ao Clube', grupo: 'Operacional' },
  { key: 'cobrancas', label: 'Cobranças', grupo: 'Operacional' },
  { key: 'empresas', label: 'Empresas (Patronal)', grupo: 'Operacional' },
  // "Cadastros Base" saiu: cargos e departamentos passaram a viver dentro de
  // Colaboradores e seguem a permissão dele.
  { key: 'auditoria', label: 'Logs de Auditoria', grupo: 'Administração' },
  { key: 'usuarios', label: 'Usuários e Perfis', grupo: 'Administração' },
];

export const MODULO_KEYS = MODULOS.map((m) => m.key);
export type MatrizPermissoes = Partial<Record<ModuloKey, NivelPermissao>>;

const todos = (nivel: NivelPermissao): Record<ModuloKey, NivelPermissao> =>
  MODULO_KEYS.reduce((acc, k) => ({ ...acc, [k]: nivel }), {} as Record<ModuloKey, NivelPermissao>);

export const PRESETS_PERFIL: Record<PerfilUsuario, Record<ModuloKey, NivelPermissao>> = {
  ADMINISTRADOR: todos('EDITAR'),
  COORDENACAO: {
    dashboard: 'VISUALIZAR', atendimentos: 'EDITAR', processos: 'EDITAR', agenda: 'EDITAR',
    filiados: 'EDITAR', colaboradores: 'EDITAR', escalas: 'EDITAR', eventos: 'EDITAR', colonia: 'EDITAR',
    acessos: 'EDITAR', cobrancas: 'EDITAR', empresas: 'EDITAR', auditoria: 'VISUALIZAR', usuarios: 'SEM_ACESSO',
  },
  ADVOGADO: {
    dashboard: 'VISUALIZAR', atendimentos: 'VISUALIZAR', processos: 'EDITAR', agenda: 'EDITAR',
    filiados: 'VISUALIZAR', colaboradores: 'SEM_ACESSO', escalas: 'VISUALIZAR', eventos: 'SEM_ACESSO', colonia: 'SEM_ACESSO',
    acessos: 'SEM_ACESSO', cobrancas: 'SEM_ACESSO', empresas: 'SEM_ACESSO', auditoria: 'SEM_ACESSO', usuarios: 'SEM_ACESSO',
  },
  TRIAGEM: {
    dashboard: 'VISUALIZAR', atendimentos: 'EDITAR', processos: 'SEM_ACESSO', agenda: 'VISUALIZAR',
    filiados: 'VISUALIZAR', colaboradores: 'SEM_ACESSO', escalas: 'SEM_ACESSO', eventos: 'SEM_ACESSO', colonia: 'SEM_ACESSO',
    // Quem fica no balcão é quem valida a entrada no clube.
    acessos: 'EDITAR',
    // A secretaria (Triagem) cadastra a empresa e define a senha provisória.
    cobrancas: 'SEM_ACESSO', empresas: 'EDITAR', auditoria: 'SEM_ACESSO', usuarios: 'SEM_ACESSO',
  },
};

/** Metadados de exibição dos perfis (cards do formulário). */
export interface PerfilInfo {
  key: PerfilUsuario;
  label: string;
  descricao: string;
}
export const PERFIS: PerfilInfo[] = [
  { key: 'TRIAGEM', label: 'Triagem', descricao: `Atendimento inicial de ${V.filiados} e registro de demandas.` },
  { key: 'ADVOGADO', label: 'Advogado(a)', descricao: 'Acesso a processos, agenda de prazos e acompanhamento jurídico.' },
  { key: 'COORDENACAO', label: 'Coordenação', descricao: 'Gestão de equipe, financeiro e relatórios gerenciais.' },
  { key: 'ADMINISTRADOR', label: 'Administrador', descricao: 'Acesso completo a todos os módulos e configurações.' },
];
export const PERFIL_LABEL: Record<PerfilUsuario, string> = {
  ADMINISTRADOR: 'Administrador', COORDENACAO: 'Coordenação', ADVOGADO: 'Advogado(a)', TRIAGEM: 'Triagem',
};

/** Nível efetivo de um usuário em um módulo (matriz própria → preset do perfil). */
export function nivelEfetivo(
  role: PerfilUsuario | string | null | undefined,
  permissoes: unknown,
  modulo: ModuloKey,
): NivelPermissao {
  if (role === 'ADMINISTRADOR') return 'EDITAR';
  const perfil = (role as PerfilUsuario) in PRESETS_PERFIL ? (role as PerfilUsuario) : 'TRIAGEM';
  const matriz = (permissoes ?? {}) as MatrizPermissoes;
  const doUsuario = matriz?.[modulo];
  if (doUsuario && doUsuario in RANK_NIVEL) return doUsuario;
  return PRESETS_PERFIL[perfil]?.[modulo] ?? 'SEM_ACESSO';
}

/** Pode ao menos visualizar o módulo? (usado no gating de navegação) */
export function podeVer(
  role: PerfilUsuario | string | null | undefined,
  permissoes: unknown,
  modulo: ModuloKey,
): boolean {
  return RANK_NIVEL[nivelEfetivo(role, permissoes, modulo)] >= RANK_NIVEL.VISUALIZAR;
}

/** Pode gravar no módulo? (usado para não exibir ações que a API vai recusar) */
export function podeEditar(
  role: PerfilUsuario | string | null | undefined,
  permissoes: unknown,
  modulo: ModuloKey,
): boolean {
  return RANK_NIVEL[nivelEfetivo(role, permissoes, modulo)] >= RANK_NIVEL.EDITAR;
}

/**
 * Pode EXCLUIR registros do sistema?
 *
 * Regra global e sem exceção por módulo: **apenas o ADMINISTRADOR apaga**. O
 * `PermissionsGuard` já barra todo DELETE no backend (a única exceção são as
 * rotas de autoatendimento do próprio perfil), então esta função existe para a
 * TELA não oferecer um botão que a API vai recusar com 403.
 *
 * Use sempre esta função em vez de comparar a role à mão: era a comparação
 * espalhada que fazia alguns componentes esquecerem a regra — a Coordenação
 * chegou a ver "Excluir filiado", que só falhava depois do clique.
 */
export function podeExcluir(role: PerfilUsuario | string | null | undefined): boolean {
  return role === 'ADMINISTRADOR';
}
