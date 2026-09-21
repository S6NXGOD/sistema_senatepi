import { api } from './api';
import { tenant } from '@/tenant.config';
import { ASSUNTO_LABEL, ASSUNTOS } from './relatorios';
import { celularParaWhatsApp, linkWhatsApp as linkDoWhatsApp } from './whatsapp';
import { V } from './vocabulario';

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
  /**
   * CONSULTA REMARCADA (15/09/2026). Opcionais pela janela de troca: a API de
   * antes não manda. Remarcada fica NEUTRA, nunca âmbar: o sistema não sabe se
   * o filiado foi avisado, e um aviso que nunca se apaga ensina a ignorar.
   */
  remarcacoes?: number;
  dataOriginal?: string | null;
}

/**
 * DE QUEM É A VEZ (15/09/2026): da triagem ou da consulta.
 *
 * Calculado no servidor, na leitura (`filaDoAtendimento`). Das 4 consultas que
 * o advogado concluiu até 14/09, as 4 exigiram que a triagem fechasse o
 * atendimento à mão depois, sem registrar nada novo; e a lista pintava
 * "Pendente" em âmbar enquanto a triagem só podia esperar. A fila separa o que
 * pede a triagem do que está correndo na agenda de alguém.
 */
export type FilaDoAtendimento = 'TRIAGEM' | 'CONSULTA';
export type MotivoDaFila =
  | 'SEM_DESFECHO'
  | 'FALTA_CONCLUIR'
  | 'AGUARDANDO'
  | 'CONSULTA_SEM_REGISTRO'
  | 'CONSULTA_CANCELADA'
  | 'SEM_CONSULTA';
export interface SituacaoNaFila {
  fila: FilaDoAtendimento;
  motivo: MotivoDaFila | null;
}
/** Como a fila chega: o objeto, ou só a palavra. `undefined` é a API de antes. */
export type FilaNaResposta = SituacaoNaFila | FilaDoAtendimento | null;

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
  /** Triagem ou consulta. Ausente na API anterior a 15/09/2026. */
  fila?: FilaNaResposta;
  /** Marcada como urgente no registro. Ausente na API anterior a 21/09/2026. */
  urgente?: boolean;
  /** O porquê da urgência — a API a exige ao marcar; aqui é o `title` da chama. */
  urgenteMotivo?: string | null;
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

/** Quem fechou, quem é dono da consulta: o mínimo para escrever o nome. */
export interface PessoaResumo {
  id: string;
  nome: string;
  nomeExibicao?: string | null;
  avatarUrl?: string | null;
}

/** As quatro categorias do cancelamento. São slugs do catálogo da agenda: a consulta recebe a MESMA. */
export type CategoriaCancelamentoAtendimento = 'DESISTENCIA' | 'NAO_COMPARECEU' | 'PERDEU_OBJETO' | 'DUPLICIDADE';

/** Em que pé está a consulta vigente na hora de fechar. NENHUMA vem como `consulta: null`. */
export type SituacaoNoFechamento = 'FUTURA' | 'COMECOU' | 'EM_ANDAMENTO' | 'ATENDIDA';

/**
 * O PLANO DE FECHAMENTO, calculado no servidor (`planoDeFechamento`).
 *
 * A tela não recalcula: os serviços `concluir` e `cancelar` validam com a MESMA
 * função que monta este objeto. O que a tela faz é mostrar o efeito e perguntar
 * só o que o plano diz que falta decidir.
 */
export interface FechamentoAtendimento {
  consulta: {
    id: string;
    situacao: SituacaoNoFechamento;
    inicio: string;
    local: string | null;
    linkReuniao: string | null;
    responsavel: PessoaResumo | null;
  } | null;
  consultasAbertas: number;
  concluir: {
    permitido: boolean;
    recusa: string | null;
    consulta: 'NENHUMA' | 'CANCELAR_PARA_CONCLUIR' | 'ESCOLHER' | 'SO_MANTER';
    nota: 'OPCIONAL' | 'OBRIGATORIA' | 'OBRIGATORIA_SE_CANCELAR';
  };
  cancelar: {
    permitido: boolean;
    recusa: string | null;
    consulta: 'NENHUMA' | 'ATENDIDA' | 'ESCOLHER' | 'SO_MANTER';
  };
  /**
   * O ATENDIMENTO FECHA SOZINHO (15/09/2026): pendente, encaminhado e com a
   * consulta de pé (futura, começada ou em andamento). A tela lê, não recalcula.
   * Ausente na API anterior.
   */
  fechaSozinho?: boolean;
}

/** Quem fechou: a triagem, à mão, ou o advogado, ao registrar a consulta. Nulo antes de 15/09/2026. */
export type OrigemDaConclusao = 'TRIAGEM' | 'CONSULTA';

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
    /*
      O FECHAMENTO NA FICHA (14/09/2026). Todos opcionais: a API sobe antes, mas
      na janela de troca o web novo pode falar com a API antiga, e registro
      fechado antes das colunas vem com tudo nulo (não há backfill).
    */
    concluidoEm?: string | null;
    concluidoPor?: PessoaResumo | null;
    conclusaoObs?: string | null;
    canceladoEm?: string | null;
    canceladoPor?: PessoaResumo | null;
    canceladoCategoria?: string | null;
    canceladoMotivo?: string | null;
    fechamento?: FechamentoAtendimento | null;
    /* O ATENDIMENTO INDEPENDENTE (15/09/2026). Opcionais pela janela de troca. */
    conclusaoOrigem?: OrigemDaConclusao | null;
    conclusaoConsultaId?: string | null;
    fila?: FilaNaResposta;
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

/*
  UMA LINGUAGEM SÓ NA COLUNA RESULTADO (14/09/2026). "Resolvido no ato" era
  preto chapado ao lado do chip verde de "Consulta atendida": duas cores para o
  mesmo fato, a demanda foi atendida. Agora é a família verde do chip.
*/
export const DESFECHO_COR: Record<DesfechoAtendimento, string> = {
  RESOLVIDO_ATO: 'border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  ENCAMINHADO: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const STATUS_LABEL: Record<StatusAtendimento, string> = {
  PENDENTE: 'Pendente',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};
/*
  FECHADO NÃO É ALARME (14/09/2026). Cancelado era vermelho e riscado: o
  vermelho dizia "algo deu errado" sobre uma decisão tomada, e o riscado
  atrapalhava a leitura a 400 px. Só o pendente, que ainda pede alguém, é âmbar,
  e o vermelho ficou para o Excluir.

  MAS OS DOIS FECHADOS ERAM O MESMO CINZA (18/09/2026), e aí a regra passou do
  ponto: `bg-muted text-foreground/80` para concluído e `bg-muted
  text-muted-foreground` para cancelado são indistinguíveis numa tabela — dois
  desfechos OPOSTOS com o mesmo selo, e a lista virava uma parede sem relevo.
  (Na Agenda esse defeito não existe: lá concluído já é verde e cancelado é
  cinza.) O relato foi direto: "cancelado tem que estar vermelho".

  A correção NÃO é vermelho, e o motivo é aritmético: no print havia duas linhas
  canceladas entre dezessete, e nenhuma delas pede coisa alguma — pintar de
  alarme o que não precisa de ninguém é o jeito mais rápido de ensinar a equipe
  a ignorar alarme. O que faltava era IDENTIDADE, não urgência: rosa suave, sem
  preenchimento forte e sem riscado. Fica legível o bastante para o olho separar
  as linhas de longe, e discreto o bastante para não competir com o âmbar, que
  continua sendo a única cor que quer dizer "isto é com você".
*/
export const STATUS_COR: Record<StatusAtendimento, string> = {
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  CONCLUIDO: 'bg-muted text-foreground/80',
  CANCELADO: 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300',
};

