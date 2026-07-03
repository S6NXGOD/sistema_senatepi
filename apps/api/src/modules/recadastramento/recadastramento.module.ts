import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Prisma,
  StatusRecadastramento,
  TipoHistoricoFiliado,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateFiliadoDto } from '../filiados/dto/filiado.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class RecadastramentoService {
  constructor(private readonly prisma: PrismaService) {}

  async submeter(filiadoId: string, dto: UpdateFiliadoDto, autor?: string) {
    const atual = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      include: { vinculos: { orderBy: { ordem: 'asc' } } },
    });
    if (!atual) throw new NotFoundException('Filiado não encontrado');

    const { vinculos, ...dados } = dto;

    // Snapshot do estado anterior (para auditoria/histórico)
    const dadosAnteriores: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify({
        ...atual,
        dataNascimento: atual.dataNascimento,
        dataAdmissao: atual.dataAdmissao,
        vinculos: atual.vinculos,
      }),
    );

    const [filiado] = await this.prisma.$transaction([
      this.prisma.filiado.update({
        where: { id: filiadoId },
        data: {
          ...dados,
          cpf: dto.cpf ? dto.cpf.replace(/\D/g, '') : undefined,
          dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : undefined,
          dataAdmissao: dto.dataAdmissao ? new Date(dto.dataAdmissao) : undefined,
          vinculos: vinculos
            ? {
                deleteMany: {},
                create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })),
              }
            : undefined,
        },
        include: { vinculos: true },
      }),
      this.prisma.recadastramento.create({
        data: {
          filiadoId,
          status: StatusRecadastramento.APROVADO,
          dadosAnteriores,
          dadosNovos: dto as unknown as Prisma.InputJsonValue,
          revisadoEm: new Date(),
        },
      }),
      this.prisma.filiadoHistorico.create({
        data: {
          filiadoId,
          tipo: TipoHistoricoFiliado.RECADASTRAMENTO,
          descricao: 'Recadastramento realizado.',
          autor,
        },
      }),
    ]);

    return filiado;
  }

  listar(filiadoId: string) {
    return this.prisma.recadastramento.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      include: { revisor: { select: { nome: true } } },
    });
  }
}

@ApiTags('recadastramento')
@ApiBearerAuth()
@Controller('filiados/:id')
class RecadastramentoController {
  constructor(private readonly service: RecadastramentoService) {}

  @Post('recadastramento')
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA, UserRole.FUNCIONARIO)
  submeter(
    @Param('id') id: string,
    @Body() dto: UpdateFiliadoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.submeter(id, dto, autor);
  }

  @Get('recadastramentos')
  listar(@Param('id') id: string) {
    return this.service.listar(id);
  }
}

@Module({
  controllers: [RecadastramentoController],
  providers: [RecadastramentoService],
  exports: [RecadastramentoService],
})
export class RecadastramentoModule {}
