import { Injectable } from '@nestjs/common';
import { Prisma, StatusAtendimento, StatusCompromisso, StatusProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { inicioDoDiaBR } from '../processos/utils/data-br.util';

/**
 * RELATÓRIOS — o que a equipe entregou, e o que ficou.
 *
 * DUAS DECISÕES QUE MOLDAM TUDO AQUI:
 *
 * 1. NÃO EXISTE RANKING. Nada de posição, nota, medalha ou "melhor do mês".
 *    São nove advogados que se conhecem pelo nome; uma tabela ordenada por
 *    volume vira comparação pública de produtividade entre colegas cujos casos
 *    não são comparáveis — uma execução simples e uma ação civil pública contam
 *    "1" cada. A ordem é ALFABÉTICA, de propósito, e a leitura fica com quem
 *    conhece o trabalho.
 *
 * 2. O ADVOGADO VÊ O PRÓPRIO ESPELHO. A permissão `relatorios` é VISUALIZAR
 *    para ele, mas o recorte é aqui: ele recebe uma linha, a dele. Quem
 *    coordena recebe todas. Sem isso, "relatório de equipe" seria o mesmo que
 *    publicar a produção de cada um para todos.
 *
 * O QUE ESTE SERVIÇO NÃO MEDE, e é deliberado: qualidade. Nenhum número aqui
 * diz se a peça era boa. Ele conta entregas, atrasos e desfechos — o resto é
 * leitura de quem lê.
 */

export interface LinhaEquipe {
  usuarioId: string;
  nome: string;
  papel: string;
  /** Atividades concluídas no período. */
  concluidas: number;
  /** Abertas agora, independentemente do período. É a foto, não o filme. */
  abertas: number;
  /** Abertas e com o horário já vencido. */
  atrasadas: number;
  /** Mediana em minutos, só das que tiveram cronômetro. `null` sem amostra. */
  medianaMinutos: number | null;
  /** Quantas das concluídas tiveram cronômetro — a base da mediana. */
  cronometradas: number;
}

export interface Contagem {
  rotulo: string;
  total: number;
}

export interface Relatorio {
  periodo: { de: string; ate: string };
  escopo: 'GLOBAL' | 'PESSOAL';
  /** Quando a coordenação pediu o espelho de UMA pessoa. */
  focoUsuario: { id: string; nome: string } | null;
  equipe: LinhaEquipe[];
  atividades: {
    concluidas: number;
    canceladas: number;
    abertas: number;
    atrasadas: number;
    porDesfecho: Contagem[];
    /**
     * QUE TIPO DE TRABALHO. "Concluiu 15" não diz se foram quinze audiências
     * ou quinze telefonemas — e a diferença é o dia inteiro de alguém.
     */
    porTipo: Contagem[];
    /** Quantas nasceram de robô e quantas de gente. */
    automaticas: number;
    manuais: number;
  };
  processos: {
    /** Entraram no SISTEMA no período — inclui acervo antigo recém-importado. */
    cadastrados: number;
    /** Foram AJUIZADOS no período. É o número de "casos novos" de verdade. */
    distribuidos: number;
    ativos: number;
    encerrados: number;
    porArea: Contagem[];
    porTribunal: Contagem[];
  };
  atendimentos: {
    registrados: number;
    concluidos: number;
    porCanal: Contagem[];
    porAtendente: Contagem[];
    /**
     * SOBRE O QUE O FILIADO PROCUROU — a pergunta que a diretoria faz e que o
     * sistema não sabia responder. `naoInformado` conta os registros anteriores
     * ao campo e os que ficaram em branco: sem ele, uma amostra de três viraria
     * "100% progressão de nível".
     */
    porAssunto: Contagem[];
    assuntoNaoInformado: number;
    porSetor: Contagem[];
  };
  geradoEm: string;
}

/** Mediana e não média: uma atividade esquecida aberta a noite inteira
 *  distorceria a média e não move a mediana. */
function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 ? ord[meio] : Math.round((ord[meio - 1] + ord[meio]) / 2);
}

