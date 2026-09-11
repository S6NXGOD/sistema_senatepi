import { chaveDeEnte } from './chave-de-ente.util';
import { PESO_SITUACAO, situacaoFiscal, type SituacaoFiscal } from './leitura-fiscal.util';
import { PRESENCA_VAZIA, type Presenca } from './presenca.util';

/**
 * A LISTA DE CONTAS PÚBLICAS — recorte, situação, ordem e contagens, sem banco.
 *
 * POR QUE EM MEMÓRIA. A situação fiscal não é coluna: ela sai de comparar o
 * percentual com os limites que vieram na mesma linha, e "proibido de dar
 * aumento" não se escreve em SQL sem copiar a regra da LRF para dentro da
 * consulta — duas versões da mesma regra, que é o que este projeto já pagou
 * caro com "atrasada". O catálogo inteiro são 5.571 municípios, e os
 * indicadores, algumas centenas de linhas: cabe em memória com folga.
 *
 * E POR QUE UMA FUNÇÃO PURA: é aqui que moram as decisões que a tela mostra —
 * o que é "onde atuamos", quem vem primeiro, quantos há em cada chip. Sem banco
 * no meio, o teste cobra essas decisões com os números da produção.
 */

/** Onde procurar: onde o sindicato atua (padrão), o estado da casa, ou o Brasil. */
export const ESCOPOS = ['atuacao', 'uf', 'brasil'] as const;
export type Escopo = (typeof ESCOPOS)[number];

/**
 * OS CHIPS DE SITUAÇÃO — quatro, não sete. Quem negocia pergunta "pode ou não
 * pode dar aumento?", e prudencial e acima do teto dão a mesma resposta. As três
 * ausências (não publicou, não consultado, declaração que não fecha) também: em
 * todas, não há número para levar à mesa.
 */
export const FILTROS_DE_SITUACAO = ['impedidos', 'alerta', 'regular', 'sem_numero'] as const;
export type FiltroDeSituacao = (typeof FILTROS_DE_SITUACAO)[number];

export const GRUPO_DA_SITUACAO: Record<SituacaoFiscal, FiltroDeSituacao> = {
  ACIMA_DO_TETO: 'impedidos',
  PRUDENCIAL: 'impedidos',
  ALERTA: 'alerta',
  REGULAR: 'regular',
  INCONSISTENTE: 'sem_numero',
  SEM_DADO: 'sem_numero',
  NAO_CONSULTADO: 'sem_numero',
};

/** Onde temos mais gente (padrão), quem está mais perto do limite, ou A–Z. */
export const ORDENS = ['presenca', 'percentual', 'nome'] as const;
export type Ordem = (typeof ORDENS)[number];

export interface EnteDaLista {
  codigo: number;
  nome: string;
  uf: string;
  nomeNormalizado: string;
  regiaoImediata: string | null;
  populacao: number | null;
  siconfiConsultadoEm: Date | null;
}

export interface LeituraDaLista {
  percentualRcl: number | null;
  limiteMaximo: number | null;
  limitePrudencial: number | null;
  limiteAlerta: number | null;
  exercicio: number;
  quadrimestre: number;
}

export interface SaudeDaLista {
  exercicio: number;
  bimestre: number;
  percentualDespesa: number | null;
  despesaLiquidada: number | null;
}

export interface FiltrosDaLista {
  escopo: Escopo;
  busca?: string | null;
  /** Só vale no escopo 'brasil' — nos outros dois a UF já está decidida. */
  uf?: string | null;
  situacao?: FiltroDeSituacao | null;
  ordem: Ordem;
  page: number;
  pageSize: number;
}

export interface LinhaDaLista {
  codigo: number;
  nome: string;
  uf: string;
  esfera: 'M';
  consultadoEm: Date | null;
  regiaoImediata: string | null;
  populacao: number | null;
  /** Fora do estado da casa — a tela mostra a UF só nesses. */
  foraDaUF: boolean;
  fiscal: {
    situacao: SituacaoFiscal;
    percentualRcl?: number | null;
    limiteMaximo?: number | null;
    limitePrudencial?: number | null;
    exercicio?: number;
    quadrimestre?: number;
  };
  saude: SaudeDaLista | null;
  presenca: Presenca;
  /**
   * COMPATIBILIDADE COM A TELA ANTIGA durante a janela de troca do deploy: o
   * navegador que ainda roda a versão anterior lê `vinculos.*` e quebraria sem
   * o objeto. Pode sair no ciclo seguinte.
   */
  vinculos: { filiados: number; organizacoes: number; processos: number };
}

const temNumero = (l: LinhaDaLista) =>
  l.fiscal.percentualRcl != null && l.fiscal.situacao !== 'INCONSISTENTE';

/** "Gente nossa ali": quem mora mais quem trabalha para o ente. */
const pesoDaPresenca = (l: LinhaDaLista) => l.presenca.moram + l.presenca.trabalham;

/**
 * A ORDEM.
 *
 * O ESTADO DA CASA VEM PRIMEIRO em qualquer desempate. A lista antiga ordenava
 * por UF e depois por nome, e "DF" e "MA" vêm antes de "PI" no alfabeto:
 * Brasília, Caxias e Timon abriam a tela de um sindicato do Piauí.
 */
