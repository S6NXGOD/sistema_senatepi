import { api } from './api';
import { tenant } from '@/tenant.config';
import { ASSUNTO_LABEL, ASSUNTOS } from './relatorios';
import { celularParaWhatsApp, linkWhatsApp as linkDoWhatsApp } from './whatsapp';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type CanalAtendimento = 'PRESENCIAL' | 'WHATSAPP' | 'TELEFONE' | 'EMAIL' | 'SITE';
export type DesfechoAtendimento = 'RESOLVIDO_ATO' | 'ENCAMINHADO';
export type StatusAtendimento = 'PENDENTE' | 'CONCLUIDO' | 'CANCELADO';
export type TipoEncaminhamento = 'CONSULTA_NOVA' | 'ANDAMENTO_PROCESSO';
export type SetorAtendimento = 'JURIDICO' | 'FINANCEIRO' | 'SECRETARIA' | 'DIRETORIA' | 'COLONIA' | 'OUTRO';

/**
 * Em que pé está a consulta que nasceu do atendimento.
 *
 * CALCULADO NO SERVIDOR (`situacaoDoEncaminhamento`), na leitura. A tela não
 * recalcula: se a lista, a gaveta e o painel derivassem cada um o seu estado,
 * um dia os três discordariam. Quando a API ainda não manda o campo, a tela
 * simplesmente não mostra o chip.
 */
export type EstadoEncaminhamento =
  | 'AGENDADA'
  | 'HOJE'
  | 'EM_CONSULTA'
  | 'FICOU_PARA_TRAS'
  | 'ATENDIDA'
  | 'CANCELADA';

export interface Encaminhamento {
  estado: EstadoEncaminhamento;
  compromissoId: string;
  inicio: string;
  responsavel: { id: string; nome: string; nomeExibicao?: string | null } | null;
  linkReuniao: string | null;
  local: string | null;
}

/** Como vai ser a consulta. Mora no `local` da atividade (D11): não é canal. */
export type ModalidadeConsulta = 'SEDE' | 'VIDEO' | 'TELEFONE';

export interface FiliadoLista {
  id: string;
  nomeCompleto: string;
  matricula: string;
  telefonePrincipal: string | null;
  telefoneSecundario?: string | null;
}

export interface Atendente {
  id: string;
  nome: string;
}

export interface AtendimentoLista {
  id: string;
  numero: number;
  canal: CanalAtendimento;
  /** Sobre o que era a demanda — nulo nos registros anteriores ao campo. */
  assunto?: string | null;
  /** "Qual assunto?" — só existe quando o assunto é Outro. */
  assuntoOutro?: string | null;
  desfecho: DesfechoAtendimento | null;
  status: StatusAtendimento;
  tipoEncaminhamento: TipoEncaminhamento | null;
  responsavel: string | null;
  descricao: string;
  createdAt: string;
  filiado: FiliadoLista;
  atendente: Atendente;
  /** Só quando há consulta. Ausente na API anterior à rodada de 13/09. */
  encaminhamento?: Encaminhamento | null;
}

