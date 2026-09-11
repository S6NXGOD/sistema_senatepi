import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { carimbarRodape } from '../../common/pdf-rodape.util';
import { tenant, rodapeInstitucional } from '../../tenant/tenant.config';
import { dataParaNome, nomeDeArquivo, type DocumentoGerado } from '@core/infra';
import { formatarDataHoraBR } from '../processos/utils/data-br.util';
import { folgaAtePrudencial, situacaoFiscal, PESO_SITUACAO, type SituacaoFiscal } from './leitura-fiscal.util';
import { coberturaDoCadastro, ondeAtuamos, presencaPorEnte, PRESENCA_VAZIA } from './presenca.util';
import {
  COR,
  COR_SITUACAO,
  desenharCabecalho,
  dinheiroBR,
  numeroBR,
  pctBR,
  ROTULO_SITUACAO,
  TOPO_DO_CONTEUDO,
  type Documento,
} from './pdf-contas.util';

/**
 * O RELATÓRIO DE CONTAS PÚBLICAS — o que a integração sabe, numa folha que se
 * leva para a reunião.
 *
 * POR QUE EM PAPEL, se a tela já mostra. Porque a tela é de quem tem login. A
 * diretoria discute em reunião, o advogado leva a pasta para a audiência, e a
 * assembleia recebe cópia.
 *
 * O QUE ELE FAZ DE DIFERENTE DA TELA: começa explicando as palavras. O papel
 * não tem tooltip, e quem lê pode nunca ter ouvido "limite prudencial".
 *
 * O QUE ELE NÃO FAZ: afirmar o que não dá para defender. Declaração
 * inconsistente aparece como inconsistente, a fatia da função Saúde vem com a
 * ressalva de que não é o mínimo constitucional, e a folga é medida até o
 * PRUDENCIAL — a coluna antiga ("cabe ainda") media até o teto e exagerava
 * justamente o espaço que a lei não dá.
 */

const RODAPE = rodapeInstitucional();

/**
 * A LEGENDA, em português de gente — é a razão de o relatório existir em papel.
 * Cada entrada responde "o que muda para nós", nunca "o que a sigla significa".
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
    'Fica em 95% do teto (51,3% nas prefeituras). A partir dele o art. 22 da LRF PROÍBE conceder aumento, criar cargo e contratar. Continuam permitidos a revisão geral anual (art. 37, X, da Constituição), o que decorre de sentença judicial ou de lei, e a reposição de aposentados e falecidos em saúde, educação e segurança.',
  ],
  [
    'Até o prudencial',
    'Quanto a folha ainda pode crescer antes de chegar ao limite prudencial, mantida a receita dos últimos 12 meses. É espaço legal, não dinheiro em caixa — e derruba a alegação de impedimento fiscal.',
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
    'Saúde',
    'A fatia da despesa que caiu na função Saúde, do Relatório Resumido da Execução Orçamentária (RREO). NÃO é o mínimo constitucional de 15%, que tem outra base de cálculo e sai num anexo que a API do Tesouro não publica.',
  ],
  [
    'Nossa presença',
    'Moram: filiados com endereço no município. Trabalham: filiados com vínculo numa organização ligada ao ente. Ações contra: processos do sindicato em que o ente, ou órgão dele, é réu.',
  ],
];

interface LinhaDoRelatorio {
  nome: string;
  uf: string;
  esfera: string;
  situacao: SituacaoFiscal;
  pct: number | null;
  /** Até o PRUDENCIAL, em reais. Negativo = passou dele. */
  folga: number | null;
  saudePct: number | null;
  moram: number;
  trabalham: number;
  acoesContra: number;
  organizacoes: number;
}

/**
 * "2.632 moram · 1 ação" — com singular e plural certos ("1 moram" saiu no
 * papel na primeira versão) e com a MESMA regra da tela (`frasesDaPresenca`):
 * organização só aparece quando ninguém mora nem trabalha ali, senão Palmeirais
 * — que está na lista por ter organização cadastrada — ficaria com um "—".
 */
