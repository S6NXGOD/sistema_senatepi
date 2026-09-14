import { api } from './api';
import { baixarArquivo } from './pdf';

/**
 * USO E PRODUTIVIDADE — quem usa o sistema e o que cada pessoa registrou nele.
 *
 * Pedido de 12/09/2026: "monitorar a produtividade de cada usuário no sistema,
 * por perfil". A API (`produtividade.service.ts`) decide três coisas, e a tela
 * não desfaz nenhuma:
 *
 *  · só entra TRABALHO REGISTRADO, contado pela fonte certa — clique não conta;
 *  · NÃO EXISTE POSIÇÃO: por perfil, depois por nome. O que pede atenção ganha
 *    cor no lugar em que está, e não um lugar no topo;
 *  · só a gestão vê todo mundo; os demais veem a própria linha.
 */

export interface LinhaDeUso {
  usuarioId: string;
  nome: string;
  perfil: string;
  /**
   * URL assinada, só para a TELA. Não existe `avatarKey` aqui: o interceptor
   * global da API apaga a chave da resposta, e o tipo que a declarava levava a
   * concluir que ninguém tinha foto. A foto do PDF vem de `carregarRostos`.
   */
  avatarUrl: string | null;
  /** Último uso real: login, sessão renovada ou ação gravada. */
  ultimoAcesso: string | null;
  diasComUso: number;
  /** AAAA-MM-DD, em Teresina. */
  diasAtivos: string[];
  agenda: {
    concluidas: number;
    /** No dia marcado ou antes — nunca "no prazo": o prazo processual o sistema não conhece. */
    noDiaMarcado: number;
    criadas: number;
    abertas: number;
    atrasadas: number;
    /**
     * As concluídas por TIPO de atividade (14/09/2026): só tipos com
     * concluídas, do mais concluído ao menos, depois pelo nome. É ordem de
     * coisa, e não de gente. Opcional pela janela de troca do deploy.
     */
    porTipo?: TipoConcluido[];
  };
  publicacoes: { decididas: number; esperando: number };
  processos: { cadastrados: number; andamentos: number; documentos: number };
  filiados: { cadastrados: number; fichasAtualizadas: number };
  atendimentos: number;
  /** Mês a mês, para o PDF de um ano. Opcional pela janela de troca do deploy. */
  porMes?: MesDeUso[];
  /**
   * Semana a semana (14/09/2026), uma entrada por segunda-feira de
   * `Produtividade.semanas`, parada com zeros. A API soma; o web NUNCA
   * reagrupa dias em semanas. Opcional pela janela de troca do deploy.
   */
  porSemana?: SemanaDeUso[];
  /**
   * Quando a conta foi criada (ISO). Só decide "Sem comparação: a conta foi
   * criada em …": o "antes 0" de quem não tinha conta não é queda nem
   * crescimento. Opcional pela janela de troca do deploy.
   */
  contaCriadaEm?: string;
}

export interface MesDeUso {
  /** AAAA-MM, em Teresina. */
  mes: string;
  diasComUso: number;
  concluidas: number;
  andamentos: number;
  atendimentos: number;
  /** Os quatro abaixo vieram em 14/09/2026, para o mês a mês empilhado; opcionais pela janela de troca. */
  noDiaMarcado?: number;
  processosCadastrados?: number;
  documentos?: number;
  filiadosCadastrados?: number;
}

export interface SemanaDeUso {
  /** A segunda-feira da semana, AAAA-MM-DD, em Teresina. */
  semana: string;
  /** Quantos dias desta semana caem dentro do período (as pontas podem ter menos de 7). */
  diasNoPeriodo: number;
  diasComUso: number;
  concluidas: number;
  noDiaMarcado: number;
  andamentos: number;
  atendimentos: number;
  processosCadastrados: number;
  documentos: number;
  filiadosCadastrados: number;
}

export interface TipoConcluido {
  /** O slug de `tipos_evento`. */
  tipo: string;
  /** O nome atual do tipo; slug sem cadastro chega como "Outro tipo". */
  nome: string;
  concluidas: number;
  noDiaMarcado: number;
}

export interface ResumoDoPerfil {
  perfil: string;
  pessoas: number;
  usaram: number;
  semAcessoRecente: number;
  nuncaEntraram: number;
}

