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
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { DjenService } from './djen.service';
import { DjenSyncService } from './djen-sync.service';
import { DjenBuscaService } from './djen-busca.service';

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

/**
 * Filtros da busca no acervo de publicações.
 *
 * DECLARADO ANTES DO CONTROLLER, e isso não é estilo: com
 * `emitDecoratorMetadata`, o decorador do parâmetro guarda uma REFERÊNCIA à
 * classe avaliada na definição do método. Classe declarada depois passa no
 * `tsc --noEmit` e derruba a aplicação no carregamento do módulo com
 * "Cannot access 'X' before initialization" — já aconteceu neste projeto.
 */
export class BuscaPublicacoesDto {
  @ApiPropertyOptional({ description: 'Teor, número do processo, nome da parte, advogado ou OAB.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Slug da providência classificada.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  providencia?: string;

  @ApiPropertyOptional({ description: 'Sigla do tribunal (TRT22, TJPI…).' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  tribunal?: string;

  @ApiPropertyOptional({ enum: ['COM_TAREFA', 'SEM_TAREFA'] })
  @IsOptional()
  @IsIn(['COM_TAREFA', 'SEM_TAREFA'])
  situacao?: 'COM_TAREFA' | 'SEM_TAREFA';

  @ApiPropertyOptional({ description: 'Só as publicações dos processos de quem está pedindo.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  meus?: 'true' | 'false';

  @ApiPropertyOptional({
    enum: ['TUDO', 'AUTOR', 'REU', 'NUMERO', 'TEOR'],
    description: 'ONDE procurar o termo. Padrão TUDO. Ver o comentário do serviço.',
  })
  @IsOptional()
  @IsIn(['TUDO', 'AUTOR', 'REU', 'NUMERO', 'TEOR'])
  onde?: 'TUDO' | 'AUTOR' | 'REU' | 'NUMERO' | 'TEOR';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
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
    private readonly busca: DjenBuscaService,
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
      /** O CDN do CNJ está recusando consultas vindas deste servidor. */
      bloqueadoNaOrigem: this.djen.bloqueadoNaOrigem,
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

  /**
   * BUSCA NO ACERVO — a tela que faltava.
   *
   * Declarada ANTES de `processo/:processoId` de propósito: o Nest casa rotas
   * na ordem de declaração, e um `@Get('processo/:x')` acima engoliria
   * `/djen/publicacoes` como se "publicacoes" fosse um id.
   */
  @Get('publicacoes')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Procura no que já foi baixado: teor, parte, advogado, OAB ou NPU.' })
  buscar(@Query() filtro: BuscaPublicacoesDto, @CurrentUser() user: AuthUser) {
    /**
     * O ESCOPO VEM DO TOKEN, NUNCA DO CLIENTE.
     *
     * O parâmetro é um booleano — "quero só os meus" — e o id de quem são "os
     * meus" sai do usuário autenticado. Aceitar um `advogadoId` na query
     * deixaria qualquer um ler o acervo de qualquer colega mudando a URL.
     */
    return this.busca.buscar({
      ...filtro,
      meusProcessosDe: filtro.meus === 'true' ? user.id : undefined,
    });
  }

  /** Tribunais e providências presentes no acervo — alimenta os filtros. */
  @Get('publicacoes/facetas')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Valores disponíveis para filtrar a busca.' })
  facetas() {
    return this.busca.facetas();
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
   * CNJ dezenas de vezes. A cadência é imposta pelo próprio `DjenService`, que
   * respeita a cota de 20 requisições por minuto do CNJ — por isso a varredura
   * completa pode demorar minutos, e é melhor assim que levar 403 no meio.
   */
  @Post('sincronizar')
  @Roles(UserRole.ADMINISTRADOR)
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Varredura completa do DJEN (OAB dos advogados + processos mudos).' })
  varrer() {
    return this.sync.varrer();
  }
}