export interface PaginaAtendimentos {
  items: AtendimentoLista[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

/** Filiado com dados de contato (dossiê / atualização cadastral). */
export interface FiliadoDossie {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  situacao: string;
  telefonePrincipal: string | null;
  telefoneSecundario: string | null;
  email: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}

export interface CompromissoResumo {
  id: string;
  titulo?: string;
  tipo?: string;
  status: string;
  inicio: string;
  local?: string | null;
  linkReuniao?: string | null;
  /** Preenchido quando a atividade é seguimento de outra, e não a consulta. */
  origemDesfechoId?: string | null;
  responsavel: { id: string; nome: string; nomeExibicao?: string | null } | null;
}

export interface AtendimentoDossie {
  atendimento: {
    id: string;
    numero: number;
    canal: CanalAtendimento;
    /** Sobre o que era — nulo nos registros anteriores ao campo. */
    assunto: string | null;
    assuntoOutro?: string | null;
    encaminhamento?: Encaminhamento | null;
    /** As consultas nascidas do atendimento, com status (API nova). */
    consultas?: CompromissoResumo[];
    desfecho: DesfechoAtendimento | null;
    status: StatusAtendimento;
    tipoEncaminhamento: TipoEncaminhamento | null;
    desfechoObs: string | null;
    desfechoEm: string | null;
    setor: SetorAtendimento | null;
    responsavel: string | null;
    descricao: string;
    createdAt: string;
    atendente: Atendente;
    filiado: FiliadoDossie;
    processo: { id: string; numeroCNJ: string; classeProcessual: string | null } | null;
    compromissos: CompromissoResumo[];
  };
  historico: {
    id: string;
    numero: number;
    canal: CanalAtendimento;
    desfecho: DesfechoAtendimento | null;
    status: StatusAtendimento;
    descricao: string;
    createdAt: string;
    atendente: { nome: string };
  }[];
}

// ---------------------------------------------------------------------------
// Rótulos e cores
// ---------------------------------------------------------------------------

export const CANAL_LABEL: Record<CanalAtendimento, string> = {
  PRESENCIAL: 'Presencial',
  WHATSAPP: 'WhatsApp',
  TELEFONE: 'Telefone',
  EMAIL: 'E-mail',
  SITE: 'Site',
};
export const CANAIS = Object.keys(CANAL_LABEL) as CanalAtendimento[];

export const CANAL_COR: Record<CanalAtendimento, string> = {
  PRESENCIAL: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  WHATSAPP: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  TELEFONE: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  EMAIL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  SITE: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

export const DESFECHO_LABEL: Record<DesfechoAtendimento, string> = {
  RESOLVIDO_ATO: 'Resolvido no ato',
  ENCAMINHADO: 'Encaminhado',
};

export const DESFECHO_COR: Record<DesfechoAtendimento, string> = {
  RESOLVIDO_ATO: 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900',
  ENCAMINHADO: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const STATUS_LABEL: Record<StatusAtendimento, string> = {
  PENDENTE: 'Pendente',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};
export const STATUS_COR: Record<StatusAtendimento, string> = {
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  CONCLUIDO: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
  CANCELADO: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 line-through',
};

export const TIPO_ENC_LABEL: Record<TipoEncaminhamento, string> = {
  CONSULTA_NOVA: 'Consulta Jurídica (caso novo)',
  ANDAMENTO_PROCESSO: 'Andamento de Processo existente',
};

export const SETOR_LABEL: Record<SetorAtendimento, string> = {
  JURIDICO: 'Jurídico',
  FINANCEIRO: 'Financeiro',
  SECRETARIA: 'Secretaria',
  DIRETORIA: 'Diretoria',
  COLONIA: 'Colônia de Férias',
  OUTRO: 'Outro',
};
export const SETORES = Object.keys(SETOR_LABEL) as SetorAtendimento[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** O fuso do sindicato: a data que o filiado lê é a de Teresina, não a do aparelho. */
export const FUSO_BR = 'America/Fortaleza';

/**
 * Link do WhatsApp para o filiado, ou `null` quando o cadastro não tem celular.
 *
 * DELEGA A `lib/whatsapp.ts` — a regra única do número. A montagem que morava
 * aqui aceitava "10 dígitos ou mais" (telefone fixo abria conversa com um número
 * sem WhatsApp) e lia só o telefone principal, quando a importação grava o
 * celular no SECUNDÁRIO. A assinatura antiga continua valendo: o terceiro
 * argumento é opcional.
 */
export function linkWhatsApp(
  telefone: string | null | undefined,
  mensagem: string,
  secundario?: string | null,
): string | null {
  const celular = celularParaWhatsApp(telefone, secundario);
  return celular ? linkDoWhatsApp(celular, mensagem) : null;
}

/** Primeiro nome, para a saudação. */
export function primeiroNomeDe(nome: string): string {
  return nome.trim().split(/\s+/)[0] || nome.trim();
}

/** Saudação de WhatsApp referenciando o atendimento. Sem emoji (regra da casa). */
export function mensagemSaudacao(p: { nome: string; data: string }): string {
  const quando = new Date(p.data).toLocaleDateString('pt-BR', { timeZone: FUSO_BR });
  return (
    `Olá, ${primeiroNomeDe(p.nome)}. Aqui é do ${tenant.sigla}.\n\n` +
    `Estamos entrando em contato a respeito do seu atendimento registrado em ${quando}. ` +
    `Como podemos ajudar?`
  );
}

// ---------------------------------------------------------------------------
// Assunto
// ---------------------------------------------------------------------------

export const ASSUNTO_OUTRO_MIN = 3;
export const ASSUNTO_OUTRO_MAX = 80;

/** Espaços repetidos colapsados — a mesma limpeza que o servidor faz antes de gravar. */
export function limparAssuntoOutro(texto: string | null | undefined): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * "Qual assunto?" é obrigatório SÓ quando se escolheu Outro (D12). Devolve a
 * frase do erro, ou `null` quando está tudo certo.
 */
export function erroDoAssunto(assunto: string | null | undefined, assuntoOutro: string | null | undefined): string | null {
  if (assunto !== 'OUTRO') return null;
  const t = limparAssuntoOutro(assuntoOutro);
  if (t.length < ASSUNTO_OUTRO_MIN) return 'Diga em poucas palavras qual é o assunto (pelo menos 3 letras).';
  if (t.length > ASSUNTO_OUTRO_MAX) return `O assunto cabe em ${ASSUNTO_OUTRO_MAX} caracteres. Os detalhes vão na descrição.`;
  return null;
}

/** "Remuneração e atrasados", "Outro: aposentadoria" ou `null` sem assunto. */
export function rotuloDoAssunto(assunto: string | null | undefined, assuntoOutro?: string | null): string | null {
  if (!assunto) return null;
  if (assunto === 'OUTRO') {
    const t = limparAssuntoOutro(assuntoOutro);
    return t ? `Outro: ${t}` : 'Outro';
  }
  return ASSUNTO_LABEL[assunto] ?? assunto;
}

/**
 * O corpo do PATCH do assunto. O texto só vai quando é Outro: um Outro
 * reclassificado como Remuneração não pode levar "aposentadoria" junto.
 */
export function corpoDoAssunto(assunto: string | null | undefined, assuntoOutro: string | null | undefined): AtualizarAssuntoInput {
  if (!assunto) return { assunto: null };
  if (assunto !== 'OUTRO') return { assunto };
  return { assunto, assuntoOutro: limparAssuntoOutro(assuntoOutro) };
}

/** O assunto mudou em relação ao que estava gravado? Evita PATCH à toa. */
export function assuntoMudou(
  antes: { assunto?: string | null; assuntoOutro?: string | null },
  depois: { assunto?: string | null; assuntoOutro?: string | null },
): boolean {
  const a = antes.assunto || null;
  const d = depois.assunto || null;
  if (a !== d) return true;
  if (d !== 'OUTRO') return false;
  return limparAssuntoOutro(antes.assuntoOutro) !== limparAssuntoOutro(depois.assuntoOutro);
}

/**
 * O assunto no registro do desfecho só é conferido quando a pessoa MEXEU nele.
 *
 * 13/09/2026: todo atendimento anterior à coluna `assunto_outro` com assunto
 * "Outro" tem o texto nulo (a migração só acrescenta a coluna). Validar sempre
 * travava o fechamento desses registros com "diga qual é o assunto", num campo
 * marcado como opcional. É a mesma condição que decide se a rota do assunto é
 * chamada.
 */
export function erroDoAssuntoNoDesfecho(
  antes: { assunto?: string | null; assuntoOutro?: string | null },
  depois: { assunto?: string | null; assuntoOutro?: string | null },
): string | null {
  if (!assuntoMudou(antes, depois)) return null;
  return erroDoAssunto(depois.assunto, depois.assuntoOutro);
}

// ---------------------------------------------------------------------------
// Datas no fuso do sindicato
// ---------------------------------------------------------------------------

/** "2026-09-15" — o dia de Teresina de um instante. */
export function diaBR(instante: Date | string): string {
  return new Date(instante).toLocaleDateString('en-CA', { timeZone: FUSO_BR });
}

/** "10:00" no fuso de Teresina. */
export function horaBR(instante: Date | string): string {
  return new Date(instante).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO_BR });
}

/** "qua, 15/09" de um dia puro "AAAA-MM-DD" (meio-dia de Teresina: nunca anda de dia). */
export function rotuloDoDia(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: FUSO_BR }).replace('.', '');
  const diaMes = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_BR });
  return `${semana}, ${diaMes}`;
}

