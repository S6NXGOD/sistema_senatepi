import { tenant } from '@/tenant.config';
import { chaveLocal } from './armazenamento';
import { baixarDocumento, type BlocoDoPdf, type CapaDoDocumento } from './pdf-documento';
import { PALETA, numero } from './pdf-graficos';
import {
  LEITURA, desfechosParaLer, duracaoEmPalavras, rotuloDoAno, tendencia,
  type Concentracao, type Historico, type LeituraConcentracao, type Panorama,
} from './panorama';

/**
 * O PDF DO PANORAMA — retrato de hoje do acervo, para levar à diretoria.
 *
 * O MESMO PADRÃO DOS RELATÓRIOS: `planoDoPanorama` decide O QUE entra e é
 * função pura, provada sem navegador; `pdf-documento.ts` só desenha. Nenhuma
 * rota nova — o papel imprime o que `GET /panorama` já entrega a quem vê a tela.
 *
 * O QUE ELE NÃO FAZ, E POR QUÊ:
 *  - NÃO TEM PERÍODO NEM COMPARAÇÃO. O Panorama não guarda histórico: é o
 *    acervo de agora. "Comparado com o mês passado" seria inventado.
 *  - NÃO LISTA PROCESSOS. Filiação a sindicato é dado pessoal sensível (LGPD,
 *    art. 5º, II), e um NPU ao lado de um réu reidentifica a pessoa numa
 *    consulta pública. O payload nem traz nome de filiado ou de advogado — e
 *    advogado ao lado de desfecho seria taxa de vitória de colega.
 *  - NÃO RECOMENDA. O "Antes de ler" abre o documento sempre, fora das opções,
 *    e nenhum texto do plano manda fazer nada (há teste).
 *  - RÉU PESSOA FÍSICA NÃO SAI COM NOME. Sai "Pessoa física".
 */

export type SecaoDoPanorama = 'lados' | 'concentracoes' | 'dispersoes';

export type EscolhasDoPanorama = Record<SecaoDoPanorama, { incluir: boolean; detalhar: boolean }>;

export const SECOES_DO_PANORAMA: {
  chave: SecaoDoPanorama;
  titulo: string;
  resumo: string;
  /** `null`: a seção não tem o que detalhar. */
  detalhe: string | null;
  /** Aviso em âmbar ao lado da escolha. */
  cuidado?: string;
}[] = [
  {
    chave: 'lados',
    titulo: 'De que lado estamos',
    resumo: 'Em quantos processos ativos a entidade é autora, representa o filiado ou é ré.',
    detalhe: null,
  },
  {
    chave: 'concentracoes',
    titulo: 'O mesmo réu, o mesmo pedido',
    resumo: 'Uma linha por parte contrária: ações ativas, julgadas e a leitura.',
    detalhe: 'Os pedidos que se repetem contra cada réu e o que cada leitura quer dizer.',
    cuidado:
      'Leva o nome de cada réu e como as ações contra ele têm sido julgadas. Pense em quem ' +
      'recebe o papel antes de levar à assembleia.',
  },
  {
    chave: 'dispersoes',
    titulo: 'O mesmo pedido, muitos réus',
    resumo: 'Uma linha por pedido: ações ativas, réus distintos e julgadas.',
    detalhe: 'As ações ajuizadas por ano de cada pedido.',
  },
];

/** Tudo incluído, nada detalhado: o papel curto é o que se lê na reunião. */
export const ESCOLHAS_PADRAO_DO_PANORAMA: EscolhasDoPanorama = {
  lados: { incluir: true, detalhar: false },
  concentracoes: { incluir: true, detalhar: false },
  dispersoes: { incluir: true, detalhar: false },
};

export interface OpcoesDoPanorama {
  graficos: boolean;
}

export const OPCOES_PADRAO_DO_PANORAMA: OpcoesDoPanorama = { graficos: true };

export interface ExtrasDoPanorama {
  /** Barras e colunas além das tabelas. Ligado, se não disser nada. */
  graficos?: boolean;
}

