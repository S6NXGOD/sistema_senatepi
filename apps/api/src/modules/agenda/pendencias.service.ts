import { Injectable } from '@nestjs/common';
import { Prisma, StatusCompromisso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inicioDoDiaBR } from '../processos/utils/data-br.util';
import { ultimosUsosReais } from '../dashboard/ultimo-acesso.util';
import {
  daPessoa, motivoParaAvisarAEquipe, ondeSouReserva, porQueAEquipePrecisa,
} from './equipe.util';

/**
 * O QUE NÃO PODE ESPERAR — e depende de quem está pedindo, agora.
 *
 * Alimenta a FAIXA que aparece em cima de toda tela. Até 12/09/2026 alimentava
 * também um SINO no topo, com sete grupos. O sino saiu (ver o fim deste
 * comentário) e com ele os grupos que só ele mostrava. Ficou o que justifica
 * interromper qualquer tela:
 *
 *  · ATRASADA ............... sua, e o dia já virou;
 *  · PRECISA_DA_EQUIPE ...... de um caso em que você é reserva, e ninguém está
 *                             cuidando — o responsável sumiu, ou o dia virou;
 *  · PUBLICACAO_SEM_TAREFA .. o ato chegou nos seus processos e ninguém pegou.
 *
 * O dia de hoje, a hora que passou e a audiência da semana continuam no PAINEL,
 * onde a pessoa abre o dia. A ação nova sem cadastro continua no cartão do
 * painel e na tela de Processos, que é onde se trabalha uma fila.
 *
 * NÃO É UMA CAIXA DE NOTIFICAÇÕES: devolve ESTADO, não evento. Concluiu, some
 * sozinho — sem "marcar como lida", sem histórico, sem repetir.
 *
 * POR QUE O SINO SAIU: ele repetia o painel numa gaveta que precisava ser
 * aberta, e o próprio administrador contou que o ignorava. E quem mais precisava
 * do aviso nem entra no sistema — para esse caso, o que funciona é avisar os
 * COLEGAS do caso, que é o grupo novo.
 */
export interface Pendencia {
  tipo: 'ATRASADA' | 'PRECISA_DA_EQUIPE' | 'PUBLICACAO_SEM_TAREFA';
  total: number;
  /** Até três exemplos — o suficiente para reconhecer sem virar uma lista. */
  exemplos: {
    id: string;
    titulo: string;
    quando: string | null;
    href: string;
    /** O porquê, quando o item não é da pessoa: "Dr. Carlos está sem entrar há 39 dias". */
    detalhe?: string;
  }[];
}

const MAX_EXEMPLOS = 3;

@Injectable()
export class PendenciasService {
  constructor(private readonly prisma: PrismaService) {}

