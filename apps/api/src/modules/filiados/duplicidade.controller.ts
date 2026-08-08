import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { DuplicidadeService } from './duplicidade.service';
import { DuplicidadeAtivaGuard, duplicidadeAtiva } from './duplicidade.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';

class ParFiliadosDto {
  @IsString() idA!: string;
  @IsString() idB!: string;
}

class FundirDto {
  @IsString() manterId!: string;
  @IsString() descartarId!: string;
}

class LoteDto {
  /** Teto de 100 por chamada — ver `executarLote`, sobre fatiar. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limite?: number;
}

/**
 * Mutirão de consolidação de cadastros duplicados.
 *
 * REGISTRADO ANTES de FiliadosController no módulo, de propósito: o Nest
 * resolve rotas na ordem de registro, e o `@Get(':id')` de lá casaria com
 * "duplicidade", devolvendo "filiado não encontrado" em vez desta tela.
 */
@ApiTags('filiados')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Controller('filiados/duplicidade')
export class DuplicidadeController {
  constructor(private readonly service: DuplicidadeService) {}

  /**
   * Estado do recurso — a ÚNICA rota que responde com o mutirão desligado.
   *
   * O front pergunta aqui em vez de carregar a decisão embutida: as
   * NEXT_PUBLIC_* do Next são resolvidas no build, então uma flag no front
   * exigiria rebuildar o serviço web só para desligar. Perguntando à API, o
   * desligamento vale na hora.
   *
   * `pendentes` é o que faz a tela sumir sozinha quando o último grupo for
   * resolvido, sem ninguém precisar lembrar de desligar nada.
   */
  @Get('status')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  async status() {
    const ativo = duplicidadeAtiva();
    return { ativo, pendentes: ativo ? await this.service.pendentes() : 0 };
  }

  @Get()
  @UseGuards(DuplicidadeAtivaGuard)
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  listar() {
    return this.service.varrer();
  }

  /** Prévia do lote: o que seria consolidado, para conferência antes de agir. */
  @Get('lote')
  @UseGuards(DuplicidadeAtivaGuard)
  @Roles(UserRole.ADMINISTRADOR)
  async previaLote() {
    const itens = await this.service.elegiveisParaLote();
    return { total: itens.length, amostra: itens.slice(0, 25) };
  }

  /**
   * Executa uma FATIA do lote. O front chama repetidamente até `restantes`
   * zerar, o que dá progresso real e evita que 704 fusões numa requisição só
   * estourem o tempo do proxy.
   *
   * DELETE porque apaga: herda a regra global de que só o ADMINISTRADOR exclui.
   */
  @Delete('lote')
  @UseGuards(DuplicidadeAtivaGuard)
  @Roles(UserRole.ADMINISTRADOR)
  executarLote(@Body() dto: LoteDto, @CurrentUser('nome') autor: string) {
    return this.service.executarLote(dto.limite ?? 25, autor);
  }

  @Post('distintos')
  @UseGuards(DuplicidadeAtivaGuard)
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  distintos(@Body() dto: ParFiliadosDto, @CurrentUser('nome') autor: string) {
    return this.service.marcarDistintos(dto.idA, dto.idB, autor);
  }

  /**
   * Funde e apaga o descartado.
   *
   * É DELETE de propósito: o PermissionsGuard já bloqueia todo DELETE para
   * quem não é ADMINISTRADOR — a regra global "só o Administrador apaga" passa
   * a valer aqui sem precisar de exceção nova nem de lembrete em code review.
   */
  @Delete('fundir')
  @UseGuards(DuplicidadeAtivaGuard)
  @Roles(UserRole.ADMINISTRADOR)
  fundir(@Body() dto: FundirDto, @CurrentUser('nome') autor: string) {
    return this.service.fundir(dto.manterId, dto.descartarId, autor);
  }
}