/**
 * A fila lida da resposta, num formato só. `undefined` = a API ainda não manda
 * (janela de troca): quem lê cai no comportamento de antes, sem inventar fila.
 */
export function filaDe(a: { fila?: FilaNaResposta }): SituacaoNaFila | null | undefined {
  if (a.fila === undefined) return undefined;
  if (a.fila === null) return null;
  if (typeof a.fila === 'string') return { fila: a.fila, motivo: null };
  return a.fila;
}

/*
  "AGUARDANDO A CONSULTA" NÃO É PENDÊNCIA DA TRIAGEM (15/09/2026). O #13 e o #14
  pintavam "Pendente" em âmbar na lista e na gaveta, e nos dois a triagem não
  tinha o que fazer além de esperar. Âmbar só na fila da triagem.
*/
export const COR_AGUARDANDO_A_CONSULTA = 'bg-muted text-foreground/80';

export function rotuloDoStatus(a: { status: StatusAtendimento; fila?: FilaNaResposta }): string {
  if (a.status === 'PENDENTE' && filaDe(a)?.fila === 'CONSULTA') return 'Aguardando a consulta';
  return STATUS_LABEL[a.status];
}

/**
 * O SELO DE SITUAÇÃO ACRESCENTA ALGUMA COISA AO CHIP DO ENCAMINHAMENTO?
 *
 * "Essa listagem da triagem/atendimento está boa? Não há algo para melhorar na
 * UI, coloração, filtros e listagem?" — o dono, 21/09/2026. Há, e o maior
 * problema é ESTE: a tabela tinha duas colunas dizendo o mesmo fato.
 *
 *   RESULTADO                STATUS
 *   Consulta marcada    ×    Aguardando a consulta
 *   Consulta atendida   ×    Concluído
 *
 * Nas onze linhas do print, as duas colunas nunca discordaram — e não podiam:
 * desde 15/09/2026 o atendimento fecha SOZINHO quando o advogado conclui a
 * consulta, então "atendida" e "concluído" são o mesmo acontecimento contado
 * duas vezes. Duas colunas para um fato é o mesmo defeito do atraso que
 * aparecia em quatro lugares no painel do advogado.
 *
 * ENTÃO O SELO SÓ APARECE QUANDO DIZ O QUE O CHIP NÃO DIZ:
 *
 *  · sem chip .................. o selo é a única voz, aparece sempre;
 *  · CANCELADO ................. o chip fala da consulta, nunca do cancelamento;
 *  · PENDENTE com a TRIAGEM .... o chip diz o que foi encaminhado, e o selo diz
 *                                que a bola ainda é da triagem — coisas
 *                                diferentes;
 *  · PENDENTE esperando consulta o chip "Consulta marcada" já diz isso: some;
 *  · CONCLUIDO ................. "Consulta atendida" já diz isso: some.
 */
export function oSeloDeSituacaoAcrescenta(a: {
  status: StatusAtendimento;
  fila?: FilaNaResposta;
  encaminhamento?: unknown;
}): boolean {
  if (!a.encaminhamento) return true;
  if (a.status === 'CANCELADO') return true;
  if (a.status === 'CONCLUIDO') return false;
  // Pendente: só acrescenta quando a bola é da triagem.
  return filaDe(a)?.fila !== 'CONSULTA';
}

export function corDoStatus(a: { status: StatusAtendimento; fila?: FilaNaResposta }): string {
  if (a.status === 'PENDENTE' && filaDe(a)?.fila === 'CONSULTA') return COR_AGUARDANDO_A_CONSULTA;
  return STATUS_COR[a.status];
}

/**
 * As categorias do cancelamento do atendimento, com o texto do cartão.
 *
 * Os slugs são os do catálogo da agenda (desfechos.catalogo.ts): cancelada junto,
 * a consulta recebe a MESMA categoria, sem tradução. Sem "Outro", como no
 * catálogo: o que a categoria não cobre vai no detalhe opcional.
 */
export const CATEGORIAS_CANCELAMENTO_ATENDIMENTO: {
  slug: CategoriaCancelamentoAtendimento;
  rotulo: string;
  apoio: string;
}[] = [
  { slug: 'DESISTENCIA', rotulo: `${V.Filiado} desistiu`, apoio: 'A pessoa avisou que não quer mais seguir.' },
  { slug: 'NAO_COMPARECEU', rotulo: `${V.Filiado} não retornou`, apoio: 'Não veio nem respondeu aos contatos.' },
  { slug: 'PERDEU_OBJETO', rotulo: 'Perdeu o objeto', apoio: 'A demanda deixou de existir antes de ser atendida.' },
  { slug: 'DUPLICIDADE', rotulo: 'Registrado por engano', apoio: 'Duplicado, ou aberto para a pessoa errada.' },
];

/** O rótulo da categoria gravada; um slug desconhecido aparece cru em vez de sumir. */
export function rotuloDaCategoriaDoAtendimento(slug: string | null | undefined): string {
  if (!slug) return '';
  return CATEGORIAS_CANCELAMENTO_ATENDIMENTO.find((c) => c.slug === slug)?.rotulo ?? slug;
}

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

/*
  NO FUSO DE TERESINA (15/09/2026). A criação e o histórico saíam no fuso do
  aparelho, e as frases novas da mesma gaveta (fechamento, consulta) no de
  Teresina: num computador com outro fuso, duas horas diferentes para o mesmo dia.
*/
export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: FUSO_BR });
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

/**
 * O que o servidor grava no `local` para cada modalidade — espelho de
 * `LOCAL_DA_MODALIDADE` da API (encaminhamento.util.ts), com a mesma tabela no
 * teste. Na sede o local fica vazio, como sempre foi.
 */
export const LOCAL_DA_MODALIDADE: Record<ModalidadeConsulta, string | null> = {
  SEDE: null,
  VIDEO: 'Por chamada de vídeo',
  TELEFONE: 'Por telefone',
};

/**
 * A modalidade que o cartão da consulta mostra marcada ao abrir "Mudar como vai
 * ser". Local vazio é a sede; texto livre (um endereço, uma sala) não é
 * nenhuma das três, e a tela deixa a escolha em aberto com "Hoje diz: …".
 */
export function modalidadeDoCartao(local: string | null | undefined): ModalidadeConsulta | null {
  if (!local || !local.trim()) return 'SEDE';
  return modalidadeDoLocal(local);
}

/**
 * "Na sede", "Por vídeo", "Por telefone" ou o local livre — SEMPRE escrito.
 *
 * 14/09/2026: o sub-cartão imprimia o local cru, e na sede o local é vazio. A
 * consulta #14 dizia "chamada de vídeo" na demanda e nada no cartão: ninguém
 * via que ela estava marcada na sede.
 */