export function presencaNoPapel(l: Pick<LinhaDoRelatorio, 'moram' | 'trabalham' | 'acoesContra' | 'organizacoes'>): string {
  return [
    l.moram ? `${numeroBR(l.moram, 0)} ${l.moram === 1 ? 'mora' : 'moram'}` : '',
    l.trabalham ? `${numeroBR(l.trabalham, 0)} ${l.trabalham === 1 ? 'trabalha' : 'trabalham'}` : '',
    l.acoesContra ? `${l.acoesContra} ${l.acoesContra === 1 ? 'ação' : 'ações'}` : '',
    !l.moram && !l.trabalham && l.organizacoes
      ? `${l.organizacoes} ${l.organizacoes === 1 ? 'organização' : 'organizações'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

@Injectable()
export class RelatorioEntesService {
  constructor(private readonly prisma: PrismaService) {}

  async gerar(): Promise<DocumentoGerado> {
    const [linhas, cobertura] = await Promise.all([this.reunir(), coberturaDoCadastro(this.prisma)]);
    const pdf = await this.desenhar(linhas, cobertura);
    return {
      pdf,
      nomeArquivo: nomeDeArquivo([tenant.sigla, 'contas publicas', dataParaNome()], 'pdf'),
    };
  }

  /**
   * SÓ ONDE O SINDICATO ATUA — o mesmo recorte da tela (`ondeAtuamos`), mais o
   * Governo do Estado da casa. O catálogo inteiro seriam 5.599 linhas de papel.
   */
  private async reunir(): Promise<LinhaDoRelatorio[]> {
    const presenca = await presencaPorEnte(this.prisma);
    const atuacao = [...ondeAtuamos(presenca)];
    const entes = await this.prisma.ente.findMany({
      where: {
        /* A União fica fora: o RGF dela vem em outro formato — ver `MunicipiosService.destaques`. */
        esfera: { not: 'U' },
        OR: [{ codigo: { in: atuacao } }, { esfera: 'E', uf: (tenant.endereco?.uf ?? '').toUpperCase() }],
      },
      include: {
        indicadoresPessoal: { orderBy: [{ exercicio: 'desc' }, { quadrimestre: 'desc' }], take: 1 },
        indicadoresSaude: { orderBy: [{ exercicio: 'desc' }, { bimestre: 'desc' }], take: 1 },
      },
    });

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
      const folga = leitura
        ? folgaAtePrudencial({ ...leitura, despesaPessoal: num(i?.despesaPessoal) }, situacao)
        : null;
      const p = presenca.get(e.codigo) ?? PRESENCA_VAZIA;
      return {
        nome: e.nome,
        uf: e.uf,
        esfera: e.esfera,
        situacao,
        pct: leitura?.percentualRcl ?? null,
        folga: folga?.valor ?? null,
        saudePct: num(s?.percentualDespesa),
        moram: e.esfera === 'M' ? p.moram : 0,
        trabalham: p.trabalham,
        acoesContra: p.acoesContra,
        organizacoes: p.organizacoes,
      };
    });

    /*
      A ORDEM É A DA URGÊNCIA, não a alfabética: quem restringe direito primeiro.
      Numa reunião ninguém lê a terceira página.
    */
    return linhas.sort(
      (a, b) =>
        PESO_SITUACAO[a.situacao] - PESO_SITUACAO[b.situacao] ||
        (b.pct ?? -1) - (a.pct ?? -1) ||
        a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }

  private async desenhar(
    linhas: LinhaDoRelatorio[],
    cobertura: { ativos: number; semCidade: number; comLocalDeTrabalho: number },
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc: Documento = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = doc.page.margins.left;
      const R = doc.page.width - doc.page.margins.right;
      const LARGURA = R - L;
      const novaPagina = () => {
        doc.addPage();
        desenharCabecalho(doc);
        return TOPO_DO_CONTEUDO;
      };

      desenharCabecalho(doc);
      let y = TOPO_DO_CONTEUDO;
      doc.fillColor(COR.TEXTO).font('Times-Bold').fontSize(17).text('Contas públicas — onde o sindicato atua', L, y);
      y += 24;
      doc
        .fillColor(COR.SECUNDARIO)
        .font('Helvetica')
        .fontSize(8.5)
        .text(
          `Prefeituras e Governo do Estado com quem o ${tenant.sigla} se relaciona, com o que cada um declarou ` +
            `ao Tesouro Nacional. Emitido em ${formatarDataHoraBR(new Date())}.`,
          L,
          y,
          { width: LARGURA },
        );
      y = doc.y + 14;

      /* ------------------------------------------------------- legenda ---- */
      doc.fillColor(COR.TEXTO).font('Times-Bold').fontSize(12).text('Como ler este relatório', L, y);
      y = doc.y + 4;
      doc.moveTo(L, y).lineTo(R, y).strokeColor(COR.FILETE).lineWidth(0.7).stroke();
      y += 8;

      /*
        A ALTURA DE CADA LINHA É MEDIDA ANTES DE DESENHAR, com `heightOfString`.
        Confiar no `doc.y` depois de dois `text()` lado a lado não funciona — a
        primeira versão escreveu os termos empilhados dentro das descrições.
      */
      const LARGURA_TERMO = 118;
      const LARGURA_TEXTO = LARGURA - LARGURA_TERMO - 10;
      for (const [termo, texto] of LEGENDA) {
        doc.font('Helvetica-Bold').fontSize(8.5);
        const hTermo = doc.heightOfString(termo, { width: LARGURA_TERMO });
        doc.font('Helvetica').fontSize(8);
        const hTexto = doc.heightOfString(texto, { width: LARGURA_TEXTO });
        const altura = Math.max(hTermo, hTexto);
        if (y + altura > doc.page.height - 80) y = novaPagina();
        doc.fillColor(COR.ROTULO).font('Helvetica-Bold').fontSize(8.5).text(termo, L, y, { width: LARGURA_TERMO });
        doc
          .fillColor(COR.SECUNDARIO)
          .font('Helvetica')
          .fontSize(8)
          .text(texto, L + LARGURA_TERMO + 10, y, { width: LARGURA_TEXTO });
        y += altura + 6;
      }

      /* -------------------------------------------------------- tabela ---- */
      y += 6;
      if (y > doc.page.height - 200) y = novaPagina();
      doc.fillColor(COR.TEXTO).font('Times-Bold').fontSize(12).text('Do mais restrito ao mais folgado', L, y);
      y = doc.y + 6;

      /*
        Colunas: ente | pessoal % | situação | até o prudencial | saúde % | nossa presença.
        A situação ganhou largura: "declaração não fecha" saía "declaração não…"
        na primeira impressão, e é justamente o rótulo que precisa ser lido inteiro.
      */
      const COL = [L, L + 146, L + 196, L + 276, L + 342, L + 384];
      const cabecalhoTabela = () => {
        doc.fillColor(COR.SECUNDARIO).font('Helvetica-Bold').fontSize(7);
        doc.text('ENTE', COL[0], y);
        doc.text('PESSOAL', COL[1], y, { width: 46, align: 'right' });
        doc.text('SITUAÇÃO', COL[2] + 4, y);
        /*
          O CABEÇALHO É MAIS LARGO QUE A COLUNA, alinhado pela direita: com a
          largura da coluna, "ATÉ O PRUDENCIAL" quebrava em duas linhas e a
          segunda passava por cima do filete e da primeira linha da tabela.
        */
        doc.text('ATÉ O PRUDENCIAL', COL[3] - 24, y, { width: 88, align: 'right', lineBreak: false });
        doc.text('SAÚDE', COL[4], y, { width: 38, align: 'right' });
        doc.text('NOSSA PRESENÇA', COL[5], y, { width: R - COL[5], align: 'right' });
        y += 11;
        doc.moveTo(L, y).lineTo(R, y).strokeColor(COR.FILETE).lineWidth(0.7).stroke();
        y += 5;
      };
      cabecalhoTabela();

      for (const l of linhas) {
        if (y > doc.page.height - 90) {
          y = novaPagina();
          cabecalhoTabela();
        }
        const nome =
          l.esfera === 'M' ? `${l.nome}/${l.uf}` : l.esfera === 'E' ? `Governo do Estado — ${l.nome}` : l.nome;
        const semNumero = l.situacao === 'INCONSISTENTE';

        doc.fillColor(COR.TEXTO).font('Helvetica').fontSize(8).text(nome, COL[0], y, { width: 142, ellipsis: true, height: 10 });
        doc
          .fillColor(COR_SITUACAO[l.situacao])
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(semNumero ? '—' : pctBR(l.pct), COL[1], y, { width: 46, align: 'right' });
        doc
          .fillColor(COR_SITUACAO[l.situacao])
          .font('Helvetica')
          .fontSize(7)
          .text(ROTULO_SITUACAO[l.situacao], COL[2] + 4, y + 0.5, { width: 76, ellipsis: true, height: 10 });
        doc
          .fillColor(l.folga !== null && l.folga < 0 ? COR.VERMELHO : COR.TEXTO)
          .font('Helvetica')
          .fontSize(8)
          .text(
            l.folga === null ? '—' : l.folga >= 0 ? dinheiroBR(l.folga) : `${dinheiroBR(-l.folga)} acima`,
            COL[3],
            y,
            { width: 64, align: 'right' },
          );
        doc
          .fillColor(COR.TEXTO)
          .font('Helvetica')
          .fontSize(8)
          .text(pctBR(l.saudePct), COL[4], y, { width: 38, align: 'right' });
        const presenca = presencaNoPapel(l);
        doc
          .fillColor(COR.SECUNDARIO)
          .font('Helvetica')
          .fontSize(7)
          .text(presenca || '—', COL[5], y + 0.5, { width: R - COL[5], align: 'right', ellipsis: true, height: 10 });

        y += 13;
        doc.moveTo(L, y - 3).lineTo(R, y - 3).strokeColor('#F3F4F6').lineWidth(0.5).stroke();
      }

      if (!linhas.length) {
        doc
          .fillColor(COR.SECUNDARIO)
          .font('Helvetica-Oblique')
          .fontSize(9)
          .text(
            'Nenhum ente com vínculo ainda. Use "Ligar cadastros" e "Atualizar do Tesouro" em Contas Públicas.',
            L,
            y,
            { width: LARGURA },
          );
        y = doc.y;
      }

      /* ----------------------------------------------------- ressalvas ---- */
      y += 12;
      if (y > doc.page.height - 150) y = novaPagina();
      doc.fillColor(COR.TEXTO).font('Times-Bold').fontSize(11).text('O que este relatório NÃO afirma', L, y);
      y = doc.y + 5;
      const comCidade = cobertura.ativos - cobertura.semCidade;
      const RESSALVAS = [
        'A coluna Saúde é a fatia da despesa na função Saúde, não o mínimo constitucional de 15% — as bases de cálculo são diferentes. E é acumulada no ano: só compare entes medidos no mesmo bimestre.',
        '"Até o prudencial" é espaço legal, não dinheiro em caixa. Usa a receita dos últimos 12 meses; como ela costuma crescer, a folga real tende a ser maior.',
        `Os contadores enxergam o que o cadastro diz: de ${numeroBR(cobertura.ativos, 0)} filiados ativos, ${numeroBR(comCidade, 0)} têm cidade e ${numeroBR(cobertura.comLocalDeTrabalho, 0)} têm o local de trabalho ligado a uma organização.`,
        'Ações que só TRAMITAM numa comarca não contam como presença: o fórum de uma cidade não diz nada sobre a prefeitura dela.',
        'Os números são declarações do próprio ente ao Tesouro. Onde a declaração não fecha, o relatório diz isso em vez de exibir o percentual.',
      ];
      for (const r of RESSALVAS) {
        doc.font('Helvetica').fontSize(7.5);
        const h = doc.heightOfString(`•  ${r}`, { width: LARGURA });
        if (y + h > doc.page.height - 60) y = novaPagina();
        doc.fillColor(COR.SECUNDARIO).text(`•  ${r}`, L, y, { width: LARGURA });
        y += h + 3;
      }

      y += 6;
      doc
        .fillColor(COR.SECUNDARIO)
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