/**
 * OS LIMITES DO PAPEL. Hoje são cerca de onze cartões (3 a 5 páginas); os
 * limites existem para o dia em que o acervo crescer, e o que fica de fora é
 * dito numa nota — nunca cortado em silêncio.
 */
export const LIMITES_DO_PANORAMA = {
  /** Linhas da tabela de réus. */
  reus: 20,
  /** Pedidos listados por réu no detalhe, e linhas da tabela de pedidos. */
  pedidos: 12,
  /** Gráficos de ações por ano. */
  graficos: 8,
};

const FUSO = 'America/Fortaleza';
const n = numero;
const plural = (v: number, um: string, varios: string) => `${n(v)} ${v === 1 ? um : varios}`;

/** Data inválida não pode virar "Invalid Date" no papel: vale o agora. */
function comoData(iso: string | null | undefined): Date {
  const d = new Date(iso ?? '');
  return Number.isFinite(d.getTime()) ? d : new Date();
}

function partesDoDia(iso: string | null | undefined) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(comoData(iso));
  const de = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? '';
  return { ano: de('year'), mes: de('month'), dia: de('day'), hora: de('hour'), minuto: de('minute') };
}

/** "12/09/2026", no fuso de Teresina — o servidor e o navegador podem estar em UTC. */
export function dataDoRetrato(iso: string | null | undefined): string {
  const p = partesDoDia(iso);
  return `${p.dia}/${p.mes}/${p.ano}`;
}

/** "22:30", no fuso de Teresina. */
export function horaDoRetrato(iso: string | null | undefined): string {
  const p = partesDoDia(iso);
  return `${p.hora}:${p.minuto}`;
}

/** O ano de agora em Teresina: na virada do ano, o UTC já estaria no seguinte. */
export function anoEmTeresina(agora: Date = new Date()): number {
  return Number(partesDoDia(agora.toISOString()).ano);
}

export const tituloPadraoDoPanorama = () => `Panorama do acervo do ${tenant.sigla}`;

/** `panorama-<tenant>-<AAAA-MM-DD>.pdf`, pelo dia do retrato em Teresina. */
export function arquivoDoPanorama(geradoEm: string | null | undefined): string {
  const p = partesDoDia(geradoEm);
  return `panorama-${tenant.id}-${p.ano}-${p.mes}-${p.dia}.pdf`;
}

/** Réu pessoa física não sai com nome num papel da diretoria. */
export function nomeDoReu(c: Pick<Concentracao, 'adversario'> & { tipo?: Concentracao['tipo'] }): string {
  if (c.tipo === 'FISICA') return 'Pessoa física';
  return c.adversario?.trim() || 'Parte sem nome no cadastro';
}

/** A API manda o histórico em todos os cartões? Sem ele, o papel não fala em "ajuizadas". */
export function temHistorico(p: Pick<Panorama, 'concentracoes' | 'dispersoes'>): boolean {
  return [...p.concentracoes, ...p.dispersoes].every((c) => !!c.historico);
}

/** "9 (3 · 4 · 2)" — o total e as três partes, na ordem da legenda. */
function julgadasEmPartes(h: Historico): string {
  return `${n(h.julgados)} (${n(h.procedentes)} · ${n(h.parciais)} · ${n(h.improcedentes)})`;
}

/**
 * ANTES DE LER — sempre o primeiro bloco, fora das opções. O papel sai da sala
 * sem quem saberia explicar o que os números são e o que não são.
 */
