import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { AnexosService, ANEXO_TAMANHO_MAX } from './anexos.service';
import { CriarAnexoDto, ListarAnexosQueryDto } from './dto/anexos.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('anexos')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
@Controller('anexos')
export class AnexosController {
  constructor(private readonly service: AnexosService) {}

  private ctx(req: Request, userId?: string) {
    return { userId, ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /** Upload de anexo vinculado a um Atendimento OU a um Processo. */
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: ANEXO_TAMANHO_MAX } }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CriarAnexoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.upload(file, dto, this.ctx(req, userId));
  }

  /** Lista os anexos de um Atendimento (?atendimentoId=) ou Processo (?processoId=). */
  @Get()
  listar(@Query() query: ListarAnexosQueryDto) {
    return this.service.listar(query);
  }

  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId));
  }
}