  async minhas(usuarioId: string): Promise<{ pendencias: Pendencia[]; total: number }> {
    const agora = new Date();
    const inicioDeHoje = inicioDoDiaBR(agora);

    const abertas: Prisma.CompromissoWhereInput = {
      status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
    };

    /**
     * MEU inclui o que acompanho sem responder — mesma régua da agenda e do
     * painel. A reserva do robô fica de fora dela: não vira aviso enquanto
     * alguém estiver cuidando. A régua mora em `daPessoa`.
     */
    const meu: Prisma.CompromissoWhereInput = { ...abertas, ...daPessoa(usuarioId) };

    const [atrasadas, souReserva, publicacoes] = await Promise.all([
      this.prisma.compromisso.findMany({
        where: { ...meu, inicio: { lt: inicioDeHoje } },
        orderBy: { inicio: 'asc' },
        select: { id: true, titulo: true, inicio: true },
      }),
      /*
        AS TAREFAS EM QUE A PESSOA É RESERVA — todas as abertas, sem corte de
        data: o aviso não depende só do dia, depende de o responsável estar por
        perto. Quem decide é `motivoParaAvisarAEquipe`, a mesma regra do painel.
        O teto é folgado: são dezenas de tarefas por advogado, não centenas.
      */
      this.prisma.compromisso.findMany({
        where: { ...abertas, ...ondeSouReserva(usuarioId) },
        orderBy: { inicio: 'asc' },
        take: 60,
        select: {
          id: true,
          titulo: true,
          inicio: true,
          responsavel: { select: { id: true, nome: true, nomeExibicao: true } },
        },
      }),
      /**
       * Publicação que pediu algo nos MEUS processos e nunca virou tarefa.
       *
       * É o único item que não é uma atividade — e é o mais importante, porque
       * uma tarefa esquecida ao menos aparece na agenda. Esta não aparece em
       * lugar nenhum: o ato chegou, ninguém pegou, e o silêncio parece calma.
       */
      this.prisma.comunicacaoDjen.findMany({
        where: {
          compromissoId: null,
          /*
            SEM TAREFA **E SEM DISPENSA** — a segunda metade faltava, e sem ela
            este alarme era 100% falso positivo.

            O robô decide não criar tarefa quando o ato é anterior ao momento em
            que passamos a olhar aquele processo (`ehNoticiaVelha`): o
            escritório soube pelo PJe e cuidou, ou não cuidou, e nos dois casos
            uma tarefa criada semanas depois é eco. Essa decisão não deixava
            rastro, então a linha ficava idêntica à de uma falha de automação.

            Medido na produção em 07/09/2026: 1.243 publicações classificadas
            sem tarefa, 1.243 delas notícia velha — nenhuma dos últimos 7 dias,
            1.063 com mais de 90. O aviso contava as 1.243. Carlos Henrique via
            "1003 publicações suas sem tarefa aberta", em VERMELHO, na barra que
            cobre toda tela do sistema, todo dia. Nove dos doze usuários viviam
            assim; o administrador não, e é por isso que ninguém reportou.

            Agora só entra o que o robô DEVERIA ter transformado em tarefa e não
            transformou. Hoje isso dá zero — e zero é a resposta certa: a
            automação não está falhando.
          */
          tarefaDispensadaEm: null,
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

    // Só se pergunta pelo último acesso de quem responde por uma tarefa em que
    // a pessoa é reserva — em geral, três ou quatro colegas.
    const usos = await ultimosUsosReais(this.prisma, souReserva.map((c) => c.responsavel.id));
    const daEquipe = souReserva.flatMap((c) => {
      const aviso = motivoParaAvisarAEquipe(c, usos.get(c.responsavel.id), agora);
      return aviso ? [{ c, aviso }] : [];
    });

    /** Um ato = (processo, providência); as cópias da mesma publicação colapsam. */
    const atosSemTarefa = publicacoes.filter(
      (p, i, todas) =>
        todas.findIndex((o) => o.processoId === p.processoId && o.providencia === p.providencia) === i,
    );

    const pendencias: Pendencia[] = [];
    if (atrasadas.length) {
      pendencias.push({
        tipo: 'ATRASADA',
        total: atrasadas.length,
        exemplos: atrasadas.slice(0, MAX_EXEMPLOS).map((c) => ({
          id: c.id,
          titulo: c.titulo,
          quando: c.inicio.toISOString(),
          href: `/agenda?compromisso=${c.id}`,
        })),
      });
    }
    /*
      LOGO DEPOIS DAS SUAS, e com o porquê no próprio item: "Elaborar
      manifestação" sozinho obrigaria a abrir a atividade só para descobrir de
      quem é e por que chegou a você.
    */
    if (daEquipe.length) {
      pendencias.push({
        tipo: 'PRECISA_DA_EQUIPE',
        total: daEquipe.length,
        exemplos: daEquipe.slice(0, MAX_EXEMPLOS).map(({ c, aviso }) => ({
          id: c.id,
          titulo: c.titulo,
          quando: c.inicio.toISOString(),
          href: `/agenda?compromisso=${c.id}`,
          detalhe: porQueAEquipePrecisa(c.responsavel.nomeExibicao || c.responsavel.nome, aviso),
        })),
      });
    }
    /*
      UM ATO, UMA LINHA — e não uma por destinatário.

      O tribunal manda a MESMA publicação para cada intimado; no banco viram
      linhas distintas com o mesmo (processo, providência). A contagem somava
      as cópias: medido em 07/09/2026, 39 linhas recentes eram 23 atos — 41% de
      inflação num número que existe justamente para dimensionar trabalho.
    */
    if (atosSemTarefa.length) {
      pendencias.push({
        tipo: 'PUBLICACAO_SEM_TAREFA',
        total: atosSemTarefa.length,
        exemplos: atosSemTarefa.slice(0, MAX_EXEMPLOS).map((p) => ({
          id: p.id,
          titulo: p.processo?.numeroCNJ ?? 'Publicação',
          quando: p.dataDisponibilizacao.toISOString(),
          href: `/processos?processo=${p.processoId ?? ''}`,
        })),
      });
    }

    return { pendencias, total: pendencias.reduce((s, p) => s + p.total, 0) };
  }
}
