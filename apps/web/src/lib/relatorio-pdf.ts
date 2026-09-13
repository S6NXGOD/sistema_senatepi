import { tenant } from '@/tenant.config';
import { chaveLocal } from './armazenamento';
import { baixarDocumento, type BlocoDoPdf } from './pdf-documento';
import { PALETA, agruparResto, numero, variacao } from './pdf-graficos';
import { presetValido, rotuloDoPeriodo, type Periodo, type PresetDoPeriodo } from './periodo-do-pdf';
import { formatNPU } from './processos';
import {
  RESULTADO_LABEL, dataCurta, diaCurto, duracao, fraseDasSentencas, horaDoItem,
  totalDoAno, type Contagem, type ItemDaAgenda, type Relatorio,
} from './relatorios';

export type { BlocoDoPdf } from './pdf-documento';

/**
 * O PDF DO RELATÓRIO — o documento que vai para a diretoria e para a assembleia.
 *
 * A planilha continua sendo a matéria-prima de quem quer somar. Este é outro
 * público: quem vai LER no papel ou na tela projetada, e precisa escolher o que
 * entra. Por isso duas decisões por seção — incluir e detalhar — e não um PDF
 * único com tudo: o que serve à coordenação numa segunda-feira (a tabela da
 * equipe, pessoa por pessoa) não é o que se projeta numa assembleia.
 *
 * MONTADO EM DUAS ETAPAS, DE PROPÓSITO. `planoDoPdf` decide O QUE entra e é
 * função pura, testada sem navegador. `pdf-documento.ts` só desenha o plano.
 * Assim a regra "a tabela por pessoa só sai se alguém pediu" é provada em
 * teste, e não conferida a olho num PDF.
 *
 * A SEGUNDA VERSÃO (12/09/2026 — "sinta-se livre para colocar gráficos,
 * comparativos, personalizar na hora de gerar"): o período se escolhe no
 * próprio diálogo, as contagens saem em barras, a comparação com o período
 * anterior vem colada no resumo, e o papel leva título e observação de quem
 * emitiu. PESSOA NÃO VIRA BARRA: a lista por pessoa e a por atendente ficam em
 * tabela, em ordem alfabética — barra por pessoa é pódio desenhado.
 */

export type SecaoDoPdf = 'justica' | 'proximos' | 'equipe' | 'publicacoes' | 'atendimentos';

export type EscolhasDoPdf = Record<SecaoDoPdf, { incluir: boolean; detalhar: boolean }>;

export const SECOES_DO_PDF: {
  chave: SecaoDoPdf;
  titulo: string;
  resumo: string;
  detalhe: string;
  /** Aviso ao lado da escolha. */
  cuidado?: string;
}[] = [
  {
    chave: 'justica',
    titulo: 'O sindicato na Justiça',
    resumo: 'Acervo ativo, sentenças e ações por ano.',
    detalhe: 'Sentenças do período, contra quem, onde e sobre o quê.',
  },
  {
    chave: 'proximos',
    titulo: 'Próximos 30 dias',
    resumo: 'Quantas audiências e prazos vêm pela frente.',
    detalhe: 'A lista, com data, processo e responsável.',
  },
  {
    chave: 'equipe',
    titulo: 'Equipe',
    resumo: 'Totais de atividades concluídas, em aberto e atrasadas.',
    detalhe: 'Uma linha por pessoa, em ordem alfabética.',
    cuidado:
      'O detalhe mostra os números de cada pessoa. Deixe desligado quando o PDF for ' +
      'para a diretoria ou para a assembleia.',
  },
  {
    chave: 'publicacoes',
    titulo: 'Publicações e robô',
    resumo: 'O que chegou do Diário e o que virou tarefa.',
    detalhe: 'O que o robô criou, concluiu e cancelou.',
  },
  {
    chave: 'atendimentos',
    titulo: 'Atendimento ao filiado',
    resumo: 'Quantos atendimentos e por que procuraram.',
    detalhe: 'Por setor, canal e atendente.',
  },
];

