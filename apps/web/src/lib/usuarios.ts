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
