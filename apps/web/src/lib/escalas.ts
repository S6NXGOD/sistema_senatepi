import { api } from './api';
import { tenant } from '@/tenant.config';
import { modalidadeDoLocal } from './atendimentos';
import { celularParaWhatsApp } from './whatsapp';

export interface AdvogadoEscala {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  /** Perfil — a tela agrupa "Advogados" primeiro. Opcional: a API antiga não manda. */
  role?: string;
  avatarUrl?: string | null;
}

export interface Escala {
  id: string;
  data: string; // ISO (data pura: meia-noite UTC do dia)
  horaInicio: string; // "HH:MM"
  horaFim: string; // "HH:MM"
  observacao: string | null;
  advogadoId?: string;
  advogado: AdvogadoEscala;
}

export interface EscalaItemInput {
  data: string;
  horaInicio: string;
  horaFim: string;
  observacao?: string;
}

/** O que o PATCH aceita (C8). A data não muda: plantão em outro dia é outro plantão. */
export interface AlteracaoDeEscala {
  advogadoId?: string;
  horaInicio?: string;
  horaFim?: string;
  observacao?: string | null;
  /**
   * Consultas que passam para quem assume (14/09/2026). Só vai quando a prévia
   * carregou: ausente = comportamento antigo (nada muda); `[]` = decidiu manter
   * todas, e a decisão fica carimbada na auditoria.
   */
  passarConsultas?: string[];
}

/**
 * Espelho do `ITENS_MAX` do DTO da API: dois meses de dias corridos. A
 * repetição semanal de um mês inteiro de dias úteis dá uns 23.
 */
export const MAXIMO_DE_DATAS_POR_VEZ = 62;

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
  advogadoId?: string;
  advogado: AdvogadoEscala;
}
/** Advogados de plantão numa data (YYYY-MM-DD; padrão hoje). */
export async function listarPlantao(data?: string): Promise<PlantaoItem[]> {
  return (await api.get('/escalas/plantao', { params: data ? { data } : {} })).data;
}

export async function listarEscalas(mes: string, advogadoId?: string): Promise<Escala[]> {
  return (await api.get('/escalas', { params: { mes, ...(advogadoId ? { advogadoId } : {}) } })).data;
}
export async function criarEscalas(advogadoId: string, itens: EscalaItemInput[]) {
  return (await api.post('/escalas', { advogadoId, itens })).data as { ok: boolean; criadas: number; ids?: string[] };
}
/** Corrige horário/observação ou troca a pessoa (C8). */
export async function atualizarEscala(id: string, dados: AlteracaoDeEscala): Promise<EscalaAtualizada> {
  return (await api.patch(`/escalas/${id}`, dados)).data;
}
export async function excluirEscala(id: string) {
  return (await api.delete(`/escalas/${id}`)).data as { ok: boolean };
}

/**
 * A frase que a API mandou, para mostrar como está.
 *
 * A recusa de sobreposição já diz QUAL dia e QUAL horário colidiu ("Em 15/09 a
 * Dra. Shérad já está de plantão 09:00–12:00."). Trocar isso por "Não foi
 * possível salvar" obrigaria quem cadastrou vinte datas a procurar a errada.
 *
 * "Cannot PATCH /api/escalas/…" é o Express dizendo que a rota não existe —
 * acontece na janela do deploy, com a tela nova diante da API antiga. Mostrar
 * isso cru assusta; a frase certa é "ainda não está disponível".
 */
export function mensagemDoErro(e: unknown, padrao: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  const texto = Array.isArray(m) ? m.find((x) => typeof x === 'string' && x.trim()) : m;
  if (typeof texto !== 'string' || !texto.trim()) return padrao;
  if (/^Cannot (GET|POST|PATCH|PUT|DELETE) /.test(texto)) {
    return 'Esta ação ainda não está disponível no servidor. Recarregue a página em alguns minutos.';
  }
  return texto.trim();
}

// ---------------------------------------------------------------------------
// Fuso: "hoje" e "agora" são os de Teresina
// ---------------------------------------------------------------------------

const FUSO_BR = 'America/Fortaleza';

function partesBR(agora: Date, opcoes: Intl.DateTimeFormatOptions): Record<string, string> {
  const partes = new Intl.DateTimeFormat('en-US', { ...opcoes, timeZone: FUSO_BR }).formatToParts(agora);
  return Object.fromEntries(partes.map((p) => [p.type, p.value]));
}

