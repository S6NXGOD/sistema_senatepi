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
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { TipoDependente, TipoHistoricoFiliado, TipoPessoa } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QrCodeService } from '../../common/qrcode/qrcode.service';
import { ImageService } from '../../common/storage/image.service';
import { StorageService } from '../../common/storage/storage.service';
import { dataCalendario } from '../../common/utils/datas.util';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';

// ---- Regra de negócio compartilhável ----
export function calcularIdade(dataNascimento: Date, referencia = new Date()): number {
  let idade = referencia.getFullYear() - dataNascimento.getFullYear();
  const m = referencia.getMonth() - dataNascimento.getMonth();
  if (m < 0 || (m === 0 && referencia.getDate() < dataNascimento.getDate())) idade--;
  return idade;
}

/**
 * Quem pode entrar acompanhando o filiado.
 *
 * O LIMITE DE IDADE VALE SÓ PARA FILHO, e é o motivo de a regra existir: filho
 * deixa de ser dependente ao crescer. Cônjuge, pai e mãe não têm idade máxima —
 * a condição deles não muda com o tempo.
 *
 * A regra era `se não é cônjuge, exige ≤ 18`. Com a entrada de PAI e MÃE isso
 * passaria a barrar justamente quem sempre terá mais de 18 — por isso agora a
 * lista de "sem limite de idade" é explícita, e um tipo novo entra nela de
 * propósito, não por descuido.
 */
const SEM_LIMITE_DE_IDADE = new Set<TipoDependente>([
  TipoDependente.CONJUGE,
  TipoDependente.PAI,
  TipoDependente.MAE,
]);

export function dependenteValidoParaEvento(
  tipo: TipoDependente,
  dataNascimento: Date,
): boolean {
  if (SEM_LIMITE_DE_IDADE.has(tipo)) return true;
  return calcularIdade(dataNascimento) <= 18;
}

// ---- DTO ----
class CreateDependenteDto {
  @ApiProperty({ enum: TipoDependente }) @IsEnum(TipoDependente) tipo: TipoDependente;
  @ApiProperty() @IsString() nome: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cpf?: string;
  @ApiProperty() @IsDateString() dataNascimento: string;
}

// ---- Service ----
@Injectable()
export class DependentesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly image: ImageService,
    private readonly storage: StorageService,
  ) {}

  async create(filiadoId: string, dto: CreateDependenteDto, autor?: string) {
    const filiado = await this.prisma.filiado.findUnique({ where: { id: filiadoId } });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');

    if (dto.tipo === TipoDependente.CONJUGE) {
      const jaTem = await this.prisma.dependente.count({
        where: { filiadoId, tipo: TipoDependente.CONJUGE },
      });
      if (jaTem > 0) throw new BadRequestException('Filiado já possui cônjuge cadastrado');
    }

    const dependente = await this.prisma.dependente.create({
      data: {
        filiadoId,
        tipo: dto.tipo,
        nome: dto.nome,
        cpf: dto.cpf?.replace(/\D/g, ''),
        dataNascimento: dataCalendario(dto.dataNascimento),
        qrToken: this.qr.gerarToken(),
      },
    });

    await this.prisma.filiadoHistorico.create({
      data: {
        filiadoId,
        tipo: TipoHistoricoFiliado.INCLUSAO_DEPENDENTE,
        descricao: `Dependente incluído: ${dependente.nome} (${dependente.tipo === TipoDependente.CONJUGE ? 'Cônjuge' : 'Filho(a)'}).`,
        autor,
      },
    });
    return dependente;
  }

  async listarPorFiliado(filiadoId: string) {
    const deps = await this.prisma.dependente.findMany({ where: { filiadoId } });
    return Promise.all(
      deps.map(async (d) => ({
        ...d,
        idade: calcularIdade(d.dataNascimento),
        validoParaEvento: dependenteValidoParaEvento(d.tipo, d.dataNascimento),
        fotoUrl: d.fotoThumbKey
          ? await this.storage.getSignedUrl(d.fotoThumbKey).catch(() => null)
          : null,
      })),
    );
  }

  async atualizarFoto(id: string, arquivo: Buffer) {
    const dep = await this.prisma.dependente.findUnique({ where: { id } });
    if (!dep) throw new NotFoundException('Dependente não encontrado');
    const { fotoKey, fotoThumbKey } = await this.image.processarFoto(
      arquivo,
      `dependentes/${id}`,
    );
    if (dep.fotoKey) void this.storage.delete(dep.fotoKey).catch(() => undefined);
    if (dep.fotoThumbKey) void this.storage.delete(dep.fotoThumbKey).catch(() => undefined);
    return this.prisma.dependente.update({
      where: { id },
      data: { fotoKey, fotoThumbKey },
    });
  }

  async remove(id: string, autor?: string) {
    const dep = await this.prisma.dependente.findUnique({ where: { id } });
    if (!dep) throw new NotFoundException('Dependente não encontrado');
    await this.prisma.dependente.delete({ where: { id } });
    await this.prisma.filiadoHistorico.create({
      data: {
        filiadoId: dep.filiadoId,
        tipo: TipoHistoricoFiliado.EXCLUSAO_DEPENDENTE,
        descricao: `Dependente removido: ${dep.nome}.`,
        autor,
      },
    });
    return { ok: true };
  }

  async qrCode(id: string) {
    const dep = await this.prisma.dependente.findUnique({ where: { id } });
    if (!dep) throw new NotFoundException('Dependente não encontrado');
    const payload = this.qr.montarPayload(dep.id, TipoPessoa.DEPENDENTE, dep.qrToken);
    return { payload, imagem: await this.qr.gerarImagemDataUrl(payload) };
  }
}

// ---- Controller ----
@ApiTags('dependentes')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Controller()
class DependentesController {
  constructor(private readonly service: DependentesService) {}

  @Post('filiados/:filiadoId/dependentes')
  create(@Param('filiadoId') filiadoId: string, @Body() dto: CreateDependenteDto) {
    return this.service.create(filiadoId, dto);
  }

  @Get('filiados/:filiadoId/dependentes')
  list(@Param('filiadoId') filiadoId: string) {
    return this.service.listarPorFiliado(filiadoId);
  }

  @Post('dependentes/:id/foto')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto'))
  foto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo "foto" é obrigatório');
    return this.service.atualizarFoto(id, file.buffer);
  }

  @Get('dependentes/:id/qrcode')
  qr(@Param('id') id: string) {
    return this.service.qrCode(id);
  }

  @Delete('dependentes/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  controllers: [DependentesController],
  providers: [DependentesService],
  exports: [DependentesService],
})
export class DependentesModule {}
