import { QrCodeService, StorageService, mascararCpf, proximoSequencial } from '@core/infra';
import { anoBR, daquiAUmAnoBR, formatarDataBR } from '../../modules/processos/utils/data-br.util';
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  conteudoDisposto, nomeDeArquivo, type DocumentoGerado,
} from '@core/infra';
import PDFDocument from 'pdfkit';
import {
  Prisma,
  SituacaoFiliado,
  StatusCarteirinha,
  TipoHistoricoFiliado,
  TipoPessoa,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { lerLogoDaMarca } from '../../common/assets.util';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  campoVisivel,
  contatosEmLinha,
  enderecoEmLinha,
  tenant,
} from '../../tenant/tenant.config';
import { coresDaCarteirinha } from './cor-da-carteirinha.util';
import { buscarAssinatura } from './assinatura-do-presidente.util';
import {
  ROTULO_SITUACAO_FILIADO,
  categoriaDoCartao,
  iniciaisDoNome,
  nomeParaCartao,
} from './rotulos-do-cartao.util';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/*
  AS CORES SÃO DA CASA, NÃO DO SENATEPI (24/09/2026).

  Estavam cravadas aqui — e com elas o nome, duas linhas abaixo. A carteirinha
  do SINDSERM sairia VERDE, com o nome do sindicato dos enfermeiros. Ver
  `cor-da-carteirinha.util`: as duas saem de `tenant.corInstitucional`, e o tom
  claro derivado reproduz o par que estava à mão (#1B7F0A → #5E9F4D, contra o
  #4FA11B de antes).
*/
const { forte: COR_FORTE, clara: COR_CLARA } = coresDaCarteirinha(tenant.corInstitucional);

/** O prefixo do número da carteirinha — o mesmo desde a carga de 03/07/2026. */
const PREFIXO_CARTEIRINHA = 'CART';
/** Quantas vezes recalcular o número antes de desistir, na corrida. */
const TENTATIVAS_NUMERO = 3;

@Injectable()
export class CarteirinhasService {
  private readonly logger = new Logger(CarteirinhasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly storage: StorageService,
  ) {}

