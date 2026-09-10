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
import { ColaboradoresService } from './colaboradores.service';
import {
  AlterarStatusColaboradorDto,
  CreateColaboradorDto,
  ListColaboradoresQueryDto,
  UpdateColaboradorDto,
} from './dto/colaborador.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { conteudoDisposto } from '@core/infra';

@ApiTags('colaboradores')
@ApiBearerAuth()
@ModuloTenant('colaboradores')
@Modulo('colaboradores')
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

  /** QR de entrada em eventos (payload assinado + imagem). */
  @Get(':id/qrcode')
  qrCode(@Param('id') id: string) {
    return this.service.qrCode(id);
  }

  /** Crachá em PDF, com foto e o QR de entrada. */
  @Get(':id/cracha/pdf')
  @Header('Content-Type', 'application/pdf')
  async cracha(
    @Param('id') id: string,
    @CurrentUser('nome') autor: string,
    @Res() res: Response,
  ) {
    const { pdf, nomeArquivo } = await this.service.gerarCrachaPdf(id, autor);
    res.setHeader('Content-Disposition', conteudoDisposto(nomeArquivo));
    res.send(pdf);
  }

  @Post()
  create(@Body() dto: CreateColaboradorDto, @CurrentUser('nome') autor: string) {
    return this.service.create(dto, autor);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateColaboradorDto, @CurrentUser('nome') autor: string) {
    return this.service.update(id, dto, autor);
  }

  @Patch(':id/status')
  alterarStatus(
    @Param('id') id: string,
    @Body() dto: AlterarStatusColaboradorDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.alterarStatus(id, dto, autor);
  }

  @Post(':id/foto')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
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
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
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
  removeDocumento(@Param('id') id: string, @Param('documentoId') documentoId: string) {
    return this.service.removeDocumento(id, documentoId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
