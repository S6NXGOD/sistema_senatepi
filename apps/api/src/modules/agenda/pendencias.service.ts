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

/**
 * O ESCOPO GANHOU UMA EXCEÇÃO, e ela é deliberada.
 *
 * Tudo aqui é pessoal — até a publicação sem tarefa é filtrada pelos processos
 * do próprio advogado. `ACAO_NOVA` não é: ela não é de ninguém, porque o
 * processo ainda não existe no acervo para ter dono.
 *
 * Ela entra pelo MESMO motivo que trouxe a publicação sem tarefa para cá, escrito
 * ali em cima: "o ato chegou, ninguém pegou, e o silêncio parece calma". Uma
 * ação contra o sindicato que ninguém cadastrou é a mesma falha um nível acima —
 * e a única que não aparece em NENHUMA lista do sistema, porque o sistema não
 * sabe que o processo existe.
 *
 * NÃO VIRA DIFUSÃO DE RESPONSABILIDADE: é uma fila compartilhada com resolução
 * Única. Quem cadastrar (ou ignorar) primeiro limpa o item para todo mundo.
 */
/** Uma pendência: o que é, quantas são, e para onde ela leva. */
export interface Pendencia {
  tipo: 'ATRASADA' | 'PASSOU_DA_HORA' | 'HOJE' | 'AUDIENCIA' | 'PUBLICACAO_SEM_TAREFA' | 'ACAO_NOVA';
  total: number;
  /** Até três exemplos — o suficiente para reconhecer sem virar uma lista. */
  exemplos: { id: string; titulo: string; quando: string | null; href: string }[];
  /**
   * FILA DA EQUIPE, e não trabalho de quem está olhando.
   *
   * Vive aqui, e não só no mapa de rótulos do web, porque é o que decide o
   * NÚMERO DO CRACHÁ — e essa conta é feita neste arquivo. Com a regra nos dois
   * lugares, o crachá somava o que o rótulo dizia não ser da pessoa.
   */
  compartilhada?: boolean;
}

/**
 * O QUE NÃO ENTRA NO CRACHÁ — e por que o crachá estava mentindo para todos.
 *
 * Medido em 09/09/2026, nos 14 usuários ativos:
 *
 *   Tiago, Margareth, Lara, Jaqueline, Shérad ... 0 tarefas suas, crachá = 25
 *   Ícaro, Murilo ............................... 1 tarefa,  crachá = 26 (96% alheio)
 *   Morgana ..................................... 5 tarefas, crachá = 30 (83% alheio)
 *   Administradores / coordenação / triagem ..... 11,        crachá = 36 (69% alheio)
 *
 * As 25 são a fila COMPARTILHADA de ações que o Diário revelou e ninguém
 * cadastrou. O mesmo 25 para os catorze, todo dia, sem mudar — porque não é de
 * ninguém. Cinco pessoas sem nada a fazer viam "25" em vermelho no topo de toda
 * tela do sistema.
 *
 * O comentário do próprio `ACAO_NOVA` já previa isto ("faz o contador mentir
 * sobre a carga da pessoa; ela abre esperando 30 tarefas suas") e o flag
 * `compartilhada` existia no web — mas a SOMA acontecia aqui, sem conhecê-lo.
 *
 * Um crachá que não zera nunca é papel de parede. Agora ele responde uma
 * pergunta só: "quantas coisas MINHAS estão esperando?" — e zerar é a melhor
 * notícia que ele pode dar. A fila da equipe continua na lista, marcada, e
 * continua no painel e em Processos, que é onde se trabalha um backlog.
 */
const NAO_CONTA_NO_CRACHA: ReadonlySet<Pendencia['tipo']> = new Set(['ACAO_NOVA']);

const MAX_EXEMPLOS = 3;

/**
 * De que lado estamos, em duas palavras.
 *
 * O sino tem uma linha por item e ela já carrega o NPU — "Movem contra nós" é o
 * máximo que cabe e o mínimo que informa. `AMBOS` acontece em recurso (11% dos
 * casos medidos) e não pode virar um dos dois: seria escolher por chute.
 */
const POLO_CURTO: Record<string, string> = {
  ATIVO: 'Movemos',
  PASSIVO: 'Movem contra nós',
  AMBOS: 'Nos dois polos',
  INDEFINIDO: 'Polo não informado',
};
/** Uma semana de pauta: o que cabe em "me preparar". */
const DIAS_DE_AUDIENCIA = 7;

@Injectable()
export class PendenciasService {
  constructor(private readonly prisma: PrismaService) {}

