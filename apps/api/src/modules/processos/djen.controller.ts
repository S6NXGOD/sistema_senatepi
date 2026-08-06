import {
  CanActivate,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { DjenService } from './djen.service';
import { DjenSyncService } from './djen-sync.service';

/**
 * Interruptor da integração com o DJEN.
 *
 * Desligada, as rotas respondem 404 e não 403 — mesma semântica de
 * `DuplicidadeAtivaGuard`: guardar o link não adianta porque a porta não
 * existe. Ligar ou desligar é mudar `DJEN_INTEGRACAO` no ambiente e reiniciar,
 * sem alterar código e sem novo build.
 */
@Injectable()
export class DjenAtivoGuard implements CanActivate {
  constructor(private readonly djen: DjenService) {}

  canActivate(): boolean {
    if (!this.djen.integracaoAtiva) {
      throw new NotFoundException('Cannot access /api/djen');
    }
    return true;
  }
}

@ApiTags('djen')
@ApiBearerAuth()
@Modulo('processos')
@Controller('djen')
export class DjenController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly djen: DjenService,
    private readonly sync: DjenSyncService,
  ) {}

  /**
   * Estado da integração — a ÚNICA rota que responde com o DJEN desligado.
   *
   * O front pergunta aqui em vez de carregar a decisão embutida: as
   * `NEXT_PUBLIC_*` do Next são resolvidas no build, então uma flag no front
   * exigiria rebuildar o serviço web só para desligar. Perguntando à API, o
   * desligamento vale na hora.
   */
  @Get('status')
  async status() {
    const ativo = this.djen.integracaoAtiva;
    return {
      ativo,
      janelaDias: this.djen.janelaDias,
      publicacoes: ativo ? await this.prisma.comunicacaoDjen.count() : 0,
      /** Advogados que a varredura por OAB alcança — zero aqui explica silêncio. */
      advogadosComOab: ativo
        ? await this.prisma.user.count({
            where: { ativo: true, oab: { not: null }, oabUf: { not: null } },
          })
        : 0,
    };
  }

  /** Publicações de um processo, mais recentes primeiro. */
  @Get('processo/:processoId')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Publicações do DJEN casadas com o processo.' })
  listarDoProcesso(@Param('processoId') processoId: string, @Query('limite') limite?: string) {
    return this.prisma.comunicacaoDjen.findMany({
      where: { processoId },
      orderBy: { dataDisponibilizacao: 'desc' },
      take: Math.min(Number(limite) || 50, 200),
      select: {
        id: true, hash: true, siglaTribunal: true, tipoComunicacao: true,
        tipoDocumento: true, nomeOrgao: true, nomeClasse: true, meio: true,
        link: true, texto: true, dataDisponibilizacao: true, providencia: true,
        prazoMencionadoDias: true, compromissoId: true, movimentacaoId: true,
        destinatarios: true, advogados: true,
      },
    });
  }

  /** Busca as publicações de UM processo sob demanda (botão da ficha). */
  @Post('processo/:processoId/sincronizar')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Consulta o DJEN para este processo e grava o que houver de novo.' })
  sincronizarProcesso(@Param('processoId') processoId: string) {
    return this.sync.sincronizarProcesso(processoId);
  }

  /**
   * Dispara a varredura completa fora do horário do robô.
   *
   * Restrita a ADMINISTRADOR: percorre a OAB de todos os advogados e consulta o
   * CNJ dezenas de vezes. Roda SEM espera entre chamadas de propósito — quem
   * clicou está olhando para a tela; a cadência conservadora existe para o robô
   * das 05:00, que tem a noite inteira.
   */
  @Post('sincronizar')
  @Roles(UserRole.ADMINISTRADOR)
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Varredura completa do DJEN (OAB dos advogados + processos mudos).' })
  varrer() {
    return this.sync.varrer();
  }
}
