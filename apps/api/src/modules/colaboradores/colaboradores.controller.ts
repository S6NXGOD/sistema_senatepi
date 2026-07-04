import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ColaboradoresService } from './colaboradores.service';
import {
  AlterarStatusColaboradorDto,
  CreateColaboradorDto,
  ListColaboradoresQueryDto,
  UpdateColaboradorDto,
} from './dto/colaborador.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('colaboradores')
@ApiBearerAuth()
@Controller('colaboradores')
export class ColaboradoresController {
  constructor(private readonly service: ColaboradoresService) {}

  @Get()
  findAll(@Query() query: ListColaboradoresQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/historico')
  historico(@Param('id') id: string) {
    return this.service.historico(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  create(@Body() dto: CreateColaboradorDto, @CurrentUser('nome') autor: string) {
    return this.service.create(dto, autor);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  update(@Param('id') id: string, @Body() dto: UpdateColaboradorDto, @CurrentUser('nome') autor: string) {
    return this.service.update(id, dto, autor);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  alterarStatus(
    @Param('id') id: string,
    @Body() dto: AlterarStatusColaboradorDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.alterarStatus(id, dto, autor);
  }

  @Post(':id/foto')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto'))
  foto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('nome') autor: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo "foto" é obrigatório.');
    if (!file.mimetype.startsWith('image/')) throw new BadRequestException('Envie um arquivo de imagem.');
    return this.service.atualizarFoto(id, file.buffer, autor);
  }

  @Post(':id/documentos')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo'))
  addDocumento(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('titulo') titulo: string,
    @CurrentUser('nome') autor: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo "arquivo" é obrigatório.');
    return this.service.addDocumento(id, file, titulo, autor);
  }

  @Delete(':id/documentos/:documentoId')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  removeDocumento(@Param('id') id: string, @Param('documentoId') documentoId: string) {
    return this.service.removeDocumento(id, documentoId);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