function contar<T>(itens: T[], chave: (t: T) => string | null): Contagem[] {
  const mapa = new Map<string, number>();
  for (const i of itens) {
    const k = chave(i);
    if (!k) continue;
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([rotulo, total]) => ({ rotulo, total }))
    .sort((a, b) => b.total - a.total || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

@Injectable()
export class RelatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  async montar(
    de: Date,
    ate: Date,
    usuario: { id: string; role: string; permissoes?: unknown },
    /**
     * FOCO EM UMA PESSOA — pedido da coordenação para conversar com alguém, não
     * para publicar um pódio. O advogado NÃO pode usar: para ele o recorte já é
     * ele mesmo, e aceitar o parâmetro abriria o espelho do colega.
     */
    focoId?: string,
  ): Promise<Relatorio> {
    // `ate` chega como data; o período fecha no FIM do dia informado, senão
    // "de 01/09 até 30/09" perderia tudo que aconteceu no dia 30.
    const inicio = inicioDoDiaBR(de);
    const fim = new Date(inicioDoDiaBR(ate).getTime() + 24 * 3_600_000);
    const agora = new Date();

    const souAdvogado = usuario.role === 'ADVOGADO';
    /** O foco só existe para quem vê a equipe inteira. */
    const foco = souAdvogado ? undefined : focoId?.trim() || undefined;
    const alvo = souAdvogado ? usuario.id : foco;

    const soMeu: Prisma.CompromissoWhereInput = alvo
      ? { OR: [{ responsavelId: alvo }, { equipe: { some: { usuarioId: alvo } } }] }
      : {};

    const noPeriodo = { gte: inicio, lt: fim };

    const [
      concluidas,
      canceladas,
      abertas,
      processosNovos,
      processosDistribuidos,
      processosAtivos,
      processosEncerrados,
      processosPeriodo,
      atendimentos,
      pessoas,
    ] = await Promise.all([
      /**
       * CONCLUÍDA CONTA PARA QUEM CONCLUIU — inclusive no escopo pessoal.
       *
       * A primeira versão filtrava o escopo pessoal por "sou o responsável",
       * e o mesmo advogado aparecia com 13 no próprio relatório e 15 no da
       * coordenação: duas ele havia concluído sem ser o responsável. Dois
       * números para a mesma pergunta é pior que número nenhum.
       */
      this.prisma.compromisso.findMany({
        where: {
          ...(alvo ? { concluidoPor: alvo } : {}),
          status: StatusCompromisso.CONCLUIDO,
          concluidoEm: noPeriodo,
        },
        select: {
          concluidoPor: true, responsavelId: true, desfecho: true,
          tipo: true, origemAutomatica: true,
          iniciadoEm: true, concluidoEm: true,
        },
      }),
      this.prisma.compromisso.count({
        where: { ...soMeu, status: StatusCompromisso.CANCELADO, canceladoEm: noPeriodo },
      }),
      this.prisma.compromisso.findMany({
        where: {
          ...soMeu,
          status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        },
        select: { responsavelId: true, inicio: true },
      }),
      this.prisma.processo.count({ where: { createdAt: noPeriodo } }),
      /**
       * DISTRIBUÍDOS, e não cadastrados — são coisas diferentes e o relatório
       * mentiria juntando as duas. Na primeira carga do acervo, 127 processos
       * entraram no sistema em agosto, e o mais antigo é de 2015: "127 novos no
       * mês" seria uma afirmação falsa sobre o trabalho da equipe.
       */
      this.prisma.processo.count({ where: { dataDistribuicao: noPeriodo } }),
      this.prisma.processo.count({ where: { statusInterno: StatusProcesso.ATIVO } }),
      this.prisma.processo.count({
        where: { statusInterno: StatusProcesso.ENCERRADO, updatedAt: noPeriodo },
      }),
      this.prisma.processo.findMany({
        where: { statusInterno: StatusProcesso.ATIVO },
        select: { categoria: true, tribunal: true },
      }),
      this.prisma.atendimento.findMany({
        where: {
          createdAt: noPeriodo,
          // O foco vale também para o balcão: "o que o Ivo atendeu no mês".
          ...(alvo ? { atendentePorId: alvo } : {}),
        },
        select: {
          status: true, canal: true, assunto: true, setor: true,
          atendente: { select: { nome: true, nomeExibicao: true } },
        },
      }),
      this.prisma.user.findMany({
        where: alvo ? { id: alvo } : { ativo: true },
        select: { id: true, nome: true, nomeExibicao: true, role: true },
        orderBy: { nome: 'asc' },
      }),
    ]);

    const duracoes = new Map<string, number[]>();
    const porPessoa = new Map<string, { concluidas: number; cronometradas: number }>();
    for (const c of concluidas) {
      // Quem CONCLUIU, e não quem era responsável: o relatório conta entrega.
      const quem = c.concluidoPor ?? c.responsavelId;
      if (!quem) continue;
      const atual = porPessoa.get(quem) ?? { concluidas: 0, cronometradas: 0 };
      atual.concluidas++;
      if (c.iniciadoEm && c.concluidoEm) {
        atual.cronometradas++;
        const min = Math.round((c.concluidoEm.getTime() - c.iniciadoEm.getTime()) / 60_000);
        if (min >= 0) duracoes.set(quem, [...(duracoes.get(quem) ?? []), min]);
      }
      porPessoa.set(quem, atual);
    }

    const abertasPorPessoa = new Map<string, { abertas: number; atrasadas: number }>();
    for (const a of abertas) {
      if (!a.responsavelId) continue;
      const atual = abertasPorPessoa.get(a.responsavelId) ?? { abertas: 0, atrasadas: 0 };
      atual.abertas++;
      if (a.inicio < agora) atual.atrasadas++;
      abertasPorPessoa.set(a.responsavelId, atual);
    }

    /**
     * ORDEM ALFABÉTICA, e a lista traz TODO MUNDO — inclusive quem fechou zero.
     *
     * Ordenar por volume publicaria um pódio. E esconder quem ficou em zero
     * seria pior que mostrar: o zero pode ser férias, pode ser um mês inteiro
     * dentro de uma ação civil pública que não gera "atividade concluída", e é
     * justamente a linha que precisa de conversa, não de sumiço.
     */
    const equipe: LinhaEquipe[] = pessoas.map((p) => {
      const fez = porPessoa.get(p.id) ?? { concluidas: 0, cronometradas: 0 };
      const tem = abertasPorPessoa.get(p.id) ?? { abertas: 0, atrasadas: 0 };
      return {
        usuarioId: p.id,
        nome: p.nomeExibicao || p.nome,
        papel: p.role,
        concluidas: fez.concluidas,
        abertas: tem.abertas,
        atrasadas: tem.atrasadas,
        cronometradas: fez.cronometradas,
        medianaMinutos: mediana(duracoes.get(p.id) ?? []),
      };
    });

    const alvoNome = alvo ? (pessoas.find((x) => x.id === alvo) ?? null) : null;

    return {
      periodo: { de: inicio.toISOString(), ate: fim.toISOString() },
      escopo: souAdvogado ? 'PESSOAL' : 'GLOBAL',
      focoUsuario:
        foco && alvoNome ? { id: alvoNome.id, nome: alvoNome.nomeExibicao || alvoNome.nome } : null,
      equipe,
      atividades: {
        concluidas: concluidas.length,
        canceladas,
        abertas: abertas.length,
        atrasadas: abertas.filter((a) => a.inicio < agora).length,
        porDesfecho: contar(concluidas, (c) => c.desfecho),
        porTipo: contar(concluidas, (c) => String(c.tipo)),
        automaticas: concluidas.filter((c) => c.origemAutomatica).length,
        manuais: concluidas.filter((c) => !c.origemAutomatica).length,
      },
      processos: {
        cadastrados: processosNovos,
        distribuidos: processosDistribuidos,
        ativos: processosAtivos,
        encerrados: processosEncerrados,
        porArea: contar(processosPeriodo, (p) => p.categoria),
        porTribunal: contar(processosPeriodo, (p) => p.tribunal),
      },
      atendimentos: {
        registrados: atendimentos.length,
        concluidos: atendimentos.filter((a) => a.status === StatusAtendimento.CONCLUIDO).length,
        porCanal: contar(atendimentos, (a) => a.canal),
        porAtendente: contar(
          atendimentos,
          (a) => a.atendente?.nomeExibicao || a.atendente?.nome || null,
        ),
        porAssunto: contar(atendimentos, (a) => (a.assunto ? String(a.assunto) : null)),
        assuntoNaoInformado: atendimentos.filter((a) => !a.assunto).length,
        porSetor: contar(atendimentos, (a) => (a.setor ? String(a.setor) : null)),
      },
      geradoEm: new Date().toISOString(),
    };
  }
}
