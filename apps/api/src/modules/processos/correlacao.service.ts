import { Injectable, Logger } from '@nestjs/common';
import { StatusCompromisso, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { montarUrgencia } from '../agenda/equipe.util';
import { somarDiasUteis, TITULO_PRAZO_GENERICO } from './automacao-prazos.service';
import { correlacionar } from './utils/correlacao.util';
import {
  classificarProvidencia,
  diasParaLembrete,
  PROVIDENCIAS,
  type Providencia,
} from './utils/providencia.util';

/**
 * Amarra as publicações do DJEN às movimentações do DataJud, e garante que um
 * mesmo fato produza NO MÁXIMO UMA atividade.
 *
 * OS QUATRO CENÁRIOS
 *
 *  A. A movimentação já gerou atividade → a publicação ENRIQUECE aquela
 *     atividade: o título vira a providência específica ("Elaborar
 *     manifestação" no lugar de "Verificação de Intimação / Prazo") e o teor
 *     entra na descrição. Nenhuma atividade nova.
 *
 *  B. A movimentação existe e NÃO gerou nada (classificou como irrelevante, ou
 *     foi agrupada noutra tarefa) → o DJEN cria a atividade, porque ele tem o
 *     texto e o DataJud só tinha o rótulo. Carimba `movimentacao.compromissoId`
 *     para o robô nunca mais reavaliá-la.
 *
 *  C. Nenhuma movimentação casa — o DJEN chegou primeiro. É comum: a publicação
 *     sai no diário antes de o tribunal alimentar o índice do CNJ. O DJEN cria
 *     a atividade sozinho.
 *
 *  D. O DataJud chega DEPOIS, para um fato já publicado. Antes de o robô de
 *     prazos rodar, a correlação roda no sentido inverso e carimba a
 *     movimentação nova com a atividade que a publicação já criou. O robô então
 *     a pula pela trava que sempre existiu (`if (mov.compromissoId) continue`).
 *
 * O cenário D é o que fecha o circuito: com ele, a ordem de chegada deixa de
 * importar. Sem ele, toda publicação que se antecipasse ao CNJ viraria duas
 * atividades no dia seguinte.
 */
@Injectable()
export class CorrelacaoService {
  private readonly logger = new Logger(CorrelacaoService.name);

  /**
   * Janela de movimentações consideradas. Igual à do robô de prazos: um
   * andamento de meses atrás geraria tarefa já vencida, que é ruído numa agenda
   * que precisa ser levada a sério.
   */
  private readonly JANELA_DIAS = 30;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lado DJEN — cenários A, B e C.
   *
   * Chamado depois de ingerir publicações de um processo.
   */
  async aplicarAposDjen(processoId: string): Promise<{ criadas: number; enriquecidas: number }> {
    const resumo = { criadas: 0, enriquecidas: 0 };
    try {
      const desde = new Date(Date.now() - this.JANELA_DIAS * 24 * 3_600_000);

      // `providencia: null` = ainda não classificada. É o que faz cada
      // publicação ser processada UMA vez: sem esse filtro, a janela inteira de
      // 30 dias seria reclassificada toda noite, e as que não pedem providência
      // nenhuma (edital, lista de distribuição) voltariam para sempre.
      const comunicacoes = await this.prisma.comunicacaoDjen.findMany({
        where: {
          processoId,
          providencia: null,
          compromissoId: null,
          dataDisponibilizacao: { gte: desde },
        },
        orderBy: { dataDisponibilizacao: 'asc' },
        select: {
          id: true, texto: true, tipoComunicacao: true, dataDisponibilizacao: true,
          movimentacaoId: true, link: true, nomeOrgao: true,
        },
      });
      if (!comunicacoes.length) return resumo;

      const processo = await this.carregarProcesso(processoId);
      if (!processo) return resumo;

      // Classifica antes de parear: o pareamento precisa saber quais publicações
      // designam pauta (caso especial da regra).
      const classificadas = comunicacoes.map((c) => ({
        ...c,
        ...classificarProvidencia(c.texto, c.tipoComunicacao),
      }));

      const movimentacoes = await this.prisma.movimentacaoProcessual.findMany({
        where: { processoId, dataMovimento: { gte: desde } },
        select: {
          id: true, dataMovimento: true, descricao: true, detalhe: true,
          conteudo: true, codigoMovimento: true, compromissoId: true,
        },
      });

      const pares = correlacionar(
        classificadas.map((c) => ({
          id: c.id,
          dataDisponibilizacao: c.dataDisponibilizacao,
          movimentacaoId: c.movimentacaoId,
          ehPauta: c.providencia === 'PREPARAR_AUDIENCIA',
        })),
        movimentacoes,
      );
      const movPorComunicacao = new Map(pares.map((p) => [p.comunicacaoId, p.movimentacaoId]));
      const movPorId = new Map(movimentacoes.map((m) => [m.id, m]));

      for (const c of classificadas) {
        if (c.providencia === 'NENHUMA') {
          // Grava a classificação mesmo sem atividade: é o que tira a
          // publicação da fila de trabalho. Sem isto ela seria reavaliada em
          // toda execução, para dar sempre o mesmo "nada a fazer".
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: { providencia: 'NENHUMA' },
          });
          continue;
        }

        const movimentacaoId = movPorComunicacao.get(c.id) ?? null;
        const movimentacao = movimentacaoId ? movPorId.get(movimentacaoId) : undefined;

        // (A) A movimentação já virou atividade — enriquece em vez de criar.
        if (movimentacao?.compromissoId) {
          await this.enriquecer(movimentacao.compromissoId, c);
          await this.prisma.comunicacaoDjen.update({
            where: { id: c.id },
            data: {
              movimentacaoId,
              compromissoId: movimentacao.compromissoId,
              providencia: c.providencia,
              prazoMencionadoDias: c.prazoMencionadoDias,
            },
          });
          resumo.enriquecidas++;
          continue;
        }

        // (B) e (C) — o DJEN cria a atividade. Em (B) ainda carimba a
        // movimentação, para o robô de prazos não gerar uma segunda depois.
        const compromissoId = await this.criarAtividade(processo, c);
        await this.prisma.comunicacaoDjen.update({
          where: { id: c.id },
          data: {
            movimentacaoId,
            compromissoId,
            providencia: c.providencia,
            prazoMencionadoDias: c.prazoMencionadoDias,
          },
        });
        if (movimentacaoId) {
          await this.prisma.movimentacaoProcessual.update({
            where: { id: movimentacaoId },
            data: { compromissoId },
          });
        }
        resumo.criadas++;
      }

      if (resumo.criadas || resumo.enriquecidas) {
        this.logger.log(
          `[CORRELACAO] ${processo.numeroCNJ}: ${resumo.criadas} atividade(s) criada(s), ` +
            `${resumo.enriquecidas} enriquecida(s) com o teor da publicação.`,
        );
      }
    } catch (err) {
      // Como o robô de prazos: a automação nunca derruba a ingestão. Perder um
      // enriquecimento é aceitável; perder a publicação, não.
      this.logger.error(
        `[CORRELACAO] Falha ao correlacionar o processo ${processoId}: ${(err as Error).message}`,
      );
    }
    return resumo;
  }

  /**
   * Lado DataJud — cenário D.
   *
   * Roda ANTES do robô de prazos: movimentação nova que descreve um fato já
   * publicado (e já resolvido em atividade) recebe o carimbo daquela atividade.
   * O robô então a ignora, pela trava que ele já tinha.
   *
   * Devolve quantas foram vinculadas — é o número de atividades duplicadas que
   * deixaram de nascer.
   */
  async vincularMovimentacoesNovas(processoId: string): Promise<number> {
    try {
      const desde = new Date(Date.now() - this.JANELA_DIAS * 24 * 3_600_000);

      // Só publicações que JÁ têm atividade: são elas que podem absorver uma
      // movimentação nova. As demais serão tratadas na próxima passagem do DJEN.
      const comunicacoes = await this.prisma.comunicacaoDjen.findMany({
        where: {
          processoId,
          compromissoId: { not: null },
          movimentacaoId: null,
          dataDisponibilizacao: { gte: desde },
        },
        select: {
          id: true, dataDisponibilizacao: true, compromissoId: true, providencia: true,
        },
      });
      if (!comunicacoes.length) return 0;

      const movimentacoes = await this.prisma.movimentacaoProcessual.findMany({
        where: { processoId, compromissoId: null, dataMovimento: { gte: desde } },
        select: {
          id: true, dataMovimento: true, descricao: true, detalhe: true,
          conteudo: true, codigoMovimento: true, compromissoId: true,
        },
      });
      if (!movimentacoes.length) return 0;

      const pares = correlacionar(
        comunicacoes.map((c) => ({
          id: c.id,
          dataDisponibilizacao: c.dataDisponibilizacao,
          movimentacaoId: null,
          ehPauta: c.providencia === 'PREPARAR_AUDIENCIA',
        })),
        movimentacoes,
      );

      const porComunicacao = new Map(comunicacoes.map((c) => [c.id, c]));
      for (const par of pares) {
        const c = porComunicacao.get(par.comunicacaoId)!;
        await this.prisma.movimentacaoProcessual.update({
          where: { id: par.movimentacaoId },
          data: { compromissoId: c.compromissoId },
        });
        await this.prisma.comunicacaoDjen.update({
          where: { id: c.id },
          data: { movimentacaoId: par.movimentacaoId },
        });
      }

      if (pares.length) {
        this.logger.log(
          `[CORRELACAO] Processo ${processoId}: ${pares.length} movimentação(ões) ligada(s) ` +
            'a publicação já resolvida — atividade duplicada evitada.',
        );
      }
      return pares.length;
    } catch (err) {
      this.logger.error(
        `[CORRELACAO] Falha ao vincular movimentações do processo ${processoId}: ${(err as Error).message}`,
      );
      return 0;
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Acrescenta o teor da publicação a uma atividade que o DataJud já criou.
   *
   * O título só é promovido quando a atividade ainda tem o rótulo genérico do
   * robô: se uma pessoa renomeou a tarefa, essa escolha vale mais que a nossa
   * classificação. A descrição é ACRESCIDA, nunca substituída — o que o robô
   * escreveu (lista de andamentos, aviso de atraso) continua sendo verdade.
   */
  private async enriquecer(
    compromissoId: string,
    c: { texto: string; link: string | null; providencia: Providencia; prazoMencionadoDias: number | null },
  ): Promise<void> {
    if (c.providencia === 'NENHUMA') return;
    const spec = PROVIDENCIAS[c.providencia];

    const atual = await this.prisma.compromisso.findUnique({
      where: { id: compromissoId },
      select: { titulo: true, descricao: true, origemAutomatica: true, urgente: true },
    });
    if (!atual) return;

    const jaTemTeor = atual.descricao?.includes(BLOCO_PUBLICACAO) ?? false;
    if (jaTemTeor) return; // idempotente: rodar duas vezes não empilha o texto

    const promoverTitulo =
      atual.origemAutomatica && atual.titulo === TITULO_PRAZO_GENERICO;

    await this.prisma.compromisso.update({
      where: { id: compromissoId },
      data: {
        ...(promoverTitulo ? { titulo: spec.titulo } : {}),
        descricao: `${atual.descricao ?? ''}\n\n${this.blocoTeor(c)}`.trim(),
        /**
         * Prazo curto marca como urgente; NUNCA desmarca — por isso o `||` com
         * o valor atual, e por isso `montarUrgencia` só é chamada quando a
         * marca vai de fato subir. Chamá-la com `false` limparia a urgência que
         * uma pessoa tivesse posto à mão.
         *
         * Passa por `montarUrgencia` como todo o resto: a Agenda exige motivo
         * de quem marca, e o robô escrevia os campos direto no banco. Era o
         * TERCEIRO lugar com o mesmo desvio — os outros dois estão em
         * `automacao-prazos`, corrigidos antes deste.
         */
        ...(!atual.urgente && (c.prazoMencionadoDias ?? 99) <= 5
          ? montarUrgencia(
              true,
              `A publicação menciona prazo de ${c.prazoMencionadoDias} dia(s).`,
              { origem: 'AUTOMACAO' },
            )
          : {}),
      },
    });
  }

  /** Cria a atividade a partir da publicação (cenários B e C). */
  private async criarAtividade(
    processo: ProcessoAlvo,
    c: {
      texto: string;
      link: string | null;
      nomeOrgao: string | null;
      dataDisponibilizacao: Date;
      providencia: Providencia;
      prazoMencionadoDias: number | null;
    },
  ): Promise<string> {
    const spec = PROVIDENCIAS[c.providencia as Exclude<Providencia, 'NENHUMA'>];
    const dias = diasParaLembrete(spec, c.prazoMencionadoDias);

    // Publicação antiga geraria tarefa já vencida. Puxa para hoje e avisa.
    const calculado = somarDiasUteis(c.dataDisponibilizacao, dias);
    const hoje = new Date();
    const atrasado = calculado < hoje;
    const inicio = proximoDiaUtil(atrasado ? hoje : calculado);
    inicio.setHours(9, 0, 0, 0);

    // Tarefa de contato é da secretaria; o resto é do advogado do processo.
    const responsavelId =
      spec.tipo === 'CONTATO'
        ? (await this.usuarioSecretaria()) ?? processo.responsavelId
        : processo.responsavelId;

    const compromisso = await this.prisma.compromisso.create({
      data: {
        titulo: spec.titulo,
        tipo: spec.tipo,
        status: StatusCompromisso.PENDENTE,
        inicio,
        fim: new Date(inicio.getTime() + 3_600_000),
        descricao:
          `Processo ${processo.numeroCNJ ?? '(rascunho)'}${c.nomeOrgao ? ` — ${c.nomeOrgao}` : ''}.\n` +
          (atrasado ? '⚠ Publicação recebida com atraso — confira o prazo com urgência.\n' : '') +
          this.blocoTeor(c),
        responsavelId,
        processoId: processo.id,
        filiadoId: processo.filiadoId,
        ...montarUrgencia(
          atrasado || (c.prazoMencionadoDias ?? 99) <= 5,
          atrasado
            ? 'Publicação recebida com atraso — o prazo pode já estar correndo.'
            : `A publicação menciona prazo de ${c.prazoMencionadoDias} dia(s).`,
          { origem: 'AUTOMACAO' },
        ),
        origemAutomatica: true,
        criadoPor: null, // sem autor humano — é o robô
      },
      select: { id: true },
    });
    return compromisso.id;
  }

  /**
   * Bloco de texto com o teor da publicação.
   *
   * O AVISO SOBRE O PRAZO É OBRIGATÓRIO e não é enfeite: o sistema NÃO calcula
   * vencimento processual. A contagem depende de dias úteis forenses, feriado
   * da comarca, forma de intimação e suspensão de prazo. O número que aparece
   * aqui é o que o TEXTO diz — quem confere é uma pessoa.
   */
  private blocoTeor(c: {
    texto: string;
    link: string | null;
    prazoMencionadoDias: number | null;
  }): string {
    const partes = [BLOCO_PUBLICACAO, recortar(c.texto)];
    if (c.prazoMencionadoDias != null) {
      partes.push(
        `⚠ O texto menciona prazo de ${c.prazoMencionadoDias} dias. Confira a contagem ` +
          'oficial (dias úteis, feriados da comarca, forma de intimação) — o sistema não ' +
          'calcula vencimento.',
      );
    }
    if (c.link) partes.push(`Documento no tribunal: ${c.link}`);
    return partes.join('\n');
  }

  /** Processo + a quem atribuir. Mesma regra do robô de prazos. */
  private async carregarProcesso(processoId: string): Promise<ProcessoAlvo | null> {
    const p = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, numeroCNJ: true, advogadoId: true, filiadoId: true },
    });
    if (!p) return null;

    const responsavelId = await this.responsavel(p.advogadoId);
    if (!responsavelId) {
      this.logger.warn('[CORRELACAO] Nenhum usuário ativo para atribuir tarefas — nada criado.');
      return null;
    }
    return { ...p, responsavelId };
  }

  /** Advogado do processo; sem ele, o primeiro Administrador ativo. */
  private async responsavel(advogadoId: string | null): Promise<string | null> {
    if (advogadoId) {
      const adv = await this.prisma.user.findFirst({
        where: { id: advogadoId, ativo: true },
        select: { id: true },
      });
      if (adv) return adv.id;
    }
    const admin = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMINISTRADOR, ativo: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return admin?.id ?? null;
  }

  /** Alguém da triagem para as tarefas de contato com o filiado. */
  private async usuarioSecretaria(): Promise<string | null> {
    const secretaria = await this.prisma.user.findFirst({
      where: { role: UserRole.TRIAGEM, ativo: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return secretaria?.id ?? null;
  }
}

interface ProcessoAlvo {
  id: string;
  numeroCNJ: string | null;
  advogadoId: string | null;
  filiadoId: string | null;
  responsavelId: string;
}

/** Marcador do bloco — serve também de trava de idempotência no enriquecimento. */
const BLOCO_PUBLICACAO = '— Publicação (DJEN) —';

/**
 * Teto do teor copiado para a descrição.
 *
 * Publicação de edital chega com dezenas de milhares de caracteres (listas de
 * devedores, por exemplo) e transformaria o card da agenda numa parede de
 * texto. O teor completo continua em `comunicacoes_djen.texto`, e a tela do
 * processo mostra tudo.
 */
const LIMITE_TEOR = 1500;

function recortar(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= LIMITE_TEOR
    ? limpo
    : `${limpo.slice(0, LIMITE_TEOR)}… (teor completo na aba Publicações do processo)`;
}

/** Próximo dia útil a partir de `base` (inclusive). */
function proximoDiaUtil(base: Date): Date {
  const d = new Date(base);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
