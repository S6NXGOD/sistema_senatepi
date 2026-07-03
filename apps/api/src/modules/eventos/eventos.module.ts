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
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { StatusEvento, TipoEvento, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';

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
      include: { _count: { select: { presencas: true } } },
    });
    if (!e) throw new NotFoundException('Evento não encontrado');
    return e;
  }

  async update(id: string, dto: Partial<CreateEventoDto>) {
    await this.findOne(id);
    return this.prisma.evento.update({
      where: { id },
      data: {
        ...dto,
        dataInicio: dto.dataInicio ? new Date(dto.dataInicio) : undefined,
        dataFim: dto.dataFim ? new Date(dto.dataFim) : undefined,
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

  @Post() @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  create(@Body() dto: CreateEventoDto) {
    return this.service.create(dto);
  }
  @Get() findAll() {
    return this.service.findAll();
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id') @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  update(@Param('id') id: string, @Body() dto: Partial<CreateEventoDto>) {
    return this.service.update(id, dto);
  }
  @Delete(':id') @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  controllers: [EventosController],
  providers: [EventosService],
  exports: [EventosService],
})
export class EventosModule {}
