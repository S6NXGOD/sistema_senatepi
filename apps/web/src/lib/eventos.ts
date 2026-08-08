import { api } from './api';

/**
 * Plenário Virtual — assembleias, cursos e sorteios.
 *
 * Há DUAS camadas aqui, de propósito:
 *  - `admin*`  → exige login, é a mesa diretora conduzindo o evento
 *  - `sala*`   → público, o filiado entra só com o link e o CPF
 *
 * A separação existe porque o participante não pode ter conta no sistema: são
 * 7 mil filiados, e exigir senha afastaria justamente quem a assembleia
 * precisa que participe.
 */

export type TipoEvento =
  | 'ASSEMBLEIA' | 'CONGRESSO' | 'REUNIAO' | 'CURSO' | 'SORTEIO'
  | 'NEGOCIACAO' | 'EVENTO_SOCIAL' | 'EVENTO_ESPORTIVO' | 'OUTRO';

export type StatusEvento = 'AGENDADO' | 'EM_ANDAMENTO' | 'REALIZADO' | 'CANCELADO';
export type ModoVotacao = 'SECRETA' | 'NOMINAL';
export type StatusPauta = 'RASCUNHO' | 'ABERTA' | 'ENCERRADA';

export const TIPO_EVENTO_LABEL: Record<TipoEvento, string> = {
  ASSEMBLEIA: 'Assembleia',
  CONGRESSO: 'Congresso',
  REUNIAO: 'Reunião',
  CURSO: 'Curso',
  SORTEIO: 'Sorteio',
  NEGOCIACAO: 'Negociação',
  EVENTO_SOCIAL: 'Evento social',
  EVENTO_ESPORTIVO: 'Evento esportivo',
  OUTRO: 'Outro',
};

export const STATUS_EVENTO_LABEL: Record<StatusEvento, string> = {
  AGENDADO: 'Agendado',
  EM_ANDAMENTO: 'Em andamento',
  REALIZADO: 'Realizado',
  CANCELADO: 'Cancelado',
};

export const STATUS_EVENTO_COR: Record<StatusEvento, string> = {
  AGENDADO: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  EM_ANDAMENTO: 'bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100',
  REALIZADO: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200',
  CANCELADO: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
};

/** Espelha `configuracoes-evento.ts` na API — o contrato do "camaleão". */
export interface ConfiguracoesEvento {
  exigeAdimplencia: boolean;
  habilitarVotacao: boolean;
  habilitarSorteio: boolean;
  gerarCertificado: boolean;
  cargaHoraria?: number;
  permiteDependente: boolean;
  checkinAbreMinutosAntes: number;
  checkinFechaMinutosDepois: number;
  avisoCheckin?: string;
}

/** Rótulo e explicação de cada chave, para o formulário não virar adivinhação. */
export const CHAVES_CONFIG: {
  chave: keyof ConfiguracoesEvento;
  rotulo: string;
  ajuda: string;
}[] = [
  {
    chave: 'exigeAdimplencia',
    rotulo: 'Exigir contribuição em dia',
    ajuda: 'Barra quem tem parcela vencida. Use em assembleia deliberativa.',
  },
  {
    chave: 'habilitarVotacao',
    rotulo: 'Habilitar votação',
    ajuda: 'Libera pautas e urna. Sem isto, a sala mostra só a lista de presença.',
  },
  {
    chave: 'habilitarSorteio',
    rotulo: 'Habilitar sorteio',
    ajuda: 'Permite sortear brindes entre os presentes, com resultado conferível.',
  },
  {
    chave: 'gerarCertificado',
    rotulo: 'Emitir certificado',
    ajuda: 'Para cursos: gera certificado por participante ao encerrar.',
  },
  {
    chave: 'permiteDependente',
    rotulo: 'Permitir dependentes',
    ajuda: 'Dependente não vota nem conta para quórum. Faz sentido em evento social.',
  },
];

