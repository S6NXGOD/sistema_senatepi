import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { carimbarRodape } from '../../common/pdf-rodape.util';
import { rodapeInstitucional, tenant } from '../../tenant/tenant.config';
import { dataParaNome, nomeDeArquivo, type DocumentoGerado } from '@core/infra';
import { formatarDataHoraBR } from '../processos/utils/data-br.util';
import { MunicipiosService } from './municipios.service';
import type { Folga, SituacaoFiscal } from './leitura-fiscal.util';
import {
  COR,
  COR_SITUACAO,
  desenharCabecalho,
  dinheiroBR,
  nomeDoEnte,
  numeroBR,
  pctBR,
  TOPO_DO_CONTEUDO,
  type Documento,
} from './pdf-contas.util';

/**
 * A FICHA PARA A MESA DE NEGOCIAÇÃO — uma página sobre UM ente.
 *
 * O relatório geral responde "como estão todos". Esta responde a pergunta de
 * quem vai sentar com a prefeitura amanhã, na ordem em que a conversa acontece:
 *
 *  1. A LEI DEIXA DAR AUMENTO? — sim, não, ou não há resposta, em letras
 *     grandes. É a primeira alegação do outro lado.
 *  2. QUANTO CABE — a folga até o limite prudencial, em % da folha e em reais.
 *  3. O QUE DÁ PARA DIZER — frases que os números sustentam, e só essas. Mesmo
 *     no limite prudencial a LRF permite a revisão geral anual; a prefeitura
 *     costuma omitir, e a ficha não.
 *  4. COMO ESTÁ PERTO DOS VIZINHOS — a mediana do estado e da região.
 *  5. SAÚDE e NOSSA PRESENÇA ali.
 *
 * O QUE ELA NÃO FAZ: prometer dinheiro em caixa, ou chamar a fatia da função
 * Saúde de mínimo constitucional. Uma folha que o outro lado desmente em trinta
 * segundos derruba junto os números certos.
 */

export type DadosDaFicha = Awaited<ReturnType<MunicipiosService['detalhe']>>;

/** O que a ficha precisa do bloco fiscal, visto como um tipo só. */
interface FiscalDaFicha {
  situacao: SituacaoFiscal;
  explicacao: string;
  percentualRcl?: number | null;
  limiteMaximo?: number | null;
  limitePrudencial?: number | null;
  limiteAlerta?: number | null;
  exercicio?: number;
  quadrimestre?: number;
  folga?: Folga | null;
}

/**
 * A RESPOSTA CURTA — o que se lê de longe, antes de qualquer número.
 *
 * "PELOS LIMITES": a primeira versão dizia "SIM — a LRF não impede", e era
 * falso para o Governo do Piauí em setembro de 2026 — o art. 21 torna nulo o
 * aumento nos 180 dias antes do fim do mandato, dentro ou fora dos limites.
 * Ver `respostaDaFicha` e `avisoDoCalendario`.
 */
export const RESPOSTA: Record<SituacaoFiscal, string> = {
  REGULAR: 'SIM — os limites da LRF não impedem.',
  ALERTA: 'SIM — está em alerta, mas os limites não impedem.',
  PRUDENCIAL: 'NÃO, COM EXCEÇÕES — está no limite prudencial.',
  ACIMA_DO_TETO: 'NÃO, COM EXCEÇÕES — está acima do teto.',
  INCONSISTENTE: 'SEM RESPOSTA — a declaração do ente não fecha.',
  SEM_DADO: 'SEM RESPOSTA — o ente não publicou o relatório.',
  NAO_CONSULTADO: 'SEM RESPOSTA — o Tesouro ainda não foi consultado.',
};

const periodo = (q?: number, e?: number) => (q && e ? `${q}º quadrimestre de ${e}` : '');

/**
 * A RESPOSTA DESTE ENTE, HOJE — os limites e o calendário juntos.
 *
 * Dentro dos 180 dias do art. 21, "sim pelos limites" vira "só em parte": o
 * aumento concedido agora seria nulo. E a União não é lida por esta integração
 * — a resposta diz isso, em vez de acusá-la de não publicar.
 */
