import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { FuncionariosService } from './funcionarios.service';
import {
  ChangeStatusDto,
  CreateFuncionarioDto,
  ListFuncionariosQueryDto,
  UpdateFuncionarioDto,
} from './dto/funcionario.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('funcionarios')
@ApiBearerAuth()
@Controller('funcionarios')
export class FuncionariosController {
  constructor(private readonly service: FuncionariosService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  create(@Body() dto: CreateFuncionarioDto, @CurrentUser('nome') autor: string) {
    return this.service.create(dto, autor);
  }

  @Get()
  findAll(@Query() query: ListFuncionariosQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  perfil(@Param('id') id: string) {
    return this.service.perfil(id);
  }

  @Get(':id/qrcode')
  qrCode(@Param('id') id: string) {
    return this.service.qrCode(id);
  }

  @Get(':id/historico')
  historico(@Param('id') id: string) {
    return this.service.historico(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFuncionarioDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.update(id, dto, autor);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.changeStatus(id, dto, autor);
  }

  @Post(':id/foto')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto'))
  foto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('nome') autor: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo "foto" é obrigatório');
    return this.service.atualizarFoto(id, file.buffer, autor);
  }

  @Post(':id/documentos')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo'))
  addDocumento(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('titulo') titulo: string,
    @CurrentUser('nome') autor: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo "arquivo" é obrigatório');
    return this.service.addDocumento(id, file, titulo, autor);
  }

  @Delete(':id/documentos/:documentoId')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  removeDocumento(
    @Param('id') id: string,
    @Param('documentoId') documentoId: string,
  ) {
    return this.service.removeDocumento(id, documentoId);
  }

  @Get(':id/carteirinha/pdf')
  @Header('Content-Type', 'application/pdf')
  async carteirinha(
    @Param('id') id: string,
    @CurrentUser('nome') autor: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.gerarCarteirinhaPdf(id, autor);
    res.setHeader('Content-Disposition', `inline; filename="cracha-${id}.pdf"`);
    res.send(buffer);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
