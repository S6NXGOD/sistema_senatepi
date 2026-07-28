import { api } from './api';

export interface ContaBancaria {
  id: string;
  nome: string;
  instituicao?: string | null;
}

export async function listarContas(): Promise<ContaBancaria[]> {
  return (await api.get('/financeiro/contas')).data;
}

export async function criarConta(dto: { nome: string; instituicao?: string }): Promise<ContaBancaria> {
  return (await api.post('/financeiro/contas', dto)).data;
}