/** "qua, 15/09 às 10:00". */
export function rotuloDoInstante(instante: Date | string): string {
  return `${rotuloDoDia(diaBR(instante))} às ${horaBR(instante)}`;
}

// ---------------------------------------------------------------------------
// Encaminhamento
// ---------------------------------------------------------------------------

export const MODALIDADE_LABEL: Record<ModalidadeConsulta, string> = {
  SEDE: 'Na sede',
  VIDEO: 'Por vídeo',
  TELEFONE: 'Por telefone',
};
export const MODALIDADES: ModalidadeConsulta[] = ['SEDE', 'VIDEO', 'TELEFONE'];

/** Remoto exige dia e hora combinados com o filiado. */
export function modalidadeRemota(m: ModalidadeConsulta | null | undefined): boolean {
  return m === 'VIDEO' || m === 'TELEFONE';
}

/**
 * A modalidade lida de volta do `local` da consulta. O servidor grava
 * "Por chamada de vídeo" e "Por telefone"; qualquer outro texto é local físico.
 */
export function modalidadeDoLocal(local: string | null | undefined): ModalidadeConsulta | null {
  if (local === 'Por chamada de vídeo') return 'VIDEO';
  if (local === 'Por telefone') return 'TELEFONE';
  return null;
}

/** "por vídeo", "por telefone" ou nada — o complemento curto da frase. */
function complementoDaModalidade(local: string | null | undefined): string {
  const m = modalidadeDoLocal(local);
  if (m === 'VIDEO') return 'por vídeo';
  if (m === 'TELEFONE') return 'por telefone';
  return '';
}

