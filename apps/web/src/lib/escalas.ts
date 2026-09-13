import { api } from './api';

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
export async function atualizarEscala(id: string, dados: AlteracaoDeEscala): Promise<Escala> {
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
