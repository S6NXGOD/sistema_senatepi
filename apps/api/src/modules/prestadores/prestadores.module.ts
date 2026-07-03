import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { StatusGenerico, TipoPessoa, TipoPrestador, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QrCodeService } from '../../common/qrcode/qrcode.service';
import { Roles } from '../../common/decorators/roles.decorator';

class CreatePrestadorDto {
  @ApiProperty() @IsString() nome: string;
  @ApiPropertyOptional({ enum: TipoPrestador })
  @IsOptional() @IsEnum(TipoPrestador) tipoPessoa?: TipoPrestador;
  @ApiProperty() @IsString() cpfCnpj: string;
  @ApiPropertyOptional() @IsOptional() @IsString() empresa?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telefone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contratoNumero?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() vigenciaInicio?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() vigenciaFim?: string;
  @ApiPropertyOptional({ enum: StatusGenerico })
  @IsOptional() @IsEnum(StatusGenerico) status?: StatusGenerico;
}

@Injectable()
export class PrestadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
  ) {}

  async create(dto: CreatePrestadorDto) {
    const cpfCnpj = dto.cpfCnpj.replace(/\D/g, '');
    if (await this.prisma.prestador.findUnique({ where: { cpfCnpj } }))
      throw new BadRequestException('Já existe prestador com este CPF/CNPJ');
    return this.prisma.prestador.create({
      data: {
        ...dto,
        cpfCnpj,
        vigenciaInicio: dto.vigenciaInicio ? new Date(dto.vigenciaInicio) : undefined,
        vigenciaFim: dto.vigenciaFim ? new Date(dto.vigenciaFim) : undefined,
        qrToken: this.qr.gerarToken(),
      },
    });
  }

  findAll(busca?: string) {
    return this.prisma.prestador.findMany({
      where: busca
        ? { OR: [{ nome: { contains: busca, mode: 'insensitive' } }, { empresa: { contains: busca, mode: 'insensitive' } }] }
        : undefined,
      orderBy: { nome: 'asc' },
    });
  }

  async findOne(id: string) {
    const p = await this.prisma.prestador.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Prestador não encontrado');
    return p;
  }

  async update(id: string, dto: Partial<CreatePrestadorDto>) {
    await this.findOne(id);
    return this.prisma.prestador.update({
      where: { id },
      data: {
        ...dto,
        cpfCnpj: dto.cpfCnpj ? dto.cpfCnpj.replace(/\D/g, '') : undefined,
        vigenciaInicio: dto.vigenciaInicio ? new Date(dto.vigenciaInicio) : undefined,
        vigenciaFim: dto.vigenciaFim ? new Date(dto.vigenciaFim) : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.prestador.delete({ where: { id } });
    return { ok: true };
  }

  async qrCode(id: string) {
    const p = await this.findOne(id);
    const payload = this.qr.montarPayload(p.id, TipoPessoa.PRESTADOR, p.qrToken);
    return { payload, imagem: await this.qr.gerarImagemDataUrl(payload) };
  }
}

@ApiTags('prestadores')
@ApiBearerAuth()
@Controller('prestadores')
class PrestadoresController {
  constructor(private readonly service: PrestadoresService) {}

  @Post() @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  create(@Body() dto: CreatePrestadorDto) {
    return this.service.create(dto);
  }
  @Get() findAll(@Query('busca') busca?: string) {
    return this.service.findAll(busca);
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Get(':id/qrcode') qr(@Param('id') id: string) {
    return this.service.qrCode(id);
  }
  @Patch(':id') @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  update(@Param('id') id: string, @Body() dto: Partial<CreatePrestadorDto>) {
    return this.service.update(id, dto);
  }
  @Delete(':id') @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  controllers: [PrestadoresController],
  providers: [PrestadoresService],
  exports: [PrestadoresService],
})
export class PrestadoresModule {}
