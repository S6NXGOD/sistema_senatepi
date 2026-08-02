import { api } from './api';
import type { MatrizPermissoes, PerfilUsuario } from './permissoes';

export interface Perfil {
  id: string;
  nome: string;
  nomeExibicao?: string | null;
  /** O e-mail é o login do sistema. */
  email: string;
  avatarUrl: string | null;
  role: PerfilUsuario;
  permissoes?: MatrizPermissoes | null;
  ativo: boolean;
  ultimoLoginEm: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfilePayload {
  nome?: string;
  /** Apelido exibido na interface. Vazio remove (volta a exibir o nome completo). */
  nomeExibicao?: string;
  email?: string;
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

/** Atualiza nome, nome de exibição e e-mail (PATCH /profile/update). */
export async function atualizarPerfil(payload: UpdateProfilePayload): Promise<Perfil> {
  return (await api.patch('/profile/update', payload)).data;
}

/** Troca de senha (PATCH /profile/change-password). */
export async function alterarSenha(payload: ChangePasswordPayload): Promise<{ ok: boolean }> {
  return (await api.patch('/profile/change-password', payload)).data;
}

/** Envia a foto de perfil por upload (POST /profile/avatar, multipart). */
export async function enviarAvatar(file: Blob): Promise<Perfil> {
  const fd = new FormData();
  fd.append('avatar', file, 'avatar.jpg');
  return (await api.post('/profile/avatar', fd)).data;
}

/** Remove a própria foto de perfil (DELETE /profile/avatar). */
export async function removerAvatar(): Promise<Perfil> {
  return (await api.delete('/profile/avatar')).data;
}

export const ROLE_LABEL: Record<Perfil['role'], string> = {
  ADMINISTRADOR: 'Administrador',
  COORDENACAO: 'Coordenação',
  ADVOGADO: 'Advogado(a)',
  TRIAGEM: 'Triagem',
};