/**
 * O PADRÃO É O PDF DA DIRETORIA: tudo incluído, e só a Justiça detalhada. A
 * tabela por pessoa começa DESLIGADA — é a decisão de não fazer placar
 * aplicada ao papel que sai da sala.
 */
export const ESCOLHAS_PADRAO: EscolhasDoPdf = {
  justica: { incluir: true, detalhar: true },
  proximos: { incluir: true, detalhar: false },
  equipe: { incluir: true, detalhar: false },
  publicacoes: { incluir: true, detalhar: false },
  atendimentos: { incluir: true, detalhar: false },
};

/** A seção tem o que mostrar NESTE relatório? Quem corta por perfil é a API. */
export function secaoDisponivel(r: Relatorio, secao: SecaoDoPdf): boolean {
  if (secao === 'justica') return !!r.justica;
  if (secao === 'proximos') return !!r.proximos;
  if (secao === 'publicacoes') return !!r.publicacoes || !!r.robo;
  return true;
}

/** Como o PDF sai — além de o que entra. Guardado no navegador, como as seções. */
export interface OpcoesDoPdf {
  preset: PresetDoPeriodo;
  graficos: boolean;
  comparar: boolean;
}

/**
 * O PADRÃO: o período da tela, com gráficos e comparado com o anterior. Quem
 * gera todo mês escolhe "Mês passado" uma vez, e o navegador lembra.
 */
export const OPCOES_PADRAO: OpcoesDoPdf = { preset: 'TELA', graficos: true, comparar: true };

/** O que o plano recebe além das escolhas de seção. */
export interface ExtrasDoPlano {
  /** Barras no lugar das tabelas de contagem. Ligado, se não disser nada. */
  graficos?: boolean;
  /** O mesmo relatório no período anterior. */
  anterior?: { relatorio: Relatorio; periodo: Periodo } | null;
}

/** Até quantas barras um gráfico de contagem mostra antes de somar o resto numa só. */
export const BARRAS_POR_GRAFICO = 12;

export interface RotulosDoPdf {
  tipo: (slug: string) => string;
  area: (slug: string) => string;
  canal: (slug: string) => string;
  assunto: (slug: string) => string;
  setor: (slug: string) => string;
}

/**
 * O AVISO DO CNJ VAI NO PAPEL, ao lado dos números — porque o papel sai da sala
 * sem quem saberia explicar por que os últimos meses parecem fracos.
 */
export const NOTA_DO_CNJ =
  'Sentenças contadas pelo registro do tribunal na base pública do CNJ, que costuma ' +
  'levar cerca de dois meses para registrar um julgamento: os meses mais recentes ' +
  'aparecem incompletos. As ações por ano contam os processos cadastrados neste sistema.';

const n = numero;
const plural = (v: number, um: string, varios: string) => `${n(v)} ${v === 1 ? um : varios}`;
const npu = (numeroCnj: string | null | undefined) => (numeroCnj ? formatNPU(numeroCnj) : '—');

/** A tabela de uma contagem. Para lista de PESSOAS é a única forma: pessoa nunca vira barra. */
function tabelaDeContagem(
  titulo: string,
  cabecalho: [string, string],
  itens: Contagem[],
  rotular?: (r: string) => string,
  vazio?: string,
): BlocoDoPdf {
  return {
    tipo: 'tabela',
    titulo,
    cabecalho,
    linhas: itens.map((i) => [rotular ? rotular(i.rotulo) : i.rotulo, n(i.total)]),
    numericas: [1],
    vazio,
  };
}