/** O nome de quem atende, como a equipe se chama ("Dra. Shérad"). */
export function nomeDeQuemAtende(r: { nome: string; nomeExibicao?: string | null } | null | undefined): string {
  return (r?.nomeExibicao || r?.nome || '').trim();
}

/** "com a Dra. Shérad", "com o Dr. Murilo", "com Maria" — sem chutar gênero do nome. */
export function comQuem(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return `com a ${n}`;
  if (/^dr\.?\s/i.test(n)) return `com o ${n}`;
  return `com ${n}`;
}

/** "da Dra. Shérad", "do Dr. Murilo", "de Maria" — a mesma regra do `comQuem`. */
export function deQuem(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return `da ${n}`;
  if (/^dr\.?\s/i.test(n)) return `do ${n}`;
  return `de ${n}`;
}

export type TomDoEstado = 'ambar' | 'verde' | 'neutro';

/**
 * O rótulo curto do chip e o tom. Âmbar para o que pede atenção da triagem
 * (ficou para trás, cancelada: ninguém vai atender); verde para atendida;
 * neutro para o que está correndo. Nunca vermelho, nunca "vencida".
 */
export const ESTADO_ENCAMINHAMENTO: Record<EstadoEncaminhamento, { rotulo: string; tom: TomDoEstado }> = {
  AGENDADA: { rotulo: 'Consulta marcada', tom: 'neutro' },
  HOJE: { rotulo: 'Consulta hoje', tom: 'neutro' },
  EM_CONSULTA: { rotulo: 'Em consulta', tom: 'neutro' },
  FICOU_PARA_TRAS: { rotulo: 'Consulta ficou para trás', tom: 'ambar' },
  ATENDIDA: { rotulo: 'Consulta atendida', tom: 'verde' },
  CANCELADA: { rotulo: 'Consulta cancelada', tom: 'ambar' },
};

/** Rótulo do chip, com "falta concluir" quando a consulta foi atendida e a demanda segue aberta. */
export function rotuloDoEncaminhamento(estado: EstadoEncaminhamento, statusAtendimento: StatusAtendimento): string {
  const base = ESTADO_ENCAMINHAMENTO[estado]?.rotulo ?? 'Encaminhado';
  return estado === 'ATENDIDA' && statusAtendimento === 'PENDENTE' ? `${base} · falta concluir` : base;
}

/** A consulta foi atendida e o atendimento continua aberto: oferecer "Concluir atendimento" (D13). */
export function faltaConcluir(a: { status: StatusAtendimento; encaminhamento?: Encaminhamento | null }): boolean {
  return a.status === 'PENDENTE' && a.encaminhamento?.estado === 'ATENDIDA';
}

/**
 * A frase inteira do encaminhamento, para a gaveta. Só LÊ o estado que veio do
 * servidor; o dia e a hora saem no fuso de Teresina.
 */
