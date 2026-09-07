import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StatusSugestaoProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * A FILA DE AÇÕES QUE O DIÁRIO REVELOU E O ACERVO NÃO CONHECE.
 *
 * Quem alimenta é o `DjenSyncService`: no ponto em que a ingestão descartava
 * tudo que não casava com um processo cadastrado, ele agora separa o que nomeia
 * o sindicato entre os destinatários. Este serviço é só a leitura e as duas
 * decisões possíveis — cadastrar ou ignorar.
 */
@Injectable()
export class SugestoesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A FILA SE FECHA SOZINHA quando o processo aparece no acervo.
   *
   * O cadastro pode acontecer por qualquer porta — a tela de processos, a
   * importação em lote, o cadastro manual de sempre. Amarrar o fechamento a UMA
   * delas deixaria a sugestão viva depois de resolvida, e uma fila que pede o
   * que já foi feito é pior que fila nenhuma: ensina a ignorá-la.
   *
   * Por isso a reconciliação é feita na LEITURA, contra o estado real do
   * acervo. É idempotente e não depende de ninguém lembrar de chamá-la.
   */
  private async reconciliar(): Promise<void> {
    const pendentes = await this.prisma.sugestaoProcesso.findMany({
      where: { status: StatusSugestaoProcesso.PENDENTE },
      select: { id: true, numeroCNJ: true },
    });
    if (!pendentes.length) return;

    const cadastrados = await this.prisma.processo.findMany({
      where: { numeroCNJ: { in: pendentes.map((s) => s.numeroCNJ) } },
      select: { id: true, numeroCNJ: true },
    });
    if (!cadastrados.length) return;

    const porNpu = new Map(cadastrados.map((p) => [p.numeroCNJ!, p.id]));
    for (const s of pendentes) {
      const processoId = porNpu.get(s.numeroCNJ);
      if (!processoId) continue;
      await this.prisma.sugestaoProcesso.update({
        where: { id: s.id },
        data: {
          status: StatusSugestaoProcesso.CADASTRADO,
          processoId,
          decididoEm: new Date(),
        },
      });
    }
  }

  /**
   * A fila aberta, da mais recente para a mais antiga.
   *
   * `TERCEIRO` entra junto: o tribunal às vezes não classifica o polo, e
   * esconder a ação por causa disso seria perder justamente o caso em que a
   * informação está incompleta — que é quando alguém precisa olhar.
   */
  /**
   * O ANO DE DISTRIBUIÇÃO, lido do próprio número.
   *
   * O NPU é `NNNNNNN-DD.AAAA.J.TR.OOOO`: sem pontuação, o ano ocupa as posições
   * 10 a 13. É informação que sempre esteve na tela e que ninguém lê — vinte
   * dígitos seguidos não se leem, se conferem.
   */
  private anoDoNpu(numeroCNJ: string): number | null {
    const ano = Number(numeroCNJ.slice(9, 13));
    return Number.isFinite(ano) && ano > 1990 ? ano : null;
  }

  async listar() {
    await this.reconciliar();
    const pendentes = await this.prisma.sugestaoProcesso.findMany({
      where: { status: StatusSugestaoProcesso.PENDENTE },
      select: {
        id: true,
        numeroCNJ: true,
        siglaTribunal: true,
        nomeOrgao: true,
        nomeClasse: true,
        nossoPolo: true,
        partes: true,
        advogados: true,
        primeiraEm: true,
        ultimaEm: true,
        publicacoes: true,
      },
    });

    /*
      A MAIS RECENTEMENTE DISTRIBUÍDA PRIMEIRO — e não a de publicação mais nova.

      A primeira colheita trouxe 32 ações e **só 4 são de 2026**: o resto vai de
      2014 a 2025, seis delas de 2015. Ordenar por publicação misturava a ação
      recém-distribuída — onde há prazo correndo e ninguém olhando — com o passivo
      de cadastro de dez anos atrás, que é importante e não é urgente.

      ORDENAR PELO NPU NÃO SERVE, e o engano é fácil: o número começa pelo
      SEQUENCIAL, não pelo ano. `0009999...2015` viria antes de `0000001...2026`.
      Por isso a ordenação é feita aqui, sobre o ano extraído — são dezenas de
      linhas, e o banco não tem coluna de ano para indexar.
    */
    return pendentes
      .map((s) => ({ ...s, anoDistribuicao: this.anoDoNpu(s.numeroCNJ) }))
      .sort((a, b) => {
        const anoA = a.anoDistribuicao ?? 0;
        const anoB = b.anoDistribuicao ?? 0;
        if (anoA !== anoB) return anoB - anoA;
        // Dentro do mesmo ano, a que publicou por último — sinal de que anda.
        return b.ultimaEm.getTime() - a.ultimaEm.getTime();
      })
      .slice(0, 50);
  }

  /** Quantas esperam decisão — o número do selo, sem carregar a lista. */
  async contar(): Promise<number> {
    await this.reconciliar();
    return this.prisma.sugestaoProcesso.count({
      where: { status: StatusSugestaoProcesso.PENDENTE },
    });
  }

  /**
   * "NÃO É PARA ACOMPANHAR" — e o porquê fica registrado.
   *
   * O motivo não é burocracia: a mesma ação volta a aparecer no Diário por
   * meses, e sem o registro a próxima pessoa refaz a mesma investigação. É
   * também o que permite auditar uma decisão que, no limite, deixa um processo
   * do sindicato fora do acompanhamento.
   */
  async ignorar(id: string, usuarioId: string, motivo?: string) {
    const sugestao = await this.prisma.sugestaoProcesso.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!sugestao) throw new NotFoundException('Sugestão não encontrada.');
    if (sugestao.status !== StatusSugestaoProcesso.PENDENTE) {
      throw new BadRequestException('Esta sugestão já foi decidida.');
    }

    return this.prisma.sugestaoProcesso.update({
      where: { id },
      data: {
        status: StatusSugestaoProcesso.IGNORADO,
        decididoPor: usuarioId,
        decididoEm: new Date(),
        motivoDescarte: motivo?.trim() || null,
      },
      select: { id: true, status: true },
    });
  }

  /**
   * DESFAZER O IGNORAR. Quem errou tem de poder voltar atrás sem mexer no
   * banco — e sem isso a única saída seria cadastrar um processo que ninguém
   * quer, só para tirar a linha da frente.
   */
  async reabrir(id: string) {
    const sugestao = await this.prisma.sugestaoProcesso.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!sugestao) throw new NotFoundException('Sugestão não encontrada.');
    if (sugestao.status === StatusSugestaoProcesso.CADASTRADO) {
      throw new BadRequestException('Esta ação já virou processo no acervo.');
    }

    return this.prisma.sugestaoProcesso.update({
      where: { id },
      data: {
        status: StatusSugestaoProcesso.PENDENTE,
        decididoPor: null,
        decididoEm: null,
        motivoDescarte: null,
      },
      select: { id: true, status: true },
    });
  }
}
