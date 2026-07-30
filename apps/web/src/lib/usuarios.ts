import { api } from './api';
import { MatrizPermissoes, PerfilUsuario } from './permissoes';

export interface UsuarioSistema {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  email: string;
  username: string | null;
  role: PerfilUsuario;
  permissoes: MatrizPermissoes | null;
  ativo: boolean;
  avatarUrl: string | null;
  ultimoLoginEm: string | null;
  createdAt: string;
}

export interface CriarUsuarioInput {
  nome: string;
  nomeExibicao?: string;
  username: string;
  email: string;
  senha: string;
  role: PerfilUsuario;
  ativo?: boolean;
  permissoes?: MatrizPermissoes;
}
export type AtualizarUsuarioInput = Partial<CriarUsuarioInput>;

export async function listarUsuarios(busca?: string): Promise<UsuarioSistema[]> {
  return (await api.get('/usuarios', { params: busca ? { busca } : {} })).data;
}
export async function criarUsuario(dto: CriarUsuarioInput): Promise<UsuarioSistema> {
  return (await api.post('/usuarios', dto)).data;
}
export async function atualizarUsuario(id: string, dto: AtualizarUsuarioInput): Promise<UsuarioSistema> {
  return (await api.patch(`/usuarios/${id}`, dto)).data;
}
export async function excluirUsuario(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/usuarios/${id}`)).data;
}

/** Envia a foto de perfil do usuário (POST /usuarios/:id/avatar, multipart). */
export async function enviarAvatarUsuario(id: string, foto: Blob): Promise<UsuarioSistema> {
  const fd = new FormData();
  fd.append('avatar', foto, 'avatar.jpg');
  return (await api.post(`/usuarios/${id}/avatar`, fd)).data;
}

/** Remove a foto de perfil do usuário. */
export async function removerAvatarUsuario(id: string): Promise<UsuarioSistema> {
  return (await api.delete(`/usuarios/${id}/avatar`)).data;
}