export function rotuloDaModalidadeNoCartao(local: string | null | undefined): string {
  const m = modalidadeDoCartao(local);
  return m ? MODALIDADE_LABEL[m] : (local ?? '').trim();
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

export type TomDoEstado = 'ambar' | 'verde' | 'rosa' | 'neutro';

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

/**
 * O tom do chip olhando também o atendimento.
 *
 * 14/09/2026: "Consulta cancelada" continuava âmbar num atendimento já
 * cancelado ou concluído. Aviso é estado: depois que alguém decidiu fechar, a
 * consulta cancelada não pede mais nada à triagem.
 */
export function tomDoEncaminhamento(
  estado: EstadoEncaminhamento,
  statusAtendimento: StatusAtendimento,
  fila?: FilaNaResposta,
): TomDoEstado {
  /*
    O TOM OLHA A FILA (15/09/2026). "Ficou para trás" era âmbar desde a meia-noite,
    quando o atraso já aparece na agenda de quem atende: repetir na triagem é o
    mesmo atraso três vezes. Com a fila, âmbar só no que é da triagem; verde
    só na consulta atendida de um atendimento concluído; o resto é neutro.
  */
  if (statusAtendimento !== 'PENDENTE') {
    if (estado === 'ATENDIDA' && statusAtendimento === 'CONCLUIDO') return 'verde';
    /*
      CANCELADA FECHADA É IDENTIDADE, NÃO ALERTA (18/09/2026). Enquanto o
      atendimento está pendente, a consulta cancelada é trabalho da triagem
      (remarcar ou fechar) e continua ÂMBAR. Depois que alguém fechou, ela vira
      história — e história precisa ser reconhecível, não gritada: o rosa
      distingue "não aconteceu" de "aconteceu" sem chamar ninguém.
    */
    if (estado === 'CANCELADA') return 'rosa';
    return 'neutro';
  }
  const naFila = filaDe({ fila });
  if (naFila) return naFila.fila === 'TRIAGEM' ? 'ambar' : 'neutro';
  // API de antes: o tom da tabela.
  return ESTADO_ENCAMINHAMENTO[estado]?.tom ?? 'neutro';
}

/** A consulta de pé foi remarcada? Só enquanto ela ainda vai acontecer. */
export function consultaRemarcada(
  e: Pick<Encaminhamento, 'estado' | 'remarcacoes'> | null | undefined,
  statusAtendimento: StatusAtendimento,
): boolean {
  if (!e || statusAtendimento !== 'PENDENTE') return false;
  return (e.remarcacoes ?? 0) > 0 && (e.estado === 'AGENDADA' || e.estado === 'HOJE');
}

/** Rótulo do chip, com "falta concluir" quando a consulta foi atendida e a demanda segue aberta. */
export function rotuloDoEncaminhamento(
  estado: EstadoEncaminhamento,
  statusAtendimento: StatusAtendimento,
  remarcacoes?: number,
): string {
  if (consultaRemarcada({ estado, remarcacoes }, statusAtendimento)) return 'Consulta remarcada';
  const base = ESTADO_ENCAMINHAMENTO[estado]?.rotulo ?? 'Encaminhado';
  return estado === 'ATENDIDA' && statusAtendimento === 'PENDENTE' ? `${base} · falta concluir` : base;
}

/**
 * A consulta foi atendida e o atendimento continua aberto: oferecer "Concluir atendimento".
 *
 * Desde 15/09/2026 a consulta atendida fecha o atendimento sozinha; isto sobra
 * para o que ficou aberto antes da regra, para a consulta que tinha cópia
 * aberta e para a janela de troca (contêiner antigo não fecha nada).
 */
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
  /*
    A CONSULTA MANTIDA NUM ATENDIMENTO CANCELADO (14/09/2026). Quem cancela pode
    desmarcar "cancelar a consulta também" (o duplicado cuja consulta vale para o
    outro). Aí a frase de sempre, "Consulta marcada", esconderia a contradição.
  */
  if (statusAtendimento === 'CANCELADO' && (e.estado === 'AGENDADA' || e.estado === 'HOJE' || e.estado === 'FICOU_PARA_TRAS')) {
    return `O atendimento foi cancelado, mas a consulta${com} continua marcada para ${rotuloDoInstante(e.inicio)}.`;
  }
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
      // "Ninguém vai atender" só cobra enquanto a demanda está aberta.
      return statusAtendimento === 'PENDENTE'
        ? `A consulta${com} foi cancelada. Ninguém vai atender se não houver outra.`
        : `A consulta${com} foi cancelada.`;
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
// Fechamento: concluir, cancelar, reabrir (14/09/2026)
// ---------------------------------------------------------------------------

export type AcaoDeFechar = 'CONCLUIR' | 'CANCELAR';
export type EscolhaDaConsulta = 'MANTER' | 'CANCELAR';

/** Os limites do servidor (ConcluirAtendimentoDto / CancelarAtendimentoDto). */
export const NOTA_MINIMA = 10;
export const NOTA_MAXIMA = 2000;
export const MOTIVO_MAXIMO = 1000;

const FRASE_NOTA_CURTA = `Conte em poucas palavras como a demanda terminou (pelo menos ${NOTA_MINIMA} caracteres).`;

/** "A Dra. Shérad", "O Dr. Murilo", "Maria": o nome como sujeito da frase, com a regra do `comQuem`. */
export function sujeitoDaFrase(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return `A ${n}`;
  if (/^dr\.?\s/i.test(n)) return `O ${n}`;
  return n;
}

/**
 * Qual das seis telas do "Concluir" mostrar — lida do plano do servidor.
 *
 * Não decide o que é permitido (isso é `fechamento.concluir`): só escolhe o
 * texto. `null` quando a API ainda não manda o plano.
 */
export type CasoDoConcluir = 'ATENDIDA' | 'RESOLVIDO_NO_ATO' | 'SEM_CONSULTA' | 'FUTURA' | 'COMECOU' | 'EM_ANDAMENTO';
export function casoDoConcluir(at: {
  desfecho: DesfechoAtendimento | null;
  fechamento?: FechamentoAtendimento | null;
}): CasoDoConcluir | null {
  const f = at.fechamento;
  if (!f) return null;
  const s = f.consulta?.situacao;
  if (s === 'ATENDIDA' || s === 'FUTURA' || s === 'COMECOU' || s === 'EM_ANDAMENTO') return s;
  return at.desfecho === 'RESOLVIDO_ATO' ? 'RESOLVIDO_NO_ATO' : 'SEM_CONSULTA';
}

/**
 * "Concluir atendimento" é o botão SÓLIDO só quando concluir não decide nada
 * além de fechar: a consulta foi atendida, ou foi resolvido no ato. Nos demais
 * casos é contorno, porque o modal vai pedir uma decisão.
 */
export function concluirEhDireto(at: {
  status: StatusAtendimento;
  desfecho: DesfechoAtendimento | null;
  fechamento?: FechamentoAtendimento | null;
  encaminhamento?: Encaminhamento | null;
}): boolean {
  if (at.status !== 'PENDENTE' || !at.desfecho) return false;
  const caso = casoDoConcluir(at);
  if (caso) return caso === 'ATENDIDA' || caso === 'RESOLVIDO_NO_ATO';
  return faltaConcluir(at);
}

export interface EscolhasDoFechamento {
  /** O que fazer com a consulta vigente; `null` enquanto ninguém escolheu. */
  consulta: EscolhaDaConsulta | null;
  /** Concluir: a nota. Cancelar: o detalhe opcional. */
  texto: string;
  categoria: CategoriaCancelamentoAtendimento | '';
}

/**
 * A escolha com que o modal abre.
 *
 * CANCELAR COM CONSULTA ABERTA VEM COM "CANCELAR TAMBÉM" MARCADO (D8): a ação
 * pesada já foi escolhida, e manter a consulta cria um fantasma que a Triagem
 * não consegue limpar (ela não edita a agenda). O CONCLUIR não pergunta nada
 * sobre a consulta desde 15/09/2026: ou não há consulta de pé, ou concluir é
 * "resolvido sem a consulta", que a cancela.
 */
export function escolhaInicialDaConsulta(acao: AcaoDeFechar, f: FechamentoAtendimento | null | undefined): EscolhaDaConsulta | null {
  if (acao === 'CANCELAR' && f?.cancelar.consulta === 'ESCOLHER') return 'CANCELAR';
  return null;
}

/*
  A TRIAGEM NÃO RESPONDE MAIS PELO ADVOGADO (15/09/2026). O #13 tinha consulta
  às 09:00 sem registro às 18:38, e o modal perguntava à triagem se ela tinha
  acontecido. Agora quem registra a consulta é quem atendeu, e o atendimento
  fecha junto; pela triagem, concluir com a consulta de pé é sempre "resolvido
  sem a consulta". O plano antigo (ESCOLHER, contêiner de antes na janela de
  troca) é lido do mesmo jeito e manda CANCELAR.
*/
function concluirCancelaAConsulta(f: FechamentoAtendimento): boolean {
  return f.concluir.consulta === 'CANCELAR_PARA_CONCLUIR' || f.concluir.consulta === 'ESCOLHER';
}

/** A consulta vai ser cancelada no gesto? (lido do plano e da escolha, nunca recalculado). */
export function vaiCancelarConsulta(acao: AcaoDeFechar, f: FechamentoAtendimento | null | undefined, e: EscolhasDoFechamento): boolean {
  if (!f?.consulta) return false;
  if (acao === 'CONCLUIR') return concluirCancelaAConsulta(f);
  return f.cancelar.consulta === 'ESCOLHER' && e.consulta === 'CANCELAR';
}

/** A nota é obrigatória AGORA? Só quando nenhum outro registro diz como a demanda terminou. */
export function notaObrigatoria(f: FechamentoAtendimento | null | undefined, e: EscolhasDoFechamento): boolean {
  if (!f) return false;
  if (f.concluir.nota === 'OBRIGATORIA') return true;
  return f.concluir.nota === 'OBRIGATORIA_SE_CANCELAR' && vaiCancelarConsulta('CONCLUIR', f, e);
}

/**
 * O botão principal pode gravar? E, se não, o que falta (a frase da API).
 *
 * É o espelho das recusas do servidor para o que a pessoa AINDA não escolheu.
 * O servidor continua sendo quem decide: se o plano mudou enquanto o modal
 * estava aberto, a API recusa e a tela recarrega o detalhe.
 */
export function conferirFechamento(
  acao: AcaoDeFechar,
  f: FechamentoAtendimento | null | undefined,
  e: EscolhasDoFechamento,
): { pronto: boolean; falta: string | null } {
  if (!f) return { pronto: false, falta: null };
  const texto = e.texto.trim();
  if (acao === 'CONCLUIR') {
    if (!f.concluir.permitido) return { pronto: false, falta: f.concluir.recusa };
    if (notaObrigatoria(f, e) && texto.length < NOTA_MINIMA) return { pronto: false, falta: FRASE_NOTA_CURTA };
    if (texto.length > NOTA_MAXIMA) return { pronto: false, falta: `A nota cabe em ${NOTA_MAXIMA} caracteres.` };
    return { pronto: true, falta: null };
  }
  if (!f.cancelar.permitido) return { pronto: false, falta: f.cancelar.recusa };
  if (!e.categoria) return { pronto: false, falta: 'Diga por que o atendimento vai ser cancelado.' };
  if (f.cancelar.consulta === 'ESCOLHER' && !e.consulta) return { pronto: false, falta: 'Diga o que fazer com a consulta marcada.' };
  if (texto.length > MOTIVO_MAXIMO) return { pronto: false, falta: `O detalhe cabe em ${MOTIVO_MAXIMO} caracteres.` };
  return { pronto: true, falta: null };
}

/** O corpo do PATCH /concluir. `consulta` só vai quando o plano pede uma decisão. */
export function corpoDoConcluir(f: FechamentoAtendimento | null | undefined, e: EscolhasDoFechamento): ConcluirAtendimentoInput {
  const corpo: ConcluirAtendimentoInput = {};
  const nota = e.texto.trim();
  if (nota) corpo.nota = nota;
  if (f && concluirCancelaAConsulta(f)) corpo.consulta = 'CANCELAR';
  return corpo;
}

/** O corpo do PATCH /cancelar. */
export function corpoDoCancelar(f: FechamentoAtendimento | null | undefined, e: EscolhasDoFechamento): CancelarAtendimentoInput {
  const corpo: CancelarAtendimentoInput = { categoria: e.categoria as CategoriaCancelamentoAtendimento };
  const motivo = e.texto.trim();
  if (motivo) corpo.motivo = motivo;
  if (f?.cancelar.consulta === 'ESCOLHER' && e.consulta) corpo.consulta = e.consulta;
  return corpo;
}

/** Algo foi escolhido ou digitado? Com o formulário sujo, toque fora e Esc não fecham. */
export function fechamentoSujo(acao: AcaoDeFechar, f: FechamentoAtendimento | null | undefined, e: EscolhasDoFechamento): boolean {
  return e.texto.length > 0 || !!e.categoria || e.consulta !== escolhaInicialDaConsulta(acao, f);
}

function aConsulta(responsavel: PessoaResumo | null | undefined): string {
  const quem = nomeDeQuemAtende(responsavel);
  return `A consulta${quem ? ` ${comQuem(quem)}` : ''}`;
}

function diaMesBR(instante: string): string {
  return new Date(instante).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_BR });
}

