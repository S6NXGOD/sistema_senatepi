import { api, TIMEOUT_LONGO } from './api';
import { V } from '@/lib/vocabulario';

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
  /**
   * O CNJ está recusando as consultas vindas do servidor (bloqueio do CDN por
   * origem da requisição). Não é limite de uso nem falha do sistema — nenhuma
   * tentativa a mais resolve.
   */
  bloqueadoNaOrigem?: boolean;
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
  SOLICITAR_DOCUMENTOS_FILIADO: `Solicitar documentos ao ${V.filiado}`,
  COMUNICAR_FILIADO: `Comunicar ${V.filiado}`,
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
  // Consulta o CNJ, tribunal a tribunal — não cabe no timeout de leitura.
  const { data } = await api.post(`/djen/processo/${processoId}/sincronizar`, undefined, {
    timeout: TIMEOUT_LONGO,
  });
  return data;
}

/** O acompanhamento de todas as instâncias está ligado? */
export async function statusDatajud(): Promise<{ multiInstancia: boolean }> {
  const { data } = await api.get<{ multiInstancia: boolean }>('/datajud/status');
  return data;
}

// ---------------------------------------------------------------------------
// Busca no acervo já baixado
// ---------------------------------------------------------------------------

/**
 * O que a API do CNJ NÃO faz, esta busca faz.
 *
 * `nomeParte` e `nomeAdvogado` existem no Comunica PJe e são IGNORADOS pelo
 * servidor deles — mandar um nome inexistente devolve exatamente o mesmo
 * resultado. Mas os dois vêm DENTRO de cada publicação e são guardados aqui,
 * então procurar por parte é impossível na origem e trivial no acervo.
 */
export interface FiltroPublicacoes {
  q?: string;
  providencia?: string;
  tribunal?: string;
  situacao?: 'COM_TAREFA' | 'SEM_TAREFA';
  pagina?: number;
  limite?: number;
}

export interface PublicacaoNaBusca extends PublicacaoDjen {
  /**
   * As PARTES vêm junto do processo. Sem elas a lista não diz de quem é o
   * caso, e reconhecer um ato entre 984 vira leitura de cabeçalho de acórdão.
   */
  processo: {
    id: string;
    numeroCNJ: string | null;
    partes?: { nome: string; polo: string }[];
  } | null;
  compromisso: { id: string; titulo: string; status: string; inicio: string } | null;
}

export interface ResultadoPublicacoes {
  total: number;
  pagina: number;
  limite: number;
  paginas: number;
  itens: PublicacaoNaBusca[];
}

export async function buscarPublicacoes(filtro: FiltroPublicacoes): Promise<ResultadoPublicacoes> {
  const params = Object.fromEntries(
    Object.entries(filtro).filter(([, v]) => v !== undefined && v !== '' && v !== null),
  );
  const { data } = await api.get<ResultadoPublicacoes>('/djen/publicacoes', { params });
  return data;
}

export interface FacetasDjen {
  tribunais: { sigla: string; total: number }[];
  providencias: { slug: string; total: number }[];
}

export async function facetasPublicacoes(): Promise<FacetasDjen> {
  const { data } = await api.get<FacetasDjen>('/djen/publicacoes/facetas');
  return data;
}