export interface Produtividade {
  periodo: { de: string; ate: string };
  escopo: 'GLOBAL' | 'PESSOAL';
  dias: string[];
  /** Os meses do período (AAAA-MM). Opcional pela janela de troca do deploy. */
  meses?: string[];
  /** As segundas-feiras (AAAA-MM-DD) das semanas que o período toca, em ordem. Opcional pela janela de troca. */
  semanas?: string[];
  perfis: ResumoDoPerfil[];
  pessoas: LinhaDeUso[];
  geradoEm: string;
}

export async function carregarProdutividade(de: string, ate: string): Promise<Produtividade> {
  return (await api.get<Produtividade>('/relatorios/produtividade', { params: { de, ate } })).data;
}

/** A rota das fotos pode estar lenta (storage): passou disso, o PDF sai com as iniciais. */
export const TEMPO_DOS_ROSTOS_MS = 8_000;
const PREFIXO_DO_ROSTO = 'data:image/jpeg;base64,';
/** Uma miniatura de 160 px tem uns 11 mil caracteres; o teto só barra lixo. */
const MAIOR_ROSTO = 200_000;

/**
 * O QUE SE ACEITA DA ROTA DE ROSTOS — só JPEG em data URL, por id.
 *
 * Qualquer outra coisa (URL externa, PNG, campo trocado, resposta antiga) é
 * descartada em silêncio: a pessoa sai com as iniciais, e o jsPDF nunca recebe
 * algo que não sabe abrir.
 */
export function rostosValidos(resposta: unknown): Record<string, string> {
  const rostos = (resposta as { rostos?: unknown } | null | undefined)?.rostos;
  if (!rostos || typeof rostos !== 'object' || Array.isArray(rostos)) return {};
  return Object.fromEntries(
    Object.entries(rostos as Record<string, unknown>).filter(
      (par): par is [string, string] =>
        !!par[0] &&
        typeof par[1] === 'string' &&
        par[1].startsWith(PREFIXO_DO_ROSTO) &&
        par[1].length > PREFIXO_DO_ROSTO.length &&
        par[1].length <= MAIOR_ROSTO,
    ),
  );
}

/**
 * AS FOTOS DO PERFIL PARA O PDF — miniaturas JPEG de 160 px, prontas na API
 * (`GET /relatorios/produtividade/rostos`), com o mesmo alcance da aba: a
 * gestão recebe as contas ativas; os demais, só o próprio rosto.
 *
 * Nunca lança. Rota fora do ar, lenta ou ainda não publicada (janela de troca
 * do deploy) devolve {}: o PDF sai com as iniciais e não falha por causa de foto.
 */
export async function carregarRostos(): Promise<Record<string, string>> {
  try {
    const { data } = await api.get<unknown>('/relatorios/produtividade/rostos', {
      timeout: TEMPO_DOS_ROSTOS_MS,
    });
    return rostosValidos(data);
  } catch {
    return {};
  }
}

export async function baixarCsvDaProdutividade(de: string, ate: string): Promise<void> {
  await baixarArquivo(
    `/relatorios/produtividade.csv?de=${de}&ate=${ate}`,
    `uso-do-sistema-${de}-a-${ate}.csv`,
  );
}

/** O nome do grupo — no plural, porque é um grupo de pessoas. */
export const GRUPO_DO_PERFIL: Record<string, string> = {
  ADVOGADO: 'Advogados',
  COORDENACAO: 'Coordenação',
  TRIAGEM: 'Triagem e atendimento',
  ADMINISTRADOR: 'Administração',
};

/** O mesmo corte da API: é o que faz o número do resumo bater com a cor dos cartões. */
export const DIAS_PARA_NOTAR_AUSENCIA = 7;

const DIA_MS = 86_400_000;

/** Dias inteiros desde o último acesso, na conta da API; nulo para quem nunca entrou. */
export function diasSemAcesso(ultimoAcesso: string | null, agora: Date): number | null {
  if (!ultimoAcesso) return null;
  return Math.floor((agora.getTime() - new Date(ultimoAcesso).getTime()) / DIA_MS);
}

/** Nunca entrou, ou está há uma semana ou mais sem entrar. */
export function ausente(ultimoAcesso: string | null, agora: Date): boolean {
  const dias = diasSemAcesso(ultimoAcesso, agora);
  return dias === null || dias >= DIAS_PARA_NOTAR_AUSENCIA;
}

