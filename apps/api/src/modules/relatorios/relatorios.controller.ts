import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { Response } from 'express';
import { conteudoDisposto, nomeDeArquivo } from '@core/infra';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { RelatoriosService, type Relatorio } from './relatorios.service';

/**
 * DTO ANTES DO CONTROLLER — armadilha de TDZ do `emitDecoratorMetadata`, a
 * mesma que já derrubou esta aplicação uma vez. Ver `djen.controller.ts`.
 */
export class PeriodoDto {
  @ApiPropertyOptional({ description: 'Início do período (AAAA-MM-DD). Padrão: 30 dias atrás.' })
  @IsOptional()
  @IsISO8601()
  de?: string;

  @ApiPropertyOptional({ description: 'Fim do período (AAAA-MM-DD), inclusive. Padrão: hoje.' })
  @IsOptional()
  @IsISO8601()
  ate?: string;

  /**
   * Espelho de UMA pessoa — para a coordenação conversar com ela, não para
   * publicar um pódio. O serviço ignora o parâmetro quando quem pede é
   * ADVOGADO: para ele o recorte já é ele mesmo, e aceitar aqui abriria o
   * espelho do colega.
   */
  @ApiPropertyOptional({ description: 'Id do usuário a focar (só para quem vê a equipe).' })
  @IsOptional()
  @IsString()
  usuarioId?: string;
}

/** Trinta dias é o período que a coordenação olha; o resto se escolhe na tela. */
const DIAS_PADRAO = 30;

@ApiTags('relatorios')
@ApiBearerAuth()
@Modulo('relatorios')
@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  @Get()
  @ApiOperation({ summary: 'Números da equipe, dos processos e dos atendimentos no período.' })
  montar(@Query() q: PeriodoDto, @CurrentUser() user: AuthUser) {
    const { de, ate } = this.periodo(q);
    return this.relatorios.montar(de, ate, user, q.usuarioId);
  }

  /**
   * CSV, e não PDF, para os NÚMEROS.
   *
   * Quem pede relatório de equipe quer somar, cruzar e colar numa apresentação.
   * PDF de tabela é bonito e inútil para isso — obriga a redigitar. O PDF fica
   * para o que é documento: o dossiê do processo, que se entrega ao filiado.
   */
  @Get('equipe.csv')
  @ApiOperation({ summary: 'A tabela da equipe em CSV, para abrir no Excel.' })
  async equipeCsv(@Query() q: PeriodoDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { de, ate } = this.periodo(q);
    const r = await this.relatorios.montar(de, ate, user, q.usuarioId);
    const nome = nomeDeArquivo(
      ['relatorio da equipe', r.periodo.de.slice(0, 10), r.periodo.ate.slice(0, 10)],
      'csv',
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', conteudoDisposto(nome, 'attachment'));
    res.send(Buffer.from(csvDaEquipe(r), 'utf8'));
  }

  private periodo(q: PeriodoDto): { de: Date; ate: Date } {
    const ate = q.ate ? new Date(q.ate) : new Date();
    const de = q.de ? new Date(q.de) : new Date(ate.getTime() - DIAS_PADRAO * 24 * 3_600_000);
    // Período invertido é erro de digitação, não pedido: inverte em silêncio em
    // vez de devolver tabela vazia e deixar a pessoa procurando o que errou.
    return de <= ate ? { de, ate } : { de: ate, ate: de };
  }
}

/**
 * CSV com separador `;` e BOM — é o que o Excel em português espera. Sem o BOM
 * ele abre com os acentos quebrados, e a primeira impressão é de que o sistema
 * erra o próprio relatório.
 */
export function csvDaEquipe(r: Relatorio): string {
  const CRLF = String.fromCharCode(13, 10);
  const BOM = String.fromCharCode(0xfeff);
  const campo = (v: string | number | null) =>
    v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;

  const linhas = [
    ['Pessoa', 'Perfil', 'Concluídas no período', 'Em aberto', 'Atrasadas', 'Mediana (min)', 'Com cronômetro']
      .map(campo)
      .join(';'),
    ...r.equipe.map((l) =>
      [l.nome, l.papel, l.concluidas, l.abertas, l.atrasadas, l.medianaMinutos, l.cronometradas]
        .map(campo)
        .join(';'),
    ),
  ];
  return BOM + linhas.join(CRLF) + CRLF;
}