export interface Evento {
  id: string;
  nome: string;
  descricao: string | null;
  local: string | null;
  dataInicio: string;
  dataFim: string | null;
  tipo: TipoEvento;
  status: StatusEvento;
  linkReuniao: string | null;
  urlVideoDrive: string | null;
  textoAta: string | null;
  configuracoes: ConfiguracoesEvento;
  _count?: { presencas: number; pautas?: number; sorteios?: number };
}

export interface OpcaoPauta {
  id: string;
  rotulo: string;
}

export interface Pauta {
  id: string;
  titulo: string;
  descricao: string | null;
  opcoes: OpcaoPauta[];
  modo: ModoVotacao;
  status: StatusPauta;
  quorumMinimo: number | null;
  totalVotantes?: number;
}

export interface Apuracao {
  pautaId: string;
  titulo: string;
  modo: ModoVotacao;
  status: StatusPauta;
  totalVotantes: number;
  quorumMinimo: number | null;
  quorumAtingido: boolean;
  presentes: number;
  resultado: { opcaoId: string; rotulo: string; votos: number; percentual: number }[];
  vencedora: { opcaoId: string; rotulo: string } | null;
  empate: boolean;
}

export interface Sorteio {
  id: string;
  titulo: string;
  premio: string | null;
  seed: string;
  resultado: { filiadoId: string; nome: string; matricula: string; posicao: number }[];
  realizadoEm: string;
}

// ---------------------------------------------------------------------------
// Administração (com login)
// ---------------------------------------------------------------------------

export async function listarEventos(): Promise<Evento[]> {
  return (await api.get('/eventos')).data;
}

export async function obterEvento(id: string): Promise<Evento> {
  return (await api.get(`/eventos/${id}`)).data;
}

export async function criarEvento(dto: Partial<Evento>): Promise<Evento> {
  return (await api.post('/eventos', dto)).data;
}

export async function atualizarEvento(id: string, dto: Partial<Evento>): Promise<Evento> {
  return (await api.patch(`/eventos/${id}`, dto)).data;
}

export async function listarPautas(eventoId: string): Promise<Pauta[]> {
  return (await api.get(`/eventos/${eventoId}/plenario/pautas`)).data;
}

export async function criarPauta(
  eventoId: string,
  dto: { titulo: string; descricao?: string; opcoes: OpcaoPauta[]; modo: ModoVotacao; quorumMinimo?: number },
): Promise<Pauta> {
  return (await api.post(`/eventos/${eventoId}/plenario/pautas`, dto)).data;
}

export async function abrirPauta(eventoId: string, pautaId: string): Promise<Pauta> {
  return (await api.post(`/eventos/${eventoId}/plenario/pautas/${pautaId}/abrir`, {})).data;
}

export async function encerrarPauta(eventoId: string, pautaId: string): Promise<Apuracao> {
  return (await api.post(`/eventos/${eventoId}/plenario/pautas/${pautaId}/encerrar`, {})).data;
}

export async function apurarPauta(eventoId: string, pautaId: string): Promise<Apuracao> {
  return (await api.get(`/eventos/${eventoId}/plenario/pautas/${pautaId}/apuracao`)).data;
}

export async function sortear(
  eventoId: string,
  dto: { titulo: string; premio?: string; quantidade?: number; somenteAdimplentes?: boolean },
): Promise<Sorteio & { totalConcorrentes: number; ganhadores: Sorteio['resultado'] }> {
  return (await api.post(`/eventos/${eventoId}/plenario/sorteios`, dto)).data;
}

export async function listarSorteios(eventoId: string): Promise<Sorteio[]> {
  return (await api.get(`/eventos/${eventoId}/plenario/sorteios`)).data;
}

export async function conferirSorteio(eventoId: string, sorteioId: string) {
  return (await api.get(`/eventos/${eventoId}/plenario/sorteios/${sorteioId}/conferir`)).data as {
    confere: boolean;
    explicacao: string;
    seed: string;
  };
}