export function respostaDaFicha(d: DadosDaFicha): string {
  if (d.esfera === 'U') return 'SEM RESPOSTA — esta integração não lê a LRF da União.';
  const f = d.fiscal as FiscalDaFicha;
  if (d.calendario?.fimDeMandato && (f.situacao === 'REGULAR' || f.situacao === 'ALERTA')) {
    return 'SÓ EM PARTE — os limites não impedem; o fim do mandato, sim.';
  }
  return RESPOSTA[f.situacao];
}

/**
 * OS ARGUMENTOS QUE OS NÚMEROS SUSTENTAM — e nenhum a mais.
 *
 * Função separada do desenho para o teste cobrar o CONTEÚDO: é aqui que mora o
 * risco de a ficha afirmar algo indefensável. Cada frase só aparece quando o
 * dado que a sustenta existe.
 */
export function argumentosDaMesa(d: DadosDaFicha): string[] {
  const f = d.fiscal as FiscalDaFicha;
  const out: string[] = [];
  const temNumero = f.percentualRcl != null && f.situacao !== 'INCONSISTENTE';

  if (temNumero && f.folga && f.folga.valor >= 0) {
    out.push(
      `A folha pode crescer ${numeroBR(f.folga.percentualDaFolha, 1)}% — cerca de ${dinheiroBR(f.folga.valor)} em 12 meses — ` +
        `antes de chegar ao limite prudencial, mantida a receita dos últimos 12 meses.` +
        /*
          NO FIM DO MANDATO A FOLGA É DO PRÓXIMO GOVERNO. O art. 21 anula o
          aumento de agora e também o que deixa parcelas para depois da posse
          (inciso III) — a ficha não pode sugerir "assinar agora para pagar
          depois".
        */
        (d.calendario?.fimDeMandato ? ' Até a posse, porém, vale o art. 21: o espaço é do próximo governo.' : ''),
    );
    out.push(
      'Um reajuste só da categoria pesa bem menos que um reajuste da folha inteira: o espaço para ele é proporcionalmente maior.',
    );
  }

  if (f.situacao === 'PRUDENCIAL' || f.situacao === 'ACIMA_DO_TETO') {
    out.push(
      'Mesmo no limite, a LRF permite a revisão geral anual (art. 37, X, da Constituição) e o que decorre de sentença ' +
        'judicial ou de lei (art. 22, parágrafo único, I).',
    );
    out.push(
      'A reposição de aposentados e falecidos na saúde continua permitida (art. 22, parágrafo único, IV).',
    );
    if (f.folga && f.folga.valor < 0) {
      out.push(
        `Para sair da proibição, a folha teria de cair ${numeroBR(-f.folga.percentualDaFolha, 1)}% ` +
          `(${dinheiroBR(-f.folga.valor)} em 12 meses) — ou a receita crescer.`,
      );
    }
  }

  if (f.situacao === 'SEM_DADO') {
    out.push(
      'O ente não publicou o Relatório de Gestão Fiscal do período: deixar de publicar é, por si, uma irregularidade ' +
        'prevista na LRF — e ele não pode alegar um limite que não demonstrou.',
    );
  }
  if (f.situacao === 'INCONSISTENTE') {
    out.push(
      'A declaração enviada ao Tesouro não fecha (folha maior que a receita). O número não serve para nenhum dos dois lados até o ente retificar.',
    );
  }

  const c = d.comparacao;
  if (temNumero && c?.uf?.mediana != null) {
    const dif = (f.percentualRcl as number) - c.uf.mediana;
    const lado = Math.abs(dif) < 0.05 ? 'igual à' : dif < 0 ? 'abaixo da' : 'acima da';
    out.push(
      `Gasta ${pctBR(f.percentualRcl)} com pessoal — ${lado} mediana dos ${c.uf.n} municípios do ${c.uf.uf} com dado ` +
        `(${pctBR(c.uf.mediana)})${Math.abs(dif) >= 0.05 ? `, ${numeroBR(Math.abs(dif), 1)} ponto${Math.abs(dif) >= 1.95 ? 's' : ''} de diferença` : ''}.`,
    );
  }
  if (temNumero && c?.regiao?.mediana != null) {
    out.push(
      `Na região de ${c.regiao.nome}, a mediana dos ${c.regiao.n} municípios com dado é ${pctBR(c.regiao.mediana)}.`,
    );
  }
  return out;
}

@Injectable()
export class FichaDoEnteService {
  constructor(private readonly municipios: MunicipiosService) {}

