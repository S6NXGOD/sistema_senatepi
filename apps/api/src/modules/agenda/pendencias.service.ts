import { Injectable } from '@nestjs/common';
import { Prisma, StatusCompromisso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inicioDoDiaBR } from '../processos/utils/data-br.util';
import { atoAcionavel, VALIDADE_DIAS } from '../processos/utils/tpu.util';
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
 *  · PUBLICACAO_SEM_TAREFA .. o ato chegou nos seus processos e ninguém pegou;
 *  · ATO_ESPERANDO_OLHO ..... o tribunal praticou um ato que o robô NÃO soube
 *                             resolver, e ninguém decidiu o que fazer com ele.
 *
 * O QUARTO NASCEU EM 17/09/2026, junto com o desligamento do criador cego de
 * tarefas — e por causa dele. "Não quero tarefas já com prazo matando o
 * advogado; se for algo urgente, mande um alerta, mas não encha de tarefas
 * desnecessárias." O robô do DataJud abria "Verificação de Intimação / Prazo"
 * sem saber o que o juízo pediu: das 48, 32 foram canceladas, 47 nasceram
 * atrasadas e 9 das 11 concluídas fecharam com "não havia peça a fazer".
 *
 * Só que desligar sem devolver alavanca é subtração. O ato passou a aparecer
 * com SELO ÂMBAR na ficha do processo — e a ficha é por processo, uma de cada
 * vez, exigindo rolar a linha do tempo. A lista de Processos ajuda pouco: ela
 * lê só a ÚLTIMA movimentação, e com o DataJud entregando em lote com mediana
 * de 62 dias de atraso, o ato que pede providência quase nunca é o último.
 * Ou seja: trocar a tarefa pelo selo, sozinho, esconderia o trabalho.
 *
 * Este é o alerta que o dono pediu no lugar da tarefa. É ESTADO: some quando
 * alguém decide ("virar tarefa" ou "já cuidei"), sem marcar como lido, sem
 * histórico e sem repetir. E é o MESMO cálculo do selo (`atoAcionavel`) — uma
 * porta só, porque duas réguas para o mesmo aviso já fizeram a lista mostrar
 * onze avisos que a ficha do mesmo processo não mostrava.
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
  tipo: 'ATRASADA' | 'PRECISA_DA_EQUIPE' | 'PUBLICACAO_SEM_TAREFA' | 'ATO_ESPERANDO_OLHO';
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

/**
 * O corte grosso da consulta: a maior validade do dicionário (DECISÃO, 90 dias).
 * Derivado, e não escrito à mão, para não virar mais um número casado por
 * comentário — se a validade de algum nível crescer, a consulta acompanha.
 */
