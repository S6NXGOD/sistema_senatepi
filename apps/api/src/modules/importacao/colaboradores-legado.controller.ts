import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';

import { ColaboradoresLegadoService } from './colaboradores-legado.service';
import {
  ConfirmarColaboradoresLegadoDto,
  ListarLinhasColaboradoresQueryDto,
} from './colaboradores-legado.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { importadorAtivo } from '../../tenant/tenant.config';

/**
 * IMPORTAÇÃO DA EQUIPE DO SINDICATO (funcionários, prestadores e dependentes).
 *
 * PREFIXO PRÓPRIO, e não uma rota a mais em `/importacoes`. O `@Get(':id')` do
 * controller legado casaria com qualquer palavra colocada ali — foi o motivo de
 * `importacoes/folha` ter nascido separado, e vale igual aqui.
 *
 * `@ModuloTenant('colaboradores')` e não `filiados`: isto NÃO mexe na base de
 * associados. Uma instalação sem o módulo de colaboradores recebe 404.
 *
 * Somente ADMINISTRADOR, como as outras importações: é a operação que mexe em
 * mais cadastros de uma vez só.
 */
@ApiTags('importacao-colaboradores')
@ApiBearerAuth()
@ModuloTenant('colaboradores')
@Modulo('colaboradores')
@Controller('importacoes/colaboradores')
@Roles(UserRole.ADMINISTRADOR)
export class ColaboradoresLegadoController {
  constructor(private readonly service: ColaboradoresLegadoService) {}

  /**
   * Sobe o arquivo e devolve a PRÉVIA. Nada é gravado em `colaboradores` aqui.
   *
   * BOTÃO PRÓPRIO, e não o `/importacoes/upload` que reconhece o layout sozinho.
   * Lá a escolha é entre dois arquivos que criam FILIADOS, e o operador não tem
   * como errar de população. Aqui um arquivo mal reconhecido cadastraria a
   * equipe do sindicato como associada — ou 4.000 servidores como funcionários.
   * Quando o erro muda de TABELA, a intenção precisa ser declarada.
   */
  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Prévia da importação da equipe (JSON ou CSV)' })
  @UseInterceptors(FileInterceptor('arquivo'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('id') userId: string,
    @Body('permitirReenvio') permitirReenvio?: string,
  ) {
    this.exigirImportadorLigado();
    if (!file) throw new BadRequestException('Envie o arquivo no campo "arquivo"');
    if (!/\.(json|csv|txt|xlsx?)$/i.test(file.originalname))
      throw new BadRequestException(
        'Formato não suportado. Envie .json (o formato do sistema antigo), .csv ou .xlsx.',
      );

    return this.service.processarUpload(file, userId, {
      // Vem de multipart: chega como string, não como booleano.
      permitirReenvio: permitirReenvio === 'true' || permitirReenvio === '1',
    });
  }

  @Get(':id/resumo')
  @ApiOperation({ summary: 'Contagem por classificação e problemas agrupados' })
  resumo(@Param('id') id: string) {
    this.exigirImportadorLigado();
    return this.service.resumo(id);
  }

  @Get(':id/linhas')
  @ApiOperation({ summary: 'Prévia paginada, com os dependentes de cada pessoa' })
  linhas(@Param('id') id: string, @Query() query: ListarLinhasColaboradoresQueryDto) {
    this.exigirImportadorLigado();
    return this.service.listarLinhas(id, {
      busca: query.busca,
      classificacao: query.classificacao,
      page: query.page,
    });
  }

  @Post(':id/confirmar')
  @ApiOperation({ summary: 'Executa a importação (assíncrona; acompanhe por /resumo)' })
  confirmar(
    @Param('id') id: string,
    @Body() dto: ConfirmarColaboradoresLegadoDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('nome') autor: string,
    @Req() req: Request,
  ) {
    this.exigirImportadorLigado();
    return this.service.confirmar(id, dto, { userId, autor, ip: req.ip });
  }

  /**
   * 404 quando a instalação não declarou este importador.
   *
   * O módulo `colaboradores` está ligado nos dois clientes — é o cadastro da
   * equipe, todo sindicato tem. O que é de UM cliente é a MIGRAÇÃO de um sistema
   * antigo específico, e ela some sozinha do menu quando termina. Ver
   * `TenantConfig.importadores`.
   */
  private exigirImportadorLigado() {
    importadorAtivo('colaboradores-legado', { exigir: true });
  }
}