function comparador(ordem: Ordem, ufDaCasa: string) {
  const porNome = (a: LinhaDaLista, b: LinhaDaLista) =>
    (a.uf === ufDaCasa ? 0 : 1) - (b.uf === ufDaCasa ? 0 : 1) ||
    a.uf.localeCompare(b.uf) ||
    a.nome.localeCompare(b.nome, 'pt-BR');

  if (ordem === 'nome') return porNome;

  if (ordem === 'percentual') {
    return (a: LinhaDaLista, b: LinhaDaLista) => {
      const na = temNumero(a) ? 0 : 1;
      const nb = temNumero(b) ? 0 : 1;
      if (na !== nb) return na - nb;
      if (na === 0) {
        const d = (b.fiscal.percentualRcl ?? 0) - (a.fiscal.percentualRcl ?? 0);
        if (d) return d;
      } else {
        const d = PESO_SITUACAO[a.fiscal.situacao] - PESO_SITUACAO[b.fiscal.situacao];
        if (d) return d;
      }
      return porNome(a, b);
    };
  }

  return (a: LinhaDaLista, b: LinhaDaLista) =>
    pesoDaPresenca(b) - pesoDaPresenca(a) ||
    b.presenca.acoesContra - a.presenca.acoesContra ||
    b.presenca.organizacoes - a.presenca.organizacoes ||
    porNome(a, b);
}

function linhaDaLista(
  e: EnteDaLista,
  p: LeituraDaLista | null,
  s: SaudeDaLista | null,
  presenca: Presenca,
  ufDaCasa: string,
): LinhaDaLista {
  const situacao = situacaoFiscal(p, e.siconfiConsultadoEm);
  return {
    codigo: e.codigo,
    nome: e.nome,
    uf: e.uf,
    esfera: 'M',
    consultadoEm: e.siconfiConsultadoEm,
    regiaoImediata: e.regiaoImediata,
    populacao: e.populacao,
    foraDaUF: e.uf !== ufDaCasa,
    fiscal: p
      ? {
          situacao,
          percentualRcl: p.percentualRcl,
          limiteMaximo: p.limiteMaximo,
          limitePrudencial: p.limitePrudencial,
          exercicio: p.exercicio,
          quadrimestre: p.quadrimestre,
        }
      : { situacao },
    saude: s,
    presenca: { ...presenca },
    vinculos: {
      filiados: presenca.moram,
      organizacoes: presenca.organizacoes,
      processos: presenca.acoesContra,
    },
  };
}

export function montarLista(args: {
  entes: EnteDaLista[];
  pessoal: Map<number, LeituraDaLista>;
  saude: Map<number, SaudeDaLista>;
  presenca: Map<number, Presenca>;
  atuacao: Set<number>;
  ufDaCasa: string;
  filtros: FiltrosDaLista;
}) {
  const { entes, pessoal, saude, presenca, atuacao, ufDaCasa, filtros } = args;
  const chave = chaveDeEnte(filtros.busca);

  /*
    OS CONTADORES DOS CHIPS DE RECORTE respeitam a busca. Quem digita "monte"
    em "Onde atuamos" e vê "0 · Piauí 3 · Brasil 41" descobre onde está o que
    procura sem precisar adivinhar qual chip apertar.
  */
  const escopos = { atuacao: 0, uf: 0, brasil: 0 };
  const noEscopo: EnteDaLista[] = [];
  for (const e of entes) {
    if (chave && !e.nomeNormalizado.includes(chave)) continue;
    const atua = atuacao.has(e.codigo);
    const daCasa = e.uf === ufDaCasa;
    if (atua) escopos.atuacao += 1;
    if (daCasa) escopos.uf += 1;
    escopos.brasil += 1;
    const entra =
      filtros.escopo === 'atuacao'
        ? atua
        : filtros.escopo === 'uf'
          ? daCasa
          : !filtros.uf || e.uf === filtros.uf;
    if (entra) noEscopo.push(e);
  }

  const linhas = noEscopo.map((e) =>
    linhaDaLista(
      e,
      pessoal.get(e.codigo) ?? null,
      saude.get(e.codigo) ?? null,
      presenca.get(e.codigo) ?? PRESENCA_VAZIA,
      ufDaCasa,
    ),
  );

  /* Os chips de situação contam DENTRO do recorte e da busca — senão mentem. */
  const situacao = { todas: linhas.length, impedidos: 0, alerta: 0, regular: 0, sem_numero: 0 };
  for (const l of linhas) situacao[GRUPO_DA_SITUACAO[l.fiscal.situacao]] += 1;

  const filtradas = filtros.situacao
    ? linhas.filter((l) => GRUPO_DA_SITUACAO[l.fiscal.situacao] === filtros.situacao)
    : linhas;
  filtradas.sort(comparador(filtros.ordem, ufDaCasa));

  const total = filtradas.length;
  const totalPaginas = Math.ceil(total / filtros.pageSize);
  /* Página além do fim (o filtro encolheu a lista) cai na última, não no vazio. */
  const page = Math.min(Math.max(1, filtros.page), Math.max(1, totalPaginas));
  const items = filtradas.slice((page - 1) * filtros.pageSize, page * filtros.pageSize);

  return {
    items,
    total,
    page,
    pageSize: filtros.pageSize,
    totalPaginas,
    escopo: filtros.escopo,
    ordem: filtros.ordem,
    ufDaCasa,
    contagens: { escopos, situacao },
  };
}