export function antesDeLer(p: Pick<Panorama, 'concentracoes' | 'dispersoes'>): string {
  const historico = temHistorico(p);
  return [
    'São contagens do próprio acervo e desfechos carimbados pelo tribunal. O sistema não opina ' +
      'sobre estratégia: a leitura jurídica é de quem conduz os processos.',
    historico
      ? 'Quem entra em cada bloco é decidido pelas ações ativas; os desfechos e as ações por ano ' +
        'contam todas as ações ajuizadas, inclusive as que já saíram do acervo ativo.'
      : 'Os números contam as ações ativas.',
    'Um processo trata de vários assuntos e aparece em mais de um bloco, então os números não se somam.',
    'Os pedidos têm o nome que o tribunal registrou. As etiquetas de rito (gratuidade, honorários, ' +
      'ônus da prova e outras) ficam de fora, e assuntos parecidos com códigos diferentes aparecem separados.',
    'O desfecho é a última sentença registrada na base pública do CNJ, que costuma levar cerca de ' +
      'dois meses para registrar um julgamento. Sentença não é resultado final: recurso julgado ' +
      'depois pode mudá-lo' +
      (historico ? ', e o documento diz quantas ações tiveram recurso.' : '.'),
  ].join(' ');
}

/** "3 tiveram recurso julgado depois da sentença…" — só quando há. */
function notaDoRecurso(total: number, quem: string): BlocoDoPdf | null {
  if (!(total > 0)) return null;
  return {
    tipo: 'nota',
    texto: (
      `${n(total)} ${total === 1 ? 'ação julgada teve' : 'ações julgadas tiveram'} recurso julgado ` +
      `depois da sentença: o resultado final pode ser outro. ${quem}`
    ).trim(),
  };
}

const SERIES_DOS_DESFECHOS = [
  { nome: 'Procedentes', cor: PALETA.verde },
  { nome: 'Em parte', cor: PALETA.verdeClaro },
  { nome: 'Improcedentes', cor: PALETA.ambar },
];

