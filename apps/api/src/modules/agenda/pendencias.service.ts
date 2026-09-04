import { Injectable } from '@nestjs/common';
import { Prisma, StatusCompromisso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inicioDoDiaBR } from '../processos/utils/data-br.util';

/**
 * O QUE PRECISA DE VOCÊ, AGORA.
 *
 * NÃO É UMA CAIXA DE NOTIFICAÇÕES, e a diferença é a razão de a coisa existir
 * deste jeito.
 *
 * Uma caixa guarda EVENTOS: "a tarefa X foi criada", "a publicação Y chegou".
 * Eventos acumulam, precisam de "marcar como lida", e repetem — o mesmo prazo
 * vira três avisos em três dias. Foi assim que todo sistema que a equipe já usou
 * ensinou a ignorar o sininho.
 *
 * Isto devolve ESTADO: o que é verdade neste instante e depende desta pessoa.
 * Não tem histórico, não tem "marcar como lida" e não tem como repetir — quando
 * a tarefa é concluída, ela some da lista sozinha, porque deixou de ser
 * verdade. O contador não pode inflar com o tempo: ele só cresce se o trabalho
 * pendente crescer.
 *
 * O ESCOPO É SEMPRE PESSOAL. Aqui não existe "modo global": um coordenador que
 * queira ver a operação inteira tem o painel e a agenda. Este sino responde uma
 * pergunta só — "o que é MEU e está me esperando?".
 */

/** Uma pendência: o que é, quantas são, e para onde ela leva. */
export interface Pendencia {
  tipo: 'ATRASADA' | 'HOJE' | 'AUDIENCIA' | 'PUBLICACAO_SEM_TAREFA';
  total: number;
  /** Até três exemplos — o suficiente para reconhecer sem virar uma lista. */
  exemplos: { id: string; titulo: string; quando: string | null; href: string }[];
}

const MAX_EXEMPLOS = 3;
/** Uma semana de pauta: o que cabe em "me preparar". */
const DIAS_DE_AUDIENCIA = 7;

@Injectable()
export class PendenciasService {
  constructor(private readonly prisma: PrismaService) {}

  async minhas(usuarioId: string): Promise<{ pendencias: Pendencia[]; total: number }> {
    const agora = new Date();
    const inicioDeHoje = inicioDoDiaBR(agora);
    const fimDeHoje = new Date(inicioDeHoje.getTime() + 24 * 3_600_000);
    const fimDaSemana = new Date(inicioDeHoje.getTime() + DIAS_DE_AUDIENCIA * 24 * 3_600_000);

    /**
     * MEU inclui o que acompanho sem responder — mesma régua da agenda e do
     * painel. O segundo advogado de uma audiência precisa vê-la no sino tanto
     * quanto o primeiro.
     */
    const meu: Prisma.CompromissoWhereInput = {
      status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
      OR: [{ responsavelId: usuarioId }, { equipe: { some: { usuarioId } } }],
    };

    const selecao = {
      id: true,
      titulo: true,
      inicio: true,
      processo: { select: { numeroCNJ: true } },
    } as const;

    const [atrasadas, hoje, audiencias, publicacoes] = await Promise.all([
      this.prisma.compromisso.findMany({
        where: { ...meu, inicio: { lt: inicioDeHoje } },
        orderBy: { inicio: 'asc' },
        select: selecao,
      }),
      this.prisma.compromisso.findMany({
        where: { ...meu, inicio: { gte: inicioDeHoje, lt: fimDeHoje } },
        orderBy: { inicio: 'asc' },
        select: selecao,
      }),
      this.prisma.compromisso.findMany({
        where: { ...meu, tipo: 'AUDIENCIA', inicio: { gte: fimDeHoje, lt: fimDaSemana } },
        orderBy: { inicio: 'asc' },
        select: selecao,
      }),
      /**
       * Publicação que pediu algo nos MEUS processos e nunca virou tarefa.
       *
       * É o único item do sino que não é uma atividade — e é o mais importante,
       * porque uma tarefa esquecida ao menos aparece na agenda. Esta não aparece
       * em lugar nenhum: o ato chegou, ninguém pegou, e o silêncio parece calma.
       */
      this.prisma.comunicacaoDjen.findMany({
        where: {
          compromissoId: null,
          providencia: { not: null },
          NOT: { providencia: 'NENHUMA' },
          processo: { advogados: { some: { advogadoId: usuarioId } } },
        },
        orderBy: { dataDisponibilizacao: 'desc' },
        select: {
          id: true,
          providencia: true,
          dataDisponibilizacao: true,
          processoId: true,
          processo: { select: { numeroCNJ: true } },
        },
      }),
    ]);

    const daAgenda = (
      tipo: Pendencia['tipo'],
      itens: { id: string; titulo: string; inicio: Date; processo: { numeroCNJ: string | null } | null }[],
    ): Pendencia | null =>
      itens.length
        ? {
            tipo,
            total: itens.length,
            exemplos: itens.slice(0, MAX_EXEMPLOS).map((c) => ({
              id: c.id,
              titulo: c.titulo,
              quando: c.inicio.toISOString(),
              href: `/agenda?compromisso=${c.id}`,
            })),
          }
        : null;

    const pendencias = [
      daAgenda('ATRASADA', atrasadas),
      daAgenda('HOJE', hoje),
      daAgenda('AUDIENCIA', audiencias),
      publicacoes.length
        ? {
            tipo: 'PUBLICACAO_SEM_TAREFA' as const,
            total: publicacoes.length,
            exemplos: publicacoes.slice(0, MAX_EXEMPLOS).map((p) => ({
              id: p.id,
              titulo: p.processo?.numeroCNJ ?? 'Publicação',
              quando: p.dataDisponibilizacao.toISOString(),
              href: `/processos?processo=${p.processoId ?? ''}`,
            })),
          }
        : null,
    ].filter((p): p is Pendencia => p !== null);

    return { pendencias, total: pendencias.reduce((s, p) => s + p.total, 0) };
  }
}
