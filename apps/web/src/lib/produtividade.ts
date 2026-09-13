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
  avatarUrl: string | null;
  avatarKey: string | null;
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
  };
  publicacoes: { decididas: number; esperando: number };
  processos: { cadastrados: number; andamentos: number; documentos: number };
  filiados: { cadastrados: number; fichasAtualizadas: number };
  atendimentos: number;
  /** Mês a mês, para o PDF de um ano. Opcional pela janela de troca do deploy. */
  porMes?: MesDeUso[];
}

export interface MesDeUso {
  /** AAAA-MM, em Teresina. */
  mes: string;
  diasComUso: number;
  concluidas: number;
  andamentos: number;
  atendimentos: number;
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
  perfis: ResumoDoPerfil[];
  pessoas: LinhaDeUso[];
  geradoEm: string;
}

export async function carregarProdutividade(de: string, ate: string): Promise<Produtividade> {
  return (await api.get<Produtividade>('/relatorios/produtividade', { params: { de, ate } })).data;
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
        linhas: fichasAtualizadas
          ? [{ texto: `atualizou ${qtd(fichasAtualizadas, 'ficha', 'fichas')}` }]
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

/** Vai na tela inteira, sempre. Número sem esta ressalva vira régua de gente. */
export const O_QUE_NAO_MEDE =
  'Estes números mostram o que foi registrado no sistema. Não medem a qualidade do trabalho, ' +
  'a dificuldade de cada caso nem o que acontece fora dele — audiência, telefonema, conversa ' +
  'com a diretoria, atendimento que não foi lançado. Servem para conversar, não para comparar pessoas.';