/** Contagem de COISAS — réu, comarca, assunto, canal: barras com gráficos, tabela sem. */
function contagem(
  graficos: boolean,
  titulo: string,
  cabecalho: [string, string],
  itens: Contagem[],
  rotular?: (r: string) => string,
  vazio?: string,
): BlocoDoPdf {
  if (!graficos) return tabelaDeContagem(titulo, cabecalho, itens, rotular, vazio);
  const rotulados = itens.map((i) => ({ rotulo: rotular ? rotular(i.rotulo) : i.rotulo, total: i.total }));
  return {
    tipo: 'barras',
    titulo,
    unidade: cabecalho[1].toLowerCase(),
    series: [{ nome: cabecalho[1], cor: PALETA.verde }],
    itens: agruparResto(rotulados, BARRAS_POR_GRAFICO).map((i) => ({
      rotulo: i.rotulo,
      partes: [i.total],
      texto: n(i.total),
    })),
    vazio,
  };
}

/**
 * COMPARADO COM O PERÍODO ANTERIOR — só o que se conta DENTRO de um período.
 *
 * "Em aberto", "atrasadas", o acervo e a fila de publicações são retrato de
 * agora: pedidos para o mês passado, a API devolve o mesmo retrato de hoje, e a
 * tabela diria "igual" sobre algo que ninguém mediu. Ficam de fora, e a nota diz
 * por quê. Seção desmarcada também não entra: o PDF não compara o que não mostra.
 */
function comparacao(
  r: Relatorio,
  anterior: { relatorio: Relatorio; periodo: Periodo },
  quer: (s: SecaoDoPdf) => boolean,
): BlocoDoPdf[] {
  const a = anterior.relatorio;
  const linhas: [string, number, number][] = [
    ['Atividades concluídas', a.atividades.concluidas, r.atividades.concluidas],
    ['Atividades canceladas', a.atividades.canceladas, r.atividades.canceladas],
  ];
  const comJustica = quer('justica') && !!r.justica && !!a.justica;
  if (comJustica) {
    linhas.push(['Ações ajuizadas', a.processos.distribuidos, r.processos.distribuidos]);
    linhas.push([
      'Sentenças registradas',
      a.justica!.totalSentencasNoPeriodo,
      r.justica!.totalSentencasNoPeriodo,
    ]);
  }
  if (quer('publicacoes') && r.publicacoes && a.publicacoes) {
    linhas.push(['Publicações recebidas', a.publicacoes.recebidas, r.publicacoes.recebidas]);
    linhas.push(['Publicações que viraram tarefa', a.publicacoes.viraramTarefa, r.publicacoes.viraramTarefa]);
  }
  if (quer('publicacoes') && r.robo && a.robo) {
    linhas.push(['Tarefas criadas pelo robô', a.robo.criadas, r.robo.criadas]);
  }
  linhas.push(['Atendimentos registrados', a.atendimentos.registrados, r.atendimentos.registrados]);
  if (r.atendimentos.filiadosAtendidos !== undefined && a.atendimentos.filiadosAtendidos !== undefined) {
    linhas.push(['Pessoas atendidas', a.atendimentos.filiadosAtendidos, r.atendimentos.filiadosAtendidos]);
  }

  return [
    {
      tipo: 'secao',
      titulo: 'Comparado com o período anterior',
      subtitulo: `O período anterior é ${rotuloDoPeriodo(anterior.periodo)}.`,
    },
    {
      tipo: 'tabela',
      cabecalho: ['', 'Período anterior', 'Este período', 'Variação'],
      linhas: linhas.map(([rotulo, antes, agora]) => [rotulo, n(antes), n(agora), variacao(agora, antes)]),
      numericas: [1, 2, 3],
    },
    {
      tipo: 'nota',
      texto:
        'Só entram contagens feitas dentro do período. Em aberto, atrasadas, o acervo e a fila de ' +
        'publicações são retrato de hoje e não têm “antes” para comparar.' +
        (comJustica
          ? ' As sentenças dos meses mais recentes ainda estão chegando à base do CNJ: a comparação ' +
            'delas pode mostrar uma queda que não houve.'
          : ''),
    },
  ];
}