/**
 * O resumo do topo do "Concluir", caso a caso. O tom decide o bloco: verde
 * para o que já aconteceu, âmbar para o que precisa ser lido antes de gravar.
 */
export function resumoDoConcluir(
  caso: CasoDoConcluir,
  at: {
    desfechoEm?: string | null;
    fechamento?: FechamentoAtendimento | null;
    consultas?: CompromissoResumo[];
    compromissos?: CompromissoResumo[];
  },
  agora: Date = new Date(),
): { tom: TomDoEstado; texto: string; apoio: string | null } {
  const c = at.fechamento?.consulta ?? null;
  const quem = nomeDeQuemAtende(c?.responsavel);
  switch (caso) {
    case 'ATENDIDA':
      return { tom: 'verde', texto: `${aConsulta(c?.responsavel)} foi atendida em ${rotuloDoDia(diaBR(c!.inicio))}.`, apoio: null };
    case 'RESOLVIDO_NO_ATO':
      return { tom: 'verde', texto: at.desfechoEm ? `Resolvido no ato em ${diaMesBR(at.desfechoEm)}.` : 'Resolvido no ato.', apoio: null };
    case 'SEM_CONSULTA': {
      const canceladas = consultasDoAtendimento(at)
        .filter((x) => x.status === 'CANCELADO')
        .sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime());
      return canceladas.length
        ? { tom: 'neutro', texto: `${aConsulta(canceladas[0].responsavel)} foi cancelada e não houve outra.`, apoio: null }
        : { tom: 'neutro', texto: 'Nenhuma consulta foi atendida neste atendimento.', apoio: null };
    }
    case 'FUTURA':
      return {
        tom: 'ambar',
        texto: `${aConsulta(c?.responsavel)} é ${rotuloDoInstante(c!.inicio)}.`,
        apoio:
          `Use só se a demanda se resolveu sem a consulta. Ela sai da agenda${quem ? ` ${deQuem(quem)}` : ''} como cancelada ` +
          '(Perdeu o objeto), com o seu nome, e ninguém recebe aviso fora do sistema. Se a demanda ainda precisa da consulta, ' +
          `não faça nada: o atendimento é concluído sozinho quando ${sujeitoMinusculo(quem)} registrar.`,
      };
    case 'COMECOU':
      return {
        tom: 'ambar',
        texto: diaBR(c!.inicio) === diaBR(agora)
          ? `${aConsulta(c?.responsavel)} era hoje às ${horaBR(c!.inicio)} e ainda não foi registrada.`
          : `${aConsulta(c?.responsavel)} de ${rotuloDoInstante(c!.inicio)} ainda não foi registrada.`,
        apoio:
          `Se a consulta aconteceu, quem registra é ${quem ? comArtigo(quem) : 'quem atendeu'}, e o atendimento é concluído sozinho. ` +
          'Use esta tela só se a demanda se resolveu sem a consulta: ela é cancelada como Perdeu o objeto, com a sua nota.',
      };
    case 'EM_ANDAMENTO':
    default:
      return {
        tom: 'neutro',
        texto: `${quem ? sujeitoDaFrase(quem) : 'Alguém'} está com a consulta em andamento agora. A consulta não é mexida: quem encerra é quem atende.`,
        apoio: null,
      };
  }
}