const VALIDADE_MAIS_LARGA_DIAS = Math.max(...Object.values(VALIDADE_DIAS));

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

    const [atrasadas, souReserva, publicacoes, andamentos] = await Promise.all([
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
          /*
            E SEM PROPOSTA ABERTA (17/09/2026) — a terceira metade que faltava.

            A caixa de entrada do advogado é uma DECISÃO do robô: "isto vai para
            uma pessoa decidir". A publicação fica ali, inteira, esperando — mas
            no banco ela é igualzinha à que ninguém tratou: com providência, sem
            tarefa e sem dispensa.

            São 16 propostas abertas hoje. Todas apareciam na faixa como falha
            da automação, ao lado dos buracos de verdade — e uma faixa que mente
            em parte é uma faixa que se aprende a ignorar inteira. Quem tem
            proposta esperando já é avisado pela própria caixa.
          */
          /*
            MENOS A PROPOSTA ÓRFÃ. `tarefaPropostaPara` é nulo quando o robô
            soube que há trabalho mas não soube de quem — o ato do DJEN lista os
            advogados e não diz de quem cada um é. Essa proposta não chega a
            caixa nenhuma por padrão (`listar` filtra por `tarefaPropostaPara:
            usuarioId`; a órfã só aparece no escopo `?todas=1`, que exige perfil
            e que alguém se lembre de trocar o filtro).

            Ou seja: tirá-la daqui junto com as endereçadas não a tornaria menos
            barulhenta — a tornaria INVISÍVEL. A justificativa da exclusão ("quem
            tem proposta esperando já é avisado pela própria caixa") só vale para
            quem tem caixa.
          */
          OR: [{ tarefaPropostaEm: null }, { tarefaPropostaPara: null }],
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
       * O ATO QUE O ROBÔ NÃO SOUBE RESOLVER, nos processos da pessoa.
       *
       * O RECORTE É DO BANCO ATÉ ONDE DÁ, e o julgamento é de `atoAcionavel`:
       * a janela de captura corta por data, `compromissoId`/`dispensadoEm`
       * cortam o que já tem dono ou já foi dispensado por gente, e o resto
       * (código no dicionário, complemento, validade por nível) é da função,
       * que é a mesma que acende o selo na ficha. Reescrever esse julgamento
       * aqui seria a segunda implementação de um aviso que já divergiu uma vez.
       *
       * `avaliadoEm` NÃO entra no filtro de propósito: o carimbo do robô é o
       * que faz este item existir, não o que o apaga.
       */
      this.prisma.movimentacaoProcessual.findMany({
        where: {
          compromissoId: null,
          dispensadoEm: null,
          /*
            CORTA PELA VALIDADE MAIS LARGA, não pela janela do robô. O selo de
            PRAZO vale 30 dias, mas o de DECISÃO vale 90 — e são as DECISÕES que
            dominam o que sobrou (5 Procedência em Parte, 5 Não-Provimento, 4
            Não-Acolhimento de Embargos...). Cortar em 30 aqui esconderia a maior
            parte do que este aviso existe para mostrar. Quem aplica a validade
            certa de cada nível é `atoAcionavel`, logo abaixo.
          */
          dataMovimento: { gte: new Date(agora.getTime() - VALIDADE_MAIS_LARGA_DIAS * 86_400_000) },
          processo: { advogados: { some: { advogadoId: usuarioId } } },
        },
        orderBy: { dataMovimento: 'desc' },
        // Teto folgado: o acervo inteiro tem ~1.350 movimentações em 90 dias.
        take: 200,
        select: {
          id: true, descricao: true, detalhe: true, codigoMovimento: true, dataMovimento: true,
          compromissoId: true, dispensadoEm: true, avaliadoEm: true, avaliadoMotivo: true,
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

    /*
      O MESMO JULGAMENTO DO SELO, aplicado aqui. `atoAcionavel` devolve o nível,
      o rótulo e — quando há carimbo — o motivo do robô, que é o que transforma
      "há um ato" em "há um ato e o sistema não soube o que fazer com ele".
    */
    const atosEsperandoOlho = andamentos.flatMap((m) => {
      const ato = atoAcionavel(m, agora);
      return ato ? [{ m, ato }] : [];
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
    /*
      POR ÚLTIMO, E DE PROPÓSITO. Os três de cima são trabalho que já tem nome e
      dono; este é trabalho que ainda precisa ser reconhecido como trabalho. A
      ordem da faixa é a ordem em que se resolve.

      O LINK LEVA AO ANDAMENTO, não só ao processo: aviso com número e sem
      destino obriga a procurar, e a ficha de um processo movimentado tem
      dezenas de linhas. `?andamento=` é o mesmo parâmetro que a ficha já usa
      para destacar a linha.
    */
    if (atosEsperandoOlho.length) {
      pendencias.push({
        tipo: 'ATO_ESPERANDO_OLHO',
        total: atosEsperandoOlho.length,
        exemplos: atosEsperandoOlho.slice(0, MAX_EXEMPLOS).map(({ m, ato }) => ({
          id: m.id,
          titulo: m.processo?.numeroCNJ ?? 'Processo',
          quando: m.dataMovimento.toISOString(),
          href: `/processos?processo=${m.processoId}&andamento=${m.id}`,
          detalhe: ato.rotulo,
        })),
      });
    }

    return { pendencias, total: pendencias.reduce((s, p) => s + p.total, 0) };
  }
}
