import { QrCodeService, QrPayload, StorageService } from '@core/infra';
import {
  BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException,
  Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import {
  OrigemAcesso, SituacaoFiliado, StatusColaborador, TipoDependente, TipoPessoa, UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { AuditService } from '../../common/audit/audit.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { calcularIdade, dependenteValidoParaEvento } from '../dependentes/dependentes.module';

/**
 * PORTARIA — entrada no clube do sindicato.
 *
 * É o caminho NORMAL de validação: alguém chega ao clube e a portaria confere se
 * pode entrar. O evento é a exceção (e continua em `presencas`, que registra
 * presença em evento com certificado e quórum).
 *
 * TRÊS FORMAS DE IDENTIFICAR, porque a realidade do balcão pede as três:
 * carteirinha com QR (o normal), matrícula (esqueceu a carteirinha) e CPF (não
 * lembra a matrícula). A matrícula procura tanto a do sindicato quanto a
 * funcional do empregador — num sindicato de servidores é a segunda que a
 * pessoa sabe de cor.
 */

/** Rótulo do parentesco — sem isto, mãe aparecia como "Filho(a)". */
const PARENTESCO: Record<TipoDependente, string> = {
  CONJUGE: 'Cônjuge',
  FILHO: 'Filho(a)',
  PAI: 'Pai',
  MAE: 'Mãe',
};

const STATUS_COLAB: Record<StatusColaborador, string> = {
  ATIVO: 'ativo',
  INATIVO: 'inativo',
  AFASTADO: 'afastado',
  FERIAS: 'de férias',
  DESLIGADO: 'desligado',
};

class ValidarAcessoDto {
  @ApiPropertyOptional({ description: 'Payload lido do QR da carteirinha.', type: Object })
  @IsOptional() @IsObject() qr?: QrPayload;

  @ApiPropertyOptional({
    description:
      'Matrícula (do sindicato ou funcional) ou CPF, quando a pessoa está sem a carteirinha.',
  })
  @IsOptional() @IsString() identificador?: string;
}

interface PessoaResolvida {
  tipoPessoa: TipoPessoa;
  nome: string;
  fotoThumbKey?: string | null;
  liberado: boolean;
  motivo: string;
  fk: { filiadoId?: string; dependenteId?: string; colaboradorId?: string };
}

@Injectable()
export class AcessosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Regras de liberação — uma por tipo de pessoa
  // -------------------------------------------------------------------------

  private doFiliado(f: {
    id: string; nomeCompleto: string; situacao: SituacaoFiliado; fotoThumbKey: string | null;
  }, qrValido = true): PessoaResolvida {
    const ativo = f.situacao === SituacaoFiliado.ATIVO;
    return {
      tipoPessoa: TipoPessoa.FILIADO,
      nome: f.nomeCompleto,
      fotoThumbKey: f.fotoThumbKey,
      liberado: qrValido && ativo,
      motivo: !qrValido
        ? 'QR Code inválido'
        : ativo
          ? 'Entrada liberada'
          : `Cadastro ${f.situacao.toLowerCase()}`,
      fk: { filiadoId: f.id },
    };
  }

  private doDependente(d: {
    id: string; nome: string; tipo: TipoDependente; dataNascimento: Date;
    fotoThumbKey: string | null; filiado: { situacao: SituacaoFiliado };
  }, qrValido = true): PessoaResolvida {
    const responsavelAtivo = d.filiado.situacao === SituacaoFiliado.ATIVO;
    // A mesma regra dos eventos: só FILHO tem limite de idade.
    const idadeOk = dependenteValidoParaEvento(d.tipo, d.dataNascimento);
    return {
      tipoPessoa: TipoPessoa.DEPENDENTE,
      nome: `${d.nome} (${PARENTESCO[d.tipo]})`,
      fotoThumbKey: d.fotoThumbKey,
      liberado: qrValido && responsavelAtivo && idadeOk,
      motivo: !qrValido
        ? 'QR Code inválido'
        : !responsavelAtivo
          ? 'Filiado responsável inativo'
          : !idadeOk
            ? `Filho acima de 18 anos (${calcularIdade(d.dataNascimento)} anos)`
            : 'Entrada liberada',
      fk: { dependenteId: d.id },
    };
  }

  private doColaborador(c: {
    id: string; nome: string; status: StatusColaborador; fotoThumbKey: string | null;
    vencimentoContrato: Date | null;
  }, qrValido = true): PessoaResolvida {
    const ativo = c.status === StatusColaborador.ATIVO;
    const vigente = !c.vencimentoContrato || c.vencimentoContrato >= new Date();
    return {
      tipoPessoa: TipoPessoa.COLABORADOR,
      nome: c.nome,
      fotoThumbKey: c.fotoThumbKey,
      liberado: qrValido && ativo && vigente,
      motivo: !qrValido
        ? 'QR Code inválido'
        : !ativo
          ? `Colaborador ${STATUS_COLAB[c.status]}`
          : !vigente
            ? 'Contrato fora de vigência'
            : 'Entrada liberada',
      fk: { colaboradorId: c.id },
    };
  }

  // -------------------------------------------------------------------------

  private async porQr(payload: QrPayload): Promise<PessoaResolvida> {
    if (payload.tipo === 'filiado') {
      const f = await this.prisma.filiado.findUnique({ where: { id: payload.id } });
      if (!f) throw new NotFoundException('Filiado não encontrado');
      return this.doFiliado(f, this.qr.validarAssinatura(payload, f.qrToken));
    }
    if (payload.tipo === 'dependente') {
      const d = await this.prisma.dependente.findUnique({
        where: { id: payload.id },
        include: { filiado: true },
      });
      if (!d) throw new NotFoundException('Dependente não encontrado');
      return this.doDependente(d, this.qr.validarAssinatura(payload, d.qrToken));
    }
    if (payload.tipo === 'colaborador') {
      const c = await this.prisma.colaborador.findUnique({ where: { id: payload.id } });
      if (!c) throw new NotFoundException('Colaborador não encontrado');
      return this.doColaborador(c, this.qr.validarAssinatura(payload, c.qrToken));
    }
    throw new BadRequestException('Tipo de QR Code desconhecido');
  }

  /**
   * Identificação sem carteirinha.
   *
   * A ORDEM DA BUSCA segue o que a pessoa costuma saber de cor: primeiro a
   * matrícula (do sindicato, depois a funcional do empregador), por fim o CPF.
   * Sem assinatura para conferir — quem digita é a portaria, e a conferência
   * visual é a foto que volta na tela.
   */
  private async porIdentificador(
    bruto: string,
  ): Promise<{ pessoa: PessoaResolvida; origem: OrigemAcesso } | null> {
    const texto = bruto.trim();
    const digitos = texto.replace(/\D/g, '');

    const porMatriculaSindicato = await this.prisma.filiado.findFirst({
      where: { matricula: { equals: texto, mode: 'insensitive' } },
    });
    if (porMatriculaSindicato) {
      return { pessoa: this.doFiliado(porMatriculaSindicato), origem: OrigemAcesso.MATRICULA };
    }

    const porMatriculaFuncional = await this.prisma.vinculoProfissional.findFirst({
      where: { matricula: { equals: texto, mode: 'insensitive' } },
      include: { filiado: true },
    });
    if (porMatriculaFuncional) {
      return {
        pessoa: this.doFiliado(porMatriculaFuncional.filiado),
        origem: OrigemAcesso.MATRICULA,
      };
    }

    // CPF só entra na busca com os 11 dígitos — pedaço de CPF acharia a pessoa
    // errada, e na portaria isso é liberar entrada para quem não devia.
    if (digitos.length === 11) {
      const f = await this.prisma.filiado.findFirst({ where: { cpf: digitos } });
      if (f) return { pessoa: this.doFiliado(f), origem: OrigemAcesso.CPF };

      const d = await this.prisma.dependente.findFirst({
        where: { cpf: digitos },
        include: { filiado: true },
      });
      if (d) return { pessoa: this.doDependente(d), origem: OrigemAcesso.CPF };

      const c = await this.prisma.colaborador.findFirst({ where: { cpf: digitos } });
      if (c) return { pessoa: this.doColaborador(c), origem: OrigemAcesso.CPF };
    }

    return null;
  }

  /**
   * Valida e REGISTRA a entrada — inclusive quando nega.
   *
   * O registro da recusa é o que dá valor ao histórico: saber que um desfiliado
   * tentou entrar ontem vale mais que saber que dez filiados entraram.
   */
  async validar(dto: ValidarAcessoDto, ctx: { userId?: string; ip?: string; userAgent?: string }) {
    if (!dto.qr && !dto.identificador?.trim()) {
      throw new BadRequestException('Informe o QR da carteirinha, a matrícula ou o CPF.');
    }

    let pessoa: PessoaResolvida | null = null;
    let origem: OrigemAcesso = OrigemAcesso.QR;

    if (dto.qr) {
      pessoa = await this.porQr(dto.qr);
    } else {
      const achado = await this.porIdentificador(dto.identificador!);
      if (achado) {
        pessoa = achado.pessoa;
        origem = achado.origem;
      } else {
        // NÃO ENCONTRADO TAMBÉM É REGISTRO. Sem isto, a portaria não consegue
        // mostrar depois que alguém tentou entrar com uma matrícula que não
        // existe — que é justamente o caso que gera discussão no balcão.
        origem = /^\d{11}$/.test(dto.identificador!.replace(/\D/g, ''))
          ? OrigemAcesso.CPF
          : OrigemAcesso.MATRICULA;
        await this.prisma.registroAcesso.create({
          data: {
            tipoPessoa: TipoPessoa.FILIADO,
            nomeSnapshot: `(não encontrado) ${dto.identificador!.trim()}`,
            origem,
            identificador: dto.identificador!.trim(),
            liberado: false,
            motivo: 'Nenhum cadastro encontrado para este número',
            registradoPor: ctx.userId ?? null,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
        });
        return {
          encontrado: false,
          liberado: false,
          motivo: 'Nenhum cadastro encontrado para este número',
        };
      }
    }

    const registro = await this.prisma.registroAcesso.create({
      data: {
        tipoPessoa: pessoa.tipoPessoa,
        ...pessoa.fk,
        nomeSnapshot: pessoa.nome,
        origem,
        identificador: dto.identificador?.trim() ?? null,
        liberado: pessoa.liberado,
        motivo: pessoa.motivo,
        registradoPor: ctx.userId ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      select: { id: true, registradoEm: true },
    });

    return {
      encontrado: true,
      liberado: pessoa.liberado,
      motivo: pessoa.motivo,
      nome: pessoa.nome,
      tipoPessoa: pessoa.tipoPessoa,
      origem,
      registroId: registro.id,
      registradoEm: registro.registradoEm,
      fotoUrl: pessoa.fotoThumbKey
        ? await this.storage.getSignedUrl(pessoa.fotoThumbKey).catch(() => null)
        : null,
    };
  }

  /** Histórico da portaria — o padrão é o dia de hoje. */
  async listar(q: { de?: string; ate?: string; filiadoId?: string; limite?: string }) {
    const inicio = q.de ? new Date(`${q.de}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
    const fim = q.ate ? new Date(`${q.ate}T23:59:59`) : new Date();
    return this.prisma.registroAcesso.findMany({
      where: {
        registradoEm: { gte: inicio, lte: fim },
        ...(q.filiadoId ? { filiadoId: q.filiadoId } : {}),
      },
      orderBy: { registradoEm: 'desc' },
      take: Math.min(500, Number(q.limite) || 200),
      select: {
        id: true, nomeSnapshot: true, tipoPessoa: true, registradoEm: true,
        origem: true, liberado: true, motivo: true, filiadoId: true,
      },
    });
  }
}

@ApiTags('acessos')
@ApiBearerAuth()
@ModuloTenant('acessos')
@Controller('acessos')
export class AcessosController {
  constructor(private readonly service: AcessosService) {}

  @Post('validar')
  @ApiOperation({ summary: 'Valida e registra a entrada no clube (QR, matrícula ou CPF).' })
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  validar(
    @Body() dto: ValidarAcessoDto,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.service.validar(dto, {
      userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get()
  @ApiOperation({ summary: 'Histórico de entradas — padrão: hoje.' })
  listar(
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('filiadoId') filiadoId?: string,
    @Query('limite') limite?: string,
  ) {
    return this.service.listar({ de, ate, filiadoId, limite });
  }
}

@Module({
  controllers: [AcessosController],
  providers: [AcessosService],
  exports: [AcessosService],
})
export class AcessosModule {}
