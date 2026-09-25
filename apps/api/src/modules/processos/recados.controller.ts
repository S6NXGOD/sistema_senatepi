import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AcaoAuditoria } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';

export class EscreverRecadoDto {
  @ApiProperty({
    description: 'O recado, como o filiado vai ler no portal.',
    minLength: 3,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(3, { message: 'Escreva o recado.' })
  @MaxLength(2000, { message: 'O recado passa de 2.000 caracteres.' })
  texto: string;
}

/**
 * O RECADO DO SINDICATO PARA O FILIADO — o que faltava no portal.
 *
 * "Existe algo no sistema que o advogado pode colocar para comunicar algo ao
 * filiado pelo portal?" — o dono, 25/09/2026. Não existia.
 *
 * O portal mostrava o que o TRIBUNAL publicou, em linguagem de tribunal, e nada
 * do que o sindicato tem a dizer sobre aquilo. A pessoa lia "Decurso de Prazo"
 * e ligava para a secretaria — exatamente o telefonema que o portal deveria
 * evitar. Uma linha do advogado ("o prazo era da outra parte, não precisa fazer
 * nada") resolve o que nenhuma tradução resolve.
 *
 * NÃO É A NOTA INTERNA. `MovimentacaoInterna` é a conversa da EQUIPE sobre o
 * caso e nunca sai do sistema. Esta tabela nasce sabendo que a pessoa vai ler —
 * e a tela de quem escreve diz isso em letras grandes.
 *
 * Entra pela MATRIZ, no módulo `processos`: quem edita o processo pode falar
 * com o filiado dele. Sem `@Roles`, que seria uma segunda autorização invisível.
 */
@ApiTags('processos')
@ApiBearerAuth()
@ModuloTenant('processos')
@Modulo('processos')
@Controller('processos/:processoId/recados')
export class RecadosDoProcessoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async listar(@Param('processoId') processoId: string) {
    return this.prisma.recadoDoProcesso.findMany({
      where: { processoId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, texto: true, autorNome: true, createdAt: true, vistoEm: true },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Escreve um recado que o filiado lê no portal' })
  async escrever(
    @Param('processoId') processoId: string,
    @Body() dto: EscreverRecadoDto,
    @CurrentUser() user: AuthUser,
  ) {
    const processo = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        id: true,
        numeroCNJ: true,
        filiadoId: true,
        partes: { where: { filiadoId: { not: null } }, select: { filiadoId: true } },
      },
    });
    if (!processo) throw new NotFoundException('Processo não encontrado.');

    /*
      SEM FILIADO NO PROCESSO, NINGUÉM LÊ. Medido: 174 dos 194 processos não têm
      filiado vinculado. Deixar escrever ali produziria um recado que fica para
      sempre sem leitor — e o advogado achando que avisou.
    */
    const temLeitor = !!processo.filiadoId || processo.partes.length > 0;
    if (!temLeitor) {
      throw new BadRequestException(
        'Este processo não tem filiado vinculado — não há quem leia o recado no portal. ' +
          'Vincule a parte antes.',
      );
    }

    const recado = await this.prisma.recadoDoProcesso.create({
      data: {
        processoId,
        texto: dto.texto.trim(),
        autorId: user.id,
        // Congelado: o advogado pode sair, o recado continua tendo autor.
        autorNome: user.nome,
      },
      select: { id: true, texto: true, autorNome: true, createdAt: true, vistoEm: true },
    });

    await this.audit.registrar({
      userId: user.id,
      acao: AcaoAuditoria.CREATE,
      entidade: 'RecadoDoProcesso',
      entidadeId: recado.id,
      descricao: `Recado ao filiado escrito no processo ${processo.numeroCNJ ?? processoId}.`,
      metadata: { processoId },
    });

    return recado;
  }

  /**
   * Apaga um recado.
   *
   * `DELETE` só o Administrador faz — é a regra global da matriz, e aqui ela
   * cai bem: um recado já LIDO é uma coisa que a pessoa viu, e apagar não
   * desfaz a leitura. Serve para tirar o que foi escrito por engano.
   */
  @Delete(':recadoId')
  async apagar(
    @Param('processoId') processoId: string,
    @Param('recadoId') recadoId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const recado = await this.prisma.recadoDoProcesso.findFirst({
      where: { id: recadoId, processoId },
      select: { id: true, vistoEm: true },
    });
    if (!recado) throw new NotFoundException('Recado não encontrado.');

    await this.prisma.recadoDoProcesso.delete({ where: { id: recadoId } });
    await this.audit.registrar({
      userId: user.id,
      acao: AcaoAuditoria.DELETE,
      entidade: 'RecadoDoProcesso',
      entidadeId: recadoId,
      descricao: `Recado ao filiado apagado${recado.vistoEm ? ' (o filiado já tinha lido)' : ''}.`,
      metadata: { processoId },
    });
    return { apagado: true, jaLido: !!recado.vistoEm };
  }
}
