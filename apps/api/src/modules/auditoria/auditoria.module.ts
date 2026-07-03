import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AcaoAuditoria, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(params: { acao?: AcaoAuditoria; userId?: string; page?: number }) {
    const page = Number(params.page) || 1;
    const pageSize = 30;
    const where: Prisma.AuditoriaWhereInput = {
      acao: params.acao,
      userId: params.userId,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditoria.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { nome: true, email: true } } },
      }),
      this.prisma.auditoria.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}

@ApiTags('auditoria')
@ApiBearerAuth()
@Controller('auditoria')
class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DIRETORIA)
  listar(
    @Query('acao') acao?: AcaoAuditoria,
    @Query('userId') userId?: string,
    @Query('page') page?: number,
  ) {
    return this.service.listar({ acao, userId, page });
  }
}

@Module({
  controllers: [AuditoriaController],
  providers: [AuditoriaService],
})
export class AuditoriaModule {}
