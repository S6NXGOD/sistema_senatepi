import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AnexoDoModuloGuard } from './anexo-do-modulo.guard';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { AnexosService, ANEXO_TAMANHO_MAX } from './anexos.service';
import {
  AcervoQueryDto, CriarAnexoDto, ListarAnexosQueryDto, PuxarAnexosDto,
} from './dto/anexos.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('anexos')
@ApiBearerAuth()
/**
 * OS QUATRO PERFIS entram — mas cada rota ainda passa pelo módulo do PAI do
 * anexo. `@Roles` aqui só diz "usuário do sistema"; quem autoriza de verdade é
 * o `AnexoDoModuloGuard`, porque o anexo não tem módulo próprio: ele herda o
 * de quem o segura. Ver o comentário do guard.
 */
@Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.ADVOGADO, UserRole.TRIAGEM)
@UseGuards(AnexoDoModuloGuard)
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

  /**
   * Lista os anexos de um Atendimento (?atendimentoId=), Processo (?processoId=)
   * ou atividade da Agenda (?compromissoId=).
   */
  @Get()
  listar(@Query() query: ListarAnexosQueryDto) {
    return this.service.listar(query);
  }

  /**
   * Acervo do filiado — todos os documentos que ele já entregou (atendimentos,
   * processos, agenda e cadastro), para reaproveitar sem novo upload. Passando o
   * alvo, cada item vem marcado com `jaVinculado`.
   */
  @Get('acervo')
  acervo(@Query() query: AcervoQueryDto) {
    return this.service.acervo(query);
  }

  /** "Puxa" documentos do acervo para o registro atual (sem novo upload). */
  @Post('puxar')
  puxar(@Body() dto: PuxarAnexosDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.puxar(dto, this.ctx(req, userId));
  }

  @Delete(':id')
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId));
  }
}
