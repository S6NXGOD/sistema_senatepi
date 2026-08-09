import { StorageService } from '@core/infra';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StatusProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { AnexosService } from '../anexos/anexos.service';

/**
 * DOSSIÊ DO FILIADO — a vida do associado dentro do sindicato em uma tela.
 *
 * A pergunta que este endpoint responde é a que a equipe faz no balcão o tempo
 * todo: "esse filiado já veio aqui antes? por quê? em que pé ficou?". Antes,
 * responder isso exigia abrir Triagem, Agenda, Processos, Cobranças e o perfil —
 * cinco telas e nenhuma visão do conjunto.
 *
 * É uma consulta de LEITURA e agregação: nada aqui grava. Por isso mora fora do
 * FiliadosService (que já concentra cadastro, PDF e foto) e monta a resposta em
 * três camadas:
 *  - `resumo`  — os números que respondem "quanto/quantos" de imediato;
 *  - as listas por domínio (atendimentos, atividades, processos, cobranças…);
 *  - `linhaDoTempo` — todos os fatos, de todos os domínios, em ordem cronológica.
 */

/** Quanto de cada lista volta — o suficiente para a tela, sem puxar anos de base. */
const LIMITE_LISTA = 25;
const LIMITE_TIMELINE = 60;

export type TipoFatoDossie =
  | 'FILIACAO'
  | 'ATENDIMENTO'
  | 'ATIVIDADE'
  | 'PROCESSO'
  | 'COBRANCA'
  | 'EVENTO'
  | 'RECADASTRAMENTO'
  | 'CADASTRO';

export interface FatoDossie {
  tipo: TipoFatoDossie;
  data: Date;
  titulo: string;
  detalhe: string | null;
  /** Rótulo curto de situação (Pendente, Concluído, Pago…), quando houver. */
  situacao: string | null;
  /** Id do registro de origem — a tela liga o item ao módulo correspondente. */
  refId: string | null;
}

