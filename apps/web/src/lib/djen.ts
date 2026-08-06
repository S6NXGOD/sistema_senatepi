import { api } from './api';

/**
 * Publicações e intimações do DJEN (Diário de Justiça Eletrônico Nacional).
 *
 * Complementa o DataJud: o CNJ entrega o rótulo do ato ("Expedição de
 * documento"), o DJEN entrega o TEOR — que é onde está a providência e o prazo.
 */

export interface PublicacaoDjen {
  id: string;
  hash: string;
  siglaTribunal: string;
  /** Intimação | Edital | Citação | Lista de distribuição. */
  tipoComunicacao: string | null;
  /** Texto livre, varia por tribunal — exibição apenas. */
  tipoDocumento: string | null;
  nomeOrgao: string | null;
  nomeClasse: string | null;
  /** D = Diário Nacional; E = Plataforma de Editais. */
  meio: string | null;
  link: string | null;
  /** Teor integral do ato. */
  texto: string;
  dataDisponibilizacao: string;
  /** Providência classificada a partir do texto. */
  providencia: string | null;
  /** Prazo que o TEXTO menciona — sugestão, não vencimento calculado. */
  prazoMencionadoDias: number | null;
  /** Atividade da agenda criada ou enriquecida por esta publicação. */
  compromissoId: string | null;
  /** Movimentação do DataJud que descreve o mesmo fato. */
  movimentacaoId: string | null;
  destinatarios: { nome: string | null; polo: string | null }[] | null;
  advogados: { nome: string | null; numeroOab: string | null; ufOab: string | null }[] | null;
}

export interface StatusDjen {
  ativo: boolean;
  janelaDias: number;
  publicacoes: number;
  /** Advogados que a varredura por OAB alcança. Zero aqui explica silêncio. */
  advogadosComOab: number;
}

/**
 * Rótulos das providências. O back devolve o slug; a tradução mora aqui porque
 * é texto de interface, e não regra.
 */
export const PROVIDENCIA_LABEL: Record<string, string> = {
  ANALISAR_INTIMACAO: 'Analisar intimação',
  ELABORAR_MANIFESTACAO: 'Elaborar manifestação',
  JUNTAR_DOCUMENTOS: 'Juntar documentos',
  ANALISAR_SENTENCA: 'Analisar sentença',
  AVALIAR_RECURSO: 'Avaliar recurso',
  PREPARAR_AUDIENCIA: 'Preparar audiência',
  SOLICITAR_DOCUMENTOS_FILIADO: 'Solicitar documentos ao filiado',
  COMUNICAR_FILIADO: 'Comunicar filiado',
};

/**
 * Estado da integração. É a única rota que responde com o DJEN desligado — as
 * demais devolvem 404 de propósito.
 */
export async function statusDjen(): Promise<StatusDjen> {
  const { data } = await api.get<StatusDjen>('/djen/status');
  return data;
}

export async function listarPublicacoes(processoId: string): Promise<PublicacaoDjen[]> {
  const { data } = await api.get<PublicacaoDjen[]>(`/djen/processo/${processoId}`);
  return data;
}

/** Busca no DJEN sob demanda (botão da ficha do processo). */
export async function sincronizarPublicacoes(
  processoId: string,
): Promise<{ ingeridas: number; recebidas: number }> {
  const { data } = await api.post(`/djen/processo/${processoId}/sincronizar`);
  return data;
}

/** O acompanhamento de todas as instâncias está ligado? */
export async function statusDatajud(): Promise<{ multiInstancia: boolean }> {
  const { data } = await api.get<{ multiInstancia: boolean }>('/datajud/status');
  return data;
}