  async minhas(
    usuarioId: string,
    /**
     * Quem pode CADASTRAR processo. Só para esses o sino conta ação nova: para
     * quem não tem o botão, o item seria uma cobrança sem saída.
     */
    cadastraProcesso = false,
  ): Promise<{ pendencias: Pendencia[]; total: number }> {
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

    const [atrasadas, passaramDaHora, hoje, audiencias, publicacoes, acoesNovas] = await Promise.all([
      this.prisma.compromisso.findMany({
        where: { ...meu, inicio: { lt: inicioDeHoje } },
        orderBy: { inicio: 'asc' },
        select: selecao,
      }),
      /*
        O DIA DE HOJE VIROU DOIS, e o motivo é que o sino não escalava.

        "5 atividades para hoje" às 09:00 e "5 atividades para hoje" às 22:00
        são a mesma frase para situações opostas. Nada na tela dizia que o
        tempo estava acabando — e o sino é o único aviso que aparece em TODAS
        as telas, então é ele que decide se a pessoa lembra.

        A hora já passada é informação, não alarme (`urgente: false`): o robô
        agenda "Cadastrar ação do Diário" para as 15:00 do próprio dia, e às
        15:01 nada foi perdido. Mesma régua do painel, mesmas três palavras —
        ver `estadoDoPrazo` em `lib/agenda.ts`.
      */
      this.prisma.compromisso.findMany({
        where: { ...meu, inicio: { gte: inicioDeHoje, lt: agora } },
        orderBy: { inicio: 'asc' },
        select: selecao,
      }),
      this.prisma.compromisso.findMany({
        where: { ...meu, inicio: { gte: agora, lt: fimDeHoje } },
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
            1.063 com mais de 90. O sino contava as 1.243. Carlos Henrique via
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
      /**
       * AÇÃO DO SINDICATO QUE O DIÁRIO REVELOU E NINGUÉM CADASTROU.
       *
       * O único item do sino que não é de ninguém — porque o processo ainda não
       * existe no acervo para ter dono. E é o único que NÃO aparece em nenhuma
       * outra lista do sistema: as demais telas falam do acervo, e este caso, por
       * definição, está fora dele.
       *
       * Ordenado pela mais ANTIGA: uma ação que já apareceu oito vezes no Diário
       * sem cadastro não é novidade de ontem — é acompanhamento que não houve, e
       * é ela que precisa sair da fila primeiro.
       */
      !cadastraProcesso
        ? Promise.resolve([])
        : this.prisma.sugestaoProcesso.findMany({
            where: { status: 'PENDENTE' },
            orderBy: { primeiraEm: 'asc' },
            select: {
              id: true,
              numeroCNJ: true,
              nossoPolo: true,
              primeiraEm: true,
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

    /** Um ato = (processo, providência); as cópias da mesma publicação colapsam. */
    const atosSemTarefa = publicacoes.filter(
      (p, i, todas) =>
        todas.findIndex((o) => o.processoId === p.processoId && o.providencia === p.providencia) === i,
    );

    const pendencias = [
      daAgenda('ATRASADA', atrasadas),
      daAgenda('PASSOU_DA_HORA', passaramDaHora),
      daAgenda('HOJE', hoje),
      daAgenda('AUDIENCIA', audiencias),
      /*
        UM ATO, UMA LINHA — e não uma por destinatário.

        O tribunal manda a MESMA publicação para cada intimado; no banco viram
        linhas distintas com o mesmo (processo, providência). O robô já cria uma
        tarefa só para o conjunto, mas a contagem daqui somava as cópias:
        medido em 07/09/2026, 39 linhas recentes eram 23 atos — 41% de inflação
        num número que existe justamente para dimensionar trabalho.

        A chave é a MESMA que o robô usa para agrupar, de propósito: duas
        definições de "o mesmo ato" divergiriam na primeira publicação irmã.
      */
      atosSemTarefa.length
        ? {
            tipo: 'PUBLICACAO_SEM_TAREFA' as const,
            total: atosSemTarefa.length,
            exemplos: atosSemTarefa.slice(0, MAX_EXEMPLOS).map((p) => ({
              id: p.id,
              titulo: p.processo?.numeroCNJ ?? 'Publicação',
              quando: p.dataDisponibilizacao.toISOString(),
              href: `/processos?processo=${p.processoId ?? ''}`,
            })),
          }
        : null,
      acoesNovas.length
        ? {
            tipo: 'ACAO_NOVA' as const,
            compartilhada: true,
            total: acoesNovas.length,
            exemplos: acoesNovas.slice(0, MAX_EXEMPLOS).map((a) => ({
              id: a.id,
              /*
                O POLO VEM NO TÍTULO porque é a única coisa que muda a reação.
                "Movem contra nós" e "movemos" pedem urgências diferentes, e o
                NPU sozinho não distingue uma da outra — obrigaria a abrir para
                descobrir, que é o que o sino existe para evitar.
              */
              titulo: `${POLO_CURTO[a.nossoPolo]} · ${a.numeroCNJ}`,
              // A data da PRIMEIRA vez que ela apareceu — é há quanto tempo ela
              // está sem cadastro, e não quando o robô olhou por último.
              quando: a.primeiraEm.toISOString(),
              /*
                LEVA DIRETO AO CADASTRO PREENCHIDO, e não à lista.
                Mandar para `/processos` deixava a pessoa procurando a fila na
                tela para clicar em "Cadastrar" — três passos para uma decisão que
                o sino já apresentou. O parâmetro abre o diálogo de importação com
                o NPU dentro, o que dispara sozinho a prévia do CNJ.
              */
              href: `/processos?cadastrar=${a.numeroCNJ}`,
            })),
          }
        : null,
    ].filter((p): p is Pendencia => p !== null);

    return {
      pendencias,
      /* Só o que é DELA. Ver `NAO_CONTA_NO_CRACHA` para os números que
         motivaram isto — cinco pessoas com zero tarefas viam 25. */
      total: pendencias
        .filter((p) => !NAO_CONTA_NO_CRACHA.has(p.tipo))
        .reduce((s, p) => s + p.total, 0),
    };
  }
}
