import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { FolhaPrefeituraService } from './folha-prefeitura.service';
import {
  ConfirmarFolhaDto,
  DecidirConflitoDto,
  DecidirEmLoteDto,
  ListarLinhasFolhaQueryDto,
} from './folha-prefeitura.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';

/**
 * Revisão e confirmação da FOLHA DA PREFEITURA.
 *
 * O upload continua em `POST /importacoes/upload` (ver `ImportacaoController`),
 * que reconhece o layout e encaminha — para o operador existe UM botão de
 * importar, não dois que ele teria de escolher certo.
 *
 * Prefixo próprio (`importacoes/folha`) para não disputar rota com o
 * `@Get(':id')` do controller legado, e registrado ANTES dele no módulo pelo
 * mesmo motivo documentado em `FiliadosModule`.
 *
 * Somente ADMINISTRADOR, como a importação legada: é a operação que mais mexe
 * no cadastro de uma vez só.
 */
@ApiTags('importacao-folha')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Controller('importacoes/folha')
@Roles(UserRole.ADMINISTRADOR)
export class FolhaPrefeituraController {
  constructor(private readonly service: FolhaPrefeituraService) {}

  @Get(':id/resumo')
  @ApiOperation({ summary: 'Contagem por classificação e conflitos ainda pendentes' })
  resumo(@Param('id') id: string) {
    return this.service.resumo(id);
  }

  @Get(':id/linhas')
  @ApiOperation({ summary: 'Prévia paginada, com o candidato de cada conflito' })
  linhas(@Param('id') id: string, @Query() query: ListarLinhasFolhaQueryDto) {
    return this.service.listarLinhas(id, {
      busca: query.busca,
      classificacao: query.classificacao,
      page: query.page,
    });
  }

  @Patch(':id/linhas/:linhaId/decisao')
  @ApiOperation({ summary: 'Decide um conflito: mesma pessoa, pessoa diferente ou ignorar' })
  decidir(
    @Param('id') id: string,
    @Param('linhaId') linhaId: string,
    @Body() dto: DecidirConflitoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.decidirConflito(id, linhaId, dto, autor);
  }

  @Post(':id/decisao-em-lote')
  @ApiOperation({ summary: 'Mesma decisão para todos os conflitos de um motivo' })
  decidirEmLote(
    @Param('id') id: string,
    @Body() dto: DecidirEmLoteDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.decidirEmLote(id, dto, autor);
  }

  @Post(':id/confirmar')
  @ApiOperation({ summary: 'Executa a importação (assíncrona; acompanhe por /importacoes/:id)' })
  confirmar(
    @Param('id') id: string,
    @Body() dto: ConfirmarFolhaDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('nome') autor: string,
    @Req() req: Request,
  ) {
    return this.service.confirmar(id, dto, { userId, autor, ip: req.ip });
  }
}
