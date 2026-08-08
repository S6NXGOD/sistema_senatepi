import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import {
  AcaoAuditoria,
  SituacaoFiliado,
  StatusColaborador,
  TipoDependente,
  TipoPessoa,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QrCodeService, QrPayload } from '../../common/qrcode/qrcode.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  calcularIdade,
  dependenteValidoParaEvento,
} from '../dependentes/dependentes.module';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';

class ValidarQrDto {
  @ApiProperty({ description: 'Payload lido do QR Code', type: Object })
  @IsObject() payload: QrPayload;
  @ApiPropertyOptional({ description: 'ID do evento (registra presença se válido)' })
  @IsOptional() @IsString() eventoId?: string;
}

interface PessoaResolvida {
  tipo: TipoPessoa;
  id: string;
  nome: string;
  fotoThumbKey?: string | null;
  liberado: boolean;
  motivo: string;
  qrToken: string;
  // chaves para registrar presença
  fk: Partial<Record<'filiadoId' | 'dependenteId' | 'colaboradorId', string>>;
}

/** Motivo legível quando o colaborador não está apto a entrar. */
const STATUS_COLAB: Record<StatusColaborador, string> = {
  ATIVO: 'ativo',
  INATIVO: 'inativo',
  AFASTADO: 'afastado',
  FERIAS: 'de férias',
  DESLIGADO: 'desligado',
};

