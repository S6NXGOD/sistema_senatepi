import { api } from './api';

/**
 * Portaria do clube — validação e histórico.
 *
 * Separado de `presencas` porque são fatos diferentes: presença é "esteve NESTE
 * EVENTO"; acesso é a entrada no clube, que acontece todo dia e sem evento.
 */

export type OrigemAcesso = 'QR' | 'MATRICULA' | 'CPF';

export const ORIGEM_ACESSO_LABEL: Record<OrigemAcesso, string> = {
  QR: 'Carteirinha (QR)',
  MATRICULA: 'Matrícula',
  CPF: 'CPF',
};

export interface ResultadoAcesso {
  encontrado: boolean;
  liberado: boolean;
  motivo: string;
  nome?: string;
  tipoPessoa?: string;
  origem?: OrigemAcesso;
  registroId?: string;
  registradoEm?: string;
  fotoUrl?: string | null;
}

export interface RegistroAcesso {
  id: string;
  nomeSnapshot: string;
  tipoPessoa: string;
  registradoEm: string;
  origem: OrigemAcesso;
  liberado: boolean;
  motivo: string;
  filiadoId: string | null;
}

/** Valida e REGISTRA a entrada — inclusive quando nega. */
export async function validarAcesso(dados: {
  qr?: unknown;
  identificador?: string;
}): Promise<ResultadoAcesso> {
  return (await api.post('/acessos/validar', dados)).data;
}

/** Histórico da portaria. Sem datas, devolve o dia de hoje. */
export async function listarAcessos(filtro: {
  de?: string;
  ate?: string;
  filiadoId?: string;
} = {}): Promise<RegistroAcesso[]> {
  return (await api.get('/acessos', { params: filtro })).data;
}
