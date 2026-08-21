import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsDateString, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUrl,
} from 'class-validator';
import { AcaoAuditoria, Prisma, StatusEvento, TipoEvento, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { CobrancasModule } from '../cobrancas/cobrancas.module';
import { CheckinService } from './checkin.service';
import { CheckinPublicoController } from './checkin.controller';
import { VotacaoService } from './votacao.service';
import { SorteioService } from './sorteio.service';
import { DossieEventoService } from './dossie-evento.service';
import { CertificadoService } from './certificado.service';
import { EncerramentoService } from './encerramento.service';
import { PresencaListaService } from './presenca-lista.service';
import { IntegridadeAssembleiaService } from './integridade.service';
import {
  CertificadoPublicoController, PlenarioAdminController, PlenarioPublicoController,
} from './plenario.controller';
import { lerConfiguracoes, normalizarConfiguracoes } from './configuracoes-evento';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';

class CreateEventoDto {
  @ApiProperty() @IsString() nome: string;
  @ApiPropertyOptional() @IsOptional() @IsString() descricao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() local?: string;
  @ApiProperty() @IsDateString() dataInicio: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dataFim?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() capacidadeMaxima?: number;
  @ApiPropertyOptional({ enum: TipoEvento })
  @IsOptional() @IsEnum(TipoEvento) tipo?: TipoEvento;
  @ApiPropertyOptional({ enum: StatusEvento })
  @IsOptional() @IsEnum(StatusEvento) status?: StatusEvento;

  /**
   * Link da videoconferência. Colado à mão — Meet, Zoom ou Teams.
   * A geração automática pelo Google Calendar entra depois, como opção.
   */
  @ApiPropertyOptional() @IsOptional() @IsUrl() linkReuniao?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() urlVideoDrive?: string;
  /** Ata em texto — a transcrição vem do Meet, ligada pelo próprio host. */
  @ApiPropertyOptional() @IsOptional() @IsString() textoAta?: string;

  /**
   * Chaves do "camaleão". Aceita objeto solto de propósito: quem valida é
   * `normalizarConfiguracoes`, que descarta o que não reconhece. Um DTO
   * espelhando cada chave duplicaria o contrato e os dois divergiriam.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional() @IsObject() configuracoes?: Record<string, unknown>;
}

@Injectable()
export class EventosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  create(dto: CreateEventoDto) {
    return this.prisma.evento.create({
      data: {
        ...dto,
        dataInicio: new Date(dto.dataInicio),
        dataFim: dto.dataFim ? new Date(dto.dataFim) : undefined,
        // Normaliza ANTES de gravar: assim o banco nunca acumula chave
        // desconhecida nem `"habilitarVotacao": "sim"`, e quem abrir o
        // registro daqui a um ano entende o que está lá.
        configuracoes: normalizarConfiguracoes(dto.configuracoes) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  findAll() {
    return this.prisma.evento.findMany({
      orderBy: { dataInicio: 'desc' },
      include: { _count: { select: { presencas: true } } },
    });
  }

  async findOne(id: string) {
    const e = await this.prisma.evento.findUnique({
      where: { id },
      include: { _count: { select: { presencas: true, pautas: true, sorteios: true } } },
    });
    if (!e) throw new NotFoundException('Evento não encontrado');
    // Devolve as configurações COM os padrões já aplicados. A tela precisa
    // saber o valor efetivo — um JSON `{}` no banco significa "tudo no padrão",
    // e mandar o objeto vazio faria a interface desenhar todas as chaves como
    // desligadas, inclusive as que têm padrão diferente disso.
    return { ...e, configuracoes: lerConfiguracoes(e.configuracoes) };
  }

  async update(id: string, dto: Partial<CreateEventoDto>) {
    await this.findOne(id);
    return this.prisma.evento.update({
      where: { id },
      data: {
        ...dto,
        dataInicio: dto.dataInicio ? new Date(dto.dataInicio) : undefined,
        dataFim: dto.dataFim ? new Date(dto.dataFim) : undefined,
        // Só toca nas configurações se vierem no payload: um PATCH de nome não
        // pode zerar as chaves do evento de volta ao padrão.
        configuracoes: dto.configuracoes
          ? (normalizarConfiguracoes(dto.configuracoes) as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  /**
   * O que será destruído junto com o evento.
   *
   * Todas as relações são `onDelete: Cascade`: apagar o evento leva presenças,
   * pautas, votos, sorteios e a referência ao dossiê. A confirmação na tela usa
   * estes números para que a exclusão seja um ato informado — apagar uma
   * assembleia com deliberação registrada é destruir o registro de um ato
   * jurídico, e isso não se faz por engano.
   */
  async impacto(id: string) {
    const evento = await this.findOne(id);
    const [presencas, pautas, votos, sorteios] = await Promise.all([
      this.prisma.presenca.count({ where: { eventoId: id } }),
      this.prisma.pautaVotacao.count({ where: { eventoId: id } }),
      this.prisma.votoUrna.count({ where: { pauta: { eventoId: id } } }),
      this.prisma.sorteioEvento.count({ where: { eventoId: id } }),
    ]);
    return {
      nome: evento.nome,
      status: evento.status,
      presencas,
      pautas,
      votos,
      sorteios,
      dossieEmitido: !!evento.dossiePdfKey,
      /** Há registro que se perde — a tela destaca em vermelho quando verdadeiro. */
      temHistorico: presencas > 0 || pautas > 0 || sorteios > 0 || !!evento.dossiePdfKey,
    };
  }

  async remove(id: string, autor?: string) {
    const impacto = await this.impacto(id);

    // A exclusão é permitida (decisão da diretoria), mas nunca silenciosa: fica
    // na auditoria exatamente o que foi destruído, porque depois do CASCADE não
    // resta nada de onde reconstituir.
    await this.prisma.evento.delete({ where: { id } });

    await this.audit.registrar({
      acao: AcaoAuditoria.DELETE,
      entidade: 'Evento',
      entidadeId: id,
      descricao:
        `Evento "${impacto.nome}" excluído. Destruídos: ${impacto.presencas} presença(s), ` +
        `${impacto.pautas} pauta(s), ${impacto.votos} voto(s), ${impacto.sorteios} sorteio(s)` +
        (impacto.dossieEmitido ? ' e o dossiê emitido.' : '.'),
      metadata: { ...impacto },
    });

    return { ok: true, destruido: impacto };
  }
}

@ApiTags('eventos')
@ApiBearerAuth()
@ModuloTenant('eventos')
@Controller('eventos')
class EventosController {
  constructor(private readonly service: EventosService) {}

  @Post() @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  create(@Body() dto: CreateEventoDto) {
    return this.service.create(dto);
  }
  @Get() findAll() {
    return this.service.findAll();
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
  @Patch(':id') @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  update(@Param('id') id: string, @Body() dto: Partial<CreateEventoDto>) {
    return this.service.update(id, dto);
  }
  /** Quanto se perde ao apagar — alimenta a confirmação na tela. */
  @Get(':id/impacto') @Roles(UserRole.ADMINISTRADOR)
  impacto(@Param('id') id: string) {
    return this.service.impacto(id);
  }

  /**
   * SOMENTE ADMINISTRADOR.
   *
   * Listar COORDENACAO aqui era decorativo e enganoso: o PermissionsGuard já
   * recusa todo DELETE de quem não é administrador, então o decorator prometia
   * um acesso que a requisição nunca teria — e alguém lendo o código concluiria
   * que a coordenação apaga eventos.
   */
  @Delete(':id') @Roles(UserRole.ADMINISTRADOR)
  remove(@Param('id') id: string, @CurrentUser('nome') autor: string) {
    return this.service.remove(id, autor);
  }
}

@Module({
  // CobrancasModule entra para o check-in poder consultar a adimplência pela
  // regra do financeiro, em vez de reimplementá-la aqui.
  imports: [CobrancasModule],
  // PlenarioPublicoController vem ANTES de CheckinPublicoController: ambos
  // servem sob `sala/`, e o `@Get(':eventoId')` do check-in casaria com
  // "ao-vivo" se fosse registrado primeiro. O Nest resolve na ordem.
  controllers: [
    EventosController,
    PlenarioAdminController,
    PlenarioPublicoController,
    CheckinPublicoController,
    CertificadoPublicoController,
  ],
  providers: [
    EventosService, CheckinService, VotacaoService, SorteioService, DossieEventoService,
    CertificadoService, EncerramentoService, PresencaListaService,
    IntegridadeAssembleiaService,
  ],
  exports: [EventosService],
})
export class EventosModule {}