/** O que entra no PDF, na ordem em que entra. Nenhum desenho aqui. */
export function planoDoPdf(
  r: Relatorio,
  escolhas: EscolhasDoPdf,
  rotulos: RotulosDoPdf,
  anoCorrente: number,
  extras: ExtrasDoPlano = {},
): BlocoDoPdf[] {
  const blocos: BlocoDoPdf[] = [];
  const graficos = extras.graficos ?? true;
  const quer = (s: SecaoDoPdf) => !!escolhas[s]?.incluir && secaoDisponivel(r, s);
  const detalhar = (s: SecaoDoPdf) => quer(s) && !!escolhas[s]?.detalhar;
  const pessoal = r.escopo === 'PESSOAL';

  // O RESUMO SEMPRE ENTRA: é a página que alguém lê em voz alta.
  blocos.push({ tipo: 'secao', titulo: 'Resumo do período' });
  blocos.push({
    tipo: 'numeros',
    itens: [
      {
        rotulo: 'Atividades concluídas',
        valor: n(r.atividades.concluidas),
        nota: r.atividades.concluidas
          ? `${n(r.atividades.automaticas)} do robô, ${n(r.atividades.manuais)} de pessoas`
          : undefined,
      },
      {
        rotulo: 'Em aberto agora',
        valor: n(r.atividades.abertas),
        nota: r.atividades.atrasadas
          ? plural(r.atividades.atrasadas, 'atrasada', 'atrasadas')
          : 'nenhuma atrasada',
      },
      {
        rotulo: 'Processos ativos',
        valor: n(r.processos.ativos),
        nota: `${plural(r.processos.encerrados, 'encerrado', 'encerrados')} no acervo`,
      },
      {
        rotulo: 'Atendimentos',
        valor: n(r.atendimentos.registrados),
        nota:
          r.atendimentos.filiadosAtendidos !== undefined
            ? plural(r.atendimentos.filiadosAtendidos, 'pessoa', 'pessoas')
            : undefined,
      },
    ],
  });

  // A COMPARAÇÃO VEM COLADA NO RESUMO: é a primeira pergunta de quem lê — "e antes?".
  if (extras.anterior) blocos.push(...comparacao(r, extras.anterior, quer));

  if (quer('justica') && r.justica) {
    const j = r.justica;
    blocos.push({ tipo: 'secao', titulo: 'O sindicato na Justiça' });
    blocos.push({
      tipo: 'numeros',
      itens: [
        { rotulo: 'Como autor', valor: n(j.nossoPapel.autor) },
        { rotulo: 'Representando filiados', valor: n(j.nossoPapel.representando) },
        { rotulo: 'Como réu', valor: n(j.nossoPapel.reu) },
        { rotulo: 'Coletivas / individuais', valor: `${n(j.institucionais)} / ${n(j.individuais)}` },
      ],
    });
    const frase = fraseDasSentencas(j.sentencasPorAno, anoCorrente);
    if (frase) blocos.push({ tipo: 'texto', texto: frase });
    const rotuloDoAno = (ano: number) => (ano === anoCorrente ? `${ano} (até agora)` : String(ano));
    if (graficos) {
      blocos.push({
        tipo: 'barras',
        titulo: 'Sentenças por ano',
        series: [
          { nome: 'Procedentes', cor: PALETA.verde },
          { nome: 'Em parte', cor: PALETA.verdeClaro },
          { nome: 'Improcedentes', cor: PALETA.ambar },
        ],
        // O total e as três partes, na ordem da legenda: a barra não esconde número nenhum.
        itens: j.sentencasPorAno.map((a) => ({
          rotulo: rotuloDoAno(a.ano),
          partes: [a.procedentes, a.parciais, a.improcedentes],
          texto: `${n(totalDoAno(a))} (${n(a.procedentes)} · ${n(a.parciais)} · ${n(a.improcedentes)})`,
        })),
        vazio: 'Nenhuma sentença registrada.',
      });
      blocos.push({
        tipo: 'barras',
        titulo: 'Ações ajuizadas por ano',
        series: [{ nome: 'Ações', cor: PALETA.verde }],
        itens: j.ajuizadasPorAno.map((a) => ({
          rotulo: rotuloDoAno(a.ano),
          partes: [a.processos],
          texto: n(a.processos),
        })),
        vazio: 'Nenhuma ação com data de distribuição.',
      });
    } else {
      blocos.push({
        tipo: 'tabela',
        titulo: 'Sentenças por ano',
        cabecalho: ['Ano', 'Procedentes', 'Em parte', 'Improcedentes', 'Total'],
        linhas: j.sentencasPorAno.map((a) => [
          rotuloDoAno(a.ano), n(a.procedentes), n(a.parciais), n(a.improcedentes), n(totalDoAno(a)),
        ]),
        numericas: [1, 2, 3, 4],
      });
      blocos.push({
        tipo: 'tabela',
        titulo: 'Ações ajuizadas por ano',
        cabecalho: ['Ano', 'Ações'],
        linhas: j.ajuizadasPorAno.map((a) => [rotuloDoAno(a.ano), n(a.processos)]),
        numericas: [1],
      });
    }
    blocos.push({ tipo: 'nota', texto: NOTA_DO_CNJ });

    if (detalhar('justica')) {
      blocos.push({
        tipo: 'tabela',
        titulo: `Sentenças no período (${n(j.totalSentencasNoPeriodo)})`,
        cabecalho: ['Data', 'Processo', 'Parte contrária', 'Resultado'],
        linhas: j.sentencasNoPeriodo.map((s) => [
          dataCurta(s.data), npu(s.numeroCNJ), s.adversario ?? '—', RESULTADO_LABEL[s.resultado],
        ]),
        vazio: 'Nenhuma sentença registrada no período.',
      });
      if (j.totalSentencasNoPeriodo > j.sentencasNoPeriodo.length) {
        blocos.push({
          tipo: 'nota',
          texto: `A lista mostra ${n(j.sentencasNoPeriodo.length)} de ${n(j.totalSentencasNoPeriodo)} sentenças.`,
        });
      }
      blocos.push(contagem(graficos, 'Contra quem', ['Parte contrária', 'Processos ativos'], j.adversarios));
      blocos.push(contagem(graficos, 'Onde tramitam', ['Comarca', 'Processos ativos'], j.comarcas));
      blocos.push(contagem(graficos, 'Sobre o quê', ['Assunto', 'Processos ativos'], j.temas));
      blocos.push(
        contagem(graficos, 'Por área', ['Área', 'Processos ativos'], r.processos.porArea, rotulos.area),
      );
    }
  }

  if (quer('proximos') && r.proximos) {
    const p = r.proximos;
    blocos.push({ tipo: 'secao', titulo: `Próximos ${p.dias} dias` });
    blocos.push({
      tipo: 'numeros',
      itens: [
        { rotulo: 'Audiências e perícias', valor: n(p.totalAudiencias) },
        { rotulo: 'Prazos na agenda', valor: n(p.totalPrazos) },
      ],
    });
    if (detalhar('proximos')) {
      const linha = (c: ItemDaAgenda) => [
        `${diaCurto(c.inicio)} ${horaDoItem(c.inicio)}`,
        c.titulo,
        npu(c.processo?.numeroCNJ),
        c.responsavel ? c.responsavel.nomeExibicao || c.responsavel.nome : '—',
      ];
      const cabecalho = ['Quando', 'Atividade', 'Processo', 'Responsável'];
      blocos.push({
        tipo: 'tabela', titulo: 'Audiências e perícias', cabecalho,
        linhas: p.audiencias.map(linha), vazio: 'Nenhuma nos próximos dias.',
      });
      blocos.push({
        tipo: 'tabela', titulo: 'Prazos', cabecalho,
        linhas: p.prazos.map(linha), vazio: 'Nenhum nos próximos dias.',
      });
      blocos.push({
        tipo: 'nota',
        texto:
          'Prazo, aqui, é a data marcada na agenda por alguém da equipe, e não o prazo ' +
          'processual calculado pelo tribunal.',
      });
    }
  }

  if (quer('equipe')) {
    blocos.push({
      tipo: 'secao',
      titulo: pessoal ? 'Os seus números' : r.focoUsuario ? `Números de ${r.focoUsuario.nome}` : 'Equipe',
    });
    blocos.push({
      tipo: 'numeros',
      itens: [
        { rotulo: 'Concluídas no período', valor: n(r.atividades.concluidas) },
        { rotulo: 'Canceladas no período', valor: n(r.atividades.canceladas) },
        { rotulo: 'Em aberto agora', valor: n(r.atividades.abertas) },
        { rotulo: 'Atrasadas', valor: n(r.atividades.atrasadas) },
      ],
    });
    if (r.atividades.porTipo.length) {
      blocos.push(
        contagem(graficos, 'O que foi concluído', ['Tipo de atividade', 'Concluídas'], r.atividades.porTipo, rotulos.tipo),
      );
    }
    if (detalhar('equipe')) {
      blocos.push({
        tipo: 'tabela',
        titulo: 'Por pessoa, em ordem alfabética',
        cabecalho: ['Pessoa', 'Concluídas', 'Em aberto', 'Atrasadas', 'Tempo mediano'],
        linhas: r.equipe.map((l) => [
          l.nome, n(l.concluidas), n(l.abertas), n(l.atrasadas), duracao(l.medianaMinutos),
        ]),
        numericas: [1, 2, 3, 4],
      });
      blocos.push({
        tipo: 'nota',
        texto:
          'Sem posição e sem nota: os casos não são comparáveis entre si. O tempo mediano ' +
          'considera só as atividades em que alguém usou o cronômetro.',
      });
    }
  }

  if (quer('publicacoes')) {
    blocos.push({ tipo: 'secao', titulo: 'Publicações e robô' });
    if (r.publicacoes) {
      blocos.push({
        tipo: 'numeros',
        itens: [
          { rotulo: 'Publicações recebidas', valor: n(r.publicacoes.recebidas) },
          { rotulo: 'Viraram tarefa', valor: n(r.publicacoes.viraramTarefa) },
          { rotulo: 'Dispensadas com motivo', valor: n(r.publicacoes.dispensadas) },
          { rotulo: 'Esperando decisão hoje', valor: n(r.publicacoes.esperandoDecisao) },
        ],
      });
    }
    if (detalhar('publicacoes') && r.robo) {
      const robo = r.robo;
      const canceladas = robo.canceladasPeloRobo + robo.canceladasPorPessoas;
      blocos.push({
        tipo: 'texto',
        texto:
          `O robô criou ${plural(robo.criadas, 'tarefa', 'tarefas')} no período: ` +
          `${n(robo.concluidas)} concluídas, ${n(robo.abertas)} em aberto e ${n(canceladas)} canceladas — ` +
          `${n(robo.canceladasPeloRobo)} por ele mesmo, ao achar duplicidade ou perda de objeto, e ` +
          `${n(robo.canceladasPorPessoas)} por pessoas da equipe.`,
      });
    }
  }

  if (quer('atendimentos')) {
    const a = r.atendimentos;
    blocos.push({ tipo: 'secao', titulo: 'Atendimento ao filiado' });
    blocos.push({
      tipo: 'numeros',
      itens: [
        { rotulo: 'Atendimentos registrados', valor: n(a.registrados) },
        ...(a.filiadosAtendidos !== undefined
          ? [{ rotulo: 'Pessoas atendidas', valor: n(a.filiadosAtendidos) }]
          : []),
        { rotulo: 'Concluídos', valor: n(a.concluidos) },
      ],
    });
    blocos.push(
      contagem(
        graficos, 'Por que procuraram o sindicato', ['Assunto', 'Atendimentos'], a.porAssunto, rotulos.assunto,
        'Nenhum atendimento classificado no período.',
      ),
    );
    if (a.assuntoNaoInformado > 0) {
      blocos.push({
        tipo: 'nota',
        texto: `${plural(a.assuntoNaoInformado, 'atendimento ficou', 'atendimentos ficaram')} sem assunto informado.`,
      });
    }
    if (detalhar('atendimentos')) {
      blocos.push(contagem(graficos, 'Por setor', ['Setor', 'Atendimentos'], a.porSetor, rotulos.setor));
      blocos.push(contagem(graficos, 'Por canal', ['Canal', 'Atendimentos'], a.porCanal, rotulos.canal));
      if (!pessoal) {
        // Atendente é gente: tabela, mesmo com gráficos ligados.
        blocos.push(tabelaDeContagem('Por atendente', ['Atendente', 'Atendimentos'], a.porAtendente));
      }
    }
  }

  return blocos;
}