  async gerar(codigo: number): Promise<DocumentoGerado> {
    const d = await this.municipios.detalhe(codigo);
    const pdf = await this.desenhar(d);
    return {
      pdf,
      nomeArquivo: nomeDeArquivo(
        [tenant.sigla, 'ficha de negociacao', d.nome, d.esfera === 'M' ? d.uf : '', dataParaNome()].filter(Boolean),
        'pdf',
      ),
    };
  }

  private desenhar(d: DadosDaFicha): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc: Documento = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = doc.page.margins.left;
      const R = doc.page.width - doc.page.margins.right;
      const LARGURA = R - L;
      const FIM = doc.page.height - 70;
      const f = d.fiscal as FiscalDaFicha;
      const temNumero = f.percentualRcl != null && f.situacao !== 'INCONSISTENTE';

      desenharCabecalho(doc);
      let y = TOPO_DO_CONTEUDO;

      /** Quebra a página se o próximo bloco não couber — e redesenha a faixa. */
      const garantir = (altura: number) => {
        if (y + altura > FIM) {
          doc.addPage();
          desenharCabecalho(doc);
          y = TOPO_DO_CONTEUDO;
        }
      };

      /** Um parágrafo medido ANTES de desenhar — ver o relatório geral sobre `doc.y`. */
      const paragrafo = (
        texto: string,
        o: { fonte?: string; tamanho?: number; cor?: string; x?: number; largura?: number; depois?: number } = {},
      ) => {
        const largura = o.largura ?? LARGURA;
        doc.font(o.fonte ?? 'Helvetica').fontSize(o.tamanho ?? 9);
        const h = doc.heightOfString(texto, { width: largura });
        garantir(h);
        doc.fillColor(o.cor ?? COR.TEXTO).text(texto, o.x ?? L, y, { width: largura });
        y += h + (o.depois ?? 4);
      };

      const titulo = (texto: string) => {
        garantir(40);
        y += 6;
        doc.fillColor(COR.TEXTO).font('Times-Bold').fontSize(12).text(texto, L, y);
        y += 16;
        doc.moveTo(L, y).lineTo(R, y).strokeColor(COR.FILETE).lineWidth(0.7).stroke();
        y += 6;
      };

      /* ---------------------------------------------------- identificação */
      paragrafo(nomeDoEnte(d), { fonte: 'Times-Bold', tamanho: 18, depois: 2 });
      const identidade = [
        'Ficha para a mesa de negociação',
        d.regiaoImediata ? `Região de ${d.regiaoImediata}` : '',
        d.populacao ? `${numeroBR(d.populacao, 0)} habitantes` : '',
        `emitida em ${formatarDataHoraBR(new Date())}`,
      ]
        .filter(Boolean)
        .join(' · ');
      paragrafo(identidade, { tamanho: 8.5, cor: COR.SECUNDARIO, depois: 12 });

      /* ------------------------------------------- 1. a lei deixa dar aumento? */
      {
        const resposta = respostaDaFicha(d);
        const aviso = d.calendario?.texto ?? null;
        const cor = resposta.startsWith('SÓ EM PARTE') ? COR.AMBAR : COR_SITUACAO[f.situacao];
        const PAD = 12;
        const largura = LARGURA - PAD * 2 - 4;
        doc.font('Helvetica-Bold').fontSize(15);
        const hResposta = doc.heightOfString(resposta, { width: largura });
        doc.font('Helvetica').fontSize(8.5);
        const hExplica = doc.heightOfString(f.explicacao, { width: largura });
        doc.font('Helvetica-Bold').fontSize(8.5);
        const hAviso = aviso ? doc.heightOfString(aviso, { width: largura }) + 6 : 0;
        const altura = PAD + 11 + hResposta + 6 + hExplica + hAviso + PAD;
        garantir(altura);
        doc.roundedRect(L, y, LARGURA, altura, 6).fill(COR.FUNDO);
        doc.rect(L, y, 4, altura).fill(cor);
        let yy = y + PAD;
        doc
          .fillColor(COR.SECUNDARIO)
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text('A LEI DE RESPONSABILIDADE FISCAL DEIXA DAR AUMENTO?', L + PAD + 4, yy, { width: largura });
        yy += 11;
        doc.fillColor(cor).font('Helvetica-Bold').fontSize(15).text(resposta, L + PAD + 4, yy, { width: largura });
        yy += hResposta + 6;
        doc.fillColor(COR.ROTULO).font('Helvetica').fontSize(8.5).text(f.explicacao, L + PAD + 4, yy, { width: largura });
        /* O calendário, dentro da mesma caixa: é parte da resposta, não rodapé. */
        if (aviso) {
          yy += hExplica + 6;
          doc.fillColor(COR.AMBAR).font('Helvetica-Bold').fontSize(8.5).text(aviso, L + PAD + 4, yy, { width: largura });
        }
        y += altura + 12;
      }