@Injectable()
export class DossieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly anexos: AnexosService,
  ) {}

  async gerar(filiadoId: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: {
        id: true, matricula: true, nomeCompleto: true, cpf: true, situacao: true,
        formacao: true, formacaoOutro: true, numeroCoren: true, dataNascimento: true,
        telefonePrincipal: true, telefoneSecundario: true, email: true,
        cidade: true, estado: true, bairro: true, endereco: true, numero: true,
        fotoThumbKey: true, createdAt: true, aprovadoEm: true, dataAdmissao: true,
        vinculos: { orderBy: { ordem: 'asc' }, select: { empresa: true, cargo: true } },
        _count: { select: { dependentes: true } },
      },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');

    const [
      atendimentos, atividades, processos, cobrancas, presencas,
      recadastramentos, historico, acervo, colonia,
    ] = await Promise.all([
      this.atendimentos(filiadoId),
      this.atividades(filiadoId),
      this.processos(filiadoId),
      this.cobrancas(filiadoId),
      this.presencas(filiadoId),
      this.recadastramentos(filiadoId),
      this.prisma.filiadoHistorico.findMany({
        where: { filiadoId },
        orderBy: { createdAt: 'desc' },
        take: LIMITE_TIMELINE,
      }),
      this.anexos.acervo({ filiadoId }),
      this.reservasColonia(filiado.cpf),
    ]);

    const { fotoUrl } = await this.foto(filiado.fotoThumbKey);
    const { fotoThumbKey: _omitido, _count, ...dados } = filiado;

    const resumo = {
      atendimentos: atendimentos.resumo,
      atividades: atividades.resumo,
      processos: processos.resumo,
      financeiro: cobrancas.resumo,
      documentos: { total: acervo.length },
      dependentes: _count.dependentes,
      eventos: { presencas: presencas.total, ultimoEm: presencas.ultimoEm },
      colonia: { reservas: colonia.total, ultimaTemporada: colonia.ultimaTemporada },
      recadastramentos: { total: recadastramentos.total, ultimoEm: recadastramentos.ultimoEm },
      /** Data do primeiro e do último contato de qualquer natureza. */
      relacionamento: {
        desde: filiado.createdAt,
        ultimoContatoEm: this.maisRecente([
          atendimentos.resumo.ultimoEm,
          atividades.resumo.ultimaEm,
        ]),
      },
    };

    return {
      filiado: { ...dados, fotoUrl, vinculos: filiado.vinculos },
      resumo,
      atendimentos: atendimentos.itens,
      atividades: atividades.itens,
      processos: processos.itens,
      cobrancas: cobrancas.itens,
      eventos: presencas.itens,
      documentos: acervo,
      linhaDoTempo: this.montarLinhaDoTempo({
        filiado,
        atendimentos: atendimentos.itens,
        atividades: atividades.itens,
        processos: processos.itens,
        cobrancas: cobrancas.itens,
        eventos: presencas.itens,
        recadastramentos: recadastramentos.itens,
        historico,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Blocos
  // -------------------------------------------------------------------------

  private async atendimentos(filiadoId: string) {
    const [itens, porStatus, porDesfecho, porCanal, extremos] = await Promise.all([
      this.prisma.atendimento.findMany({
        where: { filiadoId },
        orderBy: { createdAt: 'desc' },
        take: LIMITE_LISTA,
        select: {
          id: true, numero: true, canal: true, status: true, desfecho: true,
          tipoEncaminhamento: true, descricao: true, desfechoObs: true, desfechoEm: true,
          responsavel: true, createdAt: true,
          atendente: { select: { id: true, nome: true, nomeExibicao: true } },
          processo: { select: { id: true, numeroCNJ: true, titulo: true } },
          _count: { select: { anexos: true, compromissos: true } },
        },
      }),
      this.prisma.atendimento.groupBy({
        by: ['status'], where: { filiadoId }, _count: { _all: true },
      }),
      this.prisma.atendimento.groupBy({
        by: ['desfecho'], where: { filiadoId }, _count: { _all: true },
      }),
      this.prisma.atendimento.groupBy({
        by: ['canal'], where: { filiadoId }, _count: { _all: true },
      }),
      this.prisma.atendimento.aggregate({
        where: { filiadoId },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ]);

    const status = this.contar(porStatus, 'status');
    const desfecho = this.contar(porDesfecho, 'desfecho');
    return {
      itens,
      resumo: {
        total: extremos._count._all,
        pendentes: status.PENDENTE ?? 0,
        concluidos: status.CONCLUIDO ?? 0,
        cancelados: status.CANCELADO ?? 0,
        resolvidosNoAto: desfecho.RESOLVIDO_ATO ?? 0,
        encaminhados: desfecho.ENCAMINHADO ?? 0,
        /** Ainda sem resultado registrado — é o que a triagem precisa perseguir. */
        semDesfecho: desfecho.null ?? 0,
        porCanal: this.contar(porCanal, 'canal'),
        primeiroEm: extremos._min.createdAt,
        ultimoEm: extremos._max.createdAt,
      },
    };
  }

  private async atividades(filiadoId: string) {
    const agora = new Date();
    const [itens, porStatus, extremos, proxima] = await Promise.all([
      this.prisma.compromisso.findMany({
        where: { filiadoId },
        orderBy: { inicio: 'desc' },
        take: LIMITE_LISTA,
        select: {
          id: true, titulo: true, tipo: true, status: true, inicio: true, fim: true,
          local: true, urgente: true, desfecho: true, desfechoObs: true, concluidoEm: true,
          canceladoCategoria: true, canceladoMotivo: true, remarcacoes: true,
          responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } },
          atendimento: { select: { id: true, numero: true } },
          processo: { select: { id: true, numeroCNJ: true, titulo: true } },
        },
      }),
      this.prisma.compromisso.groupBy({
        by: ['status'], where: { filiadoId }, _count: { _all: true },
      }),
      this.prisma.compromisso.aggregate({
        where: { filiadoId }, _count: { _all: true }, _max: { inicio: true },
      }),
      this.prisma.compromisso.findFirst({
        where: { filiadoId, inicio: { gte: agora }, status: { in: ['PENDENTE', 'EM_ANDAMENTO'] } },
        orderBy: { inicio: 'asc' },
        select: { id: true, titulo: true, tipo: true, inicio: true },
      }),
    ]);

    const status = this.contar(porStatus, 'status');
    return {
      itens,
      resumo: {
        total: extremos._count._all,
        pendentes: status.PENDENTE ?? 0,
        emAndamento: status.EM_ANDAMENTO ?? 0,
        concluidas: status.CONCLUIDO ?? 0,
        canceladas: status.CANCELADO ?? 0,
        ultimaEm: extremos._max.inicio,
        proxima,
      },
    };
  }

  private async processos(filiadoId: string) {
    // O filiado pode ser o principal (atalho `filiadoId`) OU parte no polo (N:N).
    const where: Prisma.ProcessoWhereInput = {
      OR: [{ filiadoId }, { partes: { some: { filiadoId } } }],
    };
    const [itens, porStatus, total] = await Promise.all([
      this.prisma.processo.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: LIMITE_LISTA,
        select: {
          id: true, numeroCNJ: true, titulo: true, classeProcessual: true,
          assuntoPrincipal: true, orgaoJulgador: true, tribunal: true,
          statusInterno: true, valorCausa: true, dataDistribuicao: true,
          etiquetas: true, createdAt: true, updatedAt: true,
          advogado: { select: { id: true, nome: true, nomeExibicao: true } },
          _count: { select: { movimentacoes: true, anexos: true } },
        },
      }),
      this.prisma.processo.groupBy({ by: ['statusInterno'], where, _count: { _all: true } }),
      this.prisma.processo.count({ where }),
    ]);

    const status = this.contar(porStatus, 'statusInterno');
    const encerrados =
      (status[StatusProcesso.ARQUIVADO] ?? 0) +
      (status[StatusProcesso.ENCERRADO] ?? 0) +
      (status[StatusProcesso.IMPROCEDENTE] ?? 0);
    return {
      itens: itens.map((p) => ({ ...p, valorCausa: p.valorCausa ? Number(p.valorCausa) : null })),
      resumo: {
        total,
        ativos: status[StatusProcesso.ATIVO] ?? 0,
        rascunhos: status[StatusProcesso.RASCUNHO] ?? 0,
        encerrados,
        porStatus: status,
      },
    };
  }

  private async cobrancas(filiadoId: string) {
    const [itens, porStatus] = await Promise.all([
      this.prisma.cobranca.findMany({
        where: { filiadoId },
        orderBy: { createdAt: 'desc' },
        take: LIMITE_LISTA,
        select: {
          id: true, tipo: true, descricao: true, valorTotal: true, createdAt: true,
          parcelas: {
            orderBy: { numero: 'asc' },
            select: {
              id: true, numero: true, valor: true, status: true,
              dataVencimento: true, dataPagamento: true, valorPago: true,
            },
          },
        },
      }),
      this.prisma.parcelaCobranca.groupBy({
        by: ['status'],
        where: { cobranca: { filiadoId } },
        _count: { _all: true },
        _sum: { valor: true },
      }),
    ]);

    const linha = (s: string) => porStatus.find((p) => p.status === s);
    const soma = (s: string) => Number(linha(s)?._sum.valor ?? 0);
    const qtd = (s: string) => linha(s)?._count._all ?? 0;

    return {
      itens: itens.map((c) => ({
        ...c,
        valorTotal: Number(c.valorTotal),
        parcelas: c.parcelas.map((p) => ({
          ...p,
          valor: Number(p.valor),
          valorPago: p.valorPago ? Number(p.valorPago) : null,
        })),
      })),
      resumo: {
        parcelasPagas: qtd('PAGO'),
        valorPago: soma('PAGO'),
        parcelasAbertas: qtd('PENDENTE') + qtd('VENCIDO'),
        valorAberto: soma('PENDENTE') + soma('VENCIDO'),
        parcelasVencidas: qtd('VENCIDO'),
        valorVencido: soma('VENCIDO'),
        /** Sinal de risco: se há vencidas, a cobrança precisa de ação. */
        inadimplente: qtd('VENCIDO') > 0,
      },
    };
  }

  private async presencas(filiadoId: string) {
    const [itens, total] = await Promise.all([
      this.prisma.presenca.findMany({
        where: { filiadoId },
        orderBy: { registradoEm: 'desc' },
        take: LIMITE_LISTA,
        select: {
          id: true, registradoEm: true,
          evento: { select: { id: true, nome: true, dataInicio: true, local: true, tipo: true } },
        },
      }),
      this.prisma.presenca.count({ where: { filiadoId } }),
    ]);
    return { itens, total, ultimoEm: itens[0]?.registradoEm ?? null };
  }

  private async recadastramentos(filiadoId: string) {
    const itens = await this.prisma.recadastramento.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      take: LIMITE_LISTA,
      select: { id: true, status: true, createdAt: true },
    });
    return { itens, total: itens.length, ultimoEm: itens[0]?.createdAt ?? null };
  }

  /**
   * Colônia de Férias: a reserva não tem FK para filiado (é preenchida no
   * checkout público, identificada pelo CPF). Sem CPF no cadastro, não há como
   * cruzar — devolve zero em vez de arriscar um falso positivo por homônimo.
   */
  private async reservasColonia(cpf: string | null) {
    const digitos = (cpf ?? '').replace(/\D/g, '');
    if (digitos.length !== 11) return { total: 0, ultimaTemporada: null };
    const reservas = await this.prisma.coloniaReserva.findMany({
      where: { cpf: digitos },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { temporada: { select: { nome: true } } },
    });
    const total = await this.prisma.coloniaReserva.count({ where: { cpf: digitos } });
    return { total, ultimaTemporada: reservas[0]?.temporada?.nome ?? null };
  }

  private async foto(fotoThumbKey: string | null) {
    if (!fotoThumbKey) return { fotoUrl: null };
    const fotoUrl = await this.storage.getSignedUrl(fotoThumbKey).catch(() => null);
    return { fotoUrl };
  }

  // -------------------------------------------------------------------------
  // Linha do tempo — todos os domínios em ordem cronológica
  // -------------------------------------------------------------------------

  private montarLinhaDoTempo(d: {
    filiado: { createdAt: Date; nomeCompleto: string; matricula: string };
    atendimentos: any[];
    atividades: any[];
    processos: any[];
    cobrancas: any[];
    eventos: any[];
    recadastramentos: any[];
    historico: { id: string; tipo: string; descricao: string; autor: string | null; createdAt: Date }[];
  }): FatoDossie[] {
    const fatos: FatoDossie[] = [];

    fatos.push({
      tipo: 'FILIACAO',
      data: d.filiado.createdAt,
      titulo: 'Filiação registrada',
      detalhe: `Matrícula ${d.filiado.matricula}`,
      situacao: null,
      refId: null,
    });

    for (const a of d.atendimentos) {
      fatos.push({
        tipo: 'ATENDIMENTO',
        data: a.createdAt,
        titulo: `Atendimento #${a.numero} (${a.canal})`,
        detalhe: this.resumir(a.descricao),
        situacao: a.desfecho ?? a.status,
        refId: a.id,
      });
    }

    for (const c of d.atividades) {
      fatos.push({
        tipo: 'ATIVIDADE',
        data: c.inicio,
        titulo: c.titulo,
        detalhe: c.local ?? (c.responsavel ? `Resp.: ${c.responsavel.nomeExibicao || c.responsavel.nome}` : null),
        situacao: c.status,
        refId: c.id,
      });
    }

    for (const p of d.processos) {
      fatos.push({
        tipo: 'PROCESSO',
        data: p.dataDistribuicao ?? p.createdAt,
        titulo: p.numeroCNJ ? `Processo ${p.numeroCNJ}` : `Processo ${p.titulo ?? '(rascunho)'}`,
        detalhe: [p.classeProcessual, p.orgaoJulgador].filter(Boolean).join(' · ') || null,
        situacao: p.statusInterno,
        refId: p.id,
      });
    }

    for (const c of d.cobrancas) {
      fatos.push({
        tipo: 'COBRANCA',
        data: c.createdAt,
        titulo: `Cobrança ${c.tipo.toLowerCase()} — ${c.parcelas.length} parcela(s)`,
        detalhe: c.descricao ?? null,
        situacao: c.parcelas.some((p: any) => p.status === 'VENCIDO') ? 'VENCIDO' : null,
        refId: c.id,
      });
    }

    for (const e of d.eventos) {
      fatos.push({
        tipo: 'EVENTO',
        data: e.registradoEm,
        titulo: `Presença em ${e.evento?.nome ?? 'evento'}`,
        detalhe: e.evento?.local ?? null,
        situacao: null,
        refId: e.evento?.id ?? null,
      });
    }

    for (const r of d.recadastramentos) {
      fatos.push({
        tipo: 'RECADASTRAMENTO',
        data: r.createdAt,
        titulo: 'Recadastramento',
        detalhe: null,
        situacao: r.status,
        refId: r.id,
      });
    }

    // Histórico do cadastro (alterações, documentos, carteirinha) fecha o quadro:
    // é o que explica "por que o telefone mudou em março".
    for (const h of d.historico) {
      if (h.tipo === 'FILIACAO' || h.tipo === 'RECADASTRAMENTO') continue; // já cobertos acima
      fatos.push({
        tipo: 'CADASTRO',
        data: h.createdAt,
        titulo: h.descricao,
        detalhe: h.autor ? `por ${h.autor}` : null,
        situacao: null,
        refId: h.id,
      });
    }

    return fatos
      .sort((a, b) => b.data.getTime() - a.data.getTime())
      .slice(0, LIMITE_TIMELINE);
  }

  // -------------------------------------------------------------------------
  // Utilitários
  // -------------------------------------------------------------------------

  /** groupBy → mapa `{ VALOR: quantidade }` (chave "null" quando o campo é nulo). */
  private contar<T extends Record<string, any>>(linhas: T[], campo: keyof T): Record<string, number> {
    const out: Record<string, number> = {};
    for (const l of linhas) out[String(l[campo])] = l._count?._all ?? 0;
    return out;
  }

  private maisRecente(datas: (Date | null | undefined)[]): Date | null {
    const validas = datas.filter((d): d is Date => !!d);
    if (validas.length === 0) return null;
    return validas.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
  }

  private resumir(texto: string | null, max = 140): string | null {
    if (!texto) return null;
    const limpo = texto.replace(/\s+/g, ' ').trim();
    return limpo.length > max ? `${limpo.slice(0, max - 1)}…` : limpo;
  }
}