/**
 * As linhas do "Cancelar" sobre a consulta. `marcada` é a caixa "cancelar
 * também"; `aviso` aparece quando ela está desmarcada.
 */
export function textosDaConsultaNoCancelar(
  f: FechamentoAtendimento,
  agora: Date = new Date(),
): { titulo: string; apoio: string; aviso: string } | null {
  const c = f.consulta;
  if (!c) return null;
  const quem = nomeDeQuemAtende(c.responsavel);
  const daAgenda = `agenda${quem ? ` ${deQuem(quem)}` : ''}`;
  if (f.cancelar.consulta === 'ATENDIDA') {
    return {
      titulo: `${aConsulta(c.responsavel)} já foi atendida em ${rotuloDoDia(diaBR(c.inicio))} e continua no histórico.`,
      apoio: 'Se a demanda se resolveu na consulta, o certo é concluir.',
      aviso: '',
    };
  }
  if (f.cancelar.consulta === 'SO_MANTER') {
    return {
      titulo: `${quem ? sujeitoDaFrase(quem) : 'Alguém'} está com a consulta em andamento. A consulta não é mexida: quem encerra é quem atende.`,
      apoio: '',
      aviso: '',
    };
  }
  const jaFicouParaTras = diaBR(c.inicio) < diaBR(agora);
  return {
    titulo: `Cancelar também a consulta${quem ? ` ${comQuem(quem)}` : ''}`,
    apoio: `${rotuloDoInstante(c.inicio)} · ${rotuloDaModalidadeNoCartao(c.local)}. Sai da ${daAgenda} como cancelada, com o mesmo motivo e o seu nome.`,
    aviso: jaFicouParaTras
      ? `A consulta continua na ${daAgenda}, como algo que ficou para trás, até alguém registrar o que houve.`
      : `A consulta continua na ${daAgenda}. Se ninguém cancelar, ela vai ficar para trás na agenda dessa pessoa depois de ${rotuloDoDia(diaBR(c.inicio))}.`,
  };
}

/** "A consulta com a Dra. Shérad de qui, 17/09 às 09:00 foi cancelada." — lida da RESPOSTA do servidor. */
export function fraseDaConsultaCancelada(c: { inicio: string; responsavel: PessoaResumo | null }): string {
  return `${aConsulta(c.responsavel)} de ${rotuloDoInstante(c.inicio)} foi cancelada.`;
}

/** A mensagem ao filiado quando a consulta dele foi cancelada no fechamento. Sem emoji. */
export function mensagemDaConsultaCancelada(p: { nomeFiliado: string; inicio: string }): string {
  return [
    `Olá, ${primeiroNomeDe(p.nomeFiliado)}. Aqui é do ${tenant.sigla}.`,
    '',
    `A sua consulta jurídica de ${rotuloDoDia(diaBR(p.inicio))}, às ${horaBR(p.inicio)}, foi cancelada.`,
    '',
    'Se ainda precisar de ajuda, é só responder esta mensagem.',
  ].join('\n');
}

/**
 * Depois de gravar, a confirmação com WhatsApp aparece?
 *
 * Só quando o SERVIDOR diz que cancelou alguma consulta (o advogado pode ter
 * fechado antes). E nunca em "Registrado por engano": a pessoa não precisa
 * saber de um erro interno; basta o toast.
 */
export function mostrarConfirmacaoDoFechamento(
  acao: AcaoDeFechar,
  categoria: CategoriaCancelamentoAtendimento | '',
  efeitos: EfeitosDoFechamento | null | undefined,
  caso?: CasoDoConcluir | null,
): boolean {
  if (!efeitos?.consultasCanceladas?.length) return false;
  if (acao === 'CANCELAR' && categoria === 'DUPLICIDADE') return false;
  /*
    CÓPIA NÃO VIRA MENSAGEM (15/09/2026). Com a consulta vigente atendida,
    concluir cancela as cópias que sobraram como "Registrado por engano": o
    filiado já foi atendido e não precisa saber de um registro repetido.
  */
  if (acao === 'CONCLUIR' && caso === 'ATENDIDA') return false;
  return !efeitos.consultasCanceladas.every((c) => c.categoria === 'DUPLICIDADE');
}

/**
 * AS CÓPIAS ABERTAS (E4, 15/09/2026). A consulta vigente foi atendida e ainda
 * há outra nascida do atendimento marcada: concluir cancela as que sobraram
 * como "Registrado por engano". O modal diz antes de gravar.
 */