/** O que entra no PDF, na ordem em que entra. Nenhum desenho aqui. */
export function planoDoPanorama(
  p: Panorama,
  escolhas: EscolhasDoPanorama,
  anoCorrente: number,
  extras: ExtrasDoPanorama = {},
): BlocoDoPdf[] {
  const blocos: BlocoDoPdf[] = [];
  const graficos = extras.graficos ?? true;
  const quer = (s: SecaoDoPanorama) => !!escolhas[s]?.incluir;
  const detalhar = (s: SecaoDoPanorama) => quer(s) && !!escolhas[s]?.detalhar;
  const historico = temHistorico(p);
  const concentracoes = p.concentracoes ?? [];
  const dispersoes = p.dispersoes ?? [];

  blocos.push({ tipo: 'destaque', rotulo: 'Antes de ler', texto: antesDeLer({ concentracoes, dispersoes }) });

  if (quer('lados') && p.nossoPapel) {
    blocos.push({
      tipo: 'secao',
      titulo: 'De que lado estamos',
      // Não escreva "somam o acervo": sem parte cadastrada ou como terceiro, o processo fica fora dos três.
      subtitulo:
        `O papel do ${tenant.sigla} em cada processo ativo. Processo sem parte cadastrada, ou em que ` +
        'a entidade aparece só como terceira, não entra em nenhum dos três.',
    });
    blocos.push({
      tipo: 'numeros',
      itens: [
        {
          rotulo: `${tenant.sigla} é o autor`,
          valor: n(p.nossoPapel.autor),
          nota: 'Ação movida pela entidade em nome próprio ou da categoria.',
        },
        {
          rotulo: 'Representamos o filiado',
          valor: n(p.nossoPapel.representando),
          nota: 'A parte é o filiado; a entidade não figura em polo nenhum.',
        },
        {
          rotulo: `${tenant.sigla} é réu`,
          valor: n(p.nossoPapel.reu),
          nota: 'Ação contra a entidade: responde ela, não o filiado.',
        },
      ],
    });
  }

  if (quer('concentracoes')) {
    const reus = concentracoes.slice(0, LIMITES_DO_PANORAMA.reus);
    blocos.push({
      tipo: 'secao',
      titulo: 'O mesmo réu, o mesmo pedido',
      subtitulo:
        'Partes contrárias com três ou mais ações ativas que repetem os mesmos pedidos.' +
        (historico ? ' As julgadas contam todas as ações ajuizadas contra o réu.' : ''),
    });
    blocos.push({
      tipo: 'tabela',
      // QUANTO TEMPO ATÉ A SENTENÇA entra no papel da diretoria: é o número que
      // decide se vale entrar com a ação, e não existia em tela nem em PDF.
      cabecalho: [
        'Réu', 'Ações ativas', 'Individuais', 'Julgadas (p · pp · i)', 'Até a sentença', 'Leitura',
      ],
      linhas: reus.map((c) => [
        nomeDoReu(c),
        n(c.processos),
        n(c.individuais),
        julgadasEmPartes(desfechosParaLer(c)),
        duracaoEmPalavras(c.medianaDias) ?? '—',
        c.leituras.map((s) => LEITURA[s]?.titulo ?? s).join('; '),
      ]),
      numericas: [1, 2, 3],
      vazio: 'Nenhum réu com três ou mais ações ativas repetindo o mesmo pedido.',
    });
    if (concentracoes.length > reus.length) {
      blocos.push({
        tipo: 'nota',
        texto: `A tabela mostra ${n(reus.length)} de ${n(concentracoes.length)} réus, os de mais ações ativas.`,
      });
    }
    if (reus.length) {
      blocos.push({
        tipo: 'nota',
        texto:
          'Julgadas: p = procedentes, pp = procedentes em parte, i = improcedentes.' +
          (historico
            ? ' As leituras de resultado sempre contrário ou sempre favorável só aparecem quando ' +
              'nenhuma julgada teve recurso julgado depois.'
            : ''),
      });
    }
    const recurso = notaDoRecurso(
      reus.reduce((soma, c) => soma + desfechosParaLer(c).comRecursoDepois, 0),
      'Para esses réus, a leitura de resultado uniforme não aparece.',
    );
    if (recurso) blocos.push(recurso);

    if (graficos && reus.length) {
      blocos.push({
        tipo: 'barras',
        titulo: 'Desfechos por réu',
        unidade: historico ? 'todas as ações ajuizadas' : 'ações ativas',
        series: SERIES_DOS_DESFECHOS,
        itens: reus
          .map((c) => ({ c, h: desfechosParaLer(c) }))
          .filter(({ h }) => h.julgados > 0)
          .map(({ c, h }) => ({
            rotulo: nomeDoReu(c),
            partes: [h.procedentes, h.parciais, h.improcedentes],
            texto: `${plural(h.julgados, 'julgada', 'julgadas')} (${n(h.procedentes)} · ${n(h.parciais)} · ${n(h.improcedentes)})`,
          })),
        vazio: 'Nenhuma ação julgada contra estes réus.',
      });
    }

    if (detalhar('concentracoes') && reus.length) {
      const linhas: string[][] = [];
      for (const c of reus) {
        const pedidos = c.pedidos.slice(0, LIMITES_DO_PANORAMA.pedidos);
        // O nome se repete em cada linha: a tabela pode quebrar de página no meio de um réu.
        for (const pedido of pedidos) linhas.push([nomeDoReu(c), pedido.assunto, n(pedido.processos)]);
        if (c.pedidos.length > pedidos.length) {
          linhas.push([
            nomeDoReu(c),
            `e mais ${plural(c.pedidos.length - pedidos.length, 'pedido', 'pedidos')}`,
            '',
          ]);
        }
      }
      blocos.push({
        tipo: 'tabela',
        titulo: 'Os pedidos que se repetem',
        cabecalho: ['Réu', 'Pedido', 'Ações ativas'],
        linhas,
        numericas: [2],
      });
      // O texto de cada leitura UMA vez, e não repetido por réu.
      const presentes = (Object.keys(LEITURA) as LeituraConcentracao[]).filter((slug) =>
        reus.some((c) => c.leituras.includes(slug)),
      );
      if (presentes.length) {
        blocos.push({
          tipo: 'tabela',
          titulo: 'O que cada leitura quer dizer',
          cabecalho: ['Leitura', 'O que quer dizer'],
          linhas: presentes.map((slug) => [LEITURA[slug].titulo, LEITURA[slug].explicacao]),
        });
      }
    }
  }

  if (quer('dispersoes')) {
    const pedidos = dispersoes.slice(0, LIMITES_DO_PANORAMA.pedidos);
    blocos.push({
      tipo: 'secao',
      titulo: 'O mesmo pedido, muitos réus',
      subtitulo:
        'Pedidos que aparecem em seis ou mais ações ativas, contra cinco ou mais partes contrárias ' +
        'diferentes: o padrão não é de um réu, é da categoria.',
    });
    blocos.push({
      tipo: 'tabela',
      cabecalho: [
        'Pedido', 'Ações ativas', 'Réus distintos', 'Individuais', 'Julgadas (p · pp · i)',
        'Até a sentença',
      ],
      linhas: pedidos.map((d) => [
        d.assunto,
        n(d.processos),
        n(d.adversarios),
        n(d.individuais),
        julgadasEmPartes(desfechosParaLer(d)),
        duracaoEmPalavras(d.medianaDias) ?? '—',
      ]),
      numericas: [1, 2, 3, 4],
      vazio: 'Nenhum pedido repetido em seis ou mais ações ativas contra cinco ou mais réus.',
    });
    if (dispersoes.length > pedidos.length) {
      blocos.push({
        tipo: 'nota',
        texto: `A tabela mostra ${n(pedidos.length)} de ${n(dispersoes.length)} pedidos, os de mais ações ativas.`,
      });
    }
    const recurso = notaDoRecurso(
      pedidos.reduce((soma, d) => soma + desfechosParaLer(d).comRecursoDepois, 0),
      '',
    );
    if (recurso) blocos.push(recurso);

    if (detalhar('dispersoes') && pedidos.length) {
      const rumoDe = (serie: Panorama['dispersoes'][number]['porAno']) => {
        const rumo = tendencia(serie, anoCorrente);
        return rumo === 'CRESCENDO' ? 'crescendo' : rumo === 'DIMINUINDO' ? 'diminuindo' : null;
      };
      const unidade = historico ? 'ajuizadas' : 'ativas';
      if (graficos) {
        const comSerie = pedidos.filter((d) => d.porAno.length > 0);
        const desenhados = comSerie.slice(0, LIMITES_DO_PANORAMA.graficos);
        for (const d of desenhados) {
          const rumo = rumoDe(d.porAno);
          blocos.push({
            tipo: 'colunas',
            titulo: `Ações por ano — ${d.assunto}`,
            unidade: rumo ? `${unidade} · ${rumo}` : unidade,
            series: [{ nome: 'Ações', cor: PALETA.verde }],
            categorias: d.porAno.map((a) => String(a.ano)),
            valores: [d.porAno.map((a) => a.processos)],
            /*
              O ANO PELA METADE E O ANO ZERADO SE DIZEM EMBAIXO. A coluna com zero
              não é desenhada e a série tem uma cor só: sem o rótulo, o papel
              poria o ano corrente em pé de igualdade com os fechados.
            */
            detalhes: d.porAno.map((a) =>
              a.ano === anoCorrente ? 'até agora' : a.processos === 0 ? 'nenhuma' : '',
            ),
            vazio: 'Nenhuma ação com data de distribuição.',
          });
        }
        if (comSerie.length > desenhados.length) {
          blocos.push({
            tipo: 'nota',
            texto: `Os gráficos mostram ${n(desenhados.length)} de ${n(comSerie.length)} pedidos, os de mais ações ativas.`,
          });
        }
      } else {
        blocos.push({
          tipo: 'tabela',
          titulo: `Ações ${unidade} por ano`,
          cabecalho: ['Pedido', 'Por ano', 'Tendência'],
          linhas: pedidos.map((d) => [
            d.assunto,
            d.porAno.length
              ? d.porAno.map((a) => `${rotuloDoAno(a.ano, anoCorrente)}: ${n(a.processos)}`).join(' · ')
              : 'Sem data de distribuição',
            rumoDe(d.porAno) ?? '—',
          ]),
        });
      }
      if (pedidos.some((d) => rumoDe(d.porAno))) {
        blocos.push({
          tipo: 'nota',
          texto:
            'A tendência compara os dois últimos anos fechados com os dois anteriores e só aparece ' +
            'quando um biênio é ao menos 50% maior que o outro, com quatro ou mais ações somadas. ' +
            'O ano corrente fica fora da conta.',
        });
      }
    }
  }

  return blocos;
}