export interface PresencaLista {
  presencaId: string;
  filiadoId: string | null;
  nome: string;
  matricula: string;
  /** Sempre mascarado. O IP fica só no dossiê — ver `presenca-lista.service.ts`. */
  cpf: string;
  registradoEm: string;
  origem: 'QR_PRESENCIAL' | 'AUTOATENDIMENTO_VIRTUAL' | 'MANUAL';
  /**
   * Falso quando a presença não pôde ser vinculada a um cadastro.
   *
   * Não vota e não conta para o quórum até a mesa confirmar de quem é —
   * deliberação é de associados, e o sistema não adivinha entre homônimos.
   */
  identificado: boolean;
}

export async function listarPresencas(eventoId: string): Promise<PresencaLista[]> {
  return (await api.get(`/eventos/${eventoId}/plenario/presencas`)).data;
}

export interface PreviaEncerramento {
  jaEncerrado: boolean;
  presentes: number;
  pautasAbertas: {
    id: string; titulo: string; votantes: number;
    quorumMinimo: number | null; quorumAtingido: boolean;
  }[];
  pautasEncerradas: number;
  pautasNaoVotadas: number;
  /** O que a mesa PRECISA ler antes de confirmar (quórum, irreversibilidade). */
  alertas: string[];
}

export interface ResumoEvento {
  evento: Evento & { dossiePdfKey: string | null; dossieGeradoEm: string | null };
  presentes: number;
  primeiraPresenca: string | null;
  ultimaPresenca: string | null;
  deliberacoes: Apuracao[];
  sorteios: Sorteio[];
  dossieEmitido: boolean;
}

export async function previaEncerramento(eventoId: string): Promise<PreviaEncerramento> {
  return (await api.get(`/eventos/${eventoId}/plenario/encerramento/previa`)).data;
}

export async function encerrarAssembleia(eventoId: string) {
  return (await api.post(`/eventos/${eventoId}/plenario/encerrar`, {})).data as {
    jaEstava: boolean;
    apuracoes: Apuracao[];
    dossie: { key: string; hash: string } | null;
    erroDossie: string | null;
  };
}

export async function obterResumo(eventoId: string): Promise<ResumoEvento> {
  return (await api.get(`/eventos/${eventoId}/plenario/resumo`)).data;
}

export interface CertificadosEvento {
  habilitado: boolean;
  cargaHoraria?: number | null;
  participantes: { presencaId: string; nome: string; matricula: string; codigo: string }[];
}

export async function listarCertificados(eventoId: string): Promise<CertificadosEvento> {
  return (await api.get(`/eventos/${eventoId}/plenario/certificados`)).data;
}

/**
 * Baixa um arquivo protegido (PDF, CSV).
 *
 * Busca o conteúdo pelo cliente autenticado e abre a partir da memória, em vez
 * de mandar o navegador na URL direto. Dois motivos:
 *
 *  - a API só aceita o token no cabeçalho `Authorization`
 *    (`ExtractJwt.fromAuthHeaderAsBearerToken`), e `window.open` não manda
 *    cabeçalho nenhum;
 *  - passar o token no query resolveria o primeiro ponto e criaria um pior:
 *    credencial no histórico do navegador, nos logs do servidor e no cabeçalho
 *    `Referer` de qualquer link que a página abrisse depois.
 */