export function avisoDasCopiasAbertas(caso: CasoDoConcluir | null, f: FechamentoAtendimento | null | undefined): string | null {
  const n = f?.consultasAbertas ?? 0;
  if (caso !== 'ATENDIDA' || n <= 0) return null;
  return n === 1
    ? 'Ainda há outra consulta marcada deste atendimento. Como a consulta já foi atendida, ao concluir ela é cancelada como Registrado por engano.'
    : `Ainda há ${n} consultas marcadas deste atendimento. Como a consulta já foi atendida, ao concluir elas são canceladas como Registrado por engano.`;
}

/** O toast depois de concluir sem a tela de confirmação: diz as cópias canceladas, quando houve. */
export function avisoDoConcluido(efeitos: EfeitosDoFechamento | null | undefined): string {
  const n = efeitos?.consultasCanceladas?.length ?? 0;
  if (n === 0) return 'Atendimento concluído.';
  return n === 1
    ? 'Atendimento concluído. A consulta repetida foi cancelada.'
    : `Atendimento concluído. As ${n} consultas repetidas foram canceladas.`;
}

/** O título do modal: com a consulta de pé, concluir é resolver sem ela. */
export function tituloDoConcluir(caso: CasoDoConcluir | null, numero: number | null | undefined): string {
  const n = numero ? ` #${numero}` : '';
  return caso === 'FUTURA' || caso === 'COMECOU' ? `Resolver sem a consulta${n}` : `Concluir atendimento${n}`;
}

// ---------------------------------------------------------------------------
// A gaveta do atendimento independente (15/09/2026)
// ---------------------------------------------------------------------------

/** "a Dra. Shérad", "o Dr. Murilo", "Maria" — o nome no meio da frase. */
export function comArtigo(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return `a ${n}`;
  if (/^dr\.?\s/i.test(n)) return `o ${n}`;
  return n;
}

/** "ela", "ele" ou o próprio nome: sem chutar gênero de nome sem tratamento. */
function pronomeDe(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return 'ela';
  if (/^dr\.?\s/i.test(n)) return 'ele';
  return n;
}

function sujeitoMinusculo(nome: string): string {
  return nome ? comArtigo(nome) : 'quem atende';
}

/**
 * O QUE A GAVETA OFERECE NO FECHAMENTO — lido da fila e do plano do servidor.
 *
 *  FECHA_SOZINHO          a consulta está de pé: nada a fazer, só esperar.
 *  CONSULTA_SEM_REGISTRO  ficou 2 dias úteis sem registro: fale com quem atende.
 *  CONCLUIR               a vez é da triagem, e concluir é o gesto certo.
 *  OUTRO                  sem desfecho, fechado, ou API de antes (sem fila nem plano).
 */
export type ModoDoFechamento = 'FECHA_SOZINHO' | 'CONSULTA_SEM_REGISTRO' | 'CONCLUIR' | 'OUTRO';

export function modoDoFechamento(at: {
  status: StatusAtendimento;
  desfecho: DesfechoAtendimento | null;
  fila?: FilaNaResposta;
  fechamento?: FechamentoAtendimento | null;
}): ModoDoFechamento {
  if (at.status !== 'PENDENTE' || !at.desfecho) return 'OUTRO';
  const naFila = filaDe(at);
  if (naFila?.motivo === 'CONSULTA_SEM_REGISTRO') return 'CONSULTA_SEM_REGISTRO';
  if (at.fechamento?.fechaSozinho) return 'FECHA_SOZINHO';
  if (naFila?.fila === 'TRIAGEM' && (naFila.motivo === 'FALTA_CONCLUIR' || naFila.motivo === 'SEM_CONSULTA' || naFila.motivo === 'CONSULTA_CANCELADA')) {
    return 'CONCLUIR';
  }
  return 'OUTRO';
}

/** O bloco neutro de quem só espera: quem registra, e quando volta para a triagem. */
export function textoDoFechaSozinho(responsavel: PessoaResumo | { nome: string; nomeExibicao?: string | null } | null | undefined): {
  texto: string;
  apoio: string;
} {
  const quem = nomeDeQuemAtende(responsavel);
  return {
    texto: `Este atendimento é concluído sozinho quando ${sujeitoMinusculo(quem)} registrar a consulta na agenda.`,
    apoio: 'Se a consulta for cancelada, ou ficar 2 dias úteis sem registro, ele volta para a triagem.',
  };
}

/** Dois dias úteis depois, sem registro: a triagem fala com quem atende, e o fechamento continua sendo dela. */
export function textoDaConsultaSemRegistro(e: Pick<Encaminhamento, 'inicio' | 'responsavel'>): string {
  const quem = nomeDeQuemAtende(e.responsavel);
  if (!quem) {
    return `A consulta de ${rotuloDoDia(diaBR(e.inicio))} ainda não foi registrada. `
      + 'Quando alguém registrar, o atendimento é concluído sozinho.';
  }
  const pronome = pronomeDe(quem);
  return `A consulta de ${rotuloDoDia(diaBR(e.inicio))} ${comQuem(quem)} ainda não foi registrada. `
    + `Fale com ${pronome} ou com o ${V.filiado}: quando ${pronome} registrar, o atendimento é concluído sozinho.`;
}

/** A consulta remarcada: o dia novo, e o que fazer (avisar o filiado). */
export function textoDaRemarcada(e: Pick<Encaminhamento, 'inicio'>): string {
  return `A consulta foi remarcada para ${rotuloDoInstante(e.inicio)}. Avise o ${V.filiado}.`;
}

/**
 * A atividade é a consulta que NASCEU de um atendimento? Seguimento (criado na
 * conclusão, herda o atendimento) não fecha nada. `origemDesfechoId` ausente
 * conta como consulta: o aviso que o usa é escrito com "se".
 */
export function consultaFechaOAtendimento(c: { atendimentoId?: string | null; origemDesfechoId?: string | null }): boolean {
  return !!c.atendimentoId && !c.origemDesfechoId;
}

/**
 * A FRASE DA TRIAGEM NA GAVETA DA CONSULTA (E5, 15/09/2026).
 *
 * Lida dos campos que a API manda do atendimento (`status`,
 * `conclusaoConsultaId`). Sem eles (API de antes), não afirma nada.
 */
export function fraseDaTriagemNaConsulta(c: {
  id: string;
  status: string;
  origemDesfechoId?: string | null;
  atendimento: { numero: number; status?: string | null; conclusaoConsultaId?: string | null } | null;
}): string | null {
  const at = c.atendimento;
  if (!at) return null;
  if (at.conclusaoConsultaId && at.conclusaoConsultaId === c.id && at.status !== 'PENDENTE') {
    return `O atendimento #${at.numero} foi concluído junto com esta consulta.`;
  }
  if (c.origemDesfechoId || at.status !== 'PENDENTE') return null;
  if (c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO') {
    return `Ao registrar esta consulta, o atendimento #${at.numero} é concluído junto.`;
  }
  if (c.status === 'CANCELADO') return `O atendimento #${at.numero} voltou para a triagem.`;
  return null;
}

/** No menu da lista: com a consulta de pé, "concluir" é resolver sem ela. */
export function rotuloDoConcluirNoMenu(a: { status: StatusAtendimento; fila?: FilaNaResposta }): string {
  return a.status === 'PENDENTE' && filaDe(a)?.fila === 'CONSULTA' ? 'Resolvido sem a consulta' : 'Concluir atendimento';
}

