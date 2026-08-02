import {
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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { FiliadosService } from './filiados.service';
import { DossieService } from './dossie.service';
import {
  ChangeSituacaoDto,
  CreateFiliadoDto,
  DesfiliarDto,
  ListFiliadosQueryDto,
  UpdateFiliadoDto,
} from './dto/filiado.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('filiados')
@ApiBearerAuth()
@Controller('filiados')
export class FiliadosController {
  constructor(
    private readonly service: FiliadosService,
    private readonly dossie: DossieService,
  ) {}

  @Post()
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  create(@Body() dto: CreateFiliadoDto, @CurrentUser('nome') autor: string) {
    return this.service.create(dto, autor);
  }

  @Get()
  findAll(@Query() query: ListFiliadosQueryDto) {
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

  /**
   * DOSSIÊ — a vida do filiado no sindicato consolidada: atendimentos, agenda,
   * processos, cobranças, eventos, documentos e uma linha do tempo única.
   */
  @Get(':id/dossie')
  dossieFiliado(@Param('id') id: string) {
    return this.dossie.gerar(id);
  }

  /**
   * EDIÇÃO completa — é a porta para CORRIGIR um dado imutável (CPF digitado
   * errado, nascimento trocado). Ato deliberado da equipe, registrado na
   * auditoria; por isso não passa pela proteção de campos.
   */
  @Patch(':id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFiliadoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.update(id, dto, autor);
  }

  /**
   * ATUALIZAÇÃO CADASTRAL — o mesmo formulário que o filiado enxerga.
   * Aceita todos os campos, mas descarta alteração em CPF, RG, nascimento e
   * naturalidade que já estejam preenchidos.
   */
  @Patch(':id/atualizacao-cadastral')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  atualizacaoCadastral(
    @Param('id') id: string,
    @Body() dto: UpdateFiliadoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.atualizacaoCadastral(id, dto, autor);
  }

  @Patch(':id/situacao')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  changeSituacao(
    @Param('id') id: string,
    @Body() dto: ChangeSituacaoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.changeSituacao(id, dto, autor);
  }

  @Patch(':id/desfiliar')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  desfiliar(
    @Param('id') id: string,
    @Body() dto: DesfiliarDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.desfiliar(id, dto, autor);
  }

  /**
   * Termo de Desfiliação em PDF, pronto para assinatura.
   *
   * Os parâmetros permitem gerar o termo ANTES de confirmar a desfiliação (é o
   * que o modal faz: o filiado assina, e só então a saída é registrada). Depois
   * de desfiliado, omiti-los faz o termo usar o que está gravado no cadastro.
   */
  @Get(':id/desfiliacao/pdf')
  @Header('Content-Type', 'application/pdf')
  async termoDesfiliacao(
    @Param('id') id: string,
    @Query('motivo') motivo: string,
    @Query('observacoes') observacoes: string,
    @Query('mesCorte') mesCorte: string,
    @CurrentUser('nome') autor: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.gerarTermoDesfiliacaoPdf(
      id,
      { motivo, observacoes, mesCorte },
      autor,
    );
    res.setHeader('Content-Disposition', `inline; filename="termo-desfiliacao-${id}.pdf"`);
    res.send(buffer);
  }

  @Post(':id/foto')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
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
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('arquivo'))
  addDocumento(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('titulo') titulo: string,
    // `tipo` é o que faz o arquivo aparecer categorizado na aba Documentos
    // (ex.: TERMO_DESFILIACAO). Omitido, cai no genérico.
    @Body('tipo') tipo: string,
    @CurrentUser('nome') autor: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo "arquivo" é obrigatório');
    return this.service.addDocumento(id, file, titulo, autor, tipo);
  }

  @Delete(':id/documentos/:documentoId')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  removeDocumento(@Param('id') id: string, @Param('documentoId') documentoId: string) {
    return this.service.removeDocumento(id, documentoId);
  }

  @Get(':id/termo/pdf')
  @Header('Content-Type', 'application/pdf')
  async termo(
    @Param('id') id: string,
    @CurrentUser('nome') autor: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.gerarTermoPdf(id, autor);
    res.setHeader('Content-Disposition', `inline; filename="termo-${id}.pdf"`);
    res.send(buffer);
  }

  @Delete(':id')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
