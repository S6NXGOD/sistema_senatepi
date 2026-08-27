import { api } from './api';

export interface AdvogadoEscala {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  role?: string;
}

export interface Escala {
  id: string;
  data: string; // ISO (data)
  horaInicio: string; // "HH:MM"
  horaFim: string; // "HH:MM"
  observacao: string | null;
  advogado: AdvogadoEscala;
}

export interface EscalaItemInput {
  data: string;
  horaInicio: string;
  horaFim: string;
  observacao?: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function listarAdvogadosEscala(): Promise<AdvogadoEscala[]> {
  return (await api.get('/escalas/advogados')).data;
}

export interface PlantaoItem {
  id: string;
  data: string;
  horaInicio: string;
  horaFim: string;
  advogado: AdvogadoEscala;
}
/** Advogados de plantão numa data (YYYY-MM-DD; padrão hoje). */
export async function listarPlantao(data?: string): Promise<PlantaoItem[]> {
  return (await api.get('/escalas/plantao', { params: data ? { data } : {} })).data;
}

/** "no horário": hora atual dentro do turno (só faz sentido p/ o dia de hoje). */
export function estaNoHorario(p: { horaInicio: string; horaFim: string }): boolean {
  const agora = new Date();
  const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  return hhmm >= p.horaInicio && hhmm <= p.horaFim;
}
export async function listarEscalas(mes: string, advogadoId?: string): Promise<Escala[]> {
  return (await api.get('/escalas', { params: { mes, ...(advogadoId ? { advogadoId } : {}) } })).data;
}
export async function criarEscalas(advogadoId: string, itens: EscalaItemInput[]) {
  return (await api.post('/escalas', { advogadoId, itens })).data as { ok: boolean; criadas: number };
}
export async function excluirEscala(id: string) {
  return (await api.delete(`/escalas/${id}`)).data as { ok: boolean };
}

// ---------------------------------------------------------------------------
// Cores por advogado (atribuídas por ordem — garantem distinção na legenda)
// ---------------------------------------------------------------------------

export interface CorAdvogado {
  bg: string; // classe Tailwind (barra)
  dot: string; // classe Tailwind (legenda)
  hex: string; // para o PDF
}

export const PALETA_ADVOGADOS: CorAdvogado[] = [
  { bg: 'bg-blue-500', dot: 'bg-blue-500', hex: '#3b82f6' },
  { bg: 'bg-purple-500', dot: 'bg-purple-500', hex: '#a855f7' },
  { bg: 'bg-green-600', dot: 'bg-green-600', hex: '#16a34a' },
  { bg: 'bg-orange-500', dot: 'bg-orange-500', hex: '#f97316' },
  { bg: 'bg-pink-500', dot: 'bg-pink-500', hex: '#ec4899' },
  { bg: 'bg-teal-500', dot: 'bg-teal-500', hex: '#14b8a6' },
  { bg: 'bg-amber-500', dot: 'bg-amber-500', hex: '#f59e0b' },
  { bg: 'bg-red-500', dot: 'bg-red-500', hex: '#ef4444' },
  { bg: 'bg-indigo-500', dot: 'bg-indigo-500', hex: '#6366f1' },
  { bg: 'bg-cyan-500', dot: 'bg-cyan-500', hex: '#06b6d4' },
];

/** Mapa advogadoId → cor, atribuído por ordem (cada advogado uma cor distinta). */
export function montarCores(advogados: { id: string }[]): Record<string, CorAdvogado> {
  const mapa: Record<string, CorAdvogado> = {};
  advogados.forEach((a, i) => { mapa[a.id] = PALETA_ADVOGADOS[i % PALETA_ADVOGADOS.length]; });
  return mapa;
}

/**
 * Tratamentos que NÃO são nome.
 *
 * O acervo usa `nomeExibicao` no formato "Dra. Shérad" e "Dr. Murilo" — é como
 * a equipe se chama, e é o certo para exibir. Só que pegar "o primeiro token"
 * devolvia o TRATAMENTO: a escala mostrava "Dra. -09:00" e o plantão do dia,
 * no detalhe da atividade, virava uma lista de "Dr." e "Dra." sem nome nenhum.
 * Dois advogados de plantão apareciam como duas linhas indistinguíveis.
 *
 * Compara sem acento e sem ponto final, então "Dra.", "DRA" e "dra" caem todos
 * aqui.
 */
const TRATAMENTOS = new Set([
  'dr', 'dra', 'sr', 'sra', 'srta', 'exmo', 'exma', 'prof', 'profa', 'me', 'ma',
]);

const ehTratamento = (token: string) =>
  TRATAMENTOS.has(
    token
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\.$/, '')
      .toLowerCase(),
  );

/**
 * O primeiro nome DE VERDADE — para onde só cabe uma palavra (célula da escala).
 *
 * Onde houver espaço, prefira o nome de exibição inteiro: "Dra. Shérad" é como
 * a pessoa é chamada, e encurtar sem necessidade só tira informação.
 */
export function primeiroNome(a: AdvogadoEscala): string {
  const completo = (a.nomeExibicao || a.nome).trim();
  const tokens = completo.split(/\s+/).filter(Boolean);
  const nome = tokens.find((t) => !ehTratamento(t));
  // Só tratamento e mais nada (cadastro incompleto): devolve o que existe, em
  // vez de uma string vazia que sumiria da tela sem explicação.
  return nome ?? completo;
}

/** O nome de exibição inteiro, com tratamento — para onde há largura. */
export function nomeDeExibicao(a: AdvogadoEscala): string {
  return (a.nomeExibicao || a.nome).trim();
}

/** "YYYY-MM" do mês de referência. */
export function chaveMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function rotuloMes(d: Date): string {
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
