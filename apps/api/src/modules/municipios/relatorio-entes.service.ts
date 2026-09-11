import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { lerLogoDaMarca } from '../../common/assets.util';
import { carimbarRodape } from '../../common/pdf-rodape.util';
import { tenant, rodapeInstitucional } from '../../tenant/tenant.config';
import { dataParaNome, nomeDeArquivo, type DocumentoGerado } from '@core/infra';
import { formatarDataHoraBR } from '../processos/utils/data-br.util';
import { situacaoFiscal, PESO_SITUACAO, type SituacaoFiscal } from './leitura-fiscal.util';

/**
 * O RELATÓRIO DE ENTES PÚBLICOS — o que a integração sabe, numa folha que se
 * leva para a reunião.
 *
 * POR QUE EM PAPEL, se a tela já mostra. Porque a tela é de quem tem login. A
 * diretoria discute em reunião, o advogado leva a pasta para a audiência, e a
 * assembleia recebe cópia. Um PDF é o formato que atravessa essas três portas.
 *
 * O QUE ELE FAZ DE DIFERENTE DA TELA: começa explicando as palavras. A tela
 * pode se dar ao luxo de um `title=` no selo; o papel não tem hover, e quem lê
 * pode nunca ter ouvido "limite prudencial". Por isso a primeira página é uma
 * legenda em português de gente, e só depois vem a tabela.
 *
 * O QUE ELE NÃO FAZ: afirmar o que não dá para defender. Declaração
 * inconsistente aparece marcada como inconsistente, e a fatia da função Saúde
 * vem com a ressalva de que não é o mínimo constitucional. Um relatório que o
 * outro lado desmente em trinta segundos vale menos que nenhum.
 */

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';
const TEXTO = '#111827';
const ROTULO = '#374151';
const SECUNDARIO = '#6B7280';
const FILETE = '#E5E7EB';
const SOBRE_FAIXA = '#E8F5E3';
const VERMELHO = '#b91c1c';
const AMBAR = '#b45309';

const RODAPE = rodapeInstitucional();

/**
 * NÚMERO NO FORMATO DAQUI, SEM `toLocaleString` — e a razão não é preciosismo.
 *
 * O projeto proíbe `toLocaleString` fora de `data-br.util`, e um teste global
 * reprova quem usar. A regra é cega de propósito: ela nasceu de 26 formatações
 * de DATA que saíam no fuso do contêiner (UTC) em vez do de Teresina, e uma
 * regra com exceções deixa de ser lida. Formatar número é inofensivo, mas abrir
 * a exceção custaria mais que escrever seis linhas.
 */
