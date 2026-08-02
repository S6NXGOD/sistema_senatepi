import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Query, Req, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuditoriaContribuicoesService } from './auditoria-contribuicoes.service';
import {
  HomologarContribuicaoDto, ListarContribuicoesAdminQueryDto, RejeitarContribuicaoDto,
} from './dto/auditoria-contribuicao.dto';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Auditoria das contribuições patronais — aba "Empresas" da tela de Cobranças.
 *
 * Fica sob `@Modulo('cobrancas')` porque é onde a operação acontece: quem
 * confere pagamento de filiado é quem confere o da empresa. GET exige
 * VISUALIZAR e PATCH exige EDITAR, conforme a matriz de permissões.
 */
@ApiTags('cobrancas')
@ApiBearerAuth()
@Modulo('cobrancas')
@Controller('cobrancas/contribuicoes-patronais')
export class AuditoriaContribuicoesController {
  constructor(private readonly service: AuditoriaContribuicoesService) {}

  private ctx(req: Request, user?: AuthUser) {
    return { userId: user?.id, nome: user?.nome, ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get()
  @ApiOperation({ summary: 'Lista as contribuições declaradas pelas empresas' })
  listar(@Query() query: ListarContribuicoesAdminQueryDto) {
    return this.service.listar(query);
  }

  /** PDF/imagem exibido no visualizador lado a lado. */
  @Get(':id/documento/:tipo')
  async documento(
    @Param('id') id: string,
    @Param('tipo') tipo: string,
    @Res() res: Response,
  ) {
    if (tipo !== 'comprovante' && tipo !== 'relacao') {
      throw new BadRequestException('Documento inválido.');
    }
    const { buffer, contentType, nome } = await this.service.documento(id, tipo);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    // Folha de pagamento: dado pessoal de terceiros, sem cache compartilhado.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  @Patch(':id/homologar')
  @ApiOperation({ summary: 'Aprova a contribuição e lança a entrada no caixa' })
  homologar(
    @Param('id') id: string,
    @Body() dto: HomologarContribuicaoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.homologar(id, dto, this.ctx(req, user));
  }

  /**
   * Exclusão permanente da contribuição.
   * Verbo DELETE: o guard global já restringe ao Administrador.
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Exclui a contribuição e seus documentos' })
  remover(@Param('id') id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, user));
  }

  /** Desfaz a entrada lançada no caixa, mantendo a contribuição homologada. */
  @Delete('lancamentos/:movimentacaoId')
  @ApiOperation({ summary: 'Exclui o lançamento gerado pela homologação' })
  removerLancamento(
    @Param('movimentacaoId') movimentacaoId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.removerLancamento(movimentacaoId, this.ctx(req, user));
  }

  @Patch(':id/rejeitar')
  @ApiOperation({ summary: 'Recusa a contribuição informando o motivo à empresa' })
  rejeitar(
    @Param('id') id: string,
    @Body() dto: RejeitarContribuicaoDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.service.rejeitar(id, dto, this.ctx(req, user));
  }
}
