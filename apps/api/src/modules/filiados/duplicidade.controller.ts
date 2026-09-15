import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DuplicidadeService } from './duplicidade.service';
import { DuplicidadeAtivaGuard, duplicidadeAtiva } from './duplicidade.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { OperacaoDeSistema } from '../../common/permissions/operacao-de-sistema.decorator';

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
 * DO ADMINISTRADOR, INTEIRO (15/09/2026). Consolidar já era, por ser DELETE. O
 * "não é duplicado" não: Triagem e Coordenação viam só esse botão, e ele tirava
 * o par da fila para sempre — da vista de quem podia consolidar. Na produção, 2
 * dos 3 pares descartados vieram da Coordenação, e um deles (MARIA DA CRUZ DE
 * SOUSA, 3520 × 3746) tem toda a cara de ser a mesma pessoa. É a lição da fusão
 * de organizações (12/09): dizer se dois cadastros são ou não a mesma pessoa é
 * UMA decisão, e fica com quem pode tomá-la inteira. A `status` fecha junto, e o
 * aviso da lista de Filiados some sozinho para quem não decide.
 *
 * REGISTRADO ANTES de FiliadosController no módulo, de propósito: o Nest
 * resolve rotas na ordem de registro, e o `@Get(':id')` de lá casaria com
 * "duplicidade", devolvendo "filiado não encontrado" em vez desta tela.
 */
@ApiTags('filiados')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@OperacaoDeSistema()
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
  async status() {
    const ativo = duplicidadeAtiva();
    return { ativo, pendentes: ativo ? await this.service.pendentes() : 0 };
  }

  @Get()
  @UseGuards(DuplicidadeAtivaGuard)
  listar() {
    return this.service.varrer();
  }

  /** Prévia do lote: o que seria consolidado, para conferência antes de agir. */
  @Get('lote')
  @UseGuards(DuplicidadeAtivaGuard)
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
  executarLote(@Body() dto: LoteDto, @CurrentUser('nome') autor: string) {
    return this.service.executarLote(dto.limite ?? 25, autor);
  }

  /** Tira o par da fila como pessoas diferentes. Tem volta: `DELETE distintos/:id`. */
  @Post('distintos')
  @UseGuards(DuplicidadeAtivaGuard)
  distintos(@Body() dto: ParFiliadosDto, @CurrentUser('nome') autor: string) {
    return this.service.marcarDistintos(dto.idA, dto.idB, autor);
  }

  /** Os pares marcados como pessoas diferentes, para rever o que saiu da fila. */
  @Get('descartados')
  @UseGuards(DuplicidadeAtivaGuard)
  descartados() {
    return this.service.listarDescartados();
  }

  /**
   * Devolve o par à fila apagando a marcação "pessoas diferentes". Nunca a de
   * uma consolidação: ali um dos cadastros já não existe.
   */
  @Delete('distintos/:id')
  @UseGuards(DuplicidadeAtivaGuard)
  voltarParaFila(@Param('id') id: string, @CurrentUser('nome') autor: string) {
    return this.service.voltarParaFila(id, autor);
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
  fundir(@Body() dto: FundirDto, @CurrentUser('nome') autor: string) {
    return this.service.fundir(dto.manterId, dto.descartarId, autor);
  }
}