/** "YYYY-MM-DD" do dia de hoje em Teresina — qualquer que seja o fuso do aparelho. */
export function hojeBR(agora: Date = new Date()): string {
  const p = partesBR(agora, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" de agora em Teresina. */
export function horaBR(agora: Date = new Date()): string {
  const p = partesBR(agora, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/**
 * "no horário": hora atual dentro do turno (só faz sentido para o dia de hoje).
 *
 * A HORA É A DE TERESINA, como no cartão do painel. Estava a do aparelho: são
 * duas réguas para o mesmo estado, que coincidem no Brasil e divergem fora dele
 * — e as horas da escala são de Teresina.
 */
export function estaNoHorario(p: { horaInicio: string; horaFim: string }, agora: Date = new Date()): boolean {
  const hhmm = horaBR(agora);
  return hhmm >= p.horaInicio && hhmm <= p.horaFim;
}

// ---------------------------------------------------------------------------
// Dias de calendário (texto "YYYY-MM-DD", sem fuso — data pura)
// ---------------------------------------------------------------------------

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** O dia de uma data pura vinda da API ("2026-09-15T00:00:00.000Z" → "2026-09-15"). */
export function diaDaEscala(data: string): string {
  return String(data).slice(0, 10);
}

/** "YYYY-MM-DD" de um `Date` montado localmente (célula do calendário). */
export function chaveDoDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** O dia existe no calendário? (2026-02-31 casa com a regex e não existe.) */
export function ehDiaValido(texto: string): boolean {
  const m = DIA.exec(texto);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === texto;
}

/** Soma dias a um dia de calendário, pela aritmética UTC (sem horário de verão). */
export function somarDias(texto: string, n: number): string {
  const d = new Date(`${texto}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(texto: string): number {
  return new Date(`${texto}T12:00:00.000Z`).getUTCDay();
}

export const ehFimDeSemana = (texto: string) => {
  const d = diaDaSemana(texto);
  return d === 0 || d === 6;
};

/** O dia útil seguinte (sexta → segunda). É o que "Adicionar data" propõe. */
export function proximoDiaUtil(texto: string): string {
  let d = somarDias(texto, 1);
  while (ehFimDeSemana(d)) d = somarDias(d, 1);
  return d;
}

/** Último dia do mês do dia dado. */
export function ultimoDiaDoMes(texto: string): string {
  const [y, m] = texto.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** "15/09" — o jeito curto de falar do dia, igual à frase de erro da API. */
export function diaCurto(texto: string): string {
  const [, mes, dia] = diaDaEscala(texto).split('-');
  return `${dia}/${mes}`;
}

/** Dias da semana que a repetição oferece. Fim de semana não é plantão. */
export const DIAS_UTEIS: { valor: number; curto: string; longo: string }[] = [
  { valor: 1, curto: 'Seg', longo: 'segunda-feira' },
  { valor: 2, curto: 'Ter', longo: 'terça-feira' },
  { valor: 3, curto: 'Qua', longo: 'quarta-feira' },
  { valor: 4, curto: 'Qui', longo: 'quinta-feira' },
  { valor: 5, curto: 'Sex', longo: 'sexta-feira' },
];

/** Um ano de período, no máximo — trava de segurança do laço, não regra de negócio. */
export const LIMITE_DIAS_DO_PERIODO = 366;

/**
 * AS DATAS DE UMA REPETIÇÃO SEMANAL — "às segundas e quartas, de 01/09 a 30/09".
 *
 * Medido na produção em 12/09/2026: 25 plantões, 5 advogados, cada um num dia
 * fixo da semana, sempre 09:00–12:00. Cadastrar isso linha a linha dava umas 20
 * linhas por pessoa por mês.
 *
 * Sábado e domingo ficam fora mesmo que alguém os peça: o sistema não tem
 * tabela de feriados (e não vai ter), então a prévia mostra cada data e a
 * pessoa desmarca o feriado. A função só lista; quem decide é a tela.
 *
 * Período invertido, data que não existe ou nenhum dia escolhido: lista vazia,
 * nunca exceção — a prévia simplesmente não mostra nada.
 */
export function gerarDatasDaRepeticao({
  diasDaSemana,
  de,
  ate,
}: {
  diasDaSemana: number[];
  de: string;
  ate: string;
}): string[] {
  if (!ehDiaValido(de) || !ehDiaValido(ate) || de > ate) return [];
  const escolhidos = new Set(diasDaSemana.filter((d) => d >= 1 && d <= 5));
  if (escolhidos.size === 0) return [];
  const datas: string[] = [];
  let atual = de;
  for (let i = 0; i < LIMITE_DIAS_DO_PERIODO && atual <= ate; i++) {
    if (escolhidos.has(diaDaSemana(atual))) datas.push(atual);
    atual = somarDias(atual, 1);
  }
  return datas;
}

// ---------------------------------------------------------------------------
// Lista agrupada por dia
// ---------------------------------------------------------------------------

export interface GrupoDoDia<T> {
  data: string;
  quando: 'hoje' | 'proximo' | 'passado';
  itens: T[];
}

/**
 * A lista do celular, agrupada por dia: HOJE PRIMEIRO, depois os próximos dias
 * e, no fim, os que já passaram.
 *
 * Quem abre a escala no celular quer saber "quem está hoje" e "quem vem
 * depois"; o plantão de dez dias atrás é consulta, não rotina. Dentro de cada
 * bloco a ordem é a do calendário (e, no dia, a do horário).
 */
export function agruparPorDia<T extends { data: string; horaInicio: string }>(
  escalas: T[],
  hoje: string,
): GrupoDoDia<T>[] {
  const mapa = new Map<string, T[]>();
  for (const e of escalas) {
    const dia = diaDaEscala(e.data);
    const lista = mapa.get(dia);
    if (lista) lista.push(e);
    else mapa.set(dia, [e]);
  }
  const grupos: GrupoDoDia<T>[] = [...mapa.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([data, itens]) => ({
      data,
      quando: data === hoje ? 'hoje' : data > hoje ? 'proximo' : 'passado',
      itens: [...itens].sort((a, b) => (a.horaInicio < b.horaInicio ? -1 : a.horaInicio > b.horaInicio ? 1 : 0)),
    }));
  const peso = { hoje: 0, proximo: 1, passado: 2 } as const;
  // `sort` é estável: dentro do mesmo bloco a ordem do calendário fica.
  return grupos.sort((a, b) => peso[a.quando] - peso[b.quando]);
}

// ---------------------------------------------------------------------------
// Seletor de pessoa
// ---------------------------------------------------------------------------

const porNome = (a: AdvogadoEscala, b: AdvogadoEscala) =>
  nomeDeExibicao(a).localeCompare(nomeDeExibicao(b), 'pt-BR');

/**
 * "Advogados" primeiro, os demais sob "Outros da equipe".
 *
 * A lista da API é todo usuário ativo — Triagem, Coordenação, a conta do
 * Administrador. Na produção só advogado foi escalado até hoje, mas um
 * sindicato pode escalar estagiária ou secretária: por isso AGRUPA, não
 * esconde.
 *
 * Sem `role` em ninguém (API antiga, na janela do deploy), não há como separar:
 * todos vão num grupo só, e a tela desenha o seletor sem grupos.
 */
export function separarParaSeletor(pessoas: AdvogadoEscala[]): {
  advogados: AdvogadoEscala[];
  outros: AdvogadoEscala[];
  temPerfil: boolean;
} {
  const temPerfil = pessoas.some((p) => !!p.role);
  if (!temPerfil) return { advogados: [...pessoas].sort(porNome), outros: [], temPerfil };
  return {
    advogados: pessoas.filter((p) => p.role === 'ADVOGADO').sort(porNome),
    outros: pessoas.filter((p) => p.role !== 'ADVOGADO').sort(porNome),
    temPerfil,
  };
}

/**
 * O corpo do PATCH com SÓ o que mudou — ou `null` se nada mudou.
 *
 * Mandar o formulário inteiro faria "salvar sem mexer" parecer alteração e
 * gastaria a checagem de sobreposição à toa. Observação apagada vira `null`
 * (a API entende como "tirar a observação"); espaço em branco não é observação.
 */
export function planejarAlteracao(
  atual: Pick<Escala, 'horaInicio' | 'horaFim' | 'observacao' | 'advogado'> & { advogadoId?: string },
  form: { advogadoId: string; horaInicio: string; horaFim: string; observacao: string },
): AlteracaoDeEscala | null {
  const plano: AlteracaoDeEscala = {};
  const pessoaAtual = atual.advogadoId ?? atual.advogado.id;
  if (form.advogadoId && form.advogadoId !== pessoaAtual) plano.advogadoId = form.advogadoId;
  if (form.horaInicio !== atual.horaInicio) plano.horaInicio = form.horaInicio;
  if (form.horaFim !== atual.horaFim) plano.horaFim = form.horaFim;
  const obs = form.observacao.trim() || null;
  if (obs !== ((atual.observacao ?? '').trim() || null)) plano.observacao = obs;
  return Object.keys(plano).length ? plano : null;
}

// ---------------------------------------------------------------------------
// Cores por pessoa — ESTÁVEIS pelo id
// ---------------------------------------------------------------------------

export interface CorAdvogado {
  bg: string; // classe Tailwind (barra)
  dot: string; // classe Tailwind (ponto e legenda)
  hex: string; // para o PDF
}

/**
 * Sem âmbar e sem vermelho: na casa, âmbar é "ficou para trás" e vermelho é
 * erro. Uma pessoa pintada de âmbar no calendário pareceria um aviso.
 */
export const PALETA_ADVOGADOS: CorAdvogado[] = [
  { bg: 'bg-blue-500', dot: 'bg-blue-500', hex: '#3b82f6' },
  { bg: 'bg-purple-500', dot: 'bg-purple-500', hex: '#a855f7' },
  { bg: 'bg-green-600', dot: 'bg-green-600', hex: '#16a34a' },
  { bg: 'bg-orange-500', dot: 'bg-orange-500', hex: '#f97316' },
  { bg: 'bg-pink-500', dot: 'bg-pink-500', hex: '#ec4899' },
  { bg: 'bg-teal-500', dot: 'bg-teal-500', hex: '#14b8a6' },
  { bg: 'bg-indigo-500', dot: 'bg-indigo-500', hex: '#6366f1' },
  { bg: 'bg-cyan-600', dot: 'bg-cyan-600', hex: '#0891b2' },
  { bg: 'bg-lime-600', dot: 'bg-lime-600', hex: '#65a30d' },
  { bg: 'bg-fuchsia-600', dot: 'bg-fuchsia-600', hex: '#c026d3' },
];

/** FNV-1a de 32 bits: o mesmo texto dá sempre o mesmo número, em qualquer aparelho. */
function hashDoTexto(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Posição preferida da pessoa na paleta — só do id. */
export function indiceDaCor(id: string): number {
  return hashDoTexto(id) % PALETA_ADVOGADOS.length;
}

/** A cor de uma pessoa, só pelo id (fora de um conjunto conhecido). */
export function corDaPessoa(id: string): CorAdvogado {
  return PALETA_ADVOGADOS[indiceDaCor(id)];
}

/**
 * Mapa id → cor, ESTÁVEL.
 *
 * Era a ordem alfabética entre os escalados DO MÊS: o mesmo advogado mudava de
 * cor entre setembro e outubro, e ficava sempre azul ao filtrar.
 *
 * Agora cada pessoa parte da cor do próprio id. Dez cores para cinco pessoas
 * dão colisão com frequência, e duas pessoas da mesma cor no calendário não se
 * distinguem; por isso, quando a cor preferida já foi tomada, a pessoa anda
 * para a próxima livre. A ordem dessa disputa é a do ID (nunca a do nome nem a
 * do mês), e o conjunto deve ser a equipe inteira (`/escalas/advogados`), que
 * muda só quando alguém entra ou sai. Com mais pessoas que cores, a repetição é
 * inevitável e a pessoa fica com a preferida.
 */
export function montarCores(pessoas: { id: string }[]): Record<string, CorAdvogado> {
  const ids = [...new Set(pessoas.map((p) => p.id))].sort();
  const n = PALETA_ADVOGADOS.length;
  const tomadas = new Set<number>();
  const mapa: Record<string, CorAdvogado> = {};
  for (const id of ids) {
    const preferida = indiceDaCor(id);
    let escolhida = preferida;
    if (tomadas.size < n) {
      for (let passo = 0; passo < n; passo++) {
        const i = (preferida + passo) % n;
        if (!tomadas.has(i)) { escolhida = i; break; }
      }
    }
    tomadas.add(escolhida);
    mapa[id] = PALETA_ADVOGADOS[escolhida];
  }
  return mapa;
}

/**
 * As cores da TELA: a equipe inteira disputa a paleta; quem aparece na escala
 * sem estar na equipe (cadastro desativado depois do plantão) fica com a cor do
 * próprio id, SEM empurrar ninguém da equipe.
 *
 * Se o escalado inativo entrasse na disputa, a cor de um advogado ativo mudaria
 * só por navegar para um mês em que o antigo colega aparece — o defeito que a
 * cor estável veio consertar.
 */
export function montarCoresDaTela(
  equipe: { id: string }[],
  escalados: { id: string }[],
): Record<string, CorAdvogado> {
  const mapa = montarCores(equipe);
  for (const { id } of escalados) if (!mapa[id]) mapa[id] = corDaPessoa(id);
  return mapa;
}

// ---------------------------------------------------------------------------
// Popover do calendário
// ---------------------------------------------------------------------------

/**
 * Onde o cartão do plantão abre, dentro da janela.
 *
 * Abre embaixo da barra clicada; se não couber até o rodapé da janela, abre em
 * CIMA (e não some atrás da borda, como o `top: r.bottom` de antes fazia com os
 * plantões da última semana do mês). Na horizontal, fica a `margem` das bordas.
 */
export function posicaoDoPopover(
  alvo: { top: number; bottom: number; left: number },
  janela: { largura: number; altura: number },
  cartao: { largura: number; altura: number },
  margem = 8,
): { left: number; top?: number; bottom?: number } {
  const maxLeft = Math.max(margem, janela.largura - cartao.largura - margem);
  const left = Math.min(Math.max(alvo.left, margem), maxLeft);
  const cabeEmbaixo = alvo.bottom + 4 + cartao.altura + margem <= janela.altura;
  if (cabeEmbaixo || alvo.top - 4 - cartao.altura < margem) {
    return { left, top: Math.max(margem, Math.min(alvo.bottom + 4, janela.altura - cartao.altura - margem)) };
  }
  return { left, bottom: janela.altura - alvo.top + 4 };
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

/** "09:00–12:00" — com o traço de intervalo, nunca o hífen colado. */
export function faixaDoPlantao(p: { horaInicio: string; horaFim: string }): string {
  return `${p.horaInicio}–${p.horaFim}`;
}

/**
 * "Shérad 09:00–12:00".
 *
 * Era "Shérad -09:00": o hífen colado na hora parecia número negativo, e o fim
 * do plantão não aparecia.
 */
export function rotuloDoPlantao(e: { advogado: AdvogadoEscala; horaInicio: string; horaFim: string }): string {
  return `${primeiroNome(e.advogado)} ${faixaDoPlantao(e)}`;
}

/** "1 plantão", "3 plantões". */
export function contar(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "YYYY-MM" do mês de referência. */
export function chaveMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function rotuloMes(d: Date): string {
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Meses como texto "AAAA-MM" (sem Date: nunca anda de mês por fuso)
// ---------------------------------------------------------------------------

const NOMES_DOS_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "2026-10" → "outubro". */
export function nomeDoMes(mes: string): string {
  return NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1] ?? mes;
}

/** "2026-10" → "outubro de 2026". */
export function nomeDoMesComAno(mes: string): string {
  return `${nomeDoMes(mes)} de ${mes.slice(0, 4)}`;
}

/** "outubro" → "Outubro" — para começo de frase. */
export const comMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** O mês anterior ("2026-01" → "2025-12"). */
export function mesAnterior(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return m === 1 ? `${ano - 1}-12` : `${ano}-${String(m - 1).padStart(2, '0')}`;
}

const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * "seg, 05/10" — o cabeçalho do dia na prévia da cópia. Aritmética sobre o
 * texto: `formatDataPura` põe ponto ("seg., 05/10") e a lista fica com um
 * ponto em cada linha.
 */
export function rotuloCurtoDoDia(dia: string): string {
  const d = diaDaEscala(dia);
  return `${SEMANA_CURTA[diaDaSemana(d)]}, ${diaCurto(d)}`;
}

// ---------------------------------------------------------------------------
// COPIAR A ESCALA DE UM MÊS PARA OUTRO (D15, 14/09/2026)
// ---------------------------------------------------------------------------

/*
  Medido na produção em 13/09/2026: agosto teve 9 plantões e setembro 16, num
  padrão fixo por dia da semana (seg Margareth/Murilo, ter Tiago, qua Morgana,
  qui Shérad/Murilo), sempre 09:00–12:00. As 25 observações eram nulas.

  A REGRA MORA NO SERVIDOR (`planejarCopia`), que a usa para a prévia e para a
  gravação. O web só desenha o que veio: se recalculasse aqui, seria uma segunda
  implementação, e a pessoa desmarcaria um item que o servidor gravaria de outro
  jeito (lição "Prévia lê a mesma regra").
*/

export interface PessoaDaCopia {
  id: string;
  nome: string;
  nomeExibicao: string | null;
}

export interface ItemDaCopia {
  origemId: string;
  /** Dia do destino, "AAAA-MM-DD". */
  data: string;
  origemData: string;
  advogado: PessoaDaCopia;
  horaInicio: string;
  horaFim: string;
  /** O servidor decide o padrão: dia já coberto por outra pessoa vem desmarcado. */
  marcado: boolean;
  nota: null | { tipo: 'QUINTA_REPETIDA' | 'DIFERENTE_DO_RESTO' | 'DIA_JA_COBERTO'; texto: string };
}

export interface ItemForaDaCopia {
  origemId: string;
  origemData: string;
  advogado: PessoaDaCopia;
  horaInicio: string;
  horaFim: string;
  motivo: 'SEM_OCORRENCIA' | 'JA_ESTA_DE_PLANTAO' | 'DIA_PASSOU' | 'PESSOA_INATIVA';
  texto: string;
}

export interface PreviaDaCopia {
  origem: string;
  destino: string;
  mesesComPlantao: { mes: string; plantoes: number }[];
  existentesNoDestino: number;
  criar: ItemDaCopia[];
  fora: ItemForaDaCopia[];
}

export async function preverCopia(origem: string, destino: string): Promise<PreviaDaCopia> {
  return (await api.get('/escalas/copia', { params: { origem, destino } })).data;
}

export async function copiarEscala(dados: {
  origem: string;
  destino: string;
  itens: { origemId: string; data: string }[];
}) {
  return (await api.post('/escalas/copia', dados)).data as { ok: boolean; criadas: number; ids: string[] };
}

/** Espelho do `ArrayMaxSize(250)` do POST — trava de segurança, não regra de negócio. */
export const MAXIMO_DA_COPIA = 250;

/** Um item da cópia é o par (plantão de origem, dia do destino): a 5ª ocorrência repete a origem. */
export const chaveDaCopia = (i: { origemId: string; data: string }) => `${i.origemId}|${i.data}`;

/**
 * A origem que a folha propõe: o mês com plantões MAIS RECENTE antes do
 * destino — não "o anterior". Janeiro de recesso não é modelo para fevereiro.
 * Sem nenhum antes, o mais recente depois; sem nenhum, `null`.
 */
export function origemPadraoDaCopia(meses: { mes: string; plantoes: number }[], destino: string): string | null {
  const comPlantao = meses.filter((m) => m.plantoes > 0 && m.mes !== destino).map((m) => m.mes).sort();
  const antes = comPlantao.filter((m) => m < destino);
  if (antes.length) return antes[antes.length - 1];
  return comPlantao.length ? comPlantao[comPlantao.length - 1] : null;
}

/** Copiar só para o mês de Teresina em diante — é o 400 da API, antecipado. */
export function podeCopiarPara(destino: string, agora: Date = new Date()): boolean {
  return destino >= hojeBR(agora).slice(0, 7);
}

/**
 * O que vai no POST: os itens com a escolha da pessoa por cima do padrão do
 * servidor. A escolha fica guardada pela chave, então uma prévia recarregada
 * (o 409) mantém o que a pessoa desmarcou nos itens que continuam lá.
 */
export function itensEscolhidosDaCopia(
  criar: ItemDaCopia[],
  escolhas: Record<string, boolean>,
): { origemId: string; data: string }[] {
  return criar
    .filter((i) => escolhas[chaveDaCopia(i)] ?? i.marcado)
    .map((i) => ({ origemId: i.origemId, data: i.data }));
}

/** A lista da prévia agrupada por dia do destino, na ordem do calendário e, no dia, do horário. */
export function agruparCopiaPorDia(criar: ItemDaCopia[]): { data: string; itens: ItemDaCopia[] }[] {
  const mapa = new Map<string, ItemDaCopia[]>();
  for (const i of criar) {
    const lista = mapa.get(i.data);
    if (lista) lista.push(i);
    else mapa.set(i.data, [i]);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([data, itens]) => ({
      data,
      itens: [...itens].sort((a, b) => (a.horaInicio < b.horaInicio ? -1 : a.horaInicio > b.horaInicio ? 1 : 0)),
    }));
}

/** "22 plantões vão ser criados em outubro." */
export function resumoDaCopia(n: number, destino: string): string {
  const mes = nomeDoMes(destino);
  if (n === 0) return `Nenhum plantão vai ser criado em ${mes}.`;
  return n === 1 ? `1 plantão vai ser criado em ${mes}.` : `${n} plantões vão ser criados em ${mes}.`;
}

/** "Criar 22 plantões" / "Criar 1 plantão". */
export const rotuloDoBotaoDaCopia = (n: number) => `Criar ${contar(n, 'plantão', 'plantões')}`;

/** "Outubro já tem 6 plantões. Os que batem com a cópia ficaram de fora." */
export function avisoDoDestinoPreenchido(existentes: number, destino: string): string | null {
  if (existentes <= 0) return null;
  return `${comMaiuscula(nomeDoMes(destino))} já tem ${contar(existentes, 'plantão', 'plantões')}. ` +
    'Os que batem com a cópia ficaram de fora.';
}

/** A resposta foi um 409 (a escala mudou entre a prévia e o POST)? */
export function ehConflito(e: unknown): boolean {
  return (e as { response?: { status?: number } })?.response?.status === 409;
}

// ---------------------------------------------------------------------------
// TROCA DE PLANTONISTA E AS CONSULTAS MARCADAS (D16/D17, 14/09/2026)
// ---------------------------------------------------------------------------

/*
  Não existe ligação entre a consulta e o plantão: a consulta "do plantão" é
  INFERIDA pelo servidor (pessoa + dia + janela). Por isso é prévia com decisão
  de gente — passar sozinho seria chutar, e desfazer a escolha da triagem. A
  regra de quais consultas entram e quais são selecionáveis é do servidor
  (`consultasDoPlantao`); aqui só a escolha padrão e as frases.
*/

export interface ConsultaDoPlantao {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  status: 'PENDENTE' | 'EM_ANDAMENTO';
  papel: 'RESPONSAVEL' | 'PARTICIPANTE';
  selecionavel: boolean;
  porQueNao: string | null;
  local: string | null;
  temLink: boolean;
  atendimento: null | { id: string; numero: number | string };
  filiado: null | { id: string; nomeCompleto: string; celularWhatsApp: string | null };
  choques: { id: string; titulo: string; inicio: string; fim: string }[];
  /**
   * Quem é o principal quando quem sai só participa. Fora do contrato de
   * 14/09/2026 (pedido à api-escalas): sem ele, a linha diz só que participa.
   */
  responsavel?: { nome: string; nomeExibicao?: string | null } | null;
}

export interface ConsultasDoPlantao {
  escalaId: string;
  dia: string;
  horaInicio: string;
  horaFim: string;
  passado: boolean;
  sai: PessoaDaCopia;
  entra: null | (PessoaDaCopia & { veAgenda: boolean });
  sobreposicao: string | null;
  podePassar: boolean;
  porQueNaoPassa: string | null;
  total: number;
  noHorario: ConsultaDoPlantao[];
  foraDoHorario: ConsultaDoPlantao[];
}

export interface ResultadoDasConsultas {
  passadas: {
    id: string;
    inicio: string;
    filiado: null | { id: string; nomeCompleto: string; celularWhatsApp: string | null };
    /**
     * O lugar de quem saiu na consulta, e se quem entrou já era o responsável
     * (14/09/2026). Opcionais: o contêiner antigo não manda, e aí vale o de
     * antes (a consulta mudou de quem atende).
     */
    papel?: 'RESPONSAVEL' | 'PARTICIPANTE';
    jaEraResponsavel?: boolean;
  }[];
  mantidas: string[];
  ignoradas: { id: string; motivo: string }[];
}

/** A escala como o PATCH devolve; `consultas` só vem quando `passarConsultas` foi enviado. */
export type EscalaAtualizada = Escala & { consultas?: ResultadoDasConsultas };

/** `entra` ausente: só a contagem e a lista (excluir, encurtar o horário). */
export async function listarConsultasDoPlantao(escalaId: string, entra?: string): Promise<ConsultasDoPlantao> {
  return (await api.get(`/escalas/${escalaId}/consultas`, { params: entra ? { entra } : {} })).data;
}

/** "a Dra. Shérad", "o Dr. Murilo", "Maria" — sem chutar gênero de nome (a regra do `comQuem`). */
export function comArtigo(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return `a ${n}`;
  if (/^dr\.?\s/i.test(n)) return `o ${n}`;
  return n;
}

/** "da Dra. Shérad", "do Dr. Murilo", "de Maria". */
export function daPessoa(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return `da ${n}`;
  if (/^dr\.?\s/i.test(n)) return `do ${n}`;
  return `de ${n}`;
}

/** "dela", "dele" ou "de Maria". */
export function delaOuDele(nome: string): string {
  const n = nome.trim();
  if (/^dra\.?\s/i.test(n)) return 'dela';
  if (/^dr\.?\s/i.test(n)) return 'dele';
  return `de ${n}`;
}

const quem = (p: { nome: string; nomeExibicao?: string | null }) => (p.nomeExibicao || p.nome).trim();

/**
 * A escolha padrão: no horário do plantão, marcada (passa); fora do horário,
 * desmarcada (fica). O que não é selecionável nunca entra — em consulta agora,
 * plantão que já passou.
 */
export function marcadaPorPadrao(c: ConsultaDoPlantao, noHorario: boolean): boolean {
  return c.selecionavel && noHorario;
}

/** As consultas que a pessoa pode decidir, com a escolha dela por cima do padrão. */
export function consultasEscolhidas(d: ConsultasDoPlantao, escolhas: Record<string, boolean>): string[] {
  const ids: string[] = [];
  for (const c of d.noHorario) if (c.selecionavel && (escolhas[c.id] ?? marcadaPorPadrao(c, true))) ids.push(c.id);
  for (const c of d.foraDoHorario) if (c.selecionavel && (escolhas[c.id] ?? marcadaPorPadrao(c, false))) ids.push(c.id);
  return ids;
}

/**
 * O `passarConsultas` do PATCH — ou `undefined`, que é "não mexa nas consultas".
 *
 * Vai só quando a prévia carregou, a API disse que dá para passar e a pessoa
 * edita a Agenda: mandar o campo para a API antiga dá 400 (forbidNonWhitelisted)
 * e, com erro na prévia, ninguém viu o que estaria decidindo. Com consultas
 * selecionáveis e todas desmarcadas vai `[]`: é a decisão de manter, carimbada.
 * Sem nada selecionável não há decisão a carimbar.
 */
export function planejarPassagem(
  d: ConsultasDoPlantao | undefined,
  escolhas: Record<string, boolean>,
  editaAgenda: boolean,
): string[] | undefined {
  if (!d || !d.podePassar || !editaAgenda || d.passado) return undefined;
  const selecionaveis = [...d.noHorario, ...d.foraDoHorario].some((c) => c.selecionavel);
  if (!selecionaveis) return undefined;
  return consultasEscolhidas(d, escolhas);
}

/** "3 consultas marcadas com a Dra. Shérad neste plantão." */
export function cabecalhoDasConsultas(n: number, sai: string): string {
  if (n === 0) return `Nenhuma consulta marcada com ${comArtigo(sai)} neste plantão.`;
  return `${contar(n, 'consulta marcada', 'consultas marcadas')} com ${comArtigo(sai)} neste plantão.`;
}

/** "O Dr. Murilo fica com o plantão e com 2 consultas." */
export function resumoDaTroca(entra: string, n: number): string {
  const base = `${comMaiuscula(comArtigo(entra))} fica com o plantão`;
  return n === 0 ? `${base}.` : `${base} e com ${contar(n, 'consulta', 'consultas')}.`;
}

/** "Mais 1 consulta dela neste dia, fora do horário do plantão". */
export function rotuloDasForaDoHorario(n: number, sai: string): string {
  return `Mais ${contar(n, 'consulta', 'consultas')} ${delaOuDele(sai)} neste dia, fora do horário do plantão`;
}

/** "Atendimento #412 · por vídeo" / "Criada na agenda · por telefone". */
export function apoioDaConsulta(c: Pick<ConsultaDoPlantao, 'atendimento' | 'local'>): string {
  const origem = c.atendimento ? `Atendimento #${c.atendimento.numero}` : 'Criada na agenda';
  const modo = modalidadeDoLocal(c.local);
  const complemento = modo === 'VIDEO' ? 'por vídeo' : modo === 'TELEFONE' ? 'por telefone' : 'na sede';
  return `${origem} · ${complemento}`;
}

/** "O Dr. Murilo já tem Audiência — Processo 0801… das 09:30 às 10:30." (avisa, não bloqueia) */
export function fraseDoChoque(entra: string, choque: { titulo: string; inicio: string; fim: string }): string {
  return `${comMaiuscula(comArtigo(entra))} já tem ${choque.titulo} das ${horaBR(new Date(choque.inicio))} às ${horaBR(new Date(choque.fim))}.`;
}

/**
 * EXCLUIR O PLANTÃO NÃO MEXE NAS CONSULTAS (D17) — só avisa.
 *
 * Sem a lista (quem lê não tem Agenda), a API manda só `total`, e a contagem é
 * essa. `null` quando não há o que avisar.
 */
export function avisoDeExclusao(d: Pick<ConsultasDoPlantao, 'noHorario' | 'foraDoHorario' | 'total' | 'sai'>): string | null {
  const semLista = d.noHorario.length === 0 && d.foraDoHorario.length === 0;
  const n = semLista ? d.total : d.noHorario.length;
  if (n <= 0) return null;
  const sai = quem(d.sai);
  const dona = delaOuDele(sai);
  return n === 1
    ? `Há 1 consulta marcada com ${comArtigo(sai)} neste plantão. Ela continua na agenda ${dona}. Se outra pessoa vai atender, use Trocar com…`
    : `Há ${n} consultas marcadas com ${comArtigo(sai)} neste plantão. Elas continuam na agenda ${dona}. Se outra pessoa vai atender, use Trocar com…`;
}

/**
 * ENCURTAR O HORÁRIO (D17): as consultas do plantão que ficam fora da nova
 * faixa, pela hora de Teresina. A faixa é [início, fim): às 12:00 de um plantão
 * até 12:00 já está fora — a mesma janela que o servidor usa para "no horário".
 */
export function consultasForaDoNovoHorario<T extends { inicio: string }>(
  consultas: T[],
  faixa: { horaInicio: string; horaFim: string },
): T[] {
  return consultas.filter((c) => {
    const h = horaBR(new Date(c.inicio));
    return h < faixa.horaInicio || h >= faixa.horaFim;
  });
}

/** "1 consulta às 11:00 fica fora do novo horário." / "2 consultas (09:00 e 11:00) ficam fora do novo horário." */
export function avisoDoNovoHorario(consultas: { inicio: string }[]): string | null {
  if (consultas.length === 0) return null;
  const horas = consultas.map((c) => horaBR(new Date(c.inicio))).sort();
  if (horas.length === 1) return `1 consulta às ${horas[0]} fica fora do novo horário.`;
  const lista = `${horas.slice(0, -1).join(', ')} e ${horas[horas.length - 1]}`;
  return `${horas.length} consultas (${lista}) ficam fora do novo horário.`;
}

/** "O Dr. Murilo assumiu o plantão de 15/09 e 2 consultas. Elas já estão na agenda e no painel dele. …" */
export function textoDoPlantaoPassado(entra: string, dia: string, n: number): string {
  const dono = delaOuDele(entra);
  const consultas = n === 1
    ? `1 consulta. Ela já está na agenda e no painel ${dono}.`
    : `${n} consultas. Elas já estão na agenda e no painel ${dono}.`;
  return `${comMaiuscula(comArtigo(entra))} assumiu o plantão de ${diaCurto(dia)} e ${consultas} Ninguém recebe aviso fora do sistema.`;
}

/** "1 consulta não mudou: já tinha sido concluída." — agrupado pelo motivo que o servidor mandou. */
export function frasesDasIgnoradas(ignoradas: { id: string; motivo: string }[]): string[] {
  const porMotivo = new Map<string, number>();
  for (const i of ignoradas) {
    const motivo = (i.motivo || 'deixou de estar no plantão').trim().replace(/\.$/, '');
    const texto = motivo.charAt(0).toLowerCase() + motivo.slice(1);
    porMotivo.set(texto, (porMotivo.get(texto) ?? 0) + 1);
  }
  return [...porMotivo.entries()].map(([motivo, n]) =>
    n === 1 ? `1 consulta não mudou: ${motivo}.` : `${n} consultas não mudaram: ${motivo}.`,
  );
}

/**
 * A mensagem ao filiado quando a consulta muda de advogado. SEM o link da
 * chamada: o link foi criado por quem saiu e pode ser da sala dela. Sem emoji.
 * O número vem normalizado por `celularParaWhatsApp` antes de montar o wa.me.
 */
export function mensagemDaTrocaDeAdvogado(p: {
  nomeFiliado: string;
  entra: { nome: string; nomeExibicao?: string | null };
  inicio: string;
}): string {
  const agora = new Date(p.inicio);
  const dia = hojeBR(agora);
  const primeiro = p.nomeFiliado.trim().split(/\s+/)[0] || p.nomeFiliado.trim();
  return [
    `Olá, ${primeiro}. Aqui é do ${tenant.sigla}.`,
    '',
    `Sua consulta jurídica de ${SEMANA_LONGA[diaDaSemana(dia)]}, ${diaCurto(dia)}, às ${horaBR(agora)} continua marcada. ` +
      `Quem vai atender agora é ${comArtigo(quem(p.entra))}.`,
    '',
    'Se precisar remarcar, é só responder esta mensagem.',
  ].join('\n');
}

/**
 * O QUE O PASSO FINAL OFERECE PARA CADA CONSULTA PASSADA.
 *
 * A mensagem ao filiado diz "Quem vai atender agora é…", e isso só é verdade
 * quando quem saiu ERA quem atendia. Quem saiu só atuando junto deixa o
 * responsável onde está (a Dra. Ana continua atendendo quando a Dra. Shérad
 * passa o plantão ao Dr. Murilo), e a mensagem pronta mentiria ao filiado
 * (revisão de 14/09/2026). Nesses casos, uma linha para quem está na tela e
 * nenhuma mensagem. Sem `papel` (API antiga) fica o botão, como antes.
 */
export function avisoDaConsultaPassada(
  p: Pick<ResultadoDasConsultas['passadas'][number], 'papel' | 'jaEraResponsavel'>,
  entra: string,
  responsavel?: { nome: string; nomeExibicao?: string | null } | null,
): { tipo: 'WHATSAPP' } | { tipo: 'INFORMATIVO'; texto: string } {
  const quemEntra = comMaiuscula(comArtigo(entra));
  if (p.jaEraResponsavel) {
    return { tipo: 'INFORMATIVO', texto: `${quemEntra} já era quem atende esta consulta. Para o ${tenant.vocabulario.filiado}, nada muda.` };
  }
  if (p.papel !== 'PARTICIPANTE') return { tipo: 'WHATSAPP' };
  const principal = responsavel ? quem(responsavel) : '';
  return {
    tipo: 'INFORMATIVO',
    texto: principal
      ? `${quemEntra} passa a atuar junto; quem atende continua sendo ${comArtigo(principal)}.`
      : `${quemEntra} passa a atuar junto; quem atende não muda.`,
  };
}

/**
 * A SOBREPOSIÇÃO DA PRÉVIA SÓ VALE PARA A FAIXA GRAVADA.
 *
 * A GET da prévia confere o choque com o horário que está no banco; o PATCH,
 * com o horário do formulário. Na edição que troca a pessoa e o horário juntos,
 * usar a da prévia travava o botão por um choque que a faixa nova não tem
 * (revisão de 14/09/2026). Com a faixa mudada, quem decide é o PATCH, e a
 * recusa dele aparece no erro do envio.
 */
export function sobreposicaoQueVale(
  previa: Pick<ConsultasDoPlantao, 'sobreposicao'> | undefined,
  gravada: { horaInicio: string; horaFim: string },
  formulario: { horaInicio: string; horaFim: string },
): string | null {
  if (!previa?.sobreposicao) return null;
  const mesmaFaixa = formulario.horaInicio === gravada.horaInicio && formulario.horaFim === gravada.horaFim;
  return mesmaFaixa ? previa.sobreposicao : null;
}

/** O número para o wa.me de uma consulta passada, ou `null` ("Sem celular no cadastro."). */
export function celularDaConsultaPassada(filiado: { celularWhatsApp: string | null } | null): string | null {
  return filiado?.celularWhatsApp ? celularParaWhatsApp(filiado.celularWhatsApp) : null;
}
