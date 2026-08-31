import { api } from './api';

const BASE = '/importacoes/processos';

/**
 * IMPORTAÇÃO DE PROCESSOS EM LOTE.
 *
 * Duas fases: sobe a planilha e vê a conferência; depois confirma. A separação
 * não é cerimônia — importar 82 processos é irreversível na prática (desfazer
 * significa apagar 82 registros com andamentos do CNJ dentro), e a coluna do
 * advogado errada só apareceria depois de quarenta minutos de execução.
 */

export interface ConferenciaPlanilha {
  id: string;
  total: number;
  validos: number;
  comErro: number;
  /** Já estão no sistema — serão pulados, não são erro. */
  jaCadastrados: number;
  problemasNoArquivo: string[];
}

export interface LinhaConferida {
  linha: number;
  npu: string;
  poloAtivo: 'INSTITUCIONAL' | 'FILIADOS' | 'OUTRA' | '';
  reu: string;
  valido: boolean;
  erros: string[];
  avisos: string[];
}

export type StatusImportacaoProcessos =
  | 'VALIDANDO' | 'VALIDADO' | 'IMPORTANDO' | 'CONCLUIDO' | 'ERRO';

export interface ResumoImportacaoProcessos {
  id: string;
  nomeArquivo: string;
  status: StatusImportacaoProcessos;
  total: number;
  validos: number;
  comErro: number;
  processados: number;
  importados: number;
  ignorados: number;
  criadoEm: string;
  finalizadoEm: string | null;
  erroMensagem: string | null;
}

export async function enviarPlanilhaProcessos(arquivo: File): Promise<ConferenciaPlanilha> {
  const fd = new FormData();
  fd.append('arquivo', arquivo);
  return (await api.post(`${BASE}/upload`, fd)).data;
}

export async function resumoImportacaoProcessos(id: string): Promise<ResumoImportacaoProcessos> {
  return (await api.get(`${BASE}/${id}/resumo`)).data;
}

export async function linhasImportacaoProcessos(
  id: string,
  opts: { apenasProblemas?: boolean; page?: number } = {},
): Promise<LinhaConferida[]> {
  return (await api.get(`${BASE}/${id}/linhas`, { params: opts })).data;
}

/**
 * `criarTarefasDePrazo` PADRÃO FALSO, e é o padrão certo aqui.
 *
 * Planilha de importação é, quase sempre, acervo que já vinha sendo acompanhado
 * fora do sistema. Com o robô ligado, cada publicação dos últimos 30 dias vira
 * uma tarefa "Verificação de Intimação / Prazo" que nasce vencida — mandando
 * conferir um prazo que o escritório já cumpriu. Medido na carga de 31/08/2026:
 * 82 processos, 4 tarefas, todas de atos com 25 a 28 dias.
 */
export async function confirmarImportacaoProcessos(
  id: string,
  opcoes: { criarTarefasDePrazo?: boolean } = {},
) {
  return (
    await api.post(`${BASE}/${id}/confirmar`, {
      criarTarefasDePrazo: opcoes.criarTarefasDePrazo === true,
    })
  ).data;
}

/**
 * Quanto tempo a importação deve levar, em minutos.
 *
 * Existe porque a tela precisa dizer isso ANTES de a pessoa confirmar. São 2 a
 * 3 segundos de pausa mais a resposta do CNJ, que já foi medida entre 10 e 25
 * segundos — chutar "alguns minutos" para uma espera de quarenta é o tipo de
 * promessa que faz alguém fechar a aba no meio.
 */
export function minutosEstimados(quantidade: number): number {
  const SEGUNDOS_POR_PROCESSO = 18; // pausa (~2,5s) + resposta média do CNJ
  return Math.max(1, Math.round((quantidade * SEGUNDOS_POR_PROCESSO) / 60));
}