export function fraseDoEncaminhamento(e: Encaminhamento, statusAtendimento: StatusAtendimento): string {
  const quem = nomeDeQuemAtende(e.responsavel);
  const com = quem ? ` ${comQuem(quem)}` : '';
  const modo = complementoDaModalidade(e.local);
  const sufixoModo = modo ? ` · ${modo}` : '';
  switch (e.estado) {
    case 'HOJE':
      return `Consulta hoje às ${horaBR(e.inicio)}${com}${sufixoModo}`;
    case 'EM_CONSULTA':
      return quem ? `Em consulta ${comQuem(quem)} agora` : 'Em consulta agora';
    case 'FICOU_PARA_TRAS':
      return `A consulta de ${rotuloDoDia(diaBR(e.inicio))}${com} ficou para trás: ninguém marcou como atendida`;
    case 'ATENDIDA':
      return `Consulta atendida${quem ? ` por ${quem}` : ''}` +
        (statusAtendimento === 'PENDENTE' ? '. Falta concluir o atendimento.' : '');
    case 'CANCELADA':
      return `A consulta${com} foi cancelada. Ninguém vai atender se não houver outra.`;
    case 'AGENDADA':
    default:
      return `Consulta${com} em ${rotuloDoInstante(e.inicio)}${sufixoModo}`;
  }
}

/** "Consulta com a Dra. X em qua, 15/09 às 10:00 · por vídeo" — a confirmação logo depois de encaminhar. */
export function confirmacaoDoEncaminhamento(p: {
  responsavel: { nome: string; nomeExibicao?: string | null } | null;
  inicio: string;
  local?: string | null;
}): string {
  const quem = nomeDeQuemAtende(p.responsavel);
  const modo = complementoDaModalidade(p.local);
  return `Consulta${quem ? ` ${comQuem(quem)}` : ''} em ${rotuloDoInstante(p.inicio)}${modo ? ` · ${modo}` : ''}`;
}

/**
 * A mensagem que a triagem manda ao filiado depois de marcar a consulta.
 * Sem emoji e sem negrito: o que o filiado precisa é dia, hora e como entrar.
 */
export function mensagemDaConsulta(p: {
  nomeFiliado: string;
  responsavel: { nome: string; nomeExibicao?: string | null } | null;
  inicio: string;
  local?: string | null;
  linkReuniao?: string | null;
}): string {
  const quem = nomeDeQuemAtende(p.responsavel);
  const linhas = [
    `Olá, ${primeiroNomeDe(p.nomeFiliado)}. Aqui é do ${tenant.sigla}.`,
    '',
    `Sua consulta jurídica${quem ? ` ${comQuem(quem)}` : ''} ficou marcada para ${rotuloDoDia(diaBR(p.inicio))}, às ${horaBR(p.inicio)}.`,
  ];
  const modo = modalidadeDoLocal(p.local);
  if (modo === 'VIDEO') {
    linhas.push(
      p.linkReuniao
        ? `Vai ser por chamada de vídeo. Para entrar na hora marcada: ${p.linkReuniao}`
        : 'Vai ser por chamada de vídeo. O link para entrar será enviado antes do horário.',
    );
  } else if (modo === 'TELEFONE') {
    linhas.push('Vai ser por telefone: ligaremos para este número no horário marcado.');
  } else {
    linhas.push(`É na sede do ${tenant.sigla}.`);
  }
  linhas.push('', 'Se precisar remarcar, é só responder esta mensagem.');
  return linhas.join('\n');
}

/**
 * As consultas do atendimento, para a gaveta. A API nova manda `consultas`;
 * a anterior só tinha `compromissos`. Seguimento (atividade criada ao concluir
 * a consulta, que herda o atendimento) não é consulta.
 */
export function consultasDoAtendimento(at: {
  consultas?: CompromissoResumo[];
  compromissos?: CompromissoResumo[];
}): CompromissoResumo[] {
  return (at.consultas ?? at.compromissos ?? []).filter((c) => !c.origemDesfechoId);
}

export const STATUS_CONSULTA_LABEL: Record<string, string> = {
  PENDENTE: 'Marcada',
  EM_ANDAMENTO: 'Em consulta',
  CONCLUIDO: 'Atendida',
  CANCELADO: 'Cancelada',
};