  /**
   * A CARTEIRINHA EXISTE QUANDO ALGUÉM PRECISA DELA — não quando alguém clica.
   *
   * "O QUE É ESSE 'EMITIR CARTEIRINHA'? ISSO NÃO É UM RETRABALHO PARA A
   * SECRETARIA DO SINDICATO?" — o dono, 25/09/2026. É, e a medição dá a ele:
   *
   *   ativos ...................... 5.810
   *   já tinham carteirinha ....... 5.642  (todas na carga de 03/07/2026)
   *   sem carteirinha ................ 168  (2,9%)
   *   emitidas depois da carga ......... 1
   *
   * Um passo manual que servia a 2,9% das pessoas e, para elas, TRAVAVA o
   * documento até alguém lembrar de clicar. E o clique não decide nada: o
   * cartão não carrega um único dado que o cadastro já não tenha — "emitir" só
   * criava o número e a validade, que o sistema sabe gerar sozinho.
   *
   * Agora a carteirinha nasce na hora em que o PDF é pedido, pela secretaria ou
   * pelo próprio filiado no portal. E RENOVA sozinha quando vence: um cartão
   * vencido na mão de quem está em dia é defeito nosso, não dela.
   *
   * O NÚMERO NUNCA MUDA na renovação. Ele é a identidade do cartão no histórico
   * e na conferência; trocá-lo faria a carteirinha de dezembro não ser a mesma
   * de janeiro para ninguém que tivesse anotado.
   */
  async garantirCarteirinha(filiadoId: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: { id: true, situacao: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');

    const existente = await this.prisma.carteirinha.findUnique({ where: { filiadoId } });

    if (existente) {
      const vencida = !!existente.validaAte && existente.validaAte < new Date();
      /*
        RENOVA SÓ PARA QUEM ESTÁ ATIVO. Um cartão vencido de quem saiu do quadro
        continua vencido — e é o que ele deve dizer.
      */
      if (!vencida || filiado.situacao !== SituacaoFiliado.ATIVO) return existente;

      const renovada = await this.prisma.carteirinha.update({
        where: { filiadoId },
        data: { validaAte: daquiAUmAnoBR(), status: StatusCarteirinha.ATIVA },
      });
      await this.prisma.filiadoHistorico.create({
        data: {
          filiadoId,
          tipo: TipoHistoricoFiliado.GERACAO_CARTEIRINHA,
          descricao: `Carteirinha ${renovada.numero} renovada automaticamente (estava vencida).`,
        },
      });
      return renovada;
    }

    if (filiado.situacao !== SituacaoFiliado.ATIVO)
      throw new BadRequestException('Carteirinha só pode ser emitida para filiado ATIVO');

    /* Um ano pelo calendário DAQUI — `setFullYear` lê o relógio do contêiner,
       que às 21h de 31/12 já virou o ano. Ver `daquiAUmAnoBR`. */
    const carteirinha = await this.comNumeroLivre((numero) =>
      this.prisma.carteirinha.create({
        data: {
          filiadoId,
          numero,
          validaAte: daquiAUmAnoBR(),
          status: StatusCarteirinha.ATIVA,
        },
      }),
    );

    await this.prisma.filiadoHistorico.create({
      data: {
        filiadoId,
        tipo: TipoHistoricoFiliado.GERACAO_CARTEIRINHA,
        descricao: `Carteirinha digital emitida (${carteirinha.numero}).`,
      },
    });
    return carteirinha;
  }

  /**
   * O NOME ANTIGO, mantido de propósito.
   *
   * A rota `POST /emitir` continua existindo porque, durante a janela de troca
   * do deploy, o contêiner ANTIGO do web ainda a chama — e receber 404 ali faria
   * a carteirinha falhar justamente para quem tentasse baixá-la nesse minuto.
   * Hoje ela é idempotente e não é mais chamada por tela nenhuma.
   */
  async emitir(filiadoId: string) {
    return this.garantirCarteirinha(filiadoId);
  }

  /**
   * O PRÓXIMO NÚMERO DE CARTEIRINHA — e por que ele não é `count() + 1`.
   *
   * 24/09/2026: *"Emitir carteirinha também não acontece nada."* O que
   * acontecia era **HTTP 500**, e o log dizia
   * `Unique constraint failed on the fields: (numero)`.
   *
   * O número saía de `count() + 1`. Medido na produção: há **5.654**
   * carteirinhas, mas a maior é **CART-2026-007166** — a carga de 03/07 numerou
   * pela matrícula, com buracos. `count() + 1` dava `CART-2026-005655`, que já
   * existe. E o defeito **nunca se corrige sozinho**: o `create` falha, nada é
   * gravado, o `count()` não muda e a próxima tentativa colide igual. Emitir
   * carteirinha estava quebrado para os 173 ativos que ainda não tinham uma.
   *
   * É LETRA POR LETRA O INCIDENTE DA MATRÍCULA DE 14/08/2026 — `gerarMatricula(
   * 'SEN', count() + 1)` parou o cadastro um dia inteiro. A correção de lá
   * (`proximoSequencial`, que olha a MAIOR já emitida) tem teste próprio; aqui
   * ela é reusada em vez de reescrita, junto com a reação à corrida.
   *
   * Números fora do padrão não empurram o contador — é o que `proximoSequencial`
   * garante, e é o que impede um "CART-antigo-9999" da carga legada de saltar a
   * numeração.
   */
  private async proximoNumero(): Promise<string> {
    const emitidas = await this.prisma.carteirinha.findMany({
      where: { numero: { startsWith: `${PREFIXO_CARTEIRINHA}-` } },
      select: { numero: true },
    });
    const seq = proximoSequencial(PREFIXO_CARTEIRINHA, emitidas.map((c) => c.numero));
    return `${PREFIXO_CARTEIRINHA}-${anoBR()}-${String(seq).padStart(6, '0')}`;
  }

  /**
   * Cria com um número livre, reagindo à CORRIDA.
   *
   * Duas emissões simultâneas leem a mesma "maior emitida" e disputam o mesmo
   * número; o índice único recusa a segunda. A segunda recalcula e tenta de
   * novo, em vez de virar 500 na cara de quem clicou. O limite existe para que
   * um defeito DIFERENTE não vire laço infinito — e aí o erro sobe traduzido.
   */
  private async comNumeroLivre<T>(criar: (numero: string) => Promise<T>): Promise<T> {
    for (let tentativa = 1; tentativa <= TENTATIVAS_NUMERO; tentativa++) {
      const numero = await this.proximoNumero();
      try {
        return await criar(numero);
      } catch (e) {
        const colidiu =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          String((e.meta?.target as string[] | undefined)?.join(',') ?? '').includes('numero');
        if (!colidiu || tentativa === TENTATIVAS_NUMERO) {
          if (colidiu) {
            throw new ConflictException(
              'O número de carteirinha gerado já está em uso. Tente de novo; ' +
                'se persistir, avise o suporte (numeração fora de sincronia).',
            );
          }
          throw e;
        }
        this.logger.warn(
          `Carteirinha ${numero} foi tomada por outra emissão simultânea; ` +
            `tentativa ${tentativa + 1} de ${TENTATIVAS_NUMERO}.`,
        );
      }
    }
    throw new ConflictException('Não foi possível gerar o número da carteirinha.');
  }

  /** Dados para a versão mobile/JSON da carteirinha. */
  async dados(filiadoId: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      include: { carteirinha: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');
    if (!filiado.carteirinha)
      throw new NotFoundException(
        'Este filiado ainda não tem carteirinha — ela nasce ao baixar o PDF.',
      );

    const payload = this.qr.montarPayload(filiado.id, TipoPessoa.FILIADO, filiado.qrToken);
    const fotoUrl = filiado.fotoKey
      ? await this.storage.getSignedUrl(filiado.fotoKey).catch(() => null)
      : null;

    return {
      nome: filiado.nomeCompleto,
      cpfMascarado: mascararCpf(filiado.cpf),
      matricula: filiado.matricula,
      categoria: filiado.formacao,
      numero: filiado.carteirinha.numero,
      emitidaEm: filiado.carteirinha.emitidaEm,
      validaAte: filiado.carteirinha.validaAte,
      status: filiado.carteirinha.status,
      fotoUrl,
      qrImagem: await this.qr.gerarImagemDataUrl(payload),
    };
  }

  /**
   * Gera o PDF da carteirinha (formato cartão, estilo institucional).
   *
   * Devolve o NOME junto com o conteúdo. O controller sozinho só tem o id, e o
   * nome do arquivo saía `carteirinha-<uuid>.pdf` — doze carteirinhas baixadas
   * numa tarde viravam doze arquivos indistinguíveis na pasta. Quem já carregou
   * o filiado para desenhar o cartão é quem sabe como ele se chama.
   */
  async gerarPdf(filiadoId: string): Promise<DocumentoGerado> {
    /*
      NASCE AQUI SE PRECISAR. Antes, pedir o PDF de quem não tinha carteirinha
      devolvia 404 "Carteirinha não emitida" — uma parede para 168 pessoas, com
      a saída escondida atrás de outro botão, noutro canto da ficha.
    */
    const carteirinha = await this.garantirCarteirinha(filiadoId);
    const filiado = await this.prisma.filiado.findUnique({ where: { id: filiadoId } });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');
    const payload = this.qr.montarPayload(filiado.id, TipoPessoa.FILIADO, filiado.qrToken);
    const qrImagem = await this.qr.gerarImagemDataUrl(payload);
    const fotoBuffer = filiado.fotoKey ? await this.storage.getBuffer(filiado.fotoKey) : null;
    /*
      A assinatura da presidência é a mesma que o carnê já imprime. Buscar pode
      falhar de várias formas e nenhuma delas derruba o cartão — ver as travas
      em `assinatura-do-presidente.util`.
    */
    const cfg = await this.prisma.configuracaoSindicato.findFirst({
      select: { assinaturaPresidenteUrl: true },
    });
    const assinatura = await buscarAssinatura(cfg?.assinaturaPresidenteUrl);

    // Dimensões do cartão (paisagem). As DUAS faces têm o mesmo tamanho.
    const W = 520;
    const H = 320;
    const PANEL = 150; // largura do painel colorido da frente
    const x = 24;
    const util = W - PANEL - 40; // largura de texto da frente
    /*
      A DATA DE FILIAÇÃO É `dataFiliacao`, E SÓ ELA.

      O cartão vinha de `aprovadoEm ?? createdAt`, e isso está errado de duas
      formas medidas na produção:

        divergem de `dataFiliacao` .......... 1.015 ativos
        sairiam como "desde 2026" ........... 1.999 ativos
        ano real mais comum ................. 2010, 2013, 2011

      `createdAt` acumula dois significados desde a carga legada (ver o comentário
      do campo no schema), e `aprovadoEm` é a aprovação do cadastro, não a entrada
      no quadro. Num cartão de sócio a ANTIGUIDADE é metade do que o documento
      diz: imprimir 2026 para quem é filiado desde 2010 é errar justamente o que
      a pessoa mostraria com orgulho.

      E QUANDO NÃO SE SABE (908 ativos vieram da planilha sem a data), a linha
      simplesmente NÃO SAI — a grade é montada com o que existe. Inventar uma
      data seria pior do que omitir.
    */
    const dataFiliacao = filiado.dataFiliacao ? formatarDataBR(filiado.dataFiliacao) : null;
    const mostraFormacao = campoVisivel('formacao');
    const mostraCoren = campoVisivel('numeroCoren');

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: [W, H], margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      /** Rótulo pequeno em cima, valor em negrito embaixo — as duas faces usam. */
      const campo = (label: string, valor: string, cx: number, cy: number, w = 220) => {
        doc.fillColor(COR_CLARA).font('Helvetica').fontSize(6.5).text(label.toUpperCase(), cx, cy);
        doc
          .fillColor('#111827')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(valor || '—', cx, cy + 9, { width: w, height: 13, ellipsis: true });
      };

      // ==================== FRENTE ====================
      /*
        A FRENTE É A IDENTIDADE: quem é, de que categoria, até quando vale.

        Tudo o que é conferência — CPF, RG, nascimento, base legal, assinatura —
        foi para o verso. O cartão antigo tinha NOVE campos, a assinatura e o QR
        na mesma face, e nenhum deles respirava.
      */
      doc.rect(0, 0, W, H).fill('#FFFFFF');
      doc.rect(0, 0, W - PANEL, 8).fill(COR_CLARA);

      doc.fillColor(COR_FORTE).font('Helvetica-Bold').fontSize(13);
      doc.text(tenant.nomeCurto, x, 26, { width: util, height: 32, ellipsis: true });
      doc.moveTo(x, 64).lineTo(W - PANEL - 16, 64).strokeColor('#D1D5DB').lineWidth(1).stroke();
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('CARTEIRA DE ASSOCIADO', x, 72);

      /*
        O NOME EM CORPO 14, maior que qualquer outra coisa da face. Só encurta
        para primeiro + último quando o nome inteiro não couber na linha — medir
        antes é mais honesto do que reduzir a fonte até o nome ficar menor que a
        matrícula, num documento cuja razão de existir é dizer quem a pessoa é.
      */
      doc.fillColor(COR_CLARA).font('Helvetica').fontSize(6.5).text('NOME', x, 104);
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827');
      const nome = nomeParaCartao(filiado.nomeCompleto, (t) => doc.widthOfString(t) <= util);
      doc.text(nome, x, 114, { width: util, height: 20, ellipsis: true });

      /*
        A GRADE SE MONTA COM O QUE O CLIENTE TEM, em vez de dois desenhos fixos.

        O SENATEPI mostra categoria e COREN; o SINDSERM oculta os dois — são
        servidores municipais de toda espécie, sem categoria profissional única
        e sem conselho de classe. Montando a lista e distribuindo depois, a face
        fica cheia nos dois casos, e um cliente novo não precisa de mais um
        `else` para não sair com um buraco no meio do cartão.
      */
      const validade = carteirinha.validaAte
        ? formatarDataBR(carteirinha.validaAte)
        : 'Indeterminada';
      const grade: Array<Array<[string, string]>> = [];
      if (mostraFormacao) {
        grade.push([['Categoria', categoriaDoCartao(filiado.formacao, filiado.formacaoOutro)]]);
      }
      grade.push([
        ['Matrícula', filiado.matricula],
        ['Válida até', validade],
      ]);
      const ultima: Array<[string, string]> = [];
      if (dataFiliacao) ultima.push(['Filiado(a) desde', dataFiliacao]);
      if (mostraCoren && filiado.numeroCoren) ultima.push(['COREN', filiado.numeroCoren]);
      else if (filiado.cidade) ultima.push(['Município', filiado.cidade]);
      if (ultima.length) grade.push(ultima);

      /*
        A GRADE FICA CENTRADA NA FAIXA, não ancorada no topo.

        O SENATEPI enche três linhas e o SINDSERM duas. Ancorada no topo, a face
        do SINDSERM ficava com 64pt de branco entre o último campo e a régua do
        rodapé — a mesma sensação de cartão inacabado que este desenho veio
        consertar. Centrar distribui a sobra dos dois lados.
      */
      const PASSO = 42;
      const TOPO = 148;
      const FAIXA = 106; // de TOPO até onde o último valor pode terminar
      const altura = (grade.length - 1) * PASSO + 22;
      const inicio = TOPO + Math.max(0, (FAIXA - altura) / 2);

      /* Linha só ocupa a largura inteira quando está sozinha nela. */
      grade.forEach((linha, i) => {
        const cy = inicio + i * PASSO;
        linha.forEach(([label, valor], j) => {
          const cw = linha.length === 1 ? util : j === 0 ? 170 : 150;
          campo(label, valor, x + j * 180, cy, cw);
        });
      });

      doc.moveTo(x, 276).lineTo(W - PANEL - 16, 276).strokeColor('#E5E7EB').lineWidth(1).stroke();
      doc
        .fillColor('#9CA3AF')
        .font('Helvetica')
        .fontSize(6.5)
        .text(
          `Nº ${carteirinha.numero}  ·  Emitida em ${formatarDataBR(carteirinha.emitidaEm)}  ·  Dados e assinatura no verso`,
          x,
          285,
          { width: util },
        );

      // ----- Painel lateral (colorido) -----
      doc.rect(W - PANEL, 0, PANEL, H).fill(COR_FORTE);

      const fw = 110;
      const fh = 132;
      const fx = W - PANEL + (PANEL - fw) / 2;
      const fy = 22;
      doc.save();
      doc.roundedRect(fx, fy, fw, fh, 6).clip();
      let fotoDesenhada = false;
      if (fotoBuffer) {
        try {
          doc.image(fotoBuffer, fx, fy, { width: fw, height: fh, align: 'center', valign: 'center' });
          fotoDesenhada = true;
        } catch {
          fotoDesenhada = false;
        }
      }
      if (!fotoDesenhada) {
        /*
          SEM FOTO, MONOGRAMA — não um retângulo cinza.

          MEDIDO: 1 de 5.810 filiados ativos tem foto. O desenho antigo pintava
          `#E5E7EB` num terço do cartão, e era esse o cartão de 5.809 pessoas.
          As iniciais sobre o branco parecem escolha; o buraco cinza parecia
          defeito de impressão.
        */
        doc.rect(fx, fy, fw, fh).fill('#FFFFFF');
        doc
          .fillColor(COR_FORTE)
          .font('Helvetica-Bold')
          .fontSize(44)
          .text(iniciaisDoNome(filiado.nomeCompleto), fx, fy + fh / 2 - 24, {
            width: fw,
            align: 'center',
          });
      }
      doc.restore();

      const logo = lerLogoDaMarca();
      let logoDesenhado = false;
      if (logo) {
        try {
          doc.image(logo, W - PANEL + 20, fy + fh + 12, {
            fit: [PANEL - 40, 30],
            align: 'center',
            valign: 'center',
          });
          logoDesenhado = true;
        } catch {
          logoDesenhado = false;
        }
      }
      if (!logoDesenhado) {
        doc
          .fillColor('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(22)
          .text(tenant.sigla, W - PANEL, fy + fh + 16, { width: PANEL, align: 'center' });
      }

      const qrSize = 86;
      const qx = W - PANEL + (PANEL - qrSize) / 2;
      /* +52 e não +44: com +44 a moldura branca do QR subia por cima do logo. */
      const qy = fy + fh + 52;
      doc.rect(qx - 5, qy - 5, qrSize + 10, qrSize + 10).fill('#FFFFFF');
      const qrBase64 = qrImagem.split(',')[1];
      doc.image(Buffer.from(qrBase64, 'base64'), qx, qy, { width: qrSize, height: qrSize });
      /*
        A LEGENDA EXISTE PARA NINGUÉM ESPERAR UM SITE. O código identifica a
        pessoa na leitura do sindicato (eventos, portaria); apontar a câmera do
        celular devolve o JSON assinado, e sem esta linha isso pareceria defeito.
      */
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica')
        .fontSize(5)
        .text('IDENTIFICAÇÃO INTERNA', W - PANEL, qy + qrSize + 9, {
          width: PANEL,
          align: 'center',
          characterSpacing: 0.6,
        });

      // ==================== VERSO ====================
      /*
        O VERSO É A CONFERÊNCIA: o que se compara com um documento na mão, a
        base legal do cartão, a assinatura de quem responde por ele e o endereço
        do sindicato. É a divisão que as duas referências fazem, e é a que os
        documentos de identificação usam há décadas.
      */
      doc.addPage({ size: [W, H], margin: 0 });
      doc.rect(0, 0, W, H).fill('#FFFFFF');
      doc.rect(0, 0, W, 8).fill(COR_CLARA);

      const vx = 28;
      const vutil = W - vx * 2;

      doc
        .fillColor(COR_FORTE)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('DADOS DO(A) ASSOCIADO(A)', vx, 26);
      doc
        .fillColor('#9CA3AF')
        .font('Helvetica')
        .fontSize(7)
        .text(`Nº ${carteirinha.numero}`, vx, 27, { width: vutil, align: 'right' });
      doc.moveTo(vx, 42).lineTo(W - vx, 42).strokeColor('#E5E7EB').lineWidth(1).stroke();

      const col = [vx, vx + 158, vx + 316];
      campo('CPF', mascararCpf(filiado.cpf), col[0], 54, 150);
      campo('RG', `${filiado.rg ?? '—'}${filiado.ufRg ? ' - ' + filiado.ufRg : ''}`, col[1], 54, 150);
      campo(
        'Nascimento',
        filiado.dataNascimento ? formatarDataBR(filiado.dataNascimento) : '—',
        col[2],
        54,
        140,
      );

      campo('Filiado(a) desde', dataFiliacao ?? '—', col[0], 94, 150);
      campo('Situação', ROTULO_SITUACAO_FILIADO[filiado.situacao], col[1], 94, 150);
      /*
        A TERCEIRA COLUNA MUDA COM O CLIENTE: o COREN é o registro profissional
        que identifica o enfermeiro e não existe no SINDSERM, que o oculta. Onde
        não existe, entra o município — que serve aos dois.
      */
      if (mostraCoren) {
        campo('COREN', filiado.numeroCoren ?? '—', col[2], 94, 140);
      } else {
        campo(
          'Município / UF',
          [filiado.cidade, filiado.estado].filter(Boolean).join(' / ') || '—',
          col[2],
          94,
          140,
        );
      }

      doc.moveTo(vx, 134).lineTo(W - vx, 134).strokeColor('#E5E7EB').lineWidth(1).stroke();
      doc
        .fillColor('#6B7280')
        .font('Helvetica')
        .fontSize(6.8)
        /*
          O QUE O CARTÃO AFIRMA TEM DE SER VERDADE NO PAPEL.

          A primeira versão desta frase dizia "a autenticidade pode ser conferida
          pelo QR Code impresso na frente". NÃO PODE: o QR carrega um JSON
          `{id, tipo, validacao}` assinado por HMAC — não é URL, não existe
          página pública que o resolva, e quem apontar a câmera vê um punhado de
          texto sem sentido. Frase impressa em cinco mil cartões não se corrige
          com um deploy.
        */
        .text(
          `Documento de identificação sindical emitido pelo ${tenant.sigla} nos termos do art. 8º da ` +
            'Constituição Federal. Válido mediante apresentação de documento oficial com foto. ' +
            'Em caso de perda, ou de dúvida sobre a validade, procure a secretaria do sindicato.',
          vx,
          144,
          { width: vutil, align: 'justify', lineGap: 1.5 },
        );

      // ----- Assinatura da presidência -----
      const larguraLinha = 190;
      const lx = (W - larguraLinha) / 2;
      const ly = 244;
      if (assinatura) {
        try {
          /*
            A imagem fica ACIMA da linha, não em cima dela: assinatura cruzando
            o próprio traço é o que fez o carnê parecer "colado". `fit` para
            nenhuma proporção esticar o traço de ninguém.
          */
          doc.image(assinatura, lx, ly - 50, {
            fit: [larguraLinha, 42],
            align: 'center',
            valign: 'bottom',
          });
        } catch {
          /* imagem ilegível: sobra a linha, que é o que o cartão sempre teve */
        }
      }
      doc.moveTo(lx, ly).lineTo(lx + larguraLinha, ly).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      doc
        .fillColor('#6B7280')
        .font('Helvetica')
        .fontSize(7)
        .text(`Presidência do ${tenant.sigla}`, lx, ly + 5, {
          width: larguraLinha,
          align: 'center',
        });

      /*
        ----- Rodapé institucional, em DUAS linhas -----

        `rodapeInstitucional()` junta endereço e contatos com " | " e serve bem
        a uma folha A4. Aqui a linha tem 464pt e o texto foi cortado justo no
        e-mail — o rodapé existe para dizer onde procurar o sindicato, e sem o
        contato ele não diz nada. Endereço em cima, contatos embaixo.
      */
      const alturaRodape = 26;
      doc.rect(0, H - alturaRodape, W, alturaRodape).fill(COR_FORTE);
      const contatos = contatosEmLinha();
      /* Sem contatos informados (é o caso do SINDSERM), a única linha centra. */
      const topoRodape = H - alturaRodape + (contatos ? 7 : 11);
      doc.fillColor('#FFFFFF').font('Helvetica').fontSize(5.5);
      doc.text(`DIRETORIA ${tenant.sigla} — ${enderecoEmLinha()}`, vx, topoRodape, {
        width: vutil,
        align: 'center',
        height: 8,
        ellipsis: true,
      });
      if (contatos) {
        doc.text(contatos, vx, topoRodape + 9, {
          width: vutil,
          align: 'center',
          height: 8,
          ellipsis: true,
        });
      }

      doc.end();
    });

    return {
      pdf,
      nomeArquivo: nomeDeArquivo(['Carteirinha', filiado.nomeCompleto], 'pdf'),
    };
  }
}

@ApiTags('carteirinhas')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('filiados/:filiadoId/carteirinha')
class CarteirinhasController {
  constructor(private readonly service: CarteirinhasService) {}

  @Post('emitir') @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  emitir(@Param('filiadoId') filiadoId: string) {
    return this.service.emitir(filiadoId);
  }

  @Get()
  dados(@Param('filiadoId') filiadoId: string) {
    return this.service.dados(filiadoId);
  }

  @Get('pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('filiadoId') filiadoId: string, @Res() res: Response) {
    const { pdf, nomeArquivo } = await this.service.gerarPdf(filiadoId);
    res.setHeader('Content-Disposition', conteudoDisposto(nomeArquivo));
    res.send(pdf);
  }
}

@Module({
  controllers: [CarteirinhasController],
  providers: [CarteirinhasService],
  exports: [CarteirinhasService],
})
export class CarteirinhasModule {}