/**
 * O bloco "Concluído/Cancelado em … por …" da gaveta.
 *
 * Registro fechado antes das colunas de 14/09/2026 não tem data: não mostra o
 * bloco (sem backfill a partir da auditoria, que é frágil de ler).
 */
export function fraseDoFechamento(at: {
  status: StatusAtendimento;
  concluidoEm?: string | null;
  concluidoPor?: PessoaResumo | null;
  conclusaoObs?: string | null;
  conclusaoOrigem?: OrigemDaConclusao | null;
  canceladoEm?: string | null;
  canceladoPor?: PessoaResumo | null;
  canceladoCategoria?: string | null;
  canceladoMotivo?: string | null;
}): { texto: string; detalhe: string | null } | null {
  if (at.status === 'CANCELADO' && at.canceladoEm) {
    const por = nomeDeQuemAtende(at.canceladoPor);
    const categoria = rotuloDaCategoriaDoAtendimento(at.canceladoCategoria);
    return {
      texto: `Cancelado em ${rotuloDoInstante(at.canceladoEm)}${por ? ` por ${por}` : ''}${categoria ? ` · ${categoria}` : ''}`,
      detalhe: at.canceladoMotivo?.trim() || null,
    };
  }
  if (at.status === 'CONCLUIDO' && at.concluidoEm) {
    const por = nomeDeQuemAtende(at.concluidoPor);
    // Fechado pela consulta (15/09/2026): a nota é o desfecho que o advogado gravou.
    const pela = at.conclusaoOrigem === 'CONSULTA' ? ' pela consulta' : '';
    return {
      texto: `Concluído${pela} em ${rotuloDoInstante(at.concluidoEm)}${por ? ` por ${por}` : ''}`,
      detalhe: at.conclusaoObs?.trim() || null,
    };
  }
  return null;
}

/**
 * O texto do "Reabrir". A confirmação existe porque reabrir apaga da ficha o
 * motivo ou a nota (a auditoria guarda). Reabrir não ressuscita consulta: a
 * agenda de quem atendia pode já estar ocupada.
 */
export function textoDoReabrir(at: {
  numero: number;
  status: StatusAtendimento;
  consultas?: CompromissoResumo[];
  compromissos?: CompromissoResumo[];
  concluidoPor?: PessoaResumo | null;
  conclusaoOrigem?: OrigemDaConclusao | null;
  canceladoPor?: PessoaResumo | null;
  canceladoCategoria?: string | null;
}): { titulo: string; descricao: string } {
  /*
    QUEM FECHOU E POR QUÊ (15/09/2026). O Reabrir dizia o que sai da ficha, mas
    não o que estava sendo desfeito: "Cancelado por Julian · Filiado desistiu"
    é o que faz a pessoa parar se tocou no atendimento errado.
  */
  const partes: string[] = [];
  if (at.status === 'CANCELADO') {
    const por = nomeDeQuemAtende(at.canceladoPor);
    const categoria = rotuloDaCategoriaDoAtendimento(at.canceladoCategoria);
    const quem = [por && `Cancelado por ${por}`, categoria].filter(Boolean).join(' · ');
    if (quem) partes.push(`${quem}.`);
    partes.push('Ele volta para os pendentes. O motivo do cancelamento sai da ficha e continua guardado na auditoria.');
  } else {
    const por = nomeDeQuemAtende(at.concluidoPor);
    if (at.conclusaoOrigem === 'CONSULTA') partes.push(`Concluído pela consulta${por ? `, por ${por}` : ''}.`);
    else if (por) partes.push(`Concluído por ${por}.`);
    partes.push('Ele volta para os pendentes. A nota de conclusão sai da ficha e continua guardada na auditoria.');
  }
  /*
    SÓ COM A CONSULTA VIGENTE CANCELADA (15/09/2026). A frase aparecia com
    QUALQUER consulta cancelada, inclusive a antiga de um atendimento que tinha
    uma nova, atendida. A vigente só é cancelada quando todas as nascidas são.
  */
  const consultas = consultasDoAtendimento(at);
  if (consultas.length > 0 && consultas.every((c) => c.status === 'CANCELADO')) {
    partes.push('A consulta cancelada não volta: se ainda for preciso, marque outra depois.');
  }
  return { titulo: `Reabrir o atendimento #${at.numero}?`, descricao: partes.join(' ') };
}

/**
 * "Marcar nova consulta" (D13, fase 2): encaminhado, TODAS as consultas nascidas
 * canceladas, e a demanda ainda aberta. Sem isso, "Ninguém vai atender se não
 * houver outra" apontava para uma porta que não existia.
 */
export function podeMarcarNovaConsulta(at: {
  status: StatusAtendimento;
  desfecho: DesfechoAtendimento | null;
  consultas?: CompromissoResumo[];
  compromissos?: CompromissoResumo[];
}): boolean {
  if (at.status !== 'PENDENTE' || at.desfecho !== 'ENCAMINHADO') return false;
  const consultas = consultasDoAtendimento(at);
  return consultas.length > 0 && consultas.every((c) => c.status === 'CANCELADO');
}

/**
 * A frase de uma falha de gravação.
 *
 * A rota que ainda não existe no servidor (web novo com a API antiga, na janela
 * de troca) volta 404 com "Cannot PATCH …": isso não é português de gente, e
 * "não encontrado" faria pensar que o atendimento sumiu.
 */
export function mensagemDaFalha(e: any, padrao: string): string {
  const m = e?.response?.data?.message;
  const texto = Array.isArray(m) ? m[0] : m;
  if (e?.response?.status === 404 && (!texto || /^Cannot\s/i.test(String(texto)))) {
    return 'Esta ação ainda não chegou ao servidor. Atualize a página daqui a alguns minutos.';
  }
  return typeof texto === 'string' && texto ? texto : padrao;
}

// ---------------------------------------------------------------------------
// Filtros vindos da URL
// ---------------------------------------------------------------------------

export interface FiltroDaUrl {
  status: '' | StatusAtendimento;
  /** Só com `status = PENDENTE`: triagem ou consulta. */
  fila: '' | FilaDoAtendimento;
  desfecho: '' | DesfechoAtendimento;
  canal: '' | CanalAtendimento;
  assunto: string;
  dataInicio: string;
  dataFim: string;
  /**
   * `me`: só os que a pessoa registrou (15/09/2026). É o recorte do "Comigo,
   * com a triagem" do painel; sem ele o link abria a fila da casa inteira.
   */
  atendente: '' | 'me';
}

export const PARAMETROS_DO_FILTRO = ['status', 'fila', 'desfecho', 'canal', 'assunto', 'dataInicio', 'dataFim', 'atendente'] as const;

/**
 * O SELETOR ÚNICO DE STATUS (15/09/2026): "Com a triagem" e "Aguardando a
 * consulta" são recortes dos pendentes, e dois selects (status e fila) deixariam
 * montar "Concluído + aguardando a consulta", que não existe.
 */
export type ValorDoSeletorDeStatus = '' | 'TRIAGEM' | 'CONSULTA' | StatusAtendimento;