/** A capa: faixa com o dia, título, a linha de apoio e a observação de quem emitiu. */
export function capaDoPanorama(
  p: Pick<Panorama, 'acervoAtivo' | 'geradoEm'>,
  contexto: { emitidoPor: string; titulo?: string; observacao?: string },
): CapaDoDocumento {
  const dia = dataDoRetrato(p.geradoEm);
  return {
    faixa: `Panorama do acervo · ${dia}`,
    titulo: contexto.titulo?.trim() || tituloPadraoDoPanorama(),
    apoio:
      `Retrato de ${dia} às ${horaDoRetrato(p.geradoEm)} · ` +
      `${plural(p.acervoAtivo ?? 0, 'processo ativo', 'processos ativos')} · Emitido por ${contexto.emitidoPor}`,
    observacao: contexto.observacao?.trim() || undefined,
  };
}

const CHAVE_DAS_ESCOLHAS = chaveLocal('panorama', 'pdf-escolhas');
const CHAVE_DAS_OPCOES = chaveLocal('panorama', 'pdf-opcoes');

/** As escolhas da última vez. Título e observação NÃO ficam. */
export function lerEscolhasDoPanorama(): EscolhasDoPanorama {
  const escolhas: EscolhasDoPanorama = { ...ESCOLHAS_PADRAO_DO_PANORAMA };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DAS_ESCOLHAS) ?? 'null') as
      | Partial<EscolhasDoPanorama>
      | null;
    if (!salvo || typeof salvo !== 'object') return escolhas;
    for (const { chave } of SECOES_DO_PANORAMA) {
      const s = salvo[chave];
      if (s && typeof s.incluir === 'boolean' && typeof s.detalhar === 'boolean') {
        escolhas[chave] = { incluir: s.incluir, detalhar: s.detalhar };
      }
    }
  } catch {
    // Armazenamento bloqueado ou lixo antigo: vale o padrão.
  }
  return escolhas;
}