const CHAVE_DAS_ESCOLHAS = chaveLocal('relatorio', 'pdf-escolhas');
const CHAVE_DAS_OPCOES = chaveLocal('relatorio', 'pdf-opcoes');

/** As escolhas da última vez: quem gera o PDF da diretoria todo mês não remarca tudo. */
export function lerEscolhas(): EscolhasDoPdf {
  const escolhas: EscolhasDoPdf = { ...ESCOLHAS_PADRAO };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DAS_ESCOLHAS) ?? 'null') as
      | Partial<EscolhasDoPdf>
      | null;
    if (!salvo || typeof salvo !== 'object') return escolhas;
    for (const { chave } of SECOES_DO_PDF) {
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

export function guardarEscolhas(escolhas: EscolhasDoPdf): void {
  try {
    localStorage.setItem(CHAVE_DAS_ESCOLHAS, JSON.stringify(escolhas));
  } catch {
    // Navegador sem armazenamento: a escolha vale só desta vez.
  }
}

/** Período, gráficos e comparação da última vez. Título e observação NÃO ficam. */
export function lerOpcoes(): OpcoesDoPdf {
  const opcoes: OpcoesDoPdf = { ...OPCOES_PADRAO };
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_DAS_OPCOES) ?? 'null') as Partial<OpcoesDoPdf> | null;
    if (!salvo || typeof salvo !== 'object') return opcoes;
    if (presetValido(salvo.preset)) opcoes.preset = salvo.preset;
    if (typeof salvo.graficos === 'boolean') opcoes.graficos = salvo.graficos;
    if (typeof salvo.comparar === 'boolean') opcoes.comparar = salvo.comparar;
  } catch {
    // Armazenamento bloqueado ou lixo antigo: vale o padrão.
  }
  return opcoes;
}