export const OPCOES_DO_SELETOR_DE_STATUS: { valor: ValorDoSeletorDeStatus; rotulo: string }[] = [
  { valor: '', rotulo: 'Todos os status' },
  { valor: 'TRIAGEM', rotulo: 'Com a triagem' },
  { valor: 'CONSULTA', rotulo: 'Aguardando a consulta' },
  { valor: 'PENDENTE', rotulo: 'Todos os pendentes' },
  { valor: 'CONCLUIDO', rotulo: 'Concluído' },
  { valor: 'CANCELADO', rotulo: 'Cancelado' },
];

export function valorDoSeletorDeStatus(status: '' | StatusAtendimento, fila: '' | FilaDoAtendimento): ValorDoSeletorDeStatus {
  return status === 'PENDENTE' && fila ? fila : status;
}

export function filtroDoSeletorDeStatus(valor: ValorDoSeletorDeStatus): { status: '' | StatusAtendimento; fila: '' | FilaDoAtendimento } {
  if (valor === 'TRIAGEM' || valor === 'CONSULTA') return { status: 'PENDENTE', fila: valor };
  return { status: valor, fila: '' };
}

/**
 * A LISTA VAZIA DIZ O QUE O VAZIO SIGNIFICA (15/09/2026). Na captura da
 * produção, "Com a triagem" vazio mostrava "Nenhum atendimento encontrado com
 * esses filtros" — soa como busca que falhou, quando é a boa notícia. E quem
 * chegou ali procurando os 2 pendentes precisa saber onde eles estão.
 */
export function vazioDaLista(f: {
  status: '' | StatusAtendimento; fila: '' | FilaDoAtendimento; atendente: '' | 'me'; filtrando: boolean;
}): { titulo: string; detalhe: string | null; acao: { rotulo: string; fila: FilaDoAtendimento } | null } {
  if (f.status === 'PENDENTE' && f.fila === 'TRIAGEM') {
    return {
      titulo: f.atendente === 'me' ? 'Nada seu com a triagem agora.' : 'Nada com a triagem agora.',
      detalhe: 'Os encaminhados aguardam a consulta e são concluídos sozinhos quando ela for registrada na agenda.',
      acao: { rotulo: 'Ver os que aguardam a consulta', fila: 'CONSULTA' },
    };
  }
  if (f.status === 'PENDENTE' && f.fila === 'CONSULTA') {
    return { titulo: 'Nenhum atendimento aguardando consulta.', detalhe: null, acao: null };
  }
  return {
    titulo: f.filtrando ? 'Nenhum atendimento encontrado com esses filtros.' : 'Nenhum atendimento registrado ainda.',
    detalhe: null,
    acao: null,
  };
}

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
  const statusLido = valor('status');
  const filaLida = valor('fila');
  const desfecho = valor('desfecho');
  const canal = valor('canal');
  const assunto = valor('assunto');
  const status: '' | StatusAtendimento = (['PENDENTE', 'CONCLUIDO', 'CANCELADO'] as const).includes(statusLido as StatusAtendimento)
    ? (statusLido as StatusAtendimento)
    : '';
  // A fila é recorte dos pendentes: `fila=TRIAGEM` sozinha abre os pendentes da
  // triagem; com Concluído ou Cancelado ela não quer dizer nada e é ignorada.
  const fila: '' | FilaDoAtendimento = (filaLida === 'TRIAGEM' || filaLida === 'CONSULTA') && (status === '' || status === 'PENDENTE')
    ? filaLida
    : '';
  return {
    status: fila ? 'PENDENTE' : status,
    fila,
    desfecho: desfecho === 'RESOLVIDO_ATO' || desfecho === 'ENCAMINHADO' ? desfecho : '',
    canal: (CANAIS as string[]).includes(canal) ? (canal as CanalAtendimento) : '',
    assunto: ASSUNTOS.includes(assunto) ? assunto : '',
    dataInicio: dia('dataInicio'),
    dataFim: dia('dataFim'),
    atendente: valor('atendente') === 'me' ? 'me' : '',
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

/*
  CONCLUIR E CANCELAR TÊM ROTA PRÓPRIA (14/09/2026).

  Eram um PATCH de status sem motivo nem efeito sobre a consulta: o #9 alternou
  CANCELADO e CONCLUIDO seis vezes em quatro minutos. O `/status` passa a
  aceitar só PENDENTE (Reabrir). Não há função aqui que mande CONCLUIDO ou
  CANCELADO pelo `/status`: contra a API antiga, a rota nova dá 404 e a tela
  diz que ainda não chegou, em vez de cair na porta sem motivo.
*/
export interface ConcluirAtendimentoInput {
  nota?: string;
  consulta?: EscolhaDaConsulta;
}
export interface CancelarAtendimentoInput {
  categoria: CategoriaCancelamentoAtendimento;
  motivo?: string;
  consulta?: EscolhaDaConsulta;
}
export interface EfeitosDoFechamento {
  consultasCanceladas: {
    id: string;
    inicio: string;
    responsavel: PessoaResumo | null;
    /** A categoria gravada na consulta. Opcional: a API de antes não manda. */
    categoria?: string | null;
  }[];
}
/** O detalhe de sempre, mais o que o servidor fez de fato com as consultas. */
export type RespostaDoFechamento = AtendimentoDossie & { efeitos?: EfeitosDoFechamento };

export async function concluirAtendimento(id: string, dto: ConcluirAtendimentoInput): Promise<RespostaDoFechamento> {
  return (await api.patch(`/atendimentos/${id}/concluir`, dto)).data;
}

export async function cancelarAtendimento(id: string, dto: CancelarAtendimentoInput): Promise<RespostaDoFechamento> {
  return (await api.patch(`/atendimentos/${id}/cancelar`, dto)).data;
}

/** Reabrir: o único uso que sobrou do `/status`. Não reabre consulta nenhuma. */
export async function reabrirAtendimento(id: string): Promise<AtendimentoDossie> {
  return (await api.patch(`/atendimentos/${id}/status`, { status: 'PENDENTE' })).data;
}

export interface MudarModalidadeInput {
  modalidade: ModalidadeConsulta;
  /** Só com VIDEO. Sair do vídeo zera o link no servidor. */
  linkReuniao?: string | null;
}
/** "Mudar como vai ser" da consulta já marcada: a modalidade e, no vídeo, o link. */
export async function mudarModalidadeDaConsulta(id: string, compromissoId: string, dto: MudarModalidadeInput) {
  return (await api.patch(`/atendimentos/${id}/consultas/${compromissoId}/modalidade`, dto)).data;
}

/** Exclui o atendimento (hard delete) — só Administrador. */
export async function excluirAtendimento(id: string) {
  return (await api.delete(`/atendimentos/${id}`)).data as { ok: boolean };
}

export interface FiltroAtendimentos {
  busca?: string;
  desfecho?: DesfechoAtendimento;
  status?: StatusAtendimento;
  /** Só com `status = PENDENTE`. A API de antes ignora o parâmetro. */
  fila?: FilaDoAtendimento;
  /**
   * Só os registrados por quem pede (15/09/2026). Vai só quando marcado: a API
   * de antes recusa parâmetro desconhecido com 400 (forbidNonWhitelisted).
   */
  atendente?: 'me';
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
