import {
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsDateString, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUrl,
} from 'class-validator';
import { Prisma, StatusEvento, TipoEvento, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CobrancasModule } from '../cobrancas/cobrancas.module';
import { CheckinService } from './checkin.service';
import { CheckinPublicoController } from './checkin.controller';
import { VotacaoService } from './votacao.service';
import { SorteioService } from './sorteio.service';
import { PlenarioAdminController, PlenarioPublicoController } from './plenario.controller';
import { lerConfiguracoes, normalizarConfiguracoes } from './configuracoes-evento';

class CreateEventoDto {
  @ApiProperty() @IsString() nome: string;
  @ApiPropertyOptional() @IsOptional() @IsString() descricao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() local?: string;
  @ApiProperty() @IsDateString() dataInicio: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dataFim?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() capacidadeMaxima?: number;
  @ApiPropertyOptional({ enum: TipoEvento })
  @IsOptional() @IsEnum(TipoEvento) tipo?: TipoEvento;
  @ApiPropertyOptional({ enum: StatusEvento })
  @IsOptional() @IsEnum(StatusEvento) status?: StatusEvento;

  /**
   * Link da videoconferência. Colado à mão — Meet, Zoom ou Teams.
   * A geração automática pelo Google Calendar entra depois, como opção.
   */
  @ApiPropertyOptional() @IsOptional() @IsUrl() linkReuniao?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() urlVideoDrive?: string;
  /** Ata em texto — a transcrição vem do Meet, ligada pelo próprio host. */
  @ApiPropertyOptional() @IsOptional() @IsString() textoAta?: string;

  /**
   * Chaves do "camaleão". Aceita objeto solto de propósito: quem valida é
   * `normalizarConfiguracoes`, que descarta o que não reconhece. Um DTO
   * espelhando cada chave duplicaria o contrato e os dois divergiriam.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional() @IsObject() configuracoes?: Record<string, unknown>;
}

@Injectable()
export class EventosService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateEventoDto) {
    return this.prisma.evento.create({
      data: {
        ...dto,
        dataInicio: new Date(dto.dataInicio),
        dataFim: dto.dataFim ? new Date(dto.dataFim) : undefined,
        // Normaliza ANTES de gravar: assim o banco nunca acumula chave
        // desconhecida nem `"habilitarVotacao": "sim"`, e quem abrir o
        // registro daqui a um ano entende o que está lá.
        configuracoes: normalizarConfiguracoes(dto.configuracoes) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  findAll() {
    return this.prisma.evento.findMany({
      orderBy: { dataInicio: 'desc' },
      include: { _count: { select: { presencas: true } } },
    });
  }

  async findOne(id: string) {
    const e = await this.prisma.evento.findUnique({
      where: { id },
      include: { _count: { select: { presencas: true, pautas: true, sorteios: true } } },
    });
    if (!e) throw new NotFoundException('Evento não encontrado');
    // Devolve as configurações COM os padrões já aplicados. A tela precisa
    // saber o valor efetivo — um JSON `{}` no banco significa "tudo no padrão",
    // e mandar o objeto vazio faria a interface desenhar todas as chaves como
    // desligadas, inclusive as que têm padrão diferente disso.
    return { ...e, configuracoes: lerConfiguracoes(e.configuracoes) };
  }

  async update(id: string, dto: Partial<CreateEventoDto>) {
    await this.findOne(id);
    return this.prisma.evento.update({
      where: { id },
      data: {
        ...dto,
        dataInicio: dto.dataInicio ? new Date(dto.dataInicio) : undefined,
        dataFim: dto.dataFim ? new Date(dto.dataFim) : undefined,
        // Só toca nas configurações se vierem no payload: um PATCH de nome não
        // pode zerar as chaves do evento de volta ao padrão.
        configuracoes: dto.configuracoes
          ? (normalizarConfiguracoes(dto.configuracoes) as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.evento.delete({ where: { id } });
    return { ok: true };
  }
}

@ApiTags('eventos')
@ApiBearerAuth()
@Controller('eventos')
class EventosController {
  constructor(private readonly service: EventosService) {}

  @Post() @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  create(@Body() dto: CreateEventoDto) {
    return this.service.create(dto);
  }
  @Get() findAll() {
    return this.service.findAll();
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id') @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  update(@Param('id') id: string, @Body() dto: Partial<CreateEventoDto>) {
    return this.service.update(id, dto);
  }
  @Delete(':id') @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  // CobrancasModule entra para o check-in poder consultar a adimplência pela
  // regra do financeiro, em vez de reimplementá-la aqui.
  imports: [CobrancasModule],
  // PlenarioPublicoController vem ANTES de CheckinPublicoController: ambos
  // servem sob `sala/`, e o `@Get(':eventoId')` do check-in casaria com
  // "ao-vivo" se fosse registrado primeiro. O Nest resolve na ordem.
  controllers: [
    EventosController,
    PlenarioAdminController,
    PlenarioPublicoController,
    CheckinPublicoController,
  ],
  providers: [EventosService, CheckinService, VotacaoService, SorteioService],
  exports: [EventosService],
})
export class EventosModule {}
