import { api } from './api';

// ---------------------------------------------------------------------------
// Radar de "Audiências a Agendar" — movimentações do DataJud que designam
// pauta e ainda não viraram evento na Agenda.
// ---------------------------------------------------------------------------

export interface AudienciaAAgendar {
  /** Id da MOVIMENTAÇÃO do DataJud (é ela que carrega o estado do alerta). */
  id: string;
  descricao: string;
  dataMovimento: string;
  codigoMovimento: number | null;
  /** Data/hora extraída do texto da movimentação (null quando não veio). */
  audienciaData: string | null;
  /** false quando o texto trouxe só a data (sem horário). */
  horaDefinida: boolean;
  /** A data designada já passou — chegou atrasada, exige conferência. */
  dataNoPassado: boolean;
  diasAteAudiencia: number | null;
  processo: {
    id: string;
    numeroCNJ: string;
    classeProcessual: string | null;
    orgaoJulgador: string | null;
    tribunal: string | null;
    filiado: { id: string; nomeCompleto: string } | null;
    advogado: { id: string; nome: string } | null;
  };
  /** Já existe evento de audiência no mesmo processo e no mesmo dia. */
  eventoExistente: { id: string; titulo: string; inicio: string } | null;
}

export interface ListaAudiencias {
  total: number;
  items: AudienciaAAgendar[];
}

export async function listarAudienciasAAgendar(
  opcoes: { apenasMeus?: boolean; limite?: number } = {},
): Promise<ListaAudiencias> {
  const params: Record<string, string> = {};
  if (opcoes.apenasMeus) params.apenasMeus = 'true';
  if (opcoes.limite) params.limite = String(opcoes.limite);
  return (await api.get('/audiencias-a-agendar', { params })).data;
}

/** Grava a dispensa no banco — o alerta não volta na varredura noturna. */
export async function dispensarAudiencia(id: string, motivo?: string) {
  return (await api.post(`/audiencias-a-agendar/${id}/dispensar`, { motivo })).data;
}

/** Desfaz a dispensa (o alerta reaparece se ainda estiver vigente). */
export async function restaurarAudiencia(id: string) {
  return (await api.post(`/audiencias-a-agendar/${id}/restaurar`)).data;
}

export interface AgendarAudienciaInput {
  inicio: string;
  fim?: string;
  responsavelId: string;
  titulo?: string;
  local?: string;
  urgente?: boolean;
  observacoesInternas?: string;
}
/** Cria o evento na Agenda e resolve o alerta numa única chamada. */
export async function agendarAudiencia(id: string, dto: AgendarAudienciaInput) {
  return (await api.post(`/audiencias-a-agendar/${id}/agendar`, dto)).data;
}

// ---------------------------------------------------------------------------
// Exibição
// ---------------------------------------------------------------------------

/** "15/08/2026 às 14:30" — omite a hora quando o texto não trouxe. */
export function rotuloDataAudiencia(a: AudienciaAAgendar): string {
  if (!a.audienciaData) return 'Data não informada na movimentação';
  const d = new Date(a.audienciaData);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!a.horaDefinida) return data;
  return `${data} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "em 12 dias" / "amanhã" / "há 3 dias" — urgência em uma olhada. */
export function prazoAudiencia(a: AudienciaAAgendar): string | null {
  const dias = a.diasAteAudiencia;
  if (dias === null) return null;
  if (dias < 0) return `há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}`;
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}

/** Tom do card: vermelho quando passou ou é iminente; âmbar no resto. */
export function tomAudiencia(a: AudienciaAAgendar): 'vermelho' | 'ambar' {
  if (a.dataNoPassado) return 'vermelho';
  return a.diasAteAudiencia !== null && a.diasAteAudiencia <= 3 ? 'vermelho' : 'ambar';
}
