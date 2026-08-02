import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria, ModoVotacao, Prisma, StatusEvento, StatusPauta,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { lerConfiguracoes } from './configuracoes-evento';

export interface OpcaoPauta {
  id: string;
  rotulo: string;
}

export interface ApuracaoPauta {
  pautaId: string;
  titulo: string;
  modo: ModoVotacao;
  status: StatusPauta;
  totalVotantes: number;
  quorumMinimo: number | null;
  quorumAtingido: boolean;
  /** Presentes no evento no momento da apuração — o denominador do comparecimento. */
  presentes: number;
  resultado: { opcaoId: string; rotulo: string; votos: number; percentual: number }[];
  vencedora: { opcaoId: string; rotulo: string } | null;
  empate: boolean;
}

/**
 * Votação em assembleia — pautas, urna e apuração.
 *
 * O SIGILO É ESTRUTURAL, NÃO UMA PROMESSA DO CÓDIGO
 * Duas tabelas sem ligação entre si: `votos_habilitacao` guarda QUEM votou e
 * `votos_urna` guarda O QUE foi votado. Em pauta secreta, a urna não recebe o
 * filiado — e não tem sequer `createdAt`, para que ninguém possa parear as duas
 * por ordem cronológica.
 *
 * Nem este serviço consegue reconstruir o voto de alguém numa pauta secreta.
 * Isso é proposital: uma garantia que depende de o programador "não fazer o
 * join errado" não é garantia.
 */