@Injectable()
export class PresencasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Resolve a pessoa do QR e aplica as regras de liberação por tipo. */
  private async resolverPessoa(payload: QrPayload): Promise<PessoaResolvida> {
    const tipo = payload.tipo;

    if (tipo === 'filiado') {
      const f = await this.prisma.filiado.findUnique({ where: { id: payload.id } });
      if (!f) throw new NotFoundException('Filiado não encontrado');
      const valido = this.qr.validarAssinatura(payload, f.qrToken);
      const ativo = f.situacao === SituacaoFiliado.ATIVO;
      return {
        tipo: TipoPessoa.FILIADO,
        id: f.id,
        nome: f.nomeCompleto,
        fotoThumbKey: f.fotoThumbKey,
        liberado: valido && ativo,
        motivo: !valido ? 'QR Code inválido' : ativo ? 'Entrada liberada' : `Cadastro ${f.situacao.toLowerCase()}`,
        qrToken: f.qrToken,
        fk: { filiadoId: f.id },
      };
    }

    if (tipo === 'dependente') {
      const d = await this.prisma.dependente.findUnique({ where: { id: payload.id }, include: { filiado: true } });
      if (!d) throw new NotFoundException('Dependente não encontrado');
      const valido = this.qr.validarAssinatura(payload, d.qrToken);
      const filiadoAtivo = d.filiado.situacao === SituacaoFiliado.ATIVO;
      const idadeOk = dependenteValidoParaEvento(d.tipo, d.dataNascimento);
      let motivo = 'Entrada liberada';
      if (!valido) motivo = 'QR Code inválido';
      else if (!filiadoAtivo) motivo = 'Filiado responsável inativo';
      else if (!idadeOk)
        motivo = `Filho acima de 18 anos (${calcularIdade(d.dataNascimento)} anos)`;
      return {
        tipo: TipoPessoa.DEPENDENTE,
        id: d.id,
        nome: `${d.nome} (${d.tipo === TipoDependente.CONJUGE ? 'Cônjuge' : 'Filho(a)'})`,
        fotoThumbKey: d.fotoThumbKey,
        liberado: valido && filiadoAtivo && idadeOk,
        motivo,
        qrToken: d.qrToken,
        fk: { dependenteId: d.id },
      };
    }

    /**
     * COLABORADOR — a equipe do sindicato, cadastro único.
     *
     * Substitui os antigos 'funcionario' e 'prestador', que liam tabelas
     * separadas: o crachá trazia dados que ninguém atualizava, porque a edição
     * acontecia em Colaboradores e o QR apontava para outro registro.
     *
     * Só ATIVO entra. Afastado, de férias, inativo e desligado são recusados
     * com o motivo na tela — a portaria precisa saber POR QUE negou, e não
     * apenas que negou. Contrato vencido (PJ/terceirizado) também barra.
     */
    if (tipo === 'colaborador') {
      const c = await this.prisma.colaborador.findUnique({ where: { id: payload.id } });
      if (!c) throw new NotFoundException('Colaborador não encontrado');
      const valido = this.qr.validarAssinatura(payload, c.qrToken);
      const ativo = c.status === StatusColaborador.ATIVO;
      const vigente = !c.vencimentoContrato || c.vencimentoContrato >= new Date();

      const motivo = !valido
        ? 'QR Code inválido'
        : !ativo
          ? `Colaborador ${STATUS_COLAB[c.status]}`
          : !vigente
            ? 'Contrato fora de vigência'
            : 'Entrada liberada';

      return {
        tipo: TipoPessoa.COLABORADOR,
        id: c.id,
        nome: c.nome,
        fotoThumbKey: c.fotoThumbKey,
        liberado: valido && ativo && vigente,
        motivo,
        qrToken: c.qrToken,
        fk: { colaboradorId: c.id },
      };
    }

    throw new BadRequestException('Tipo de QR Code desconhecido');
  }

  async validar(dto: ValidarQrDto, ctx: { userId?: string; ip?: string }) {
    const pessoa = await this.resolverPessoa(dto.payload);
    const fotoUrl = pessoa.fotoThumbKey
      ? await this.storage.getSignedUrl(pessoa.fotoThumbKey).catch(() => null)
      : null;

    let presencaRegistrada = false;
    let duplicada = false;

    if (pessoa.liberado && dto.eventoId) {
      const evento = await this.prisma.evento.findUnique({ where: { id: dto.eventoId } });
      if (!evento) throw new NotFoundException('Evento não encontrado');
      try {
        await this.prisma.presenca.create({
          data: {
            eventoId: dto.eventoId,
            tipoPessoa: pessoa.tipo,
            nomeSnapshot: pessoa.nome,
            ...pessoa.fk,
          },
        });
        presencaRegistrada = true;
      } catch (e: any) {
        // Violação de unique = entrada duplicada
        if (e?.code === 'P2002') duplicada = true;
        else throw e;
      }
    }

    await this.audit.registrar({
      userId: ctx.userId,
      acao: AcaoAuditoria.VALIDACAO_QR,
      entidade: pessoa.tipo,
      entidadeId: pessoa.id,
      ip: ctx.ip,
      descricao: `${pessoa.liberado ? 'LIBERADO' : 'NEGADO'} — ${pessoa.motivo}`,
      metadata: { eventoId: dto.eventoId, duplicada },
    });

    return {
      liberado: pessoa.liberado,
      motivo: duplicada ? 'Entrada já registrada neste evento' : pessoa.motivo,
      duplicada,
      presencaRegistrada,
      pessoa: { tipo: pessoa.tipo, nome: pessoa.nome, fotoUrl },
    };
  }

  async listarPorEvento(eventoId: string) {
    return this.prisma.presenca.findMany({
      where: { eventoId },
      orderBy: { registradoEm: 'desc' },
    });
  }
}

@ApiTags('presencas')
@ApiBearerAuth()
@ModuloTenant('eventos')
@Controller()
class PresencasController {
  constructor(private readonly service: PresencasService) {}

  // Recepção/Eventos também pode validar
  @Post('validacao/qr')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  validar(@Body() dto: ValidarQrDto, @CurrentUser('id') userId: string, @Req() req: Request) {
    return this.service.validar(dto, { userId, ip: req.ip });
  }

  @Get('eventos/:eventoId/presencas')
  presencas(@Param('eventoId') eventoId: string) {
    return this.service.listarPorEvento(eventoId);
  }
}

@Module({
  controllers: [PresencasController],
  providers: [PresencasService],
  exports: [PresencasService],
})
export class PresencasModule {}