      /* ------------------------------------------------ 2. os números e a régua */
      if (temNumero) {
        const pct = f.percentualRcl as number;
        const caixas: Array<[string, string, string]> = [
          ['Gasto com pessoal', pctBR(pct), periodo(f.quadrimestre, f.exercicio)],
          ['Limite prudencial', pctBR(f.limitePrudencial), 'acima dele, aumento proibido'],
          ['Teto da LRF', pctBR(f.limiteMaximo), d.esfera === 'E' ? 'teto estadual' : 'teto municipal'],
          f.folga
            ? f.folga.valor >= 0
              ? ['Folga até o prudencial', `+${numeroBR(f.folga.percentualDaFolha, 1)}% da folha`, dinheiroBR(f.folga.valor)]
              : ['Acima do prudencial', `${numeroBR(f.folga.percentualDaFolha, 1)}% da folha`, dinheiroBR(-f.folga.valor)]
            : ['Folga até o prudencial', '—', ''],
        ];
        const GAP = 8;
        const w = (LARGURA - GAP * 3) / 4;
        garantir(52);
        caixas.forEach(([rot, val, nota], i) => {
          const x = L + i * (w + GAP);
          doc.roundedRect(x, y, w, 46, 4).lineWidth(0.7).strokeColor(COR.FILETE).stroke();
          doc.fillColor(COR.SECUNDARIO).font('Helvetica').fontSize(7).text(rot, x + 7, y + 6, { width: w - 14 });
          doc
            .fillColor(i === 0 ? COR_SITUACAO[f.situacao] : COR.TEXTO)
            .font('Helvetica-Bold')
            .fontSize(12)
            .text(val, x + 7, y + 16, { width: w - 14 });
          doc.fillColor(COR.SECUNDARIO).font('Helvetica').fontSize(6.5).text(nota, x + 7, y + 33, { width: w - 14, ellipsis: true, height: 10 });
        });
        y += 46 + 14;

        /* A régua vai até um pouco além do teto — o que importa é a distância aos limites. */
        const teto = f.limiteMaximo ?? 54;
        const escala = Math.max(teto * 1.15, pct * 1.05);
        const px = (v: number) => L + Math.min(1, v / escala) * LARGURA;
        garantir(34);
        doc.roundedRect(L, y, LARGURA, 9, 4.5).fill(COR.FILETE);
        doc.roundedRect(L, y, Math.max(9, px(pct) - L), 9, 4.5).fill(COR_SITUACAO[f.situacao]);
        /*
          AS MARCAS SEM RÓTULO EMBAIXO DE CADA UMA: os três limites ficam a
          dois ou três pontos um do outro (44,10 · 46,55 · 49,00 no Estado), e
          rótulos centrados em cada marca se atropelavam — a primeira versão
          imprimiu "alertapludencial49..." num borrão. A legenda vai numa linha
          só, na mesma ordem das marcas.
        */
        const marcas = [f.limiteAlerta, f.limitePrudencial, f.limiteMaximo].filter(
          (v): v is number => v != null,
        );
        for (const v of marcas) doc.rect(px(v) - 0.6, y - 3, 1.2, 15).fill(COR.ROTULO);
        const legenda = [
          f.limiteAlerta != null ? `alerta ${pctBR(f.limiteAlerta)}` : '',
          f.limitePrudencial != null ? `prudencial ${pctBR(f.limitePrudencial)}` : '',
          f.limiteMaximo != null ? `teto ${pctBR(f.limiteMaximo)}` : '',
        ]
          .filter(Boolean)
          .join('   ·   ');
        doc
          .fillColor(COR.SECUNDARIO)
          .font('Helvetica')
          .fontSize(7)
          .text(`Marcas na barra, da esquerda para a direita: ${legenda}`, L, y + 16, { width: LARGURA, align: 'right' });
        y += 32;
      }

