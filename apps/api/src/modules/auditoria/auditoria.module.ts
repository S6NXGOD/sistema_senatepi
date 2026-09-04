import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AcaoAuditoria, Prisma, UserRole } from '@prisma/client';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Response } from 'express';
import { conteudoDisposto, nomeDeArquivo } from '@core/infra';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { descricaoLegivel, lerLinhaHttp } from '../../common/audit/audit.frases';

/**
 * O REGISTRO DE QUEM FEZ O QUÊ — e a tela que finalmente o mostra.
 *
 * O log existia e já tinha 2.903 linhas de agosto para cá; o que não existia
 * era como ler. A rota aceitava filtrar por ação e por usuário, a página web
 * dizia "em construção", e o resultado prático era um dado gravado que ninguém
 * consultava — pior que não gravar, porque dá a impressão de controle.
 *
 * O QUE A AUDITORIA RESPONDE, e é para isso que ela serve num sindicato:
 * "quem apagou este processo?", "quem alterou a situação desta filiada?",
 * "quem entrou no sistema no fim de semana?". Todas as três precisam de PERÍODO
 * e de BUSCA POR TEXTO, que era o que faltava.
 *
 * ELA NÃO É EDITÁVEL, e nem se apaga. Não há POST, PATCH nem DELETE aqui de
 * propósito: registro de auditoria que a própria aplicação sabe alterar não
 * serve de prova de nada. A poda, quando existir, é decisão de infraestrutura
 * com retenção declarada — não um botão na tela.
 *
 * `entidade` VEM DE DOIS JEITOS: alguns pontos gravam o nome do modelo
 * ("Processo", "Compromisso") e outros gravam a ROTA ("/api/filiados"). São dois
 * escritores com convenções diferentes, e a tela mostra os dois como estão em
 * vez de esconder metade — normalizar aqui apagaria a diferença sem consertá-la.
 */

/** Trinta dias: o que a coordenação olha sem pensar no assunto. */
const DIAS_PADRAO = 30;
const PAGINA = 40;
/** Teto do CSV: exportar 100 mil linhas trava o navegador de quem pediu. */
const MAX_EXPORT = 5_000;

export class ListarAuditoriaDto {
  @ApiPropertyOptional({ enum: AcaoAuditoria })
  @IsOptional() @IsEnum(AcaoAuditoria) acao?: AcaoAuditoria;

  @ApiPropertyOptional({ description: 'Quem praticou o ato.' })
  @IsOptional() @IsString() userId?: string;

  @ApiPropertyOptional({ description: 'Entidade afetada ("Processo", "/api/filiados").' })
  @IsOptional() @IsString() entidade?: string;

  @ApiPropertyOptional({ description: 'Texto na descrição, no id do alvo ou no IP.' })
  @IsOptional() @IsString() q?: string;

  @ApiPropertyOptional({ description: 'Início (AAAA-MM-DD). Padrão: 30 dias atrás.' })
  @IsOptional() @IsISO8601() de?: string;

