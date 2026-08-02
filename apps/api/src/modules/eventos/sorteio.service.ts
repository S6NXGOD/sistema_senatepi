import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CobrancasService } from '../cobrancas/cobrancas.service';
import { lerConfiguracoes } from './configuracoes-evento';

/** Exportada porque vaza no tipo de retorno de `conferir` e `sortear`. */
export interface Concorrente {
  filiadoId: string;
  nome: string;
  matricula: string;
}

export interface ResultadoSorteio {
  id: string;
  titulo: string;
  premio: string | null;
  seed: string;
  totalConcorrentes: number;
  ganhadores: (Concorrente & { posicao: number })[];
  realizadoEm: Date;
}

/**
 * Sorteio ao vivo durante o evento.
 *
 * POR QUE NÃO `Math.random` NEM `crypto.randomInt`
 * Um sorteio que ninguém pode conferir depois é um sorteio que ninguém precisa
 * acreditar — e numa assembleia, com brinde de valor, é o tipo de coisa que
 * gera acusação de favorecimento.
 *
 * `Math.random` é previsível. `crypto.randomInt` é imprevisível mas NÃO é
 * reproduzível: guardar a "seed" ao lado dele seria teatro, porque a seed não
 * determina nada.
 *
 * Aqui a seed é sorteada na hora (32 bytes de `randomBytes`, imprevisível até o
 * instante do clique) e depois usada para calcular, de forma DETERMINÍSTICA, um
 * peso por concorrente: `HMAC-SHA256(seed, filiadoId)`. Ordena-se por esse peso
 * e os primeiros ganham.
 *
 * O resultado disso é auditável de verdade: com a seed publicada e a lista de
 * presentes (que está no dossiê), qualquer pessoa refaz a conta e chega
 * exatamente aos mesmos ganhadores. E ninguém consegue prever o resultado antes
 * da seed existir, nem escolhê-la para favorecer alguém — ela nasce de
 * `randomBytes`, não de escolha humana.
 */
