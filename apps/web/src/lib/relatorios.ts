import { api } from './api';
import { baixarArquivo } from './pdf';

/**
 * RELATÓRIOS — o que a equipe entregou, e o que ficou.
 *
 * A API não devolve posição, nota nem "melhor do mês", e a tela não inventa
 * nenhum: são nove advogados que se conhecem pelo nome, e uma tabela ordenada
 * por volume vira comparação pública entre casos que não são comparáveis — uma
 * execução simples e uma ação civil pública contam "1" cada.
 */

export interface LinhaEquipe {
  usuarioId: string;
  nome: string;
  papel: string;
  concluidas: number;
  abertas: number;
  atrasadas: number;
  /** Mediana em minutos; nulo quando ninguém usou o cronômetro. */
  medianaMinutos: number | null;
  cronometradas: number;
}

export interface Contagem {
  rotulo: string;
  total: number;
}

export interface Relatorio {
  periodo: { de: string; ate: string };
  escopo: 'GLOBAL' | 'PESSOAL';
  equipe: LinhaEquipe[];
  atividades: {
    concluidas: number;
    canceladas: number;
    abertas: number;
    atrasadas: number;
    porDesfecho: Contagem[];
  };
  processos: {
    /** Entraram no sistema no período — inclui acervo antigo importado. */
    cadastrados: number;
    /** Foram ajuizados no período. É o "caso novo" de verdade. */
    distribuidos: number;
    ativos: number;
    encerrados: number;
    porArea: Contagem[];
    porTribunal: Contagem[];
  };
  atendimentos: {
    registrados: number;
    concluidos: number;
    porCanal: Contagem[];
    porAtendente: Contagem[];
  };
  geradoEm: string;
}

export async function carregarRelatorio(de: string, ate: string): Promise<Relatorio> {
  return (await api.get<Relatorio>('/relatorios', { params: { de, ate } })).data;
}

/** CSV e não PDF: quem pede número quer somar e cruzar, não imprimir. */
export async function baixarCsvDaEquipe(de: string, ate: string): Promise<void> {
  await baixarArquivo(
    `/relatorios/equipe.csv?de=${de}&ate=${ate}`,
    `relatorio-da-equipe-${de}-a-${ate}.csv`,
  );
}

/** "1h20" em vez de "80 min" — ninguém pensa a própria tarde em minutos. */
export function duracao(minutos: number | null): string {
  if (minutos == null) return '—';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** AAAA-MM-DD no fuso local, que é o que o `<input type="date">` fala. */
export function comoData(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Os períodos que a coordenação realmente pede. Trimestre e ano não entram:
 * quem precisa deles muda as duas datas, e cada atalho a mais é uma escolha a
 * mais na frente de quem só queria ver o mês.
 */
export const ATALHOS: { rotulo: string; dias: number }[] = [
  { rotulo: '7 dias', dias: 7 },
  { rotulo: '30 dias', dias: 30 },
  { rotulo: '90 dias', dias: 90 },
];