const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * O que vem depois de "Último acesso": "hoje às 14:32", "ontem", "há 5 dias",
 * "há 3 semanas", "em 04/07/2026".
 *
 * Hoje e ontem são do CALENDÁRIO, e não de 24 horas: quem entrou às 23h de
 * ontem "entrou ontem", mesmo que tenha sido há 10 horas.
 */
export function textoDoUltimoAcesso(ultimoAcesso: string, agora: Date): string {
  const quando = new Date(ultimoAcesso);
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(quando)) / DIA_MS);
  if (dias <= 0) {
    return `hoje às ${quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (dias === 1) return 'ontem';
  if (dias < 14) return `há ${dias} dias`;
  if (dias < 60) return `há ${Math.floor(dias / 7)} semanas`;
  return `em ${quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

export interface MarcaDoDia {
  dia: string;
  usou: boolean;
  fimDeSemana: boolean;
}

export interface MarcaDaSemana {
  inicio: string;
  diasComUso: number;
  diasNoTrecho: number;
}

/**
 * Até dois meses, um quadradinho por dia; acima disso, um por semana — senão
 * "este ano" desenharia 250 quadradinhos num cartão de celular.
 */
export const LIMITE_DA_FAIXA_DIARIA = 62;

export type FaixaDeUso =
  | { tipo: 'DIA'; marcas: MarcaDoDia[] }
  | { tipo: 'SEMANA'; marcas: MarcaDaSemana[] };

/** O dia da semana pela data pura, sem passar por fuso nenhum. */
function ehFimDeSemana(dia: string): boolean {
  const [a, m, d] = dia.split('-').map(Number);
  const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return semana === 0 || semana === 6;
}

/** "2026-09-12" vira "12/09" — as pontas da faixa dos dias. */
export const diaEMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** "2026-08-20" vira "20/08/2026". */
export const diaMesEAno = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

/** Sábado ou domingo, pela data pura. */
export const caiNoFimDeSemana = (dia: string) => ehFimDeSemana(dia);

/**
 * A SEGUNDA-FEIRA DA SEMANA DO DIA, em data pura (Date.UTC), a mesma conta do
 * `semanaBR` da API. Serve para POSICIONAR o dia na grade — as contagens por
 * semana vêm prontas da API. Com `getDay()` local o domingo viraria segunda
 * em algum fuso.
 */
export function segundaFeiraDe(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  data.setUTCDate(data.getUTCDate() - ((data.getUTCDay() + 6) % 7));
  return data.toISOString().slice(0, 10);
}

/** As segundas-feiras das semanas que os dias tocam, em ordem — só quando a API ainda não manda `semanas`. */
export function semanasDosDias(dias: string[]): string[] {
  return [...new Set(dias.map(segundaFeiraDe))].sort();
}

/** O dia (AAAA-MM-DD) de um instante, no calendário de Teresina. */
export function diaEmTeresina(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
}

/** "13/09/2026, 16:37" — a hora em que a API somou, no relógio de Teresina. */
export function dataEHoraEmTeresina(iso: string): string {
  const quando = new Date(iso);
  const data = quando.toLocaleDateString('pt-BR', {
    timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const hora = quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza', hour: '2-digit', minute: '2-digit' });
  return `${data}, ${hora}`;
}

/** Quantos dias do período caem de segunda a sexta. */
export function diasDeSemana(dias: string[]): number {
  return dias.filter((dia) => !ehFimDeSemana(dia)).length;
}

/**
 * "20 DIAS COM USO · O PERÍODO TEM 44 DIAS DE SEMANA" — no lugar de "20 de 62".
 *
 * Com sábado e domingo no denominador, quem usou o sistema em todos os dias
 * úteis parecia ter usado um terço do tempo. Não vira fração ("20 de 44"): quem
 * usou num sábado passaria de 100%. Mesma frase na aba e no PDF.
 */
export function textoDosDiasComUso(diasComUso: number, dias: string[]): string {
  const usou = `${diasComUso} ${diasComUso === 1 ? 'dia' : 'dias'} com uso`;
  if (!dias.length) return usou;
  const uteis = diasDeSemana(dias);
  if (!uteis) return `${usou} · o período só tem fim de semana`;
  return `${usou} · o período tem ${uteis} ${uteis === 1 ? 'dia de semana' : 'dias de semana'}`;
}

export function faixaDeUso(dias: string[], diasAtivos: string[]): FaixaDeUso {
  const ativos = new Set(diasAtivos);
  if (dias.length <= LIMITE_DA_FAIXA_DIARIA) {
    return {
      tipo: 'DIA',
      marcas: dias.map((dia) => ({ dia, usou: ativos.has(dia), fimDeSemana: ehFimDeSemana(dia) })),
    };
  }
  const marcas: MarcaDaSemana[] = [];
  for (let i = 0; i < dias.length; i += 7) {
    const trecho = dias.slice(i, i + 7);
    marcas.push({
      inicio: trecho[0],
      diasComUso: trecho.filter((d) => ativos.has(d)).length,
      diasNoTrecho: trecho.length,
    });
  }
  return { tipo: 'SEMANA', marcas };
}

export type Bloco = 'agenda' | 'publicacoes' | 'processos' | 'filiados' | 'atendimentos';

const TODOS_OS_BLOCOS: Bloco[] = ['agenda', 'publicacoes', 'processos', 'filiados', 'atendimentos'];

/** O nome de cada bloco — no cartão da aba e no PDF, o mesmo. */
export const TITULO_DO_BLOCO: Record<Bloco, string> = {
  agenda: 'Agenda',
  publicacoes: 'Publicações',
  processos: 'Processos',
  filiados: 'Filiados',
  atendimentos: 'Atendimento',
};

/** O que cada perfil faz no sistema, na ordem em que o cartão mostra. */
export const BLOCOS_DO_PERFIL: Record<string, Bloco[]> = {
  ADVOGADO: ['agenda', 'publicacoes', 'processos'],
  COORDENACAO: ['agenda', 'processos', 'atendimentos'],
  TRIAGEM: ['atendimentos', 'filiados', 'agenda'],
  ADMINISTRADOR: ['filiados', 'processos', 'agenda'],
};

export function temRegistro(l: LinhaDeUso, bloco: Bloco): boolean {
  switch (bloco) {
    case 'agenda':
      return l.agenda.concluidas + l.agenda.criadas + l.agenda.abertas + l.agenda.atrasadas > 0;
    case 'publicacoes':
      return l.publicacoes.decididas + l.publicacoes.esperando > 0;
    case 'processos':
      return l.processos.cadastrados + l.processos.andamentos + l.processos.documentos > 0;
    case 'filiados':
      return l.filiados.cadastrados + l.filiados.fichasAtualizadas > 0;
    case 'atendimentos':
      return l.atendimentos > 0;
  }
}

/**
 * Os blocos do perfil e, depois deles, qualquer outro que tenha registro.
 *
 * O perfil decide a ORDEM, não o que se esconde: a advogada que também atende
 * não pode ter os atendimentos sumidos só porque atender "não é do perfil".
 * E o bloco do perfil aparece mesmo zerado — zero, ali, é informação.
 */
export function blocosDaPessoa(l: LinhaDeUso): Bloco[] {
  const doPerfil = BLOCOS_DO_PERFIL[l.perfil] ?? ['agenda', 'processos'];
  const extras = TODOS_OS_BLOCOS.filter((b) => !doPerfil.includes(b) && temRegistro(l, b));
  return [...doPerfil, ...extras];
}

/** Agrupa por perfil mantendo a ordem em que a API mandou — perfil, depois nome. */
export function gruposPorPerfil(pessoas: LinhaDeUso[]): { perfil: string; pessoas: LinhaDeUso[] }[] {
  const grupos = new Map<string, LinhaDeUso[]>();
  for (const p of pessoas) grupos.set(p.perfil, [...(grupos.get(p.perfil) ?? []), p]);
  return [...grupos].map(([perfil, doPerfil]) => ({ perfil, pessoas: doPerfil }));
}

/**
 * "VER O QUE FEZ" — a auditoria já filtrada pela pessoa e pelo período.
 * O número resume; é na auditoria que se confere, ato por ato.
 */
export function hrefDaAuditoria(usuarioId: string, de: string, ate: string): string {
  return `/auditoria?usuario=${encodeURIComponent(usuarioId)}&de=${de}&ate=${ate}`;
}

const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export interface ConteudoDoBloco {
  numero: number;
  rotulo: string;
  linhas: { texto: string; alerta?: boolean }[];
}

/**
 * O QUE CADA BLOCO DIZ, em frase de gente: um número grande (o trabalho feito)
 * e, embaixo, o que ele esconderia sozinho — com o que pede atenção marcado
 * para ganhar cor.
 */
export function conteudoDoBloco(bloco: Bloco, l: LinhaDeUso): ConteudoDoBloco {
  switch (bloco) {
    case 'agenda': {
      const { concluidas, noDiaMarcado, criadas, abertas, atrasadas } = l.agenda;
      return {
        numero: concluidas,
        rotulo: concluidas === 1 ? 'concluída' : 'concluídas',
        linhas: [
          ...(concluidas ? [{ texto: `${noDiaMarcado} no dia marcado` }] : []),
          atrasadas
            ? { texto: `${abertas} em aberto, ${qtd(atrasadas, 'atrasada', 'atrasadas')}`, alerta: true }
            : { texto: `${abertas} em aberto` },
          ...(criadas ? [{ texto: `criou ${criadas}` }] : []),
        ],
      };
    }
    case 'publicacoes': {
      const { decididas, esperando } = l.publicacoes;
      return {
        numero: decididas,
        rotulo: decididas === 1 ? 'decidida' : 'decididas',
        linhas: [
          esperando
            ? { texto: `${esperando} esperando decisão`, alerta: true }
            : { texto: 'nenhuma esperando' },
        ],
      };
    }
    case 'processos': {
      const { cadastrados, andamentos, documentos } = l.processos;
      return {
        numero: andamentos,
        rotulo: andamentos === 1 ? 'andamento interno' : 'andamentos internos',
        linhas: [
          ...(cadastrados ? [{ texto: `cadastrou ${qtd(cadastrados, 'processo', 'processos')}` }] : []),
          ...(documentos ? [{ texto: `anexou ${qtd(documentos, 'documento', 'documentos')}` }] : []),
        ],
      };
    }
    case 'filiados': {
      const { cadastrados, fichasAtualizadas } = l.filiados;
      return {
        numero: cadastrados,
        rotulo: cadastrados === 1 ? 'cadastrado' : 'cadastrados',
        // Conta salvamentos, e não fichas: a mesma ficha salva três vezes conta três.
        linhas: fichasAtualizadas
          ? [{ texto: `salvou ${qtd(fichasAtualizadas, 'alteração', 'alterações')} em fichas` }]
          : [],
      };
    }
    case 'atendimentos':
      return {
        numero: l.atendimentos,
        rotulo: l.atendimentos === 1 ? 'registrado' : 'registrados',
        linhas: [],
      };
  }
}

/** A linha de baixo do resumo de cada perfil: quem sumiu, ou que ninguém sumiu. */
export function fraseDoPerfil(r: ResumoDoPerfil): string {
  const partes: string[] = [];
  if (r.semAcessoRecente) partes.push(`${r.semAcessoRecente} sem entrar há uma semana ou mais`);
  if (r.nuncaEntraram) partes.push(r.nuncaEntraram === 1 ? '1 nunca entrou' : `${r.nuncaEntraram} nunca entraram`);
  return partes.length ? partes.join(' · ') : 'todos entraram na última semana';
}

/**
 * "PUBLICAÇÕES DECIDIDAS" SÓ SE COMPARAM DEPOIS DE 13/09/2026.
 *
 * Antes dessa data o sistema não guardava quem aceitou cada proposta
 * (`tarefaDecididaPor`): pela regra nova, os meses anteriores somam zero
 * aceitas, e a comparação sairia "+N" sobre um zero que ninguém mediu.
 */
export const DECISAO_GRAVADA_DESDE = '2026-09-13';

/** O período anterior começa depois que a decisão passou a ser gravada? (AAAA-MM-DD) */
export function comparaDecididas(inicioDoAnterior: string): boolean {
  return inicioDoAnterior >= DECISAO_GRAVADA_DESDE;
}

export const NOTA_DAS_DECIDIDAS =
  'Publicações decididas ficam sem comparação: só a partir de 13/09/2026 o sistema guarda quem ' +
  'aceitou ou recusou cada proposta, e o período anterior começa antes disso.';

/**
 * O QUE SE MEDIU DAS DECIDIDAS NUM PERÍODO (14/09/2026). "0 decididas" num
 * mês de agosto é número NÃO MEDIDO impresso como zero — num papel de
 * desempenho individual, diz que a pessoa não decidiu nada.
 *
 *  · NAO_MEDIDO — o período termina antes de 13/09/2026: não há número;
 *  · PARCIAL — atravessa 13/09/2026: o número vale só dali em diante;
 *  · MEDIDO — o período inteiro já tinha a decisão gravada.
 */
export type MedicaoDasDecididas = 'NAO_MEDIDO' | 'PARCIAL' | 'MEDIDO';

export function medicaoDasDecididas(periodo: { de: string; ate: string }): MedicaoDasDecididas {
  if (periodo.ate < DECISAO_GRAVADA_DESDE) return 'NAO_MEDIDO';
  return periodo.de < DECISAO_GRAVADA_DESDE ? 'PARCIAL' : 'MEDIDO';
}

/** Quantos dias do período já tinham a decisão gravada. */
export const diasMedidosDasDecididas = (dias: string[]) => dias.filter((d) => d >= DECISAO_GRAVADA_DESDE).length;

export const DECIDIDAS_NAO_MEDIDAS = 'Não medido: o sistema só grava quem decide desde 13/09/2026.';

export type Retrato = 'PERIODO' | 'HOJE';

export const RETRATO_LABEL: Record<Retrato, string> = { PERIODO: 'Período', HOJE: 'Hoje' };

export type ChaveDaLegenda =
  | 'diasComUso' | 'ultimoAcesso' | 'usaram' | 'semEntrar' | 'nuncaEntraram'
  | 'concluidas' | 'noDiaMarcado' | 'criou' | 'emAberto' | 'atrasadas'
  | 'decididas' | 'esperando'
  | 'processosCadastrados' | 'andamentos' | 'documentos'
  | 'filiadosCadastrados' | 'alteracoesEmFichas'
  | 'atendimentos' | 'mesAMes' | 'antes';

export interface LinhaDaLegenda {
  chave: ChaveDaLegenda;
  /** O nome do número, igual ao que o PDF e a aba mostram. */
  numero: string;
  /** A frase inteira: "Como ler estes números", na aba. */
  conta: string;
  /**
   * A MESMA REGRA EM ATÉ 80 CARACTERES (14/09/2026) — a coluna "O que conta"
   * do PDF, na linha do próprio número. O glossário no fim empurrava uma
   * folha só de texto e ficava longe do número que explicava. Mudou `conta`,
   * muda esta junto.
   */
  curta: string;
  /** Do período escolhido, ou de hoje (retrato de agora). Nulo quando não se aplica. */
  retrato: Retrato | null;
}

/**
 * O QUE CADA NÚMERO CONTA — em "Como ler estes números" na aba e, na frase
 * `curta`, na coluna "O que conta" do PDF (desde 14/09/2026 o PDF não tem
 * mais glossário no fim).
 *
 * A REGRA MORA NA API (`apps/api/src/modules/relatorios/produtividade.service.ts`
 * e `REGISTROS`). Mudou uma fonte ou um `where` lá, esta frase tem de mudar
 * junto — senão o papel mente sem nada acusar. Textos conferidos contra a
 * rodada de 13/09/2026: em aberto e atrasadas pela régua `daPessoa`, decididas
 * pela decisão gravada, andamentos só os lançados à mão.
 */
export const LEGENDA_DO_USO: LinhaDaLegenda[] = [
  {
    chave: 'diasComUso',
    curta: 'Entrada, sessão renovada ou ação gravada. Mede presença, não trabalho.',
    numero: 'Dias com uso',
    conta:
      'Dias do período em que a pessoa entrou no sistema, teve a sessão renovada ou teve alguma ação ' +
      'gravada em seu nome. Mede presença, não trabalho: abrir certas telas já grava registro. Sábado ' +
      'e domingo contam quando houve uso, mas não entram nos dias de semana do período.',
    retrato: 'PERIODO',
  },
  {
    chave: 'ultimoAcesso',
    curta: 'Entrada, sessão ou ação mais recente, até a hora em que o PDF foi gerado.',
    numero: 'Último acesso',
    conta:
      'A última vez que a pessoa esteve no sistema (entrada, sessão renovada ou ação), contada até a ' +
      'hora em que o documento foi gerado, mesmo num PDF de meses atrás.',
    retrato: 'HOJE',
  },
  {
    chave: 'usaram',
    curta: 'Contas ativas com ao menos um dia com uso no período.',
    numero: 'Usaram o sistema',
    conta:
      'Pessoas com ao menos um dia com uso no período, entre as contas ativas hoje. Conta desativada ' +
      'não aparece; quem chegou depois aparece com zero.',
    retrato: 'PERIODO',
  },
  {
    chave: 'semEntrar',
    curta: 'Contas ativas cujo último acesso foi há sete dias ou mais.',
    numero: 'Sem entrar há 7 dias ou mais',
    conta: 'Contas ativas cujo último acesso foi há sete dias ou mais.',
    retrato: 'HOJE',
  },
  {
    chave: 'nuncaEntraram',
    curta: 'Contas ativas que nunca entraram no sistema.',
    numero: 'Nunca entraram',
    conta: 'Contas ativas que nunca entraram no sistema.',
    retrato: 'HOJE',
  },
  {
    chave: 'concluidas',
    curta: 'Que a pessoa fechou, inclusive de colegas e as criadas pelo robô.',
    numero: 'Concluídas',
    conta:
      'Atividades da agenda que a pessoa concluiu no período, inclusive as de colegas que ela fechou e ' +
      'as tarefas criadas pelo robô. Cancelada não conta.',
    retrato: 'PERIODO',
  },
  {
    chave: 'noDiaMarcado',
    curta: 'Até a data da agenda (a última, se remarcada). Não é prazo processual.',
    numero: 'No dia marcado',
    conta:
      'Das concluídas, as fechadas até o dia que estava na agenda. Se a atividade foi remarcada, vale a ' +
      'última data. Não é prazo processual: o sistema só conhece a data da agenda.',
    retrato: 'PERIODO',
  },
  {
    chave: 'criou',
    curta: 'Lançadas na agenda pela pessoa, para si ou para outra pessoa.',
    numero: 'Criou',
    conta:
      'Atividades que a pessoa lançou na agenda no período, para si ou para outra pessoa, mesmo que ' +
      'depois canceladas. As criadas pelo robô não entram.',
    retrato: 'PERIODO',
  },
  {
    chave: 'emAberto',
    curta: 'Pendentes ou em andamento, de qualquer data; a reserva do robô não entra.',
    numero: 'Em aberto',
    conta:
      'Atividades pendentes ou em andamento, de qualquer data, em que a pessoa é a responsável ou ' +
      'participa por escolha de alguém. A reserva posta pelo robô não entra.',
    retrato: 'HOJE',
  },
  {
    chave: 'atrasadas',
    curta: 'Das em aberto, as marcadas para um dia que já passou.',
    numero: 'Atrasadas',
    conta:
      'Das em aberto, as marcadas para um dia que já passou. Quer dizer que a data da agenda ficou para ' +
      'trás; o sistema não conhece o prazo processual.',
    retrato: 'HOJE',
  },
  {
    chave: 'decididas',
    curta: 'Propostas do Diário que a pessoa aceitou ou recusou.',
    numero: 'Publicações decididas',
    conta:
      'Propostas de tarefa do Diário que a pessoa aceitou ou recusou no período. A tarefa que o sistema ' +
      'criou sozinho, depois de dias sem resposta, não entra.',
    retrato: 'PERIODO',
  },
  {
    chave: 'esperando',
    curta: 'Propostas do Diário endereçadas à pessoa que ainda esperam decisão.',
    numero: 'Esperando decisão',
    conta:
      'Propostas do Diário endereçadas à pessoa que ainda esperam ela aceitar ou recusar. As sem dono, ' +
      'que a coordenação vê na caixa dela, não entram.',
    retrato: 'HOJE',
  },
  {
    chave: 'processosCadastrados',
    curta: 'Pela tela ou por planilha, e casos pré-processuais abertos.',
    numero: 'Processos cadastrados',
    conta:
      'Processos que a pessoa cadastrou no período, pela tela ou pela importação por planilha, e casos ' +
      'pré-processuais abertos a partir de uma atividade.',
    retrato: 'PERIODO',
  },
  {
    chave: 'andamentos',
    curta: 'Escritos à mão na linha do tempo; os automáticos não entram.',
    numero: 'Andamentos internos',
    conta:
      'Andamentos que a pessoa lançou à mão na linha do tempo dos processos. O registro que o sistema ' +
      'escreve ao concluir uma atividade ou ao importar uma planilha, e o que o robô escreve, não entram.',
    retrato: 'PERIODO',
  },
  {
    chave: 'documentos',
    curta: 'Cada envio conta um; vários do acervo de uma vez contam um.',
    numero: 'Documentos anexados',
    conta:
      'Vezes que a pessoa anexou arquivo a um atendimento, processo ou atividade. Trazer vários ' +
      'documentos do acervo do filiado de uma vez conta uma.',
    retrato: 'PERIODO',
  },
  {
    chave: 'filiadosCadastrados',
    curta: 'Fichas novas criadas na tela de cadastro.',
    numero: 'Filiados cadastrados',
    conta: 'Fichas novas de filiado criadas pela pessoa na tela de cadastro.',
    retrato: 'PERIODO',
  },
  {
    chave: 'alteracoesEmFichas',
    curta: 'Cada salvamento conta um, mesmo na mesma ficha.',
    numero: 'Alterações em fichas',
    conta:
      'Vezes que a pessoa salvou alteração no cadastro de um filiado: a mesma ficha salva três vezes ' +
      'conta três; ligar de uma vez vários filiados a um município conta uma. Desfiliação e reativação ' +
      'não entram.',
    retrato: 'PERIODO',
  },
  {
    chave: 'atendimentos',
    curta: 'Registrados com a pessoa como atendente.',
    numero: 'Atendimentos',
    conta:
      'Atendimentos registrados no período com a pessoa como atendente, ou seja, quem estava no sistema ' +
      'ao registrar.',
    retrato: 'PERIODO',
  },
  {
    chave: 'mesAMes',
    curta: 'O que se registrou em cada mês; as pontas contam só os dias do período.',
    numero: 'Mês a mês',
    conta:
      'Concluídas, andamentos e atendimentos pelo mês; embaixo, quantas pessoas usaram o sistema no mês ' +
      '(ou os dias com uso, no documento de uma pessoa). O primeiro e o último mês contam só os dias ' +
      'dentro do período.',
    retrato: 'PERIODO',
  },
  {
    chave: 'antes',
    curta: 'O mesmo recorte no período anterior; o que é de agora não se compara.',
    numero: 'Antes',
    conta:
      'O mesmo recorte no período anterior. Só se compara o que é do período: o que é de hoje não tem ' +
      '“antes”. Publicações decididas só se comparam a partir de 13/09/2026.',
    retrato: null,
  },
];

/** Os números que cada bloco do cartão da pessoa mostra — é o que a legenda precisa explicar. */
export const CHAVES_DO_BLOCO: Record<Bloco, ChaveDaLegenda[]> = {
  agenda: ['concluidas', 'noDiaMarcado', 'emAberto', 'atrasadas', 'criou'],
  publicacoes: ['decididas', 'esperando'],
  processos: ['andamentos', 'processosCadastrados', 'documentos'],
  filiados: ['filiadosCadastrados', 'alteracoesEmFichas'],
  atendimentos: ['atendimentos'],
};

/** Só as linhas pedidas, na ordem da legenda — o PDF não explica número que não mostra. */
export function linhasDaLegenda(chaves: Iterable<ChaveDaLegenda>): LinhaDaLegenda[] {
  const pedidas = new Set(chaves);
  return LEGENDA_DO_USO.filter((l) => pedidas.has(l.chave));
}

/** O que a aba mostra: tudo, menos a comparação e o mês a mês (que só o PDF tem) e, no pessoal, o resumo da equipe. */
export function legendaDaAba(escopo: Produtividade['escopo']): LinhaDaLegenda[] {
  const fora: ChaveDaLegenda[] =
    escopo === 'PESSOAL' ? ['antes', 'mesAMes', 'usaram', 'semEntrar', 'nuncaEntraram'] : ['antes', 'mesAMes'];
  return LEGENDA_DO_USO.filter((l) => !fora.includes(l.chave));
}

/** Vai na tela inteira, sempre. Número sem esta ressalva vira régua de gente. */
export const O_QUE_NAO_MEDE =
  'Estes números mostram o que foi registrado no sistema. Não medem a qualidade do trabalho, ' +
  'a dificuldade de cada caso nem o que acontece fora dele — audiência, telefonema, conversa ' +
  'com a diretoria, atendimento que não foi lançado. Servem para conversar, não para comparar pessoas.';