async function baixarArquivo(caminho: string, nomeArquivo: string, novaAba = false) {
  const resp = await api.get(caminho, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data as Blob);
  try {
    if (novaAba) {
      window.open(url, '_blank', 'noopener');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      a.click();
    }
  } finally {
    // Espera o navegador consumir a URL antes de liberar a memória.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function baixarDossie(eventoId: string) {
  return baixarArquivo(`/eventos/${eventoId}/plenario/dossie.pdf`, `dossie-${eventoId}.pdf`, true);
}
export function baixarPresencaCsv(eventoId: string) {
  return baixarArquivo(`/eventos/${eventoId}/plenario/presencas.csv`, `presenca-${eventoId}.csv`);
}
export function baixarCertificado(eventoId: string, presencaId: string, nome: string) {
  return baixarArquivo(
    `/eventos/${eventoId}/plenario/certificados/${presencaId}.pdf`,
    `certificado-${nome.replace(/[^\w]+/g, '-').toLowerCase()}.pdf`,
    true,
  );
}

/**
 * "Adicionar à minha agenda" — uma URL, não uma integração.
 *
 * O que a pessoa quer é não esquecer da assembleia. Isso se resolve com um
 * link que abre o Google Agenda já preenchido. A alternativa (criar o evento
 * pela Calendar API e obter o link do Meet) exigiria Google Workspace pago,
 * projeto no Cloud, conta de serviço com delegação em todo o domínio e um
 * calendário institucional — quatro itens de infraestrutura para entregar uma
 * conveniência que uma URL resolve.
 *
 * Funciona com Gmail pessoal, que é o que a maioria dos filiados tem.
 */
export function linkGoogleAgenda(evento: {
  nome: string;
  descricao?: string | null;
  local?: string | null;
  dataInicio: string;
  dataFim?: string | null;
  linkSala?: string;
}): string {
  // O Google exige AAAAMMDDTHHMMSSZ, em UTC.
  const carimbo = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const inicio = new Date(evento.dataInicio);
  // Sem hora de término, assume 2h — assembleia não tem hora certa para
  // acabar, e um bloco de 15 minutos na agenda de ninguém ajuda.
  const fim = evento.dataFim ? new Date(evento.dataFim) : new Date(inicio.getTime() + 2 * 3600_000);

  const detalhes = [evento.descricao, evento.linkSala && `Sala virtual: ${evento.linkSala}`]
    .filter(Boolean)
    .join('\n\n');

  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: evento.nome,
    dates: `${carimbo(inicio)}/${carimbo(fim)}`,
    ...(detalhes ? { details: detalhes } : {}),
    ...(evento.local ? { location: evento.local } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// ---------------------------------------------------------------------------
// Sala pública (sem login)
// ---------------------------------------------------------------------------

export interface SalaPublica {
  id: string;
  nome: string;
  descricao: string | null;
  dataInicio: string;
  tipo: TipoEvento;
  status: StatusEvento;
  checkinAberto: boolean;
  motivo: string;
  exigeAdimplencia: boolean;
  avisoCheckin: string | null;
  linkReuniao: null;
}

export interface ResultadoCheckin {
  liberado: boolean;
  motivo: string;
  /**
   * O CPF não localizou ninguém — a tela pede os demais dados.
   *
   * Não é recusa: 70% da base histórica veio da planilha sem CPF, e o cadastro
   * é que está incompleto. A tela trata como etapa normal, porque é.
   */
  precisaComplementar?: boolean;
  participante?: {
    nome: string; matricula: string; presencaId: string; jaEstava: boolean;
    /** Falso quando não deu para vincular a um cadastro — não vota nem conta quórum. */
    identificado: boolean;
  };
}

export interface Sessao {
  evento: {
    id: string;
    nome: string;
    status: StatusEvento;
    linkReuniao: string | null;
    urlVideoDrive: string | null;
  };
  participante: { presencaId: string; nome: string; filiadoId: string | null };
  recursos: { votacao: boolean; sorteio: boolean };
}

export interface EstadoAoVivo {
  pauta:
    | (Pauta & { votantes: number | null; jaVotou: boolean; resultado: Apuracao | null })
    | null;
  ultimoSorteio: Sorteio | null;
  /** Muda quando algo relevante muda — a tela só redesenha se a versão avançar. */
  versao: string;
}

export async function abrirSala(eventoId: string): Promise<SalaPublica> {
  return (await api.get(`/sala/${eventoId}`)).data;
}

export async function fazerCheckin(eventoId: string, cpf: string): Promise<ResultadoCheckin> {
  return (await api.post(`/sala/${eventoId}/checkin`, { cpf })).data;
}

/** Segunda etapa — quando o CPF não localizou nenhum cadastro. */
export async function checkinComDados(
  eventoId: string,
  dados: { cpf: string; nomeCompleto: string; dataNascimento?: string },
): Promise<ResultadoCheckin> {
  return (await api.post(`/sala/${eventoId}/checkin/dados`, dados)).data;
}

export interface CandidatosPresenca {
  nomeInformado: string;
  cpfInformado: string | null;
  candidatos: {
    id: string; nome: string; matricula: string;
    temCpf: boolean; cidade: string | null; nascimento: string | null;
  }[];
}

export async function candidatosPresenca(
  eventoId: string,
  presencaId: string,
): Promise<CandidatosPresenca> {
  return (await api.get(`/eventos/${eventoId}/plenario/presencas/${presencaId}/candidatos`)).data;
}

export async function vincularPresenca(eventoId: string, presencaId: string, filiadoId: string) {
  return (await api.post(`/eventos/${eventoId}/plenario/presencas/${presencaId}/vincular`, { filiadoId }))
    .data as { ok: boolean; cpfGravado: boolean; filiado: { nome: string; matricula: string } };
}

export interface ImpactoExclusao {
  nome: string;
  status: StatusEvento;
  presencas: number;
  pautas: number;
  votos: number;
  sorteios: number;
  dossieEmitido: boolean;
  temHistorico: boolean;
}

export async function impactoExclusao(eventoId: string): Promise<ImpactoExclusao> {
  return (await api.get(`/eventos/${eventoId}/impacto`)).data;
}

export async function excluirEvento(eventoId: string) {
  return (await api.delete(`/eventos/${eventoId}`)).data;
}

export async function obterSessao(eventoId: string, presencaId: string): Promise<Sessao> {
  return (await api.get(`/sala/${eventoId}/sessao/${presencaId}`)).data;
}

export async function estadoAoVivo(eventoId: string, presencaId?: string): Promise<EstadoAoVivo> {
  const q = presencaId ? `?presencaId=${encodeURIComponent(presencaId)}` : '';
  return (await api.get(`/sala/${eventoId}/ao-vivo${q}`)).data;
}

export async function votar(eventoId: string, pautaId: string, presencaId: string, opcaoId: string) {
  return (await api.post(`/sala/${eventoId}/votar/${pautaId}`, { presencaId, opcaoId })).data;
}

/**
 * A credencial do participante fica no navegador dele.
 *
 * `sessionStorage`, e não `localStorage`: a sessão morre ao fechar a aba. Numa
 * assembleia em computador compartilhado — recepção do sindicato, lan house —
 * deixar o `presencaId` da pessoa anterior gravado permitiria a próxima votar
 * no lugar dela.
 */
const CHAVE = (eventoId: string) => `senatepi:sala:${eventoId}`;

export function guardarPresenca(eventoId: string, presencaId: string) {
  try { sessionStorage.setItem(CHAVE(eventoId), presencaId); } catch { /* modo privado */ }
}
export function lerPresenca(eventoId: string): string | null {
  try { return sessionStorage.getItem(CHAVE(eventoId)); } catch { return null; }
}
export function esquecerPresenca(eventoId: string) {
  try { sessionStorage.removeItem(CHAVE(eventoId)); } catch { /* ignora */ }
}

/**
 * Aviso de LGPD exibido ANTES de capturar CPF e IP.
 *
 * Avisar depois de coletar não é aviso. O texto fica aqui, num lugar só, para
 * que a tela de check-in e o dossiê citem exatamente a mesma base legal.
 */
export const AVISO_LGPD =
  'Ao confirmar sua presença, registramos seu CPF, endereço IP e data/hora, para ' +
  'comprovar a participação e o quórum deste evento. O tratamento segue a Lei Geral ' +
  'de Proteção de Dados Pessoais (LGPD), Lei nº 13.709, de 14 de agosto de 2018 ' +
  '(Fonte: Diário Oficial da União). Os dados são usados exclusivamente para fins de ' +
  'registro associativo e não são compartilhados com terceiros.';
