import { tenant } from '@/tenant.config';
import { chaveLocal } from './armazenamento';
import {
  CINZA, MARGEM, VERDE, carregarLogo, desenharCabecalhoSync, desenharRodapeGeracao,
} from './pdf-institucional';
import { formatNPU } from './processos';
import {
  RESULTADO_LABEL, dataCurta, dataDoInput, diaCurto, duracao, fraseDasSentencas, horaDoItem,
  totalDoAno, type Contagem, type ItemDaAgenda, type Relatorio,
} from './relatorios';

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
 * função pura, testada sem navegador. `gerarPdfDoRelatorio` só desenha o plano.
 * Assim a regra "a tabela por pessoa só sai se alguém pediu" é provada em
 * teste, e não conferida a olho num PDF.
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

export type BlocoDoPdf =
  | { tipo: 'secao'; titulo: string }
  | { tipo: 'numeros'; itens: { rotulo: string; valor: string; nota?: string }[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'nota'; texto: string }
  | {
      tipo: 'tabela';
      titulo: string;
      cabecalho: string[];
      linhas: string[][];
      /** Índices das colunas de número, alinhadas à direita. */
      numericas?: number[];
      vazio?: string;
    };

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

const n = (v: number) => v.toLocaleString('pt-BR');
const plural = (v: number, um: string, varios: string) => `${n(v)} ${v === 1 ? um : varios}`;
const npu = (numero: string | null | undefined) => (numero ? formatNPU(numero) : '—');

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

/** O que entra no PDF, na ordem em que entra. Nenhum desenho aqui. */
export function planoDoPdf(
  r: Relatorio,
  escolhas: EscolhasDoPdf,
  rotulos: RotulosDoPdf,
  anoCorrente: number,
): BlocoDoPdf[] {
  const blocos: BlocoDoPdf[] = [];
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
      blocos.push(tabelaDeContagem('Contra quem', ['Parte contrária', 'Processos ativos'], j.adversarios));
      blocos.push(tabelaDeContagem('Onde tramitam', ['Comarca', 'Processos ativos'], j.comarcas));
      blocos.push(tabelaDeContagem('Sobre o quê', ['Assunto', 'Processos ativos'], j.temas));
      blocos.push(
        tabelaDeContagem('Por área', ['Área', 'Processos ativos'], r.processos.porArea, rotulos.area),
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
        tabelaDeContagem('O que foi concluído', ['Tipo de atividade', 'Concluídas'], r.atividades.porTipo, rotulos.tipo),
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
      tabelaDeContagem(
        'Por que procuraram o sindicato', ['Assunto', 'Atendimentos'], a.porAssunto, rotulos.assunto,
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
      blocos.push(tabelaDeContagem('Por setor', ['Setor', 'Atendimentos'], a.porSetor, rotulos.setor));
      blocos.push(tabelaDeContagem('Por canal', ['Canal', 'Atendimentos'], a.porCanal, rotulos.canal));
      if (!pessoal) {
        blocos.push(tabelaDeContagem('Por atendente', ['Atendente', 'Atendimentos'], a.porAtendente));
      }
    }
  }

  return blocos;
}

const CHAVE_DAS_ESCOLHAS = chaveLocal('relatorio', 'pdf-escolhas');

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

/**
 * DESENHA O PLANO. Nenhuma decisão de conteúdo mora aqui — só tipografia.
 *
 * Retrato A4, a faixa institucional em toda página, tabelas de linhas claras e
 * sem grade pesada: é documento para ler, não planilha impressa.
 */
export async function gerarPdfDoRelatorio(
  r: Relatorio,
  escolhas: EscolhasDoPdf,
  rotulos: RotulosDoPdf,
  contexto: { de: string; ate: string; emitidoPor: string },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const logo = await carregarLogo('branco');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const largura = larguraPagina - MARGEM * 2;
  const limite = alturaPagina - 20;
  const TINTA: [number, number, number] = [30, 35, 40];
  const periodo = `${dataDoInput(contexto.de)} a ${dataDoInput(contexto.ate)}`;
  const faixa = `Relatório · ${periodo}`;

  let y = desenharCabecalhoSync(doc, faixa, logo);
  const cabe = (altura: number) => {
    if (y + altura <= limite) return;
    doc.addPage();
    y = desenharCabecalhoSync(doc, faixa, logo);
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...TINTA);
  doc.text(`Relatório do ${tenant.sigla}`, MARGEM, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...CINZA);
  const recorte =
    r.escopo === 'PESSOAL'
      ? 'Números pessoais'
      : r.focoUsuario
        ? `Recorte: ${r.focoUsuario.nome}`
        : 'Toda a equipe';
  doc.text(`Período de ${periodo} · ${recorte} · Emitido por ${contexto.emitidoPor}`, MARGEM, y + 10, {
    maxWidth: largura,
  });
  y += 16;

  for (const bloco of planoDoPdf(r, escolhas, rotulos, new Date().getFullYear())) {
    if (bloco.tipo === 'secao') {
      cabe(20);
      y += 4;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...VERDE);
      doc.text(bloco.titulo, MARGEM, y);
      doc.setDrawColor(...VERDE);
      doc.setLineWidth(0.3);
      doc.line(MARGEM, y + 1.8, larguraPagina - MARGEM, y + 1.8);
      y += 7;
    } else if (bloco.tipo === 'numeros') {
      const porLinha = Math.max(1, Math.min(4, bloco.itens.length));
      const vao = 3;
      const w = (largura - vao * (porLinha - 1)) / porLinha;
      const h = 18;
      for (let i = 0; i < bloco.itens.length; i += porLinha) {
        cabe(h + vao);
        bloco.itens.slice(i, i + porLinha).forEach((item, k) => {
          const x = MARGEM + k * (w + vao);
          doc.setDrawColor(222, 226, 230);
          doc.setFillColor(248, 250, 249);
          doc.setLineWidth(0.2);
          doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(14);
          doc.setTextColor(...TINTA);
          doc.text(item.valor, x + 3, y + 7.5);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(...CINZA);
          // Uma linha só: rótulo que quebra empurraria a nota para fora da caixa.
          doc.text(String(doc.splitTextToSize(item.rotulo, w - 6)[0] ?? ''), x + 3, y + 12);
          if (item.nota) {
            doc.setFontSize(7);
            doc.text(String(doc.splitTextToSize(item.nota, w - 6)[0] ?? ''), x + 3, y + 15.5);
          }
        });
        y += h + vao;
      }
    } else if (bloco.tipo === 'texto' || bloco.tipo === 'nota') {
      const corpo = bloco.tipo === 'texto' ? 10 : 7.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(corpo);
      doc.setTextColor(...(bloco.tipo === 'texto' ? TINTA : CINZA));
      const linhas = doc.splitTextToSize(bloco.texto, largura) as string[];
      const altura = linhas.length * corpo * 0.42;
      cabe(altura + 3);
      doc.text(linhas, MARGEM, y + corpo * 0.35);
      y += altura + 3;
    } else {
      cabe(26);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...TINTA);
      doc.text(bloco.titulo, MARGEM, y + 3);
      y += 5;
      autoTable(doc, {
        startY: y,
        margin: { top: 40, left: MARGEM, right: MARGEM, bottom: 18 },
        head: [bloco.cabecalho],
        body: bloco.linhas.length
          ? bloco.linhas
          : [[{
              content: bloco.vazio ?? 'Nada no período.',
              colSpan: bloco.cabecalho.length,
              styles: { halign: 'center', textColor: CINZA },
            }]],
        theme: 'plain',
        headStyles: { fillColor: [238, 243, 240], textColor: TINTA, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: TINTA, cellPadding: 1.6 },
        alternateRowStyles: { fillColor: [250, 251, 250] },
        columnStyles: Object.fromEntries(
          (bloco.numericas ?? []).map((coluna) => [coluna, { halign: 'right' as const }]),
        ),
        didDrawPage: () => {
          desenharCabecalhoSync(doc, faixa, logo);
        },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    }
  }

  desenharRodapeGeracao(doc);
  doc.save(`relatorio-${tenant.id}-${contexto.de}-a-${contexto.ate}.pdf`);
}