  @ApiPropertyOptional({ description: 'Fim (AAAA-MM-DD), inclusive. Padrão: hoje.' })
  @IsOptional() @IsISO8601() ate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export interface OpcoesDeFiltro {
  usuarios: { id: string; nome: string }[];
  entidades: string[];
  acoes: string[];
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  /** O `where` é um só para a listagem e para o CSV — senão exportam coisas diferentes. */
  private montarWhere(q: ListarAuditoriaDto): Prisma.AuditoriaWhereInput {
    const de = q.de ? new Date(`${q.de.slice(0, 10)}T00:00:00-03:00`) : this.padraoDe();
    // O fim é INCLUSIVO: "até 30/09" tem de conter o dia 30 inteiro.
    const ate = q.ate
      ? new Date(new Date(`${q.ate.slice(0, 10)}T00:00:00-03:00`).getTime() + 24 * 3_600_000)
      : new Date(Date.now() + 60_000);

    const termo = q.q?.trim();
    return {
      acao: q.acao,
      userId: q.userId,
      entidade: q.entidade,
      createdAt: { gte: de, lt: ate },
      ...(termo
        ? {
            OR: [
              { descricao: { contains: termo, mode: 'insensitive' } },
              { entidadeId: { contains: termo, mode: 'insensitive' } },
              { ip: { contains: termo } },
            ],
          }
        : {}),
    };
  }

  private padraoDe(): Date {
    return new Date(Date.now() - DIAS_PADRAO * 24 * 3_600_000);
  }

  async listar(q: ListarAuditoriaDto) {
    const page = Number(q.page) || 1;
    const where = this.montarWhere(q);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditoria.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGINA,
        take: PAGINA,
        include: { user: { select: { id: true, nome: true, nomeExibicao: true, role: true } } },
      }),
      this.prisma.auditoria.count({ where }),
    ]);
    /*
      A TRADUÇÃO ACONTECE NA LEITURA, e o banco fica intocado.

      1.555 dos 2.973 registros da produção (52%) foram gravados como linha de
      curl — `POST /api/processos/instancias/reavaliar?limite=10`. O
      interceptor já não faz mais isso, mas o passado continua lá, e é ele que
      a tela mostra hoje.

      Reescrever o histórico seria o conserto errado: um log que a própria
      aplicação edita deixa de servir como prova, e é o único motivo de ele
      existir. A rota crua continua gravada e aparece no detalhe expandido; o
      que muda é a FRASE que se lê primeiro.
    */
    return {
      data: data.map((r) => ({
        ...r,
        descricao: descricaoLegivel(r.descricao),
        /** A linha original, para quem for investigar de verdade. */
        rotaOriginal: lerLinhaHttp(r.descricao)?.caminho ?? null,
      })),
      total,
      page,
      pageSize: PAGINA,
      totalPages: Math.max(Math.ceil(total / PAGINA), 1),
    };
  }

  /**
   * As opções dos seletores saem do que EXISTE no log, e não de uma lista fixa:
   * uma entidade que nunca foi auditada não deve aparecer como filtro que
   * devolve zero, e uma que apareceu mês passado não pode sumir do seletor.
   */
  async opcoes(): Promise<OpcoesDeFiltro> {
    const [usuarios, entidades] = await Promise.all([
      this.prisma.user.findMany({
        where: { auditorias: { some: {} } },
        select: { id: true, nome: true, nomeExibicao: true },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.auditoria.groupBy({
        by: ['entidade'],
        _count: { _all: true },
        orderBy: { _count: { entidade: 'desc' } },
        take: 40,
      }),
    ]);
    return {
      usuarios: usuarios.map((u) => ({ id: u.id, nome: u.nomeExibicao || u.nome })),
      entidades: entidades.map((e) => e.entidade).filter((e): e is string => !!e),
      acoes: Object.values(AcaoAuditoria),
    };
  }

  /** O mesmo recorte da tela, em CSV — quem audita cruza com outra planilha. */
  async exportar(q: ListarAuditoriaDto) {
    return this.prisma.auditoria.findMany({
      where: this.montarWhere(q),
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT,
      include: { user: { select: { nome: true, nomeExibicao: true } } },
    });
  }
}

type LinhaExport = Awaited<ReturnType<AuditoriaService['exportar']>>[number];

/** `;` e BOM: sem os dois, o Excel em português quebra acento e coluna. */
export function csvDaAuditoria(linhas: LinhaExport[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cab = ['Quando', 'Quem', 'Ação', 'Entidade', 'Id do alvo', 'Descrição', 'IP'];
  const corpo = linhas.map((l) =>
    [
      new Date(l.createdAt).toLocaleString('pt-BR'),
      l.user?.nomeExibicao || l.user?.nome || '(sistema)',
      l.acao,
      l.entidade ?? '',
      l.entidadeId ?? '',
      // O CSV leva a MESMA frase da tela; quem cruza planilha não deveria
      // receber a linha de curl que a tela já traduziu.
      descricaoLegivel(l.descricao) ?? '',
      l.ip ?? '',
    ]
      .map(esc)
      .join(';'),
  );
  return '﻿' + [cab.map(esc).join(';'), ...corpo].join('\r\n');
}

@ApiTags('auditoria')
@ApiBearerAuth()
@ModuloTenant('auditoria')
@Modulo('auditoria')
@Controller('auditoria')
class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  /*
    ANTES da rota raiz não é preciso (o caminho difere), mas as duas auxiliares
    ficam juntas por leitura.
  */
  @Get('opcoes')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  @ApiOperation({ summary: 'Usuários, entidades e ações que existem no log.' })
  opcoes() {
    return this.service.opcoes();
  }

  @Get('export.csv')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  @ApiOperation({ summary: 'O recorte atual em CSV.' })
  async exportar(@Query() q: ListarAuditoriaDto, @Res() res: Response) {
    const linhas = await this.service.exportar(q);
    const nome = nomeDeArquivo(['auditoria', new Date().toISOString().slice(0, 10)], 'csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', conteudoDisposto(nome, 'attachment'));
    res.send(csvDaAuditoria(linhas));
  }

  @Get()
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  @ApiOperation({ summary: 'Quem fez o quê, no período.' })
  listar(@Query() q: ListarAuditoriaDto) {
    return this.service.listar(q);
  }
}

@Module({
  controllers: [AuditoriaController],
  providers: [AuditoriaService],
})
export class AuditoriaModule {}