@Injectable()
export class VotacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Gestão da pauta (mesa diretora)
  // =========================================================================

  private validarOpcoes(bruto: unknown): OpcaoPauta[] {
    if (!Array.isArray(bruto) || bruto.length < 2) {
      throw new BadRequestException('A pauta precisa de pelo menos duas opções.');
    }
    const opcoes = bruto.map((o) => {
      const id = String((o as OpcaoPauta)?.id ?? '').trim();
      const rotulo = String((o as OpcaoPauta)?.rotulo ?? '').trim();
      if (!id || !rotulo) {
        throw new BadRequestException('Cada opção precisa de `id` e `rotulo`.');
      }
      return { id, rotulo };
    });
    // Ids repetidos fariam dois botões diferentes gravarem o mesmo voto, e a
    // apuração somaria os dois num número só — erro invisível na tela.
    if (new Set(opcoes.map((o) => o.id)).size !== opcoes.length) {
      throw new BadRequestException('Há opções com o mesmo `id`.');
    }
    return opcoes;
  }

  async criar(
    eventoId: string,
    dto: {
      titulo: string;
      descricao?: string;
      opcoes: unknown;
      modo?: ModoVotacao;
      quorumMinimo?: number;
      ordem?: number;
    },
    autor?: string,
  ) {
    const evento = await this.prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const cfg = lerConfiguracoes(evento.configuracoes);
    if (!cfg.habilitarVotacao) {
      throw new BadRequestException(
        'Este evento não tem votação habilitada. Ative nas configurações antes de criar pautas.',
      );
    }

    const opcoes = this.validarOpcoes(dto.opcoes);
    return this.prisma.pautaVotacao.create({
      data: {
        eventoId,
        titulo: dto.titulo,
        descricao: dto.descricao,
        opcoes: opcoes as unknown as Prisma.InputJsonValue,
        modo: dto.modo ?? ModoVotacao.SECRETA,
        quorumMinimo: dto.quorumMinimo,
        ordem: dto.ordem ?? 0,
        autor,
      },
    });
  }

  async listar(eventoId: string) {
    const pautas = await this.prisma.pautaVotacao.findMany({
      where: { eventoId },
      orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { habilitacoes: true } } },
    });
    return pautas.map((p) => ({
      ...p,
      opcoes: p.opcoes as unknown as OpcaoPauta[],
      totalVotantes: p._count.habilitacoes,
    }));
  }

  /**
   * Abre a votação.
   *
   * Só uma pauta aberta por vez: com duas simultâneas, o participante vê duas
   * urnas e a mesa perde o controle de qual está sendo deliberada. É restrição
   * de assembleia, não limitação técnica.
   */
  async abrir(pautaId: string, autor?: string) {
    const pauta = await this.exigirPauta(pautaId);
    if (pauta.status === StatusPauta.ENCERRADA) {
      throw new ConflictException('Esta pauta já foi encerrada e não pode ser reaberta.');
    }

    const outraAberta = await this.prisma.pautaVotacao.findFirst({
      where: { eventoId: pauta.eventoId, status: StatusPauta.ABERTA, id: { not: pautaId } },
      select: { titulo: true },
    });
    if (outraAberta) {
      throw new ConflictException(
        `Encerre "${outraAberta.titulo}" antes de abrir outra votação.`,
      );
    }

    const atualizada = await this.prisma.pautaVotacao.update({
      where: { id: pautaId },
      data: { status: StatusPauta.ABERTA, abertaEm: new Date(), autor },
    });

    // Abrir votação é começar a assembleia — o status acompanha, em vez de
    // depender de alguém lembrar de apertar 'Abrir evento'.
    await this.prisma.evento.updateMany({
      where: { id: pauta.eventoId, status: StatusEvento.AGENDADO },
      data: { status: StatusEvento.EM_ANDAMENTO },
    });

    await this.audit.registrar({
      acao: AcaoAuditoria.UPDATE,
      entidade: 'PautaVotacao',
      entidadeId: pautaId,
      descricao: `Votação aberta: "${pauta.titulo}" (${pauta.modo.toLowerCase()}).`,
    });
    return atualizada;
  }

  /** Encerra e devolve a apuração — é o momento em que o resultado existe. */
  async encerrar(pautaId: string, autor?: string): Promise<ApuracaoPauta> {
    const pauta = await this.exigirPauta(pautaId);
    if (pauta.status !== StatusPauta.ABERTA) {
      throw new ConflictException('Só é possível encerrar uma votação que está aberta.');
    }

    await this.prisma.pautaVotacao.update({
      where: { id: pautaId },
      data: { status: StatusPauta.ENCERRADA, encerradaEm: new Date(), autor },
    });

    const apuracao = await this.apurar(pautaId);
    await this.audit.registrar({
      acao: AcaoAuditoria.UPDATE,
      entidade: 'PautaVotacao',
      entidadeId: pautaId,
      descricao:
        `Votação encerrada: "${pauta.titulo}". ${apuracao.totalVotantes} voto(s). ` +
        (apuracao.empate
          ? 'Resultado: EMPATE.'
          : `Vencedora: ${apuracao.vencedora?.rotulo ?? '—'}.`),
      metadata: { resultado: apuracao.resultado, quorumAtingido: apuracao.quorumAtingido },
    });
    return apuracao;
  }

  // =========================================================================
  // Voto
  // =========================================================================

  /**
   * Registra o voto de um participante.
   *
   * A credencial é o `presencaId` — quem não fez check-in não vota. Isso liga a
   * urna ao quórum: não existe voto de quem não está registrado como presente.
   *
   * TUDO numa transação: se a urna falhar depois da habilitação, o filiado
   * ficaria marcado como tendo votado sem voto nenhum na apuração — perderia o
   * direito sem exercê-lo.
   */
  async votar(dados: { pautaId: string; presencaId: string; opcaoId: string }) {
    const pauta = await this.exigirPauta(dados.pautaId);
    if (pauta.status !== StatusPauta.ABERTA) {
      throw new ForbiddenException(
        pauta.status === StatusPauta.ENCERRADA
          ? 'Esta votação já foi encerrada.'
          : 'Esta votação ainda não foi aberta.',
      );
    }

    const opcoes = pauta.opcoes as unknown as OpcaoPauta[];
    const opcao = opcoes.find((o) => o.id === dados.opcaoId);
    if (!opcao) throw new BadRequestException('Opção inválida para esta pauta.');

    const presenca = await this.prisma.presenca.findFirst({
      where: { id: dados.presencaId, eventoId: pauta.eventoId },
      select: { filiadoId: true },
    });
    if (!presenca) {
      throw new ForbiddenException('Faça o check-in no evento para poder votar.');
    }
    // Presente, mas sem vínculo confirmado com o cadastro: quem vota é
    // associado, e ninguém confirmou ainda que esta pessoa é. A mesa resolve
    // pelo painel em segundos — a mensagem diz para onde ir, em vez de
    // devolver um "não pode" sem saída.
    if (!presenca.filiadoId) {
      throw new ForbiddenException(
        'Sua presença está registrada, mas ainda não foi vinculada ao cadastro de associado. ' +
        'Procure a mesa para confirmar seus dados e liberar o voto.',
      );
    }
    const filiadoId = presenca.filiadoId;

    try {
      await this.prisma.$transaction(async (tx) => {
        // A HABILITAÇÃO vem primeiro, e é o índice único dela que recusa o voto
        // duplo. Conferir com um SELECT antes perderia a corrida entre dois
        // cliques simultâneos — os dois leriam "ainda não votou" e os dois
        // gravariam. Deixar o banco recusar é o que torna a garantia real.
        await tx.votoHabilitacao.create({ data: { pautaId: dados.pautaId, filiadoId } });

        await tx.votoUrna.create({
          data: {
            pautaId: dados.pautaId,
            opcaoId: dados.opcaoId,
            // O SIGILO MORA AQUI. Em pauta secreta o filiado não entra na urna,
            // e como a tabela não tem carimbo de tempo, não há como parear as
            // duas por ordem de inserção.
            filiadoId: pauta.modo === ModoVotacao.NOMINAL ? filiadoId : null,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Seu voto nesta pauta já foi registrado.');
      }
      throw e;
    }

    // Confirmação SEM eco da opção escolhida: a resposta trafega e fica no
    // histórico do navegador. Numa pauta secreta, devolver "você votou em X"
    // seria o próprio sistema vazando o voto que acabou de proteger.
    return { ok: true, mensagem: 'Voto registrado.' };
  }

  /** Já votei nesta pauta? Usado pela tela para trocar a urna pelo comprovante. */
  async jaVotou(pautaId: string, presencaId: string): Promise<boolean> {
    const presenca = await this.prisma.presenca.findUnique({
      where: { id: presencaId },
      select: { filiadoId: true },
    });
    if (!presenca?.filiadoId) return false;
    const h = await this.prisma.votoHabilitacao.findUnique({
      where: { pautaId_filiadoId: { pautaId, filiadoId: presenca.filiadoId } },
      select: { id: true },
    });
    return !!h;
  }

  // =========================================================================
  // Apuração
  // =========================================================================

  async apurar(pautaId: string): Promise<ApuracaoPauta> {
    const pauta = await this.exigirPauta(pautaId);
    const opcoes = pauta.opcoes as unknown as OpcaoPauta[];

    const [porOpcao, totalVotantes, presentes] = await Promise.all([
      this.prisma.votoUrna.groupBy({
        by: ['opcaoId'],
        where: { pautaId },
        _count: { _all: true },
      }),
      this.prisma.votoHabilitacao.count({ where: { pautaId } }),
      // Só quem tem vínculo confirmado entra no denominador do comparecimento.
      // Presença sem identificação é visitante: contá-la faria "12 de 30"
      // parecer baixa adesão quando 5 dos 30 nem podiam votar — e, pior,
      // inflaria a base de cálculo de qualquer quórum proporcional.
      this.prisma.presenca.count({
        where: { eventoId: pauta.eventoId, filiadoId: { not: null } },
      }),
    ]);

    const contagem = new Map(porOpcao.map((r) => [r.opcaoId, r._count._all]));
    const total = Array.from(contagem.values()).reduce((s, n) => s + n, 0);

    const resultado = opcoes.map((o) => {
      const votos = contagem.get(o.id) ?? 0;
      return {
        opcaoId: o.id,
        rotulo: o.rotulo,
        votos,
        percentual: total > 0 ? Number(((votos / total) * 100).toFixed(1)) : 0,
      };
    });

    const maior = Math.max(0, ...resultado.map((r) => r.votos));
    const naFrente = resultado.filter((r) => r.votos === maior && maior > 0);
    const empate = naFrente.length > 1;

    return {
      pautaId,
      titulo: pauta.titulo,
      modo: pauta.modo,
      status: pauta.status,
      totalVotantes,
      quorumMinimo: pauta.quorumMinimo,
      // Sem mínimo definido, não há quórum a descumprir.
      quorumAtingido: pauta.quorumMinimo == null || totalVotantes >= pauta.quorumMinimo,
      presentes,
      resultado,
      vencedora: empate || naFrente.length === 0
        ? null
        : { opcaoId: naFrente[0].opcaoId, rotulo: naFrente[0].rotulo },
      empate,
    };
  }

  /**
   * Como a tela de quem está votando enxerga a pauta.
   *
   * O placar NÃO acompanha a votação aberta: resultado parcial influencia quem
   * ainda não votou. Enquanto está aberta, sai apenas quantos já votaram.
   */
  async pautaAoVivo(eventoId: string, presencaId?: string) {
    const pauta = await this.prisma.pautaVotacao.findFirst({
      where: { eventoId, status: { in: [StatusPauta.ABERTA, StatusPauta.ENCERRADA] } },
      orderBy: [{ status: 'asc' }, { abertaEm: 'desc' }],
    });
    if (!pauta) return null;

    const base = {
      id: pauta.id,
      titulo: pauta.titulo,
      descricao: pauta.descricao,
      modo: pauta.modo,
      status: pauta.status,
      opcoes: pauta.opcoes as unknown as OpcaoPauta[],
    };

    if (pauta.status === StatusPauta.ABERTA) {
      const [votantes, jaVotou] = await Promise.all([
        this.prisma.votoHabilitacao.count({ where: { pautaId: pauta.id } }),
        presencaId ? this.jaVotou(pauta.id, presencaId) : Promise.resolve(false),
      ]);
      return { ...base, votantes, jaVotou, resultado: null };
    }

    return { ...base, votantes: null, jaVotou: true, resultado: await this.apurar(pauta.id) };
  }

  // =========================================================================

  private async exigirPauta(pautaId: string) {
    const p = await this.prisma.pautaVotacao.findUnique({ where: { id: pautaId } });
    if (!p) throw new NotFoundException('Pauta não encontrada.');
    return p;
  }
}