      /* --------------------------------------------- 3. o que dá para dizer */
      const argumentos = argumentosDaMesa(d);
      if (argumentos.length) {
        titulo('O que os números sustentam na mesa');
        for (const a of argumentos) paragrafo(`•  ${a}`, { tamanho: 9, depois: 5 });
      }

      /* --------------------------------------------------------- 4. saúde */
      titulo('Orçamento da saúde');
      if (d.saude?.percentualDespesa != null) {
        const meses = d.saude.bimestre * 2;
        paragrafo(
          `${pctBR(d.saude.percentualDespesa)} da despesa liquidada foi para a função Saúde ` +
            `(${d.saude.bimestre}º bimestre de ${d.saude.exercicio}, acumulado de ${meses} meses)` +
            (d.saudePorHabitante != null ? ` — R$ ${numeroBR(d.saudePorHabitante, 2)} por habitante no período.` : '.'),
          { tamanho: 9 },
        );
        paragrafo(
          'É a fatia da despesa total na função Saúde. NÃO é o mínimo constitucional de 15%, que é calculado sobre a receita ' +
            'de impostos e sai num anexo que a API do Tesouro não publica. Valores em reais só se comparam entre entes no mesmo bimestre.',
          { tamanho: 7.5, cor: COR.SECUNDARIO },
        );
      } else {
        paragrafo(
          d.consultadoEm
            ? 'O ente não publicou o Relatório Resumido da Execução Orçamentária no período consultado.'
            : 'Os números da saúde ainda não foram buscados no Tesouro Nacional.',
          { tamanho: 9, cor: COR.SECUNDARIO },
        );
      }

      /* ------------------------------------------------ 5. nossa presença */
      titulo(`Nossa presença`);
      const p = d.presenca;
      /* Só o que existe vira frase — "0 trabalham · 0 ações" ocupa a linha para não dizer nada. */
      const partes = [
        d.esfera === 'M' && p.moram
          ? `${numeroBR(p.moram, 0)} ${p.moram === 1 ? 'filiado mora' : 'filiados moram'} no município`
          : '',
        p.trabalham
          ? `${numeroBR(p.trabalham, 0)} ${p.trabalham === 1 ? 'trabalha' : 'trabalham'} em órgão ligado a este ente (vínculo cadastrado)`
          : '',
        p.acoesContra
          ? `${numeroBR(p.acoesContra, 0)} ${p.acoesContra === 1 ? 'ação' : 'ações'} do sindicato contra ele`
          : '',
      ].filter(Boolean);
      paragrafo(
        partes.length
          ? partes.join(' · ') + '.'
          : 'O cadastro ainda não liga nenhum filiado nem ação do sindicato a este ente.',
        { tamanho: 9 },
      );
      if (d.organizacoes.length) {
        paragrafo(
          `Órgãos do cadastro ligados a ele: ${d.organizacoes
            .slice(0, 8)
            .map((o) => o.nomeFantasia || o.nome)
            .join('; ')}${d.organizacoes.length > 8 ? '…' : ''}.`,
          { tamanho: 8, cor: COR.ROTULO },
        );
      }
      if (d.cobertura.ativos > 0) {
        paragrafo(
          `Os contadores enxergam o que o cadastro diz: de ${numeroBR(d.cobertura.ativos, 0)} filiados ativos, ` +
            `${numeroBR(d.cobertura.ativos - d.cobertura.semCidade, 0)} têm cidade e ${numeroBR(d.cobertura.comLocalDeTrabalho, 0)} ` +
            `têm o local de trabalho ligado a uma organização.`,
          { tamanho: 7.5, cor: COR.SECUNDARIO },
        );
      }

      /* -------------------------------------------------------- fontes */
      y += 6;
      paragrafo(
        'Fontes: IBGE — Localidades; SICONFI / Tesouro Nacional — RGF Anexo 01 (despesa com pessoal) e RREO Anexo 02 ' +
          '(despesa por função). São declarações do próprio ente, públicas e conferíveis em siconfi.tesouro.gov.br. ' +
          '"Folga" é espaço legal, não dinheiro em caixa; como a receita costuma crescer, a folga real tende a ser maior.',
        { fonte: 'Helvetica-Oblique', tamanho: 7, cor: COR.SECUNDARIO },
      );

      carimbarRodape(doc, rodapeInstitucional(), { numerarPaginas: true });
      doc.end();
    });
  }
}