function numeroBR(n: number, casas: number): string {
  const [inteiro, decimal] = Math.abs(n).toFixed(casas).split('.');
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${comPontos}${decimal ? ',' + decimal : ''}`;
}

/** A cor de cada situação no papel — sem fundo colorido, que gasta tinta e não imprime bem. */
const COR_SITUACAO: Record<SituacaoFiscal, string> = {
  ACIMA_DO_TETO: VERMELHO,
  PRUDENCIAL: AMBAR,
  ALERTA: AMBAR,
  REGULAR: VERDE_ESCURO,
  INCONSISTENTE: SECUNDARIO,
  SEM_DADO: SECUNDARIO,
  NAO_CONSULTADO: SECUNDARIO,
};

const ROTULO_SITUACAO: Record<SituacaoFiscal, string> = {
  ACIMA_DO_TETO: 'acima do teto',
  PRUDENCIAL: 'no prudencial',
  ALERTA: 'em alerta',
  REGULAR: 'dentro do limite',
  INCONSISTENTE: 'declaração não fecha',
  SEM_DADO: 'não publicou',
  NAO_CONSULTADO: 'não consultado',
};

/**
 * A LEGENDA, em português de gente — é a razão de o relatório existir em papel.
 *
 * Cada entrada responde "o que muda para nós", nunca "o que a sigla significa".
 * "RGF é o Relatório de Gestão Fiscal" não ajuda ninguém a negociar; "acima
 * deste limite o município não pode conceder aumento" ajuda.
 */
const LEGENDA: Array<[string, string]> = [
  [
    'Despesa com pessoal',
    'Quanto da receita do ente vai para a folha de pagamento, em porcentagem. Sai do Relatório de Gestão Fiscal (RGF), que todo ente é obrigado a publicar a cada quatro meses.',
  ],
  [
    'Teto da LRF',
    'O limite da Lei de Responsabilidade Fiscal: 54% da receita para prefeituras, 49% para governos estaduais. Passando dele, o ente tem prazo para recompor a folha e perde acesso a transferências voluntárias e a crédito.',
  ],
  [
    'Limite prudencial',
    'Fica em 95% do teto (51,3% nas prefeituras). É o número que mais importa numa negociação: a partir dele o art. 22, parágrafo único, da LRF PROÍBE conceder aumento, criar cargo e contratar — com exceção de reposição em saúde, educação e segurança.',
  ],
  [
    'Dentro do limite',
    'O ente está abaixo do prudencial. Não há impedimento fiscal para conceder aumento — e é isto que derruba a alegação mais comum na mesa.',
  ],
  [
    'Declaração não fecha',
    'O próprio ente declarou ao Tesouro uma folha maior que a receita do período. O número não serve de argumento para nenhum dos dois lados enquanto ele não retificar.',
  ],
  [
    'Não publicou',
    'O ente deixou de publicar o relatório no período. Deixar de publicar é, por si, uma irregularidade prevista na LRF.',
  ],
  [
    'Orçamento da saúde',
    'A fatia da despesa que caiu na função Saúde, do Relatório Resumido da Execução Orçamentária (RREO). NÃO é o mínimo constitucional de 15%, que tem outra base de cálculo e sai num anexo que a API do Tesouro não publica.',
  ],
];

interface LinhaDoRelatorio {
  nome: string;
  uf: string;
  esfera: string;
  populacao: number | null;
  situacao: SituacaoFiscal;
  pct: number | null;
  teto: number | null;
  folga: number | null;
  periodoRgf: string;
  saudePct: number | null;
  periodoSaude: string;
  filiados: number;
  processos: number;
}

@Injectable()
export class RelatorioEntesService {
  constructor(private readonly prisma: PrismaService) {}

  async gerar(): Promise<DocumentoGerado> {
    const linhas = await this.reunir();
    const pdf = await this.desenhar(linhas);
    return {
      pdf,
      nomeArquivo: nomeDeArquivo(
        [tenant.sigla, 'entes publicos e indicadores fiscais', dataParaNome()],
        'pdf',
      ),
    };
  }

  /** Só quem o sindicato toca — o catálogo inteiro seriam 5.599 linhas de papel. */
  private async reunir(): Promise<LinhaDoRelatorio[]> {
    const [comFiliado, comOrg, comProcesso] = await Promise.all([
      this.prisma.filiado.findMany({
        where: { municipioCodigo: { not: null } },
        select: { municipioCodigo: true },
        distinct: ['municipioCodigo'],
      }),
      this.prisma.parteExterna.findMany({
        where: { enteCodigo: { not: null } },
        select: { enteCodigo: true },
        distinct: ['enteCodigo'],
      }),
      this.prisma.processo.findMany({
        where: { municipioIBGE: { not: null } },
        select: { municipioIBGE: true },
        distinct: ['municipioIBGE'],
      }),
    ]);
    const codigos = new Set<number>();
    for (const x of comFiliado) if (x.municipioCodigo) codigos.add(x.municipioCodigo);
    for (const x of comOrg) if (x.enteCodigo) codigos.add(x.enteCodigo);
    for (const x of comProcesso) if (x.municipioIBGE) codigos.add(x.municipioIBGE);

    const entes = await this.prisma.ente.findMany({
      where: {
        OR: [
          { codigo: { in: [...codigos] } },
          { esfera: 'E', uf: (tenant.endereco?.uf ?? '').toUpperCase() },
          { esfera: 'U' },
        ],
      },
      include: {
        indicadoresPessoal: { orderBy: [{ exercicio: 'desc' }, { quadrimestre: 'desc' }], take: 1 },
        indicadoresSaude: { orderBy: [{ exercicio: 'desc' }, { bimestre: 'desc' }], take: 1 },
      },
    });
    if (!entes.length) return [];

    const codigosDoRelatorio = entes.map((e) => e.codigo);
    const [filiados, processos] = await Promise.all([
      this.prisma.filiado.groupBy({
        by: ['municipioCodigo'],
        where: { municipioCodigo: { in: codigosDoRelatorio } },
        _count: { _all: true },
      }),
      this.prisma.processo.groupBy({
        by: ['municipioIBGE'],
        where: { municipioIBGE: { in: codigosDoRelatorio } },
        _count: { _all: true },
      }),
    ]);
    const porFiliado = new Map(filiados.map((g) => [g.municipioCodigo, g._count._all]));
    const porProcesso = new Map(processos.map((g) => [g.municipioIBGE, g._count._all]));

    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

    const linhas: LinhaDoRelatorio[] = entes.map((e) => {
      const i = e.indicadoresPessoal[0] ?? null;
      const s = e.indicadoresSaude[0] ?? null;
      const leitura = i
        ? {
            percentualRcl: num(i.percentualRcl),
            limiteMaximo: num(i.limiteMaximo),
            limitePrudencial: num(i.limitePrudencial),
            limiteAlerta: num(i.limiteAlerta),
          }
        : null;
      const situacao = situacaoFiscal(leitura, e.siconfiConsultadoEm);
      const rcl = num(i?.receitaCorrenteLiquida);
      const desp = num(i?.despesaPessoal);
      const teto = num(i?.limiteMaximo);
      /* A folga só faz sentido quando a declaração fecha — ver `INCONSISTENTE`. */
      const folga =
        situacao !== 'INCONSISTENTE' && rcl !== null && desp !== null && teto !== null
          ? (rcl * teto) / 100 - desp
          : null;
      return {
        nome: e.nome,
        uf: e.uf,
        esfera: e.esfera,
        populacao: e.populacao,
        situacao,
        pct: num(i?.percentualRcl),
        teto,
        folga,
        periodoRgf: i ? `${i.quadrimestre}º quadri./${String(i.exercicio).slice(2)}` : '—',
        saudePct: num(s?.percentualDespesa),
        periodoSaude: s ? `${s.bimestre}º bim./${String(s.exercicio).slice(2)}` : '—',
        filiados: porFiliado.get(e.codigo) ?? 0,
        processos: porProcesso.get(e.codigo) ?? 0,
      };
    });

    /*
      A ORDEM É A DA URGÊNCIA, não a alfabética: quem restringe direito primeiro.
      Numa reunião ninguém lê a terceira página, e a informação que muda a
      conversa não pode depender da letra inicial do município.
    */
    return linhas.sort(
      (a, b) =>
        PESO_SITUACAO[a.situacao] - PESO_SITUACAO[b.situacao] ||
        (b.pct ?? -1) - (a.pct ?? -1) ||
        a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }

  private async desenhar(linhas: LinhaDoRelatorio[]): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = doc.page.margins.left;
      const R = doc.page.width - doc.page.margins.right;
      const LARGURA = R - L;

      /* ---------------------------------------------------- cabeçalho ---- */
      const cabecalho = () => {
        doc.rect(0, 0, doc.page.width, 74).fill(VERDE_ESCURO);
        const logo = lerLogoDaMarca();
        if (logo) {
          try {
            doc.image(logo, L, 18, { fit: [150, 38] });
          } catch {
            doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(16).text(tenant.sigla, L, 26);
          }
        } else {
          doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(16).text(tenant.sigla, L, 26);
        }
        doc
          .fillColor(SOBRE_FAIXA)
          .font('Helvetica')
          .fontSize(7.5)
          .text(`${tenant.nome}\nCNPJ: ${tenant.cnpj}`, R - 240, 22, { width: 240, align: 'right' });
        doc.rect(0, 74, doc.page.width, 4).fill(VERDE_MEDIO);
      };
      cabecalho();

      let y = 96;
      doc
        .fillColor(TEXTO)
        .font('Times-Bold')
        .fontSize(17)
        .text('Entes públicos e indicadores fiscais', L, y);
      y += 24;
      doc
        .fillColor(SECUNDARIO)
        .font('Helvetica')
        .fontSize(8.5)
        .text(
          `Municípios, Estado e União com quem o ${tenant.sigla} se relaciona, com o que cada um declarou ` +
            `ao Tesouro Nacional. Emitido em ${formatarDataHoraBR(new Date())}.`,
          L,
          y,
          { width: LARGURA },
        );
      y = doc.y + 14;

      /* ------------------------------------------------------- legenda ---- */
      doc.fillColor(TEXTO).font('Times-Bold').fontSize(12).text('Como ler este relatório', L, y);
      y = doc.y + 4;
      doc.moveTo(L, y).lineTo(R, y).strokeColor(FILETE).lineWidth(0.7).stroke();
      y += 8;

      /*
        A ALTURA DE CADA LINHA É MEDIDA ANTES DE DESENHAR, com
        `heightOfString`. Confiar no `doc.y` depois de dois `text()` com x/y
        explícitos não funciona — a primeira versão escreveu os sete termos
        empilhados dentro das descrições, porque o cursor não avançou o que eu
        supus. Medir é a única forma de duas colunas ficarem alinhadas.
      */
      const LARGURA_TERMO = 118;
      const LARGURA_TEXTO = LARGURA - LARGURA_TERMO - 10;
      for (const [termo, texto] of LEGENDA) {
        doc.font('Helvetica-Bold').fontSize(8.5);
        const hTermo = doc.heightOfString(termo, { width: LARGURA_TERMO });
        doc.font('Helvetica').fontSize(8);
        const hTexto = doc.heightOfString(texto, { width: LARGURA_TEXTO });
        const altura = Math.max(hTermo, hTexto);

        if (y + altura > doc.page.height - 80) {
          doc.addPage();
          cabecalho();
          y = 96;
        }
        doc
          .fillColor(ROTULO)
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .text(termo, L, y, { width: LARGURA_TERMO });
        doc
          .fillColor(SECUNDARIO)
          .font('Helvetica')
          .fontSize(8)
          .text(texto, L + LARGURA_TERMO + 10, y, { width: LARGURA_TEXTO });
        y += altura + 6;
      }

      /* -------------------------------------------------------- tabela ---- */
      y += 6;
      if (y > doc.page.height - 200) {
        doc.addPage();
        cabecalho();
        y = 96;
      }
      doc.fillColor(TEXTO).font('Times-Bold').fontSize(12).text('Os entes, do mais restrito ao mais folgado', L, y);
      y = doc.y + 6;

      /* Colunas: nome | pessoal % | situação | folga | saúde % | nossa presença */
      const COL = [L, L + 168, L + 224, L + 300, L + 382, L + 432];
      const cabecalhoTabela = () => {
        doc.fillColor(SECUNDARIO).font('Helvetica-Bold').fontSize(7);
        doc.text('ENTE', COL[0], y);
        doc.text('PESSOAL', COL[1], y, { width: 50, align: 'right' });
        doc.text('SITUAÇÃO', COL[2], y);
        doc.text('CABE AINDA', COL[3], y, { width: 74, align: 'right' });
        doc.text('SAÚDE', COL[4], y, { width: 44, align: 'right' });
        doc.text('NOSSA PRESENÇA', COL[5], y, { width: R - COL[5], align: 'right' });
        y += 11;
        doc.moveTo(L, y).lineTo(R, y).strokeColor(FILETE).lineWidth(0.7).stroke();
        y += 5;
      };
      cabecalhoTabela();

      const dinheiro = (n: number) =>
        Math.abs(n) >= 1e6 ? `R$ ${numeroBR(n / 1e6, 1)} mi` : `R$ ${numeroBR(n / 1e3, 0)} mil`;
      const pct = (n: number | null) => (n === null ? '—' : `${numeroBR(n, 2)}%`);

      for (const l of linhas) {
        if (y > doc.page.height - 90) {
          doc.addPage();
          cabecalho();
          y = 96;
          cabecalhoTabela();
        }
        const nome =
          l.esfera === 'M' ? `${l.nome}/${l.uf}` : l.esfera === 'E' ? `Governo do Estado — ${l.nome}` : l.nome;

        doc.fillColor(TEXTO).font('Helvetica').fontSize(8).text(nome, COL[0], y, { width: 164, ellipsis: true });
        doc
          .fillColor(COR_SITUACAO[l.situacao])
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(pct(l.pct), COL[1], y, { width: 50, align: 'right' });
        doc
          .fillColor(COR_SITUACAO[l.situacao])
          .font('Helvetica')
          .fontSize(7.5)
          .text(ROTULO_SITUACAO[l.situacao], COL[2], y, { width: 72, ellipsis: true });
        doc
          .fillColor(l.folga !== null && l.folga < 0 ? VERMELHO : TEXTO)
          .font('Helvetica')
          .fontSize(8)
          .text(
            l.folga === null ? '—' : l.folga >= 0 ? dinheiro(l.folga) : `${dinheiro(-l.folga)} acima`,
            COL[3],
            y,
            { width: 74, align: 'right' },
          );
        doc
          .fillColor(TEXTO)
          .font('Helvetica')
          .fontSize(8)
          .text(pct(l.saudePct), COL[4], y, { width: 44, align: 'right' });
        const presenca = [
          l.filiados ? `${l.filiados} filiados` : '',
          l.processos ? `${l.processos} processos` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        doc
          .fillColor(SECUNDARIO)
          .font('Helvetica')
          .fontSize(7.5)
          .text(presenca || '—', COL[5], y, { width: R - COL[5], align: 'right' });

        y += 13;
        doc.moveTo(L, y - 3).lineTo(R, y - 3).strokeColor('#F3F4F6').lineWidth(0.5).stroke();
      }

      if (!linhas.length) {
        doc
          .fillColor(SECUNDARIO)
          .font('Helvetica-Oblique')
          .fontSize(9)
          .text(
            'Nenhum ente com vínculo ainda. Use "Ligar cadastros" e "Atualizar do Tesouro" na tela de Municípios.',
            L,
            y,
            { width: LARGURA },
          );
        y = doc.y;
      }

      /* ----------------------------------------------------- ressalvas ---- */
      y += 12;
      if (y > doc.page.height - 150) {
        doc.addPage();
        cabecalho();
        y = 96;
      }
      doc.fillColor(TEXTO).font('Times-Bold').fontSize(11).text('O que este relatório NÃO afirma', L, y);
      y = doc.y + 5;
      const RESSALVAS = [
        'A coluna Saúde é a fatia da despesa na função Saúde, não o mínimo constitucional de 15% — as bases de cálculo são diferentes.',
        'Os valores da coluna Saúde e a fatia são acumulados dentro do ano: só compare entes medidos no mesmo bimestre.',
        'Processos são contados pela COMARCA (o município do órgão julgador), não pelo endereço da parte contrária. A ação contra o Município de Ilha Grande tramita em Parnaíba.',
        '"Cabe ainda" é a distância até o teto legal, não uma promessa de caixa disponível. Ela derruba a alegação de impedimento fiscal; não prova capacidade de pagamento.',
        'Os números são declarações do próprio ente ao Tesouro. Onde a declaração não fecha, o relatório diz isso em vez de exibir o percentual.',
      ];
      for (const r of RESSALVAS) {
        doc.fillColor(SECUNDARIO).font('Helvetica').fontSize(7.5).text(`•  ${r}`, L, y, { width: LARGURA });
        y = doc.y + 3;
      }

      y += 6;
      doc
        .fillColor(SECUNDARIO)
        .font('Helvetica-Oblique')
        .fontSize(7)
        .text(
          'Fontes: IBGE — Localidades (catálogo de municípios); SICONFI / Tesouro Nacional — RGF Anexo 01 (despesa com pessoal) ' +
            'e RREO Anexo 02 (despesa por função). Dados públicos, consultáveis em siconfi.tesouro.gov.br.',
          L,
          y,
          { width: LARGURA },
        );

      carimbarRodape(doc, RODAPE, { numerarPaginas: true });
      doc.end();
    });
  }
}
