import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrigemSincronizacao } from '@prisma/client';
import { MunicipiosService } from './municipios.service';
import { SiconfiSyncService } from './siconfi-sync.service';
import { VinculoDeEnteService } from './vinculo-de-ente.service';
import { ListarMunicipiosQueryDto, SincronizarSiconfiDto } from './dto/municipios.dto';
import { Modulo } from '../../common/permissions/modulo.decorator';

/**
 * MUNICÍPIOS E INDICADORES PÚBLICOS.
 *
 * AUTORIZAÇÃO: só `@Modulo('municipios')`, e nada de `@Roles`. A matriz é a
 * única política — GET exige VISUALIZAR, POST exige EDITAR, e é a tela de
 * Usuários que decide quem tem cada nível. Um `@Roles` aqui seria uma segunda
 * autorização invisível, que já custou 71 rotas neste repositório.
 *
 * NÃO EXISTE DELETE, de propósito. O catálogo é do IBGE: apagar um município do
 * banco não o apaga do Brasil, só quebraria a ligação de quem mora lá. Corrigir
 * o catálogo é recarregar o arquivo, não excluir linha.
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
  ) {}

  /** Catálogo, com os indicadores e a presença do sindicato em cada município. */
  @Get()
  listar(@Query() q: ListarMunicipiosQueryDto) {
    return this.service.listar(q);
  }

  /**
   * Municípios de uma UF, para o seletor de cidade dos formulários.
   * Literal, portanto ANTES de `:codigo`.
   */
  /**
   * O Estado da casa e a União — os entes que não são município e que
   * merecem bloco próprio na tela. Literal, portanto ANTES de `:codigo`.
   */
  /**
   * Busca curta para seletor, atravessando as três esferas. Literal,
   * portanto ANTES de `:codigo`.
   */
  @Get('buscar')
  buscar(@Query('q') q?: string) {
    return this.service.buscar(q);
  }

  @Get('destaques')
  destaques() {
    return this.service.destaques();
  }

  @Get('por-uf')
  porUF(@Query('uf') uf?: string) {
    return this.service.porUF(uf);
  }

  /**
   * O que ficou por conferir depois da varredura.
   *
   * Literal também: no Nest a primeira rota que casa vence, e `:codigo`
   * engoliria a palavra "pendencias" — duas rotas iguais não dão erro, UMA
   * SOME (já derrubou a ficha do processo neste repositório).
   */
  @Get('pendencias')
  pendencias() {
    return this.service.pendencias();
  }

  /** A ficha: identidade do IBGE, contas do Tesouro e a base do sindicato ali. */
  @Get(':codigo')
  detalhe(@Param('codigo', ParseIntPipe) codigo: number) {
    return this.service.detalhe(codigo);
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
   * ESCREVE APENAS OS DOIS CAMPOS DERIVADOS (`municipio_codigo` e
   * `municipio_origem`) de filiados e organizações — nunca nome, documento,
   * endereço ou qualquer coisa que uma pessoa tenha digitado. Isso importa para
   * a permissão: quem tem EDITAR aqui não ganha, por esta porta, o direito de
   * alterar um cadastro de filiado.
   *
   * E nunca encosta em ligação marcada como MANUAL.
   */
  @Post('casar-cadastros')
  async casar() {
    const [filiados, organizacoes] = await Promise.all([
      this.vinculo.casarFiliados(),
      this.vinculo.casarOrganizacoes(),
    ]);
    return { filiados, organizacoes };
  }
}
