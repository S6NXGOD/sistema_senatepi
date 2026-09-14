import { dataCalendario } from '@core/infra';
import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria, DesafioRecadastramento, Prisma, SituacaoFiliado, StatusRecadastramento,
  TipoHistoricoFiliado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CtxAuditoria } from '../../common/audit/audit.contexto-http';
import { UpdateFiliadoDto } from '../filiados/dto/filiado.dto';
import { protegerImutaveis } from '../filiados/campos-imutaveis';
import {
  montarSincronizacaoDependentes, resumirDependentes,
} from '../dependentes/dependentes.sync';
import { formatarDataHoraBR } from '../processos/utils/data-br.util';
import {
  AlteracaoDoRecadastramento, alteracoesDoRecadastramento, avisoDaConfirmacao, origemDoRecadastramento,
} from './alteracoes-do-recadastramento';
import { confirmacaoDoRecadastramento } from './desafio-do-link';

/** O que a ficha recebe de cada recadastramento (contrato C6). */
export interface ItemDoRecadastramento {
  id: string;
  status: StatusRecadastramento;
  origem: 'ONLINE' | 'PRESENCIAL';
  /**
   * Como o link confirmou quem era (14/09/2026). `null` no presencial e no
   * online de antes dessa data, cuja observação não dizia.
   */
  confirmacao: DesafioRecadastramento | null;
  /** A linha âmbar pronta, ou `null` — ver `avisoDaConfirmacao`. */
  avisoDaConfirmacao: string | null;
  createdAt: Date;
  revisadoEm: Date | null;
  revisor: { id: string; nome: string } | null;
  alteracoes: AlteracaoDoRecadastramento[];
}

const SELECT_ITEM = {
  id: true,
  status: true,
  observacao: true,
  createdAt: true,
  revisadoEm: true,
  dadosAnteriores: true,
  dadosNovos: true,
  revisor: { select: { id: true, nome: true } },
} satisfies Prisma.RecadastramentoSelect;

type LinhaDoRecadastramento = Prisma.RecadastramentoGetPayload<{ select: typeof SELECT_ITEM }>;

export function itemDoRecadastramento(r: LinhaDoRecadastramento): ItemDoRecadastramento {
  const alteracoes = alteracoesDoRecadastramento(r.dadosAnteriores, r.dadosNovos);
  const confirmacao = confirmacaoDoRecadastramento(r.observacao);
  return {
    id: r.id,
    status: r.status,
    origem: origemDoRecadastramento(r.observacao),
    confirmacao,
    avisoDaConfirmacao: avisoDaConfirmacao(confirmacao, alteracoes),
    createdAt: r.createdAt,
    revisadoEm: r.revisadoEm,
    revisor: r.revisor ? { id: r.revisor.id, nome: r.revisor.nome } : null,
    alteracoes,
  };
}

@Injectable()
export class RecadastramentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async submeter(filiadoId: string, dto: UpdateFiliadoDto, autor?: string) {
    const atual = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        dependentes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!atual) throw new NotFoundException('Filiado não encontrado');

    /*
      A PORTA DE SITUAÇÃO VALE AQUI TAMBÉM.

      O formulário do recadastro manda `situacao` (o valor atual, e o seletor
      permite ATIVO/INATIVO). A edição comum recusa desfiliar e reativar por
      fora das ações próprias; o recadastro não recusava — era um jeito de
      reativar um desfiliado sem registrar o motivo do retorno. As frases são as
      mesmas de `FiliadosService.exigirPortaCerta`.
    */
    if (dto.situacao && dto.situacao !== atual.situacao) {
      if (dto.situacao === SituacaoFiliado.DESFILIADO) {
        throw new BadRequestException(
          'Para desfiliar, use a ação "Desfiliar" — ela registra o motivo, o mês de corte e o Termo assinado.',
        );
      }
      if (atual.situacao === SituacaoFiliado.DESFILIADO) {
        throw new BadRequestException(
          'Para reativar, use a ação "Reativar" — ela limpa os dados da saída e registra o motivo do retorno.',
        );
      }
    }

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

  /** Recadastramentos do filiado, do mais recente para o mais antigo, com o de→para. */
  async listar(filiadoId: string): Promise<ItemDoRecadastramento[]> {
    const linhas = await this.prisma.recadastramento.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      select: SELECT_ITEM,
    });
    return linhas.map(itemDoRecadastramento);
  }

  /**
   * "CONFERIDO" — a equipe olhou o que o filiado mandou pelo link.
   *
   * Até 13/09/2026 o recadastro online nascia PENDENTE e ficava assim para
   * sempre: nenhuma tela listava, e `revisor_id`/`revisado_em` nunca eram
   * preenchidos no fluxo online. Conferir não desfaz nada (o dado já entrou,
   * o filiado é o titular): registra QUEM olhou e QUANDO.
   *
   * A troca é condicional (`status = PENDENTE` no WHERE): duas pessoas clicando
   * ao mesmo tempo não gravam dois revisores — a segunda lê quem conferiu.
   */
  async conferir(id: string, ctx: CtxAuditoria): Promise<ItemDoRecadastramento> {
    const r = await this.prisma.recadastramento.findUnique({
      where: { id },
      select: { ...SELECT_ITEM, filiadoId: true, filiado: { select: { nomeCompleto: true } } },
    });
    if (!r) throw new NotFoundException('Recadastramento não encontrado.');
    if (r.status !== StatusRecadastramento.PENDENTE) this.recusarJaDecidido(r);

    const revisadoEm = new Date();
    const { count } = await this.prisma.recadastramento.updateMany({
      where: { id, status: StatusRecadastramento.PENDENTE },
      data: {
        status: StatusRecadastramento.APROVADO,
        revisorId: ctx.userId ?? null,
        revisadoEm,
      },
    });
    if (count === 0) {
      const agora = await this.prisma.recadastramento.findUniqueOrThrow({
        where: { id },
        select: SELECT_ITEM,
      });
      this.recusarJaDecidido(agora);
    }

    const alteracoes = alteracoesDoRecadastramento(r.dadosAnteriores, r.dadosNovos);
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Recadastramento',
      entidadeId: id,
      descricao:
        `Recadastramento de ${r.filiado.nomeCompleto} conferido` +
        (origemDoRecadastramento(r.observacao) === 'ONLINE' ? ' (feito pelo próprio filiado, pelo link)' : ''),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        filiadoId: r.filiadoId,
        alteracoes: [{ campo: 'status', label: 'Andamento', de: 'PENDENTE', para: 'APROVADO' }],
        // Quantos campos a pessoa tinha na frente quando disse "conferido".
        camposConferidos: alteracoes.length,
      },
    });

    const depois = await this.prisma.recadastramento.findUniqueOrThrow({
      where: { id },
      select: SELECT_ITEM,
    });
    return itemDoRecadastramento(depois);
  }

  private recusarJaDecidido(r: Pick<LinhaDoRecadastramento, 'status' | 'revisor' | 'revisadoEm'>): never {
    if (r.status === StatusRecadastramento.REJEITADO) {
      throw new BadRequestException('Este recadastramento foi recusado e não pode ser marcado como conferido.');
    }
    if (!r.revisor) {
      throw new BadRequestException(
        'Este recadastramento foi feito pela equipe e já nasceu conferido.',
      );
    }
    throw new BadRequestException(
      `Este recadastramento já foi conferido por ${r.revisor.nome} em ${formatarDataHoraBR(r.revisadoEm)}.`,
    );
  }
}