export function guardarOpcoes(opcoes: OpcoesDoPdf): void {
  try {
    localStorage.setItem(CHAVE_DAS_OPCOES, JSON.stringify(opcoes));
  } catch {
    // Navegador sem armazenamento: vale só desta vez.
  }
}

/**
 * GERA E BAIXA. O título e a observação vêm do diálogo e não ficam guardados:
 * "Assembleia de setembro" no PDF de outubro é armadilha.
 */
export async function gerarPdfDoRelatorio(
  r: Relatorio,
  escolhas: EscolhasDoPdf,
  rotulos: RotulosDoPdf,
  contexto: { de: string; ate: string; emitidoPor: string; titulo?: string; observacao?: string },
  extras: ExtrasDoPlano = {},
): Promise<void> {
  const periodo = rotuloDoPeriodo({ de: contexto.de, ate: contexto.ate });
  const recorte =
    r.escopo === 'PESSOAL'
      ? 'Números pessoais'
      : r.focoUsuario
        ? `Recorte: ${r.focoUsuario.nome}`
        : 'Toda a equipe';
  await baixarDocumento(
    {
      faixa: `Relatório · ${periodo}`,
      titulo: contexto.titulo?.trim() || `Relatório do ${tenant.sigla}`,
      apoio: `Período: ${periodo} · ${recorte} · Emitido por ${contexto.emitidoPor}`,
      observacao: contexto.observacao?.trim() || undefined,
    },
    planoDoPdf(r, escolhas, rotulos, new Date().getFullYear(), extras),
    `relatorio-${tenant.id}-${contexto.de}-a-${contexto.ate}.pdf`,
  );
}
