import {
  Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { conteudoDisposto } from '@core/infra';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrigemSincronizacao } from '@prisma/client';
import { MunicipiosService } from './municipios.service';
import { SiconfiSyncService } from './siconfi-sync.service';
import { VinculoDeEnteService } from './vinculo-de-ente.service';
import { RelatorioEntesService } from './relatorio-entes.service';
import { FichaDoEnteService } from './ficha-do-ente.service';
import {
  LigarCidadeDto,
  LigarOrganizacaoDto,
  ListarMunicipiosQueryDto,
  SincronizarSiconfiDto,
} from './dto/municipios.dto';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * CONTAS PÚBLICAS (módulo `municipios`).
 *
 * AUTORIZAÇÃO: só `@Modulo('municipios')`, e nada de `@Roles`. A matriz é a
 * única política — GET exige VISUALIZAR, POST exige EDITAR, e é a tela de
 * Usuários que decide quem tem cada nível. Um `@Roles` aqui seria uma segunda
 * autorização invisível, que já custou 71 rotas neste repositório.
 *
 * NÃO EXISTE DELETE, de propósito. O catálogo é do IBGE: apagar um município do
 * banco não o apaga do Brasil, só quebraria a ligação de quem mora lá.
 *
 * ORDEM DAS ROTAS: toda rota literal vem ANTES de `:codigo`. No Nest a primeira
 * que casa vence, e duas rotas que casam o mesmo caminho não dão erro — uma
 * SOME (já derrubou a ficha do processo neste repositório).
 */
@ApiTags('municipios')
@ApiBearerAuth()
@Modulo('municipios')
@Controller('municipios')
export class MunicipiosController {
  constructor(
    private readonly service: MunicipiosService,
    private readonly siconfi: SiconfiSyncService,
    private readonly vinculo: VinculoDeEnteService,
    private readonly relatorio: RelatorioEntesService,
    private readonly ficha: FichaDoEnteService,
  ) {}

  /** A lista: recorte, situação, ordem e a presença do sindicato em cada município. */
  @Get()
  listar(@Query() q: ListarMunicipiosQueryDto) {
    return this.service.listar(q);
  }

  /** Busca curta para seletor, atravessando as três esferas. */
  @Get('buscar')
  buscar(@Query('q') q?: string) {
    return this.service.buscar(q);
  }

  /**
   * O RELATÓRIO EM PDF — a folha que se leva para a reunião.
   *
   * `GET` e não `POST`: é leitura, não muda nada, e por isso basta VISUALIZAR
   * na matriz. Quem só consulta precisa poder imprimir. Com ponto no nome, que
   * `:codigo` casaria alegremente antes de o ParseIntPipe reclamar.
   */
  @Get('relatorio.pdf')
  @Header('Content-Type', 'application/pdf')
  async relatorioPdf(@Res() res: Response) {
    const { pdf, nomeArquivo } = await this.relatorio.gerar();
    res.setHeader('Content-Disposition', conteudoDisposto(nomeArquivo));
    res.send(pdf);
  }

  /** O Governo do Estado da casa e a União — bloco próprio na tela. */
  @Get('destaques')
  destaques() {
    return this.service.destaques();
  }

  /** Municípios de uma UF, para o seletor de cidade dos formulários. */
  @Get('por-uf')
  porUF(@Query('uf') uf?: string) {
    return this.service.porUF(uf);
  }

  /** O que ficou por ligar depois da varredura — com o palpite de cada grafia. */
  @Get('pendencias')
  pendencias() {
    return this.service.pendencias();
  }

  /** A ficha: identidade do IBGE, contas do Tesouro e a presença do sindicato. */
  @Get(':codigo')
  detalhe(@Param('codigo', ParseIntPipe) codigo: number) {
    return this.service.detalhe(codigo);
  }

  /**
   * A FICHA PARA A MESA DE NEGOCIAÇÃO — uma página sobre UM ente.
   *
   * O relatório geral responde "como estão todos"; esta responde a pergunta de
   * quem vai sentar com a prefeitura amanhã: pode dar aumento, quanto cabe, o
   * que a lei ainda permite mesmo no limite, e como ela está perto das vizinhas.
   * Leitura, então VISUALIZAR basta. Dois segmentos — não colide com `:codigo`.
   */
  @Get(':codigo/ficha.pdf')
  @Header('Content-Type', 'application/pdf')
  async fichaPdf(@Param('codigo', ParseIntPipe) codigo: number, @Res() res: Response) {
    const { pdf, nomeArquivo } = await this.ficha.gerar(codigo);
    res.setHeader('Content-Disposition', conteudoDisposto(nomeArquivo));
    res.send(pdf);
  }

  /**
   * Busca os indicadores no Tesouro agora. Exige EDITAR pela matriz — é o que
   * distingue consultar de mandar o sistema falar com fora.
   */
  @Post('sincronizar')
  sincronizar(@Body() dto: SincronizarSiconfiDto) {
    return this.siconfi.sincronizar(OrigemSincronizacao.MANUAL, dto.codigos);
  }

  /**
   * Refaz o casamento entre o texto livre do cadastro e o catálogo do IBGE.
   *
   * ESCREVE APENAS OS CAMPOS DERIVADOS (`municipio_codigo`/`municipio_origem`
   * e `ente_codigo`/`ente_origem`) — nunca nome, documento, endereço ou
   * qualquer coisa que uma pessoa tenha digitado. Isso importa para a
   * permissão: quem tem EDITAR aqui não ganha, por esta porta, o direito de
   * alterar um cadastro de filiado. E nunca encosta em ligação MANUAL.
   */
  @Post('casar-cadastros')
  async casar() {
    const [filiados, organizacoes] = await Promise.all([
      this.vinculo.casarFiliados(),
      this.vinculo.casarOrganizacoes(),
    ]);
    return { filiados, organizacoes };
  }

  /** "Monte Alegre" é Monte Alegre do Piauí — mesmo contrato dos campos derivados. */
  @Post('ligar-cidade')
  ligarCidade(@Body() dto: LigarCidadeDto, @CurrentUser('id') userId: string) {
    return this.service.ligarCidade(dto, userId);
  }

  /** "O HGV é do Estado do Piauí" — mesmo contrato dos campos derivados. */
  @Post('ligar-organizacao')
  ligarOrganizacao(@Body() dto: LigarOrganizacaoDto, @CurrentUser('id') userId: string) {
    return this.service.ligarOrganizacao(dto, userId);
  }
}