export function guardarEscolhasDoPanorama(escolhas: EscolhasDoPanorama): void {
  try {
    localStorage.setItem(CHAVE_DAS_ESCOLHAS, JSON.stringify(escolhas));
  } catch {
    // Navegador sem armazenamento: vale só desta vez.
  }
}

export function lerOpcoesDoPanorama(): OpcoesDoPanorama {
  const opcoes: OpcoesDoPanorama = { ...OPCOES_PADRAO_DO_PANORAMA };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DAS_OPCOES) ?? 'null') as Partial<OpcoesDoPanorama> | null;
    if (salvo && typeof salvo === 'object' && typeof salvo.graficos === 'boolean') opcoes.graficos = salvo.graficos;
  } catch {
    // Armazenamento bloqueado ou lixo antigo: vale o padrão.
  }
  return opcoes;
}

export function guardarOpcoesDoPanorama(opcoes: OpcoesDoPanorama): void {
  try {
    localStorage.setItem(CHAVE_DAS_OPCOES, JSON.stringify(opcoes));
  } catch {
    // Navegador sem armazenamento: vale só desta vez.
  }
}

/** Gera e baixa. O retrato é o que a tela tem na mão — nada é buscado de novo. */
export async function gerarPdfDoPanorama(
  p: Panorama,
  escolhas: EscolhasDoPanorama,
  contexto: { emitidoPor: string; titulo?: string; observacao?: string },
  extras: ExtrasDoPanorama = {},
): Promise<void> {
  await baixarDocumento(
    capaDoPanorama(p, contexto),
    planoDoPanorama(p, escolhas, anoEmTeresina(), extras),
    arquivoDoPanorama(p.geradoEm),
  );
}
