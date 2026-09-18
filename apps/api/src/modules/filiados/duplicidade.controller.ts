import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, Max, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DuplicidadeService } from './duplicidade.service';
import { DuplicidadeAtivaGuard, duplicidadeAtiva } from './duplicidade.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { ExclusaoDelegada } from '../../common/permissions/exclusao-delegada.decorator';

class ParFiliadosDto {
  @IsString() idA!: string;
  @IsString() idB!: string;
}

class FundirDto {
  @IsString() manterId!: string;
  @IsString() descartarId!: string;
}

class FundirGrupoDto {
  @IsString() manterId!: string;
  /** Os outros cadastros do grupo — o teto acompanha o do serviço (10 no total). */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(9) @IsString({ each: true }) descartarIds!: string[];
}

class GrupoDto {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(10) @IsString({ each: true }) ids!: string[];
}

class ForaDoGrupoDto {
  @IsString() id!: string;
  /** Os outros do grupo — o que sai é gravado como distinto de cada um deles. */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(9) @IsString({ each: true }) outros!: string[];
}

class LoteDto {
  /** Teto de 100 por chamada — ver `executarLote`, sobre fatiar. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limite?: number;
}

/**
 * Mutirão de consolidação de cadastros duplicados.
 *
 * MÓDULO PRÓPRIO NA MATRIZ, "Cadastros duplicados" (15/09/2026). A fila inteira
 * responde a UMA permissão, e o Administrador escolhe quem a recebe — de
 * qualquer perfil. Nenhum perfil nasce com ela, e só ele a libera ou retira.
 *
 * O caminho até aqui, no mesmo dia: a Triagem via só "Não é duplicado" (que
 * tirava o par da fila de quem podia consolidar — 2 dos 3 descartes da produção
 * vieram da Coordenação); a fila virou do Administrador; e o dono pediu para
 * poder delegá-la. Dizer se dois cadastros são a mesma pessoa continua sendo UMA
 * decisão, só que agora de quem o Administrador escolher.
 *
 * VISUALIZAR acompanha a fila. EDITAR decide tudo: "não é duplicado", devolver à
 * fila e CONSOLIDAR — um par, um grupo de três ou mais, ou o lote. Consolidar
 * apaga, então as quatro rotas DELETE levam a marca de exclusão delegada; sem
 * ela a trava global as manteria só do Administrador.
 *
 * `@ModuloTenant('duplicados')`, a mesma chave da permissão (o
 * `gate-por-modulo.spec.ts` exige): cada instalação liga a fila na própria lista
 * de módulos, ao lado de `filiados`.
 *
 * REGISTRADO ANTES de FiliadosController no módulo, de propósito: o Nest
 * resolve rotas na ordem de registro, e o `@Get(':id')` de lá casaria com
 * "duplicidade", devolvendo "filiado não encontrado" em vez desta tela.
 */
@ApiTags('filiados')
@ApiBearerAuth()
@ModuloTenant('duplicados')
@Modulo('duplicados')
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
    return {
      total: itens.length,
      // Em quantos a filiação mais antiga será preservada. É o que autoriza a
      // tela a parar de dizer "o removido só tem nome e matrícula".
      recuamFiliacao: itens.filter((i) => i.recuaFiliacao).length,
      /*
        GRUPOS, e não pares — a tela subtraía errado (18/09/2026).
        O painel dizia "depois deles sobram N" fazendo `fila - pares`, mas um
        grupo de três gera dois pares: na base, 925 pares saem de 798 grupos, e
        a conta prometia 498 quando sobram 625. Errar por baixo é pior que não
        dizer: a pessoa termina o lote e encontra 127 grupos que não esperava.
      */
      gruposResolvidos: new Set(itens.map((i) => i.manterId)).size,
      amostra: itens.slice(0, 25),
    };
  }

  /**
   * Executa uma FATIA do lote. O front chama repetidamente até `restantes`
   * zerar, o que dá progresso real e evita que 704 fusões numa requisição só
   * estourem o tempo do proxy.
   *
   * DELETE porque apaga; quem tem EDITAR em "Cadastros duplicados" executa.
   */
  @Delete('lote')
  @ExclusaoDelegada()
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

  /**
   * Marca TODOS os pares do grupo como pessoas diferentes (17/09/2026).
   *
   * A decisão é gravada por par: em grupo de três, marcar só o primeiro par
   * deixava os outros dois de pé e o grupo voltava na varredura seguinte.
   */
  @Post('distintos-grupo')
  @UseGuards(DuplicidadeAtivaGuard)
  distintosGrupo(@Body() dto: GrupoDto, @CurrentUser('nome') autor: string) {
    return this.service.marcarGrupoDistinto(dto.ids, autor);
  }

  /**
   * Tira UM cadastro do grupo (17/09/2026): ele é gravado como pessoa diferente
   * de cada um dos outros, e o resto do grupo continua na fila.
   */
  @Post('fora-do-grupo')
  @UseGuards(DuplicidadeAtivaGuard)
  foraDoGrupo(@Body() dto: ForaDoGrupoDto, @CurrentUser('nome') autor: string) {
    return this.service.marcarForaDoGrupo(dto.id, dto.outros, autor);
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
  @ExclusaoDelegada()
  @UseGuards(DuplicidadeAtivaGuard)
  voltarParaFila(@Param('id') id: string, @CurrentUser('nome') autor: string) {
    return this.service.voltarParaFila(id, autor);
  }

  /**
   * Consolida um GRUPO inteiro no cadastro mantido — três ou mais. A checagem de
   * CPF vem antes de qualquer exclusão; ver `DuplicidadeService.fundirGrupo`.
   */
  @Delete('fundir-grupo')
  @ExclusaoDelegada()
  @UseGuards(DuplicidadeAtivaGuard)
  fundirGrupo(@Body() dto: FundirGrupoDto, @CurrentUser('nome') autor: string) {
    return this.service.fundirGrupo(dto.manterId, dto.descartarIds, autor);
  }

  /**
   * Funde e apaga o descartado. Copia antes o que só ele tem, registra no
   * histórico do mantido e na auditoria — ver `DuplicidadeService.fundir`.
   */
  @Delete('fundir')
  @ExclusaoDelegada()
  @UseGuards(DuplicidadeAtivaGuard)
  fundir(@Body() dto: FundirDto, @CurrentUser('nome') autor: string) {
    return this.service.fundir(dto.manterId, dto.descartarId, autor);
  }
}
