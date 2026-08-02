import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  async check() {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }

    // `storage` entrou por causa dos documentos com valor de registro (dossiê
    // de assembleia, termo de desfiliação, carteirinha): no Railway o disco do
    // contêiner é apagado a cada deploy, e a falha só apareceria no dia em que
    // alguém fosse conferir o documento. O diagnóstico não expõe o caminho do
    // sistema de arquivos — só se é persistente e gravável.
    return {
      status: 'ok',
      db,
      storage: await this.storage.diagnostico(),
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
