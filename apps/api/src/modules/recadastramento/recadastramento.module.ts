import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Prisma,
  StatusRecadastramento,
  TipoHistoricoFiliado,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateFiliadoDto } from '../filiados/dto/filiado.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LinkRecadastramentoService } from './link-recadastramento.service';
import {
  LinkRecadastramentoAdminController,
  LinkRecadastramentoRevogarController,
  RecadastroPublicoController,
} from './link-recadastramento.controller';
import { dataCalendario } from '../../common/utils/datas.util';
import { protegerImutaveis } from '../filiados/campos-imutaveis';
import {
  montarSincronizacaoDependentes, resumirDependentes,
} from '../dependentes/dependentes.sync';
import { FiliadosModule } from '../filiados/filiados.module';

@Injectable()
export class RecadastramentoService {
  constructor(private readonly prisma: PrismaService) {}

  async submeter(filiadoId: string, dto: UpdateFiliadoDto, autor?: string) {
    const atual = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        dependentes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!atual) throw new NotFoundException('Filiado não encontrado');

    const { vinculos, dependentes, ...entrada } = dto;
    // CPF, RG, nascimento e naturalidade não mudam num recadastramento — quando
    // já estão preenchidos, o que veio é descartado. Correção se faz na tela de
    // edição do filiado.
    const { dados, ignorados } = protegerImutaveis(atual, entrada);
    const syncDependentes = montarSincronizacaoDependentes(dependentes, atual.dependentes);
    const resumo = resumirDependentes(dependentes, atual.dependentes);

    // Snapshot do estado anterior (para auditoria/histórico)
    const dadosAnteriores: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify({
        ...atual,
        dataNascimento: atual.dataNascimento,
        dataAdmissao: atual.dataAdmissao,
        vinculos: atual.vinculos,
        dependentes: atual.dependentes,
      }),
    );

    const [filiado] = await this.prisma.$transaction([
      this.prisma.filiado.update({
        where: { id: filiadoId },
        data: {
          ...dados,
          // Lê de `dados`, não de `dto`: um campo protegido já foi removido ali,
          // e usar o dto aqui reintroduziria a alteração barrada.
          cpf: dados.cpf ? String(dados.cpf).replace(/\D/g, '') : undefined,
          dataNascimento: dataCalendario(dados.dataNascimento as string | undefined),
          dataAdmissao: dataCalendario(dto.dataAdmissao),
          vinculos: vinculos
            ? {
                deleteMany: {},
                create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })),
              }
            : undefined,
          dependentes: syncDependentes,
        },
        include: { vinculos: true, dependentes: true },
      }),
      this.prisma.recadastramento.create({
        data: {
          filiadoId,
          status: StatusRecadastramento.APROVADO,
          dadosAnteriores,
          dadosNovos: dto as unknown as Prisma.InputJsonValue,
          revisadoEm: new Date(),
        },
      }),
      this.prisma.filiadoHistorico.create({
        data: {
          filiadoId,
          tipo: TipoHistoricoFiliado.RECADASTRAMENTO,
          descricao:
            'Recadastramento realizado.' +
            (resumo ? ` ${resumo}` : '') +
            (ignorados.length ? ` Campos protegidos ignorados: ${ignorados.join(', ')}.` : ''),
          autor,
        },
      }),
    ]);

    return filiado;
  }

  listar(filiadoId: string) {
    return this.prisma.recadastramento.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      include: { revisor: { select: { nome: true } } },
    });
  }
}

@ApiTags('recadastramento')
@ApiBearerAuth()
@Controller('filiados/:id')
class RecadastramentoController {
  constructor(private readonly service: RecadastramentoService) {}

  @Post('recadastramento')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO, UserRole.TRIAGEM)
  submeter(
    @Param('id') id: string,
    @Body() dto: UpdateFiliadoDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.service.submeter(id, dto, autor);
  }

  @Get('recadastramentos')
  listar(@Param('id') id: string) {
    return this.service.listar(id);
  }
}

@Module({
  // FiliadosModule entra por causa da foto: o recadastramento online reaproveita
  // o mesmo processamento de imagem usado pela equipe.
  imports: [FiliadosModule],
  controllers: [
    RecadastramentoController,
    LinkRecadastramentoAdminController,
    LinkRecadastramentoRevogarController,
    RecadastroPublicoController,
  ],
  providers: [RecadastramentoService, LinkRecadastramentoService],
  exports: [RecadastramentoService, LinkRecadastramentoService],
})
export class RecadastramentoModule {}