/** Advogados primeiro; o resto da equipe depois, sem esconder ninguém (há coordenador que advoga). */
export function agruparEquipe<T extends { role?: string | null }>(pessoas: T[]): { advogados: T[]; outros: T[] } {
  const advogados: T[] = [];
  const outros: T[] = [];
  for (const p of pessoas) (p.role === 'ADVOGADO' ? advogados : outros).push(p);
  return { advogados, outros };
}

/**
 * O dia cujo plantão aparece no encaminhamento: o dia DIGITADO, ou o dia em que
 * a consulta vai cair se ficar em branco (`dataPadrao`, calculado no servidor
 * pela mesma função que grava). Nunca "hoje" por conta própria.
 */
export function diaDoPlantao(dataConsulta: string, dataPadrao: string | null | undefined): string | null {
  if (dataConsulta && /^\d{4}-\d{2}-\d{2}/.test(dataConsulta)) return dataConsulta.slice(0, 10);
  return dataPadrao ?? null;
}

/** O valor do `datetime-local` já passou? (hora do aparelho, que é a de quem digitou). */
export function dataJaPassou(dataConsulta: string, agora: Date = new Date()): boolean {
  if (!dataConsulta) return false;
  const d = new Date(dataConsulta);
  return !Number.isNaN(d.getTime()) && d.getTime() < agora.getTime();
}

// ---------------------------------------------------------------------------
// Filtros vindos da URL
// ---------------------------------------------------------------------------

export interface FiltroDaUrl {
  status: '' | StatusAtendimento;
  desfecho: '' | DesfechoAtendimento;
  canal: '' | CanalAtendimento;
  assunto: string;
  dataInicio: string;
  dataFim: string;
}

export const PARAMETROS_DO_FILTRO = ['status', 'desfecho', 'canal', 'assunto', 'dataInicio', 'dataFim'] as const;

/**
 * `/atendimentos?assunto=OUTRO&dataInicio=2026-08-01&dataFim=2026-08-31`.
 *
 * Um número que vira link precisa abrir a lista com o MESMO recorte que contou.
 * Valor desconhecido é ignorado (um link velho não pode travar a tela num filtro
 * que não existe), e o que não veio fica vazio: o link leva o recorte inteiro.
 */
export function filtroDaUrl(params: { get(chave: string): string | null }): FiltroDaUrl {
  const valor = (k: string) => (params.get(k) ?? '').trim();
  const dia = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(valor(k)) ? valor(k) : '');
  const status = valor('status');
  const desfecho = valor('desfecho');
  const canal = valor('canal');
  const assunto = valor('assunto');
  return {
    status: (['PENDENTE', 'CONCLUIDO', 'CANCELADO'] as const).includes(status as StatusAtendimento)
      ? (status as StatusAtendimento)
      : '',
    desfecho: desfecho === 'RESOLVIDO_ATO' || desfecho === 'ENCAMINHADO' ? desfecho : '',
    canal: (CANAIS as string[]).includes(canal) ? (canal as CanalAtendimento) : '',
    assunto: ASSUNTOS.includes(assunto) ? assunto : '',
    dataInicio: dia('dataInicio'),
    dataFim: dia('dataFim'),
  };
}

