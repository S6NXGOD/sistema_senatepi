import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray, IsInt, IsOptional, IsString, IsBoolean, IsEnum, Max, Min, MaxLength,
} from 'class-validator';
import { ModoVotacao, UserRole } from '@prisma/client';
import { VotacaoService } from './votacao.service';
import { SorteioService } from './sorteio.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

class CriarPautaDto {
  @IsString() @MaxLength(300) titulo!: string;
  @IsOptional() @IsString() @MaxLength(2000) descricao?: string;
  /** `[{ id, rotulo }]` — validado em `VotacaoService.validarOpcoes`. */
  @IsArray() opcoes!: unknown[];
  @IsOptional() @IsEnum(ModoVotacao) modo?: ModoVotacao;
  @IsOptional() @IsInt() @Min(1) quorumMinimo?: number;
  @IsOptional() @IsInt() @Min(0) ordem?: number;
}

class SortearDto {
  @IsString() @MaxLength(200) titulo!: string;
  @IsOptional() @IsString() @MaxLength(200) premio?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) quantidade?: number;
  @IsOptional() @IsBoolean() somenteAdimplentes?: boolean;
}

class VotarDto {
  /** Credencial do participante — devolvida no check-in. */
  @IsString() presencaId!: string;
  @IsString() opcaoId!: string;
}

/**
 * MESA DIRETORA — quem conduz a assembleia.
 *
 * Abrir e encerrar votação, criar pautas e sortear são atos de condução, não de
 * participação: ficam com ADMINISTRADOR e COORDENAÇÃO.
 */
@ApiTags('plenario')
@ApiBearerAuth()
@Controller('eventos/:eventoId/plenario')
export class PlenarioAdminController {
  constructor(
    private readonly votacao: VotacaoService,
    private readonly sorteio: SorteioService,
  ) {}

  @Get('pautas')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  listarPautas(@Param('eventoId') eventoId: string) {
    return this.votacao.listar(eventoId);
  }

  @Post('pautas')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  criarPauta(
    @Param('eventoId') eventoId: string,
    @Body() dto: CriarPautaDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.votacao.criar(eventoId, dto, autor);
  }

  @Post('pautas/:pautaId/abrir')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  abrir(@Param('pautaId') pautaId: string, @CurrentUser('nome') autor: string) {
    return this.votacao.abrir(pautaId, autor);
  }

  /** Encerra e devolve a apuração — é o momento em que o resultado existe. */
  @Post('pautas/:pautaId/encerrar')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  encerrar(@Param('pautaId') pautaId: string, @CurrentUser('nome') autor: string) {
    return this.votacao.encerrar(pautaId, autor);
  }

  @Get('pautas/:pautaId/apuracao')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  apurar(@Param('pautaId') pautaId: string) {
    return this.votacao.apurar(pautaId);
  }

  @Post('sorteios')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  sortear(
    @Param('eventoId') eventoId: string,
    @Body() dto: SortearDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.sorteio.sortear(eventoId, dto, autor);
  }

  @Get('sorteios')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  listarSorteios(@Param('eventoId') eventoId: string) {
    return this.sorteio.listar(eventoId);
  }

  /** Reexecuta a seed e confirma que o resultado gravado é o que ela produz. */
  @Get('sorteios/:sorteioId/conferir')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  conferir(@Param('sorteioId') sorteioId: string) {
    return this.sorteio.conferir(sorteioId);
  }
}

/**
 * PARTICIPANTE — quem está na assembleia, sem login.
 *
 * A credencial é o `presencaId`, entregue no check-in. Sem ele não há voto:
 * é o que amarra a urna ao quórum, porque não existe voto de quem não consta
 * como presente.
 */
@ApiTags('plenario-publico')
@Public()
@Controller('sala/:eventoId')
export class PlenarioPublicoController {
  constructor(
    private readonly votacao: VotacaoService,
    private readonly sorteio: SorteioService,
  ) {}

  /**
   * Estado ao vivo da sala. É este endpoint que a tela consulta a cada 3s.
   *
   * Enquanto a pauta está ABERTA, devolve só quantos já votaram — nunca o
   * placar. Resultado parcial influencia quem ainda não votou.
   */
  @Get('ao-vivo')
  async aoVivo(
    @Param('eventoId') eventoId: string,
    @Query('presencaId') presencaId?: string,
  ) {
    const [pauta, sorteios] = await Promise.all([
      this.votacao.pautaAoVivo(eventoId, presencaId),
      this.sorteio.listar(eventoId),
    ]);
    return {
      pauta,
      ultimoSorteio: sorteios[0] ?? null,
      // Muda sempre que algo relevante muda: a tela só redesenha quando a
      // versão avança, em vez de a cada resposta do polling.
      versao: [
        pauta?.id ?? '-',
        pauta?.status ?? '-',
        pauta?.votantes ?? '-',
        sorteios[0]?.id ?? '-',
      ].join('|'),
    };
  }

  @Post('votar/:pautaId')
  votar(@Param('pautaId') pautaId: string, @Body() dto: VotarDto) {
    return this.votacao.votar({
      pautaId,
      presencaId: dto.presencaId,
      opcaoId: dto.opcaoId,
    });
  }
}
