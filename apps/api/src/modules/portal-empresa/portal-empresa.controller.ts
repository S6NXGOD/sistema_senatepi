import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, Res,
  UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PortalEmpresaAuthService } from './portal-empresa-auth.service';
import { ContribuicoesPatronaisService, TAMANHO_MAX_ANEXO } from './contribuicoes.service';
import { GerarContribuicaoDto, ListarContribuicoesQueryDto } from './dto/contribuicao.dto';
import { EmpresaJwtGuard } from './guards/empresa-jwt.guard';
import { EmpresaAtual } from './decorators/empresa-atual.decorator';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Área logada do Portal da Empresa.
 *
 * NENHUMA rota aqui leva `@PermiteSenhaProvisoria`: enquanto a empresa não
 * trocar a senha provisória, o `EmpresaJwtGuard` recusa tudo com 403. É aqui
 * que os serviços do módulo patronal vão sendo acrescentados.
 */
@ApiTags('portal-empresa')
@Public()
@UseGuards(EmpresaJwtGuard)
@Controller('portal-empresa')
export class PortalEmpresaController {
  constructor(
    private readonly service: PortalEmpresaAuthService,
    private readonly contribuicoes: ContribuicoesPatronaisService,
  ) {}

  private ctx(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('dados')
  @ApiOperation({ summary: 'Cadastro da própria empresa' })
  dados(@EmpresaAtual('id') empresaId: string) {
    return this.service.dadosCadastrais(empresaId);
  }

  // -------------------------------------------------------------------------
  // Contribuição patronal
  //
  // Todas as rotas recebem o `empresaId` da SESSÃO, nunca do corpo ou da URL:
  // não há como declarar ou consultar a guia de outra empresa.
  // -------------------------------------------------------------------------

  @Get('contribuicoes')
  @ApiOperation({ summary: 'Histórico de guias da empresa' })
  listarContribuicoes(
    @EmpresaAtual('id') empresaId: string,
    @Query() query: ListarContribuicoesQueryDto,
  ) {
    return this.contribuicoes.listar(empresaId, query);
  }

  @Get('contribuicoes/:id')
  detalheContribuicao(@EmpresaAtual('id') empresaId: string, @Param('id') id: string) {
    return this.contribuicoes.detalhe(empresaId, id);
  }

  /** Retoma o PIX de uma guia já criada (a empresa pode voltar depois). */
  @Get('contribuicoes/:id/pix')
  pixContribuicao(@EmpresaAtual('id') empresaId: string, @Param('id') id: string) {
    return this.contribuicoes.pixDaGuia(empresaId, id);
  }

  /**
   * Download de um documento enviado.
   *
   * O arquivo é servido POR AQUI, atrás do guard, em vez de por uma URL do
   * storage: no driver `local` o `/uploads` fica público e sem expiração, o
   * que contradiria o aviso de LGPD exibido no envio.
   */
  @Get('contribuicoes/:id/documento/:tipo')
  @ApiOperation({ summary: 'Baixa o comprovante ou a relação de trabalhadores' })
  async documento(
    @EmpresaAtual('id') empresaId: string,
    @Param('id') id: string,
    @Param('tipo') tipo: string,
    @Res() res: Response,
  ) {
    if (tipo !== 'comprovante' && tipo !== 'relacao') {
      throw new BadRequestException('Documento inválido.');
    }
    const { buffer, contentType, nome } = await this.contribuicoes.baixarDocumento(
      empresaId, id, tipo,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    // Dado pessoal de terceiros: nada de cache compartilhado.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }

  @Post('contribuicoes/gerar')
  @ApiOperation({ summary: 'Declara a competência e devolve o PIX (QR + Copia e Cola)' })
  gerarContribuicao(
    @EmpresaAtual('id') empresaId: string,
    @Body() dto: GerarContribuicaoDto,
    @Req() req: Request,
  ) {
    return this.contribuicoes.gerar(empresaId, dto, this.ctx(req));
  }

  /**
   * Comprovante do PIX + relação de trabalhadores.
   * O limite do multer é a primeira barreira; o serviço confere tipo e tamanho.
   */
  @Patch('contribuicoes/:id/anexar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'comprovante', maxCount: 1 }, { name: 'relacao', maxCount: 1 }],
      { limits: { fileSize: TAMANHO_MAX_ANEXO, files: 2 } },
    ),
  )
  anexarContribuicao(
    @EmpresaAtual('id') empresaId: string,
    @Param('id') id: string,
    @UploadedFiles()
    arquivos: { comprovante?: Express.Multer.File[]; relacao?: Express.Multer.File[] },
    @Req() req: Request,
  ) {
    return this.contribuicoes.anexar(empresaId, id, arquivos ?? {}, this.ctx(req));
  }
}
