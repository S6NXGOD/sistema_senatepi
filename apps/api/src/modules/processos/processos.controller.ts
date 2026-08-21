import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ProcessosService } from './processos.service';
import { AudienciasService } from './audiencias.service';
import {
  AtualizarProcessoDto,
  FormalizarProcessoDto,
  ImportarProcessoDto,
  ListProcessosQueryDto,
} from './dto/processos.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

@ApiTags('processos')
@ApiBearerAuth()
@Modulo('processos')
@Controller('processos')
export class ProcessosController {
  constructor(
    private readonly service: ProcessosService,
    private readonly audiencias: AudienciasService,
  ) {}

  private ctx(req: Request, userId?: string) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], userId };
  }

  /** Gatilho de importação (On-Demand): consulta o DATAJUD e cria o cache local. */
  @Post('importar')
  @ApiOperation({ summary: 'Importa um processo do DATAJUD (409 se já existir localmente).' })
  importar(@Body() dto: ImportarProcessoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.importar(dto, this.ctx(req, userId));
  }

  /**
   * Relê no CNJ o que o parser multi-instância ainda não viu.
   *
   * Chamado pela TELA ao abrir a lista, uma vez por sessão. É POST porque muda
   * dados (grava instâncias e andamentos), e devolve `restantes` para a tela
   * saber se vale pedir outra rodada.
   */
  @Post('instancias/reavaliar')
  @ApiOperation({ summary: 'Reavalia as instâncias dos processos ainda não lidos pelo parser multi-instância.' })
  async reavaliarInstancias(@Query('limite') limite?: string, @CurrentUser('id') userId?: string, @Req() req?: Request) {
    const n = Number(limite) || 10;
    const r = await this.service.reavaliarInstancias(n);

    /**
     * RECLASSIFICAR AS AUDIÊNCIAS junto — e só na rodada "cara" (limite > 0),
     * que acontece uma vez por sessão.
     *
     * O `ehAudiencia` é calculado na GRAVAÇÃO do andamento, então melhorar o
     * classificador não conserta o que já está no banco. Foi o caso agora: os
     * códigos de audiência do TRT22 e do TJPI não eram reconhecidos, e todo o
     * histórico ficou marcado como "não é audiência". Isto reaplica a regra
     * sobre o que já existe, sem tocar no CNJ e sem desfazer decisão humana
     * (dispensa e vínculo com a agenda são preservados).
     */
    if (n > 0 && req) {
      try {
        const audiencias = await this.audiencias.reclassificar({
          ip: req.ip, userAgent: req.headers['user-agent'], userId,
        });
        return { ...r, audiencias };
      } catch {
        // Falhar aqui não pode derrubar a reavaliação das instâncias, que é o
        // motivo principal da chamada.
        return r;
      }
    }
    return r;
  }

  /**
   * Advogados que podem atuar num processo. Declarado antes de `:id` — o Nest
   * casa na ordem, e `@Get(':id')` engoliria "advogados" como se fosse um id.
   */
  @Get('advogados')
  @ApiOperation({ summary: 'Usuários com perfil ADVOGADO (seletor de equipe do processo).' })
  listarAdvogados() {
    return this.service.listarAdvogados();
  }

  /** Lista o cache local (leitura instantânea, sem consulta ao vivo). */
  @Get()
  listar(@Query() query: ListProcessosQueryDto, @CurrentUser('id') userId: string) {
    // userId alimenta o filtro rápido "Meus processos".
    return this.service.listar(query, userId);
  }

  /** Detalhe + movimentações lidos 100% do cache local. */
  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  /** Botão "Sincronizar": rebusca o NPU e insere apenas as movimentações ausentes. */
  @Patch(':id/sincronizar')
  @ApiOperation({ summary: 'Re-sincroniza incrementalmente o processo com o DATAJUD.' })
  sincronizar(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.ressincronizar(id, this.ctx(req, userId));
  }

  /** Ajuíza um caso pré-processual: recebe o NPU e busca no DataJud. */
  @Patch(':id/formalizar')
  @ApiOperation({ summary: 'Formaliza um processo em rascunho (informa o NPU; DataJud opcional).' })
  formalizar(@Param('id') id: string, @Body() dto: FormalizarProcessoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.formalizar(id, dto, this.ctx(req, userId));
  }

  /** Atualiza dados INTERNOS (status/vínculos) — não consulta o DATAJUD. */
  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarProcessoDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.atualizar(id, dto, this.ctx(req, userId));
  }

  /** Exclui o processo e todo o histórico (movimentações + anexos) — só Administrador. */
  @Delete(':id')
  @ApiOperation({ summary: 'Exclui o processo e todo o seu histórico.' })
  remover(@Param('id') id: string, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.remover(id, this.ctx(req, userId));
  }
}
