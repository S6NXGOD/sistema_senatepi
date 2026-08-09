import { StorageService } from '@core/infra';
import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

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
      /**
       * Versão publicada. É o que permite ao front descobrir que saiu build
       * novo e oferecer a atualização — sem isso, quem está com o aplicativo
       * instalado no celular pode ficar semanas numa versão antiga, porque
       * nada obriga o aparelho a recarregar a página.
       *
       * O Railway injeta `RAILWAY_GIT_COMMIT_SHA` em todo deploy. Fora dele
       * (desenvolvimento) o valor é fixo e o aviso nunca aparece.
       */
      versao: (process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev').slice(0, 7),
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