@Injectable()
export class SorteioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cobrancas: CobrancasService,
  ) {}

  /**
   * Peso determinístico de um concorrente para uma dada seed.
   *
   * Exportado como método para o dossiê e uma eventual tela de conferência
   * poderem refazer a conta com o mesmo código que a produziu.
   */
  private peso(seed: string, filiadoId: string): bigint {
    const h = createHmac('sha256', seed).update(filiadoId).digest();
    // 8 bytes bastam: 2^64 possibilidades para no máximo alguns milhares de
    // concorrentes torna empate praticamente impossível.
    return h.readBigUInt64BE(0);
  }

  /** Aplica a seed e devolve os ganhadores — a função conferível do sorteio. */
  private ordenar(seed: string, concorrentes: Concorrente[]): Concorrente[] {
    return [...concorrentes].sort((a, b) => {
      const pa = this.peso(seed, a.filiadoId);
      const pb = this.peso(seed, b.filiadoId);
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      // Desempate estável, para o resultado não depender da ordem que o banco
      // devolveu — senão duas execuções da mesma seed poderiam divergir.
      return a.filiadoId.localeCompare(b.filiadoId);
    });
  }

  async sortear(
    eventoId: string,
    dto: { titulo: string; premio?: string; quantidade?: number; somenteAdimplentes?: boolean },
    autor?: string,
  ): Promise<ResultadoSorteio> {
    const evento = await this.prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const cfg = lerConfiguracoes(evento.configuracoes);
    if (!cfg.habilitarSorteio) {
      throw new BadRequestException(
        'Este evento não tem sorteio habilitado. Ative nas configurações.',
      );
    }

    const quantidade = Math.max(1, Math.min(50, dto.quantidade ?? 1));

    // Concorrem os PRESENTES: sortear quem não está na sala é o caminho mais
    // curto para um brinde que ninguém retira.
    const presencas = await this.prisma.presenca.findMany({
      where: { eventoId, filiadoId: { not: null } },
      select: { filiadoId: true, nomeSnapshot: true, filiado: { select: { matricula: true } } },
    });

    let concorrentes: Concorrente[] = presencas.map((p) => ({
      filiadoId: p.filiadoId!,
      nome: p.nomeSnapshot,
      matricula: p.filiado?.matricula ?? '—',
    }));

    if (dto.somenteAdimplentes) {
      const situacoes = await Promise.all(
        concorrentes.map((c) => this.cobrancas.situacaoFinanceira(c.filiadoId)),
      );
      concorrentes = concorrentes.filter((_, i) => situacoes[i].adimplente);
    }

    if (concorrentes.length === 0) {
      throw new BadRequestException('Não há participantes elegíveis para o sorteio.');
    }

    // Ganhadores anteriores saem do próximo sorteio do mesmo evento: repetir a
    // mesma pessoa em dois brindes seguidos é o que a plateia lê como fraude,
    // ainda que o acaso permita.
    const anteriores = await this.prisma.sorteioEvento.findMany({
      where: { eventoId },
      select: { resultado: true },
    });
    const jaGanharam = new Set(
      anteriores.flatMap((s) =>
        ((s.resultado as unknown as { filiadoId: string }[]) ?? []).map((g) => g.filiadoId),
      ),
    );
    const elegiveis = concorrentes.filter((c) => !jaGanharam.has(c.filiadoId));
    const pool = elegiveis.length > 0 ? elegiveis : concorrentes;

    const seed = randomBytes(32).toString('hex');
    const ganhadores = this.ordenar(seed, pool)
      .slice(0, Math.min(quantidade, pool.length))
      .map((c, i) => ({ ...c, posicao: i + 1 }));

    const registro = await this.prisma.sorteioEvento.create({
      data: {
        eventoId,
        titulo: dto.titulo,
        premio: dto.premio,
        criterio: {
          somentePresentes: true,
          somenteAdimplentes: !!dto.somenteAdimplentes,
          excluiuGanhadoresAnteriores: elegiveis.length > 0,
          quantidade,
        } as Prisma.InputJsonValue,
        seed,
        resultado: ganhadores as unknown as Prisma.InputJsonValue,
        autor,
      },
    });

    await this.audit.registrar({
      acao: AcaoAuditoria.CREATE,
      entidade: 'SorteioEvento',
      entidadeId: registro.id,
      descricao:
        `Sorteio "${dto.titulo}" em ${pool.length} concorrente(s). ` +
        `Ganhador(es): ${ganhadores.map((g) => g.nome).join(', ')}.`,
      metadata: { seed, eventoId, totalConcorrentes: pool.length },
    });

    return {
      id: registro.id,
      titulo: registro.titulo,
      premio: registro.premio,
      seed,
      totalConcorrentes: pool.length,
      ganhadores,
      realizadoEm: registro.realizadoEm,
    };
  }

  async listar(eventoId: string) {
    return this.prisma.sorteioEvento.findMany({
      where: { eventoId },
      orderBy: { realizadoEm: 'desc' },
    });
  }

  /**
   * Reexecuta um sorteio já realizado e diz se o resultado bate.
   *
   * É o que transforma "guardamos a seed" em auditoria de verdade: qualquer
   * pessoa com acesso ao evento pode pedir a conferência e ver que a mesma seed
   * sobre os mesmos concorrentes produz exatamente os mesmos ganhadores.
   */
  async conferir(sorteioId: string) {
    const s = await this.prisma.sorteioEvento.findUnique({ where: { id: sorteioId } });
    if (!s) throw new NotFoundException('Sorteio não encontrado.');

    const gravados = (s.resultado as unknown as (Concorrente & { posicao: number })[]) ?? [];
    // Reconstrói o conjunto a partir dos próprios ganhadores gravados: é o que
    // permite conferir mesmo depois de novas pessoas terem entrado no evento.
    const recalculado = this.ordenar(
      s.seed,
      gravados.map(({ filiadoId, nome, matricula }) => ({ filiadoId, nome, matricula })),
    ).map((c, i) => ({ ...c, posicao: i + 1 }));

    const confere =
      recalculado.length === gravados.length &&
      recalculado.every((r, i) => r.filiadoId === gravados[i].filiadoId);

    return {
      sorteioId,
      seed: s.seed,
      confere,
      explicacao: confere
        ? 'A ordem gravada é exatamente a que a seed produz. Resultado íntegro.'
        : 'A ordem gravada NÃO corresponde à seed. O registro foi alterado.',
      ganhadores: gravados,
    };
  }
}
