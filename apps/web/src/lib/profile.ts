import { api } from './api';

export interface Perfil {
  id: string;
  nome: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
  role: 'ADMIN' | 'DIRETORIA' | 'FUNCIONARIO' | 'RECEPCAO';
  ativo: boolean;
  ultimoLoginEm: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfilePayload {
  nome?: string;
  email?: string;
  username?: string;
  avatarUrl?: string;
}

export interface ChangePasswordPayload {
  senhaAtual: string;
  novaSenha: string;
  confirmarNovaSenha: string;
}

/** Dados do usuário logado (GET /profile/me). */
export async function getMeuPerfil(): Promise<Perfil> {
  return (await api.get('/profile/me')).data;
}

/** Atualiza nome/e-mail/username/avatar (PATCH /profile/update). */
export async function atualizarPerfil(payload: UpdateProfilePayload): Promise<Perfil> {
  return (await api.patch('/profile/update', payload)).data;
}

/** Troca de senha (PATCH /profile/change-password). */
export async function alterarSenha(payload: ChangePasswordPayload): Promise<{ ok: boolean }> {
  return (await api.patch('/profile/change-password', payload)).data;
}

/** Envia a foto de perfil por upload (POST /profile/avatar, multipart). */
export async function enviarAvatar(file: File): Promise<Perfil> {
  const fd = new FormData();
  fd.append('avatar', file);
  return (await api.post('/profile/avatar', fd)).data;
}

export const ROLE_LABEL: Record<Perfil['role'], string> = {
  ADMIN: 'Administrador',
  DIRETORIA: 'Diretoria',
  FUNCIONARIO: 'Funcionário',
  RECEPCAO: 'Recepção',
};
