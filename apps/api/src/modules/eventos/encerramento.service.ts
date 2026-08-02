import { Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, StatusEvento, StatusPauta } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { VotacaoService, ApuracaoPauta } from './votacao.service';
import { DossieEventoService } from './dossie-evento.service';

export interface PreviaEncerramento {
  jaEncerrado: boolean;
  presentes: number;
  pautasAbertas: { id: string; titulo: string; votantes: number; quorumMinimo: number | null; quorumAtingido: boolean }[];
  pautasEncerradas: number;
  /** Pautas em rascunho que nunca foram votadas — somem sem deliberação. */
  pautasNaoVotadas: number;
  /** Avisos que a mesa PRECISA ler antes de confirmar. */
  alertas: string[];
}

/**
 * Encerramento da assembleia — o momento em que ela vira registro.
 *
 * Um botão só, porque na prática é um ato só: fechar as votações que ficaram
 * abertas, travar o check-in e emitir o dossiê. Separar isso em três ações
 * distintas era o desenho anterior, e o resultado foi previsível — a
 * assembleia terminava e ninguém emitia documento nenhum, porque não havia
 * nada na tela lembrando que faltava.
 */
@Injectable()
export class EncerramentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly votacao: VotacaoService,
    private readonly dossie: DossieEventoService,
  ) {}

  /**
   * O que vai acontecer se encerrar agora.
   *
   * Existe para a confirmação poder ser específica em vez de genérica.
   * "Tem certeza?" não ajuda ninguém a decidir; "há uma votação aberta com 12
   * de 30 votos e quórum mínimo de 20" ajuda.
   */
  async previa(eventoId: string): Promise<PreviaEncerramento> {
    const evento = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: { id: true, status: true },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const [presentes, pautas] = await Promise.all([
      this.prisma.presenca.count({ where: { eventoId } }),
      this.prisma.pautaVotacao.findMany({
        where: { eventoId },
        select: {
          id: true, titulo: true, status: true, quorumMinimo: true,
          _count: { select: { habilitacoes: true } },
        },
      }),
    ]);

    const abertas = pautas
      .filter((p) => p.status === StatusPauta.ABERTA)
      .map((p) => ({
        id: p.id,
        titulo: p.titulo,
        votantes: p._count.habilitacoes,
        quorumMinimo: p.quorumMinimo,
        quorumAtingido: p.quorumMinimo == null || p._count.habilitacoes >= p.quorumMinimo,
      }));

    const alertas: string[] = [];

    // QUÓRUM — o alerta que evita anular a assembleia inteira. O sistema tem o
    // dado desde sempre e encerrava em silêncio; deliberação sem o quórum
    // exigido é nula, e quem preside costuma descobrir isso depois.
    for (const p of abertas.filter((x) => !x.quorumAtingido)) {
      alertas.push(
        `A pauta "${p.titulo}" tem ${p.votantes} voto(s) e exige ${p.quorumMinimo}. ` +
        'Encerrar agora registra a deliberação SEM o quórum mínimo atingido.',
      );
    }
    if (abertas.length > 0) {
      alertas.push(
        `${abertas.length} votação(ões) ainda aberta(s) será(ão) encerrada(s). ` +
        'Quem ainda não votou perde o direito, e pauta encerrada NÃO pode ser reaberta.',
      );
    }
    if (presentes === 0) {
      alertas.push('Nenhuma presença registrada — o dossiê sairá sem lista de presença.');
    }

    return {
      jaEncerrado: evento.status === StatusEvento.REALIZADO,
      presentes,
      pautasAbertas: abertas,
      pautasEncerradas: pautas.filter((p) => p.status === StatusPauta.ENCERRADA).length,
      pautasNaoVotadas: pautas.filter((p) => p.status === StatusPauta.RASCUNHO).length,
      alertas,
    };
  }

  /**
   * Encerra a assembleia e emite o dossiê.
   *
   * IDEMPOTENTE: chamar duas vezes não gera dois dossiês nem quebra. Um duplo
   * clique no botão, ou dois membros da mesa clicando ao mesmo tempo, é o
   * cenário provável — não o excepcional.
   */
  async encerrar(eventoId: string, autor?: string) {
    const evento = await this.prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    if (evento.status === StatusEvento.REALIZADO) {
      return {
        ok: true,
        jaEstava: true,
        mensagem: 'Esta assembleia já estava encerrada.',
        apuracoes: [] as ApuracaoPauta[],
      };
    }

    // 1) Fecha as votações que ficaram abertas. Fora de transação de propósito:
    //    `encerrar` de cada pauta já é atômico e registra sua própria auditoria,
    //    e uma falha na terceira pauta não deve desfazer as duas primeiras — o
    //    que foi apurado, foi apurado.
    const abertas = await this.prisma.pautaVotacao.findMany({
      where: { eventoId, status: StatusPauta.ABERTA },
      select: { id: true },
    });
    const apuracoes: ApuracaoPauta[] = [];
    for (const p of abertas) {
      apuracoes.push(await this.votacao.encerrar(p.id, autor));
    }

    // 2) Trava o check-in. `janelaCheckin` já recusa entrada em evento
    //    REALIZADO — não há regra nova, só a mudança de estado.
    await this.prisma.evento.update({
      where: { id: eventoId },
      data: {
        status: StatusEvento.REALIZADO,
        // Sem hora de término registrada, o encerramento é o carimbo. Uma
        // assembleia não tem hora certa para acabar, e o dossiê precisa dizer
        // quando acabou.
        dataFim: evento.dataFim ?? new Date(),
      },
    });

    // 3) Emite o dossiê. Falha aqui NÃO desfaz o encerramento: a assembleia
    //    acabou de fato, e o documento pode ser reemitido pelo botão. Perder o
    //    encerramento por causa do PDF seria trocar o essencial pelo acessório.
    let dossie: { key: string; hash: string } | null = null;
    let erroDossie: string | null = null;
    try {
      const r = await this.dossie.gerar(eventoId, autor);
      dossie = { key: r.key, hash: r.hash };
    } catch (e) {
      erroDossie = e instanceof Error ? e.message : 'falha ao gerar o dossiê';
    }

    await this.audit.registrar({
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Evento',
      entidadeId: eventoId,
      descricao:
        `Assembleia "${evento.nome}" encerrada. ` +
        `${apuracoes.length} votação(ões) fechada(s) no encerramento. ` +
        (dossie ? 'Dossiê emitido.' : `Dossiê NÃO emitido: ${erroDossie}.`),
      metadata: { dossieHash: dossie?.hash ?? null, pautasEncerradas: apuracoes.length },
    });

    return { ok: true, jaEstava: false, apuracoes, dossie, erroDossie };
  }

  /**
   * Resumo do que aconteceu — alimenta a tela pós-encerramento.
   *
   * É a resposta para "e aí?": quórum, o que foi decidido, quem esteve e onde
   * está o documento.
   */
  async resumo(eventoId: string) {
    const evento = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: {
        id: true, nome: true, status: true, dataInicio: true, dataFim: true,
        textoAta: true, urlVideoDrive: true, dossiePdfKey: true, dossieGeradoEm: true,
        configuracoes: true,
      },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const [presentes, pautas, sorteios, primeira, ultima] = await Promise.all([
      this.prisma.presenca.count({ where: { eventoId } }),
      this.prisma.pautaVotacao.findMany({
        where: { eventoId, status: StatusPauta.ENCERRADA },
        orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      }),
      this.prisma.sorteioEvento.findMany({
        where: { eventoId },
        orderBy: { realizadoEm: 'asc' },
      }),
      this.prisma.presenca.findFirst({ where: { eventoId }, orderBy: { registradoEm: 'asc' }, select: { registradoEm: true } }),
      this.prisma.presenca.findFirst({ where: { eventoId }, orderBy: { registradoEm: 'desc' }, select: { registradoEm: true } }),
    ]);

    return {
      evento,
      presentes,
      primeiraPresenca: primeira?.registradoEm ?? null,
      ultimaPresenca: ultima?.registradoEm ?? null,
      deliberacoes: await Promise.all(pautas.map((p) => this.votacao.apurar(p.id))),
      sorteios,
      dossieEmitido: !!evento.dossiePdfKey,
    };
  }
}
