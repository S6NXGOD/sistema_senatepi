import { Body, Controller, Get, Header, Param, Patch, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { conteudoDisposto } from '@core/infra';
import { Public } from '../../common/decorators/public.decorator';
import { FiliadoAtual } from './decorators/filiado-atual.decorator';
import { FiliadoJwtGuard } from './guards/filiado-jwt.guard';
import { PortalFiliadoService } from './portal-filiado.service';
import { AtualizarMeuCadastroDto } from './dto/portal-filiado.dto';

/**
 * O CONTEÚDO DO PORTAL DO FILIADO.
 *
 * `@Public()` desliga os guards GLOBAIS do administrativo; `@UseGuards(
 * FiliadoJwtGuard)` na classe é a proteção real, e nenhuma rota daqui leva
 * `@PermiteSenhaProvisoria` — ou seja, TUDO aqui exige que a senha provisória
 * já tenha sido trocada. A trava é do servidor, não do redirecionamento da tela.
 *
 * Toda rota lê o id da SESSÃO (`@FiliadoAtual('id')`), nunca um id que venha da
 * URL. É o que impede o portal de virar uma janela para o cadastro dos outros.
 */
@ApiTags('portal-filiado')
@Public()
@UseGuards(FiliadoJwtGuard)
@Controller('portal-filiado/eu')
export class PortalFiliadoController {
  constructor(private readonly service: PortalFiliadoService) {}

  private ctx(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get()
  @ApiOperation({ summary: 'Resumo da primeira tela do portal' })
  resumo(@FiliadoAtual('id') id: string) {
    return this.service.resumo(id);
  }

  // ---- Carteirinha ----

  @Get('carteirinha')
  carteirinha(@FiliadoAtual('id') id: string) {
    return this.service.carteirinha(id);
  }

  @Get('carteirinha/pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'O MESMO PDF que a secretaria emite — frente e verso' })
  async carteirinhaPdf(@FiliadoAtual('id') id: string, @Res() res: Response) {
    const { pdf, nomeArquivo } = await this.service.carteirinhaPdf(id);
    res.setHeader('Content-Disposition', conteudoDisposto(nomeArquivo));
    res.send(pdf);
  }

  // ---- Cadastro ----

  @Get('cadastro')
  cadastro(@FiliadoAtual('id') id: string) {
    return this.service.cadastro(id);
  }

  @Patch('cadastro')
  @ApiOperation({ summary: 'O filiado corrige os próprios dados — vale na hora' })
  atualizarCadastro(
    @FiliadoAtual('id') id: string,
    @Body() dto: AtualizarMeuCadastroDto,
    @Req() req: Request,
  ) {
    return this.service.atualizarCadastro(id, dto, this.ctx(req));
  }

  // ---- Processos ----

  @Get('processos')
  processos(@FiliadoAtual('id') id: string) {
    return this.service.processos(id);
  }

  @Get('processos/:processoId')
  processo(@FiliadoAtual('id') id: string, @Param('processoId') processoId: string) {
    return this.service.processo(id, processoId);
  }

  // ---- Cobranças ----

  @Get('cobrancas')
  @ApiOperation({ summary: 'Recusa com 403 onde o cliente não usa cobrança pelo sistema' })
  cobrancas(@FiliadoAtual('id') id: string) {
    return this.service.cobrancas(id);
  }
}