/** A URL traz algum filtro conhecido? */
export function urlTemFiltro(params: { get(chave: string): string | null }): boolean {
  return PARAMETROS_DO_FILTRO.some((k) => !!params.get(k));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface CriarAtendimentoInput {
  filiadoId: string;
  canal: CanalAtendimento;
  /** Sobre o que é — opcional; o relatório conta os não informados à parte. */
  assunto?: string;
  /** Obrigatório (3–80) quando `assunto = OUTRO`; não vai nos demais. */
  assuntoOutro?: string;
  descricao: string;
  /** A triagem é a PORTA: é no balcão que se descobre que o caso tem prazo. */
  urgente?: boolean;
  /** Obrigatório ao marcar urgente — a API recusa sem motivo. */
  urgenteMotivo?: string;
}
export async function criarAtendimento(dto: CriarAtendimentoInput) {
  return (await api.post('/atendimentos', dto)).data;
}

/** Registra o desfecho (resultado) do atendimento. */
export interface RegistrarDesfechoInput {
  resultado: DesfechoAtendimento;
  desfechoObs?: string;
  advogadoIds?: string[];
  tipoEncaminhamento?: TipoEncaminhamento;
  processoId?: string;
  dataConsulta?: string;
  /** Vai para o `local` da consulta. Obrigatória a data quando é VIDEO/TELEFONE. */
  modalidade?: ModalidadeConsulta;
  /** Só com VIDEO. O servidor extrai a URL do convite colado e recusa o que não é https. */
  linkReuniao?: string | null;
}
export async function registrarDesfecho(id: string, dto: RegistrarDesfechoInput): Promise<AtendimentoDossie> {
  return (await api.patch(`/atendimentos/${id}/desfecho`, dto)).data;
}

export interface AtualizarAssuntoInput {
  assunto: string | null;
  assuntoOutro?: string;
}
/** Classificar ou reclassificar depois — na gaveta ou no desfecho. */
export async function atualizarAssunto(id: string, dto: AtualizarAssuntoInput) {
  return (await api.patch(`/atendimentos/${id}/assunto`, dto)).data;
}

/** Colar (ou tirar) o link da chamada numa consulta nascida do atendimento. */
export async function atualizarLinkDaConsulta(id: string, compromissoId: string, linkReuniao: string | null) {
  return (await api.patch(`/atendimentos/${id}/consultas/${compromissoId}/link`, { linkReuniao })).data;
}

export interface PessoaDaEquipe {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  avatarUrl?: string | null;
  role?: string;
}

export interface OpcoesEncaminhamento {
  /** Dia em que a consulta cai se a data ficar em branco (mesma função que grava). */
  dataPadrao: string;
  /** O dia do plantão devolvido. */
  dia: string;
  plantao: { id: string; advogadoId: string; advogado: PessoaDaEquipe; horaInicio: string; horaFim: string }[];
  /** Quem pode receber a consulta: ativos com acesso à agenda, advogados primeiro. */
  advogados: PessoaDaEquipe[];
}
/**
 * Plantão e equipe numa rota de ATENDIMENTOS: quem registra o desfecho alcança
 * o que o desfecho precisa, sem depender de ter acesso ao módulo de escalas.
 */
export async function opcoesDeEncaminhamento(data?: string): Promise<OpcoesEncaminhamento> {
  return (await api.get('/atendimentos/encaminhamento/opcoes', { params: data ? { data } : {} })).data;
}

export interface ChoqueNaAgenda {
  id: string;
  titulo: string;
  tipo: string;
  inicio: string;
  fim: string;
}
/** O que já ocupa a agenda de uma pessoa no horário da consulta. Avisa, não bloqueia. */
export async function choquesNaAgenda(p: { responsavelId: string; inicio: string; fim: string }): Promise<ChoqueNaAgenda[]> {
  return (await api.get('/compromissos/conflitos', { params: p })).data;
}

/** Concluir / cancelar / reabrir a demanda. */
export async function mudarStatusAtendimento(id: string, status: StatusAtendimento) {
  return (await api.patch(`/atendimentos/${id}/status`, { status })).data;
}

/** Exclui o atendimento (hard delete) — só Administrador. */
export async function excluirAtendimento(id: string) {
  return (await api.delete(`/atendimentos/${id}`)).data as { ok: boolean };
}

export interface FiltroAtendimentos {
  busca?: string;
  desfecho?: DesfechoAtendimento;
  status?: StatusAtendimento;
  canal?: CanalAtendimento;
  assunto?: string;
  dataInicio?: string;
  dataFim?: string;
  page?: number;
  pageSize?: number;
}
export async function listarAtendimentos(filtro: FiltroAtendimentos = {}): Promise<PaginaAtendimentos> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(filtro)) if (v) params[k] = String(v);
  return (await api.get('/atendimentos', { params })).data;
}

export async function getAtendimento(id: string): Promise<AtendimentoDossie> {
  return (await api.get(`/atendimentos/${id}`)).data;
}

/** Atualização cadastral de contato do filiado (reusa o PATCH de filiados). */
export interface ContatoFiliado {
  telefonePrincipal?: string | null;
  telefoneSecundario?: string | null;
  email?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
}
export async function atualizarContatoFiliado(filiadoId: string, dados: ContatoFiliado) {
  return (await api.patch(`/filiados/${filiadoId}`, dados)).data;
}
