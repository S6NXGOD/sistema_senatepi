import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria, OrigemPresenca, SituacaoFiliado, StatusEvento, TipoPessoa,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CobrancasService } from '../cobrancas/cobrancas.service';
import { janelaCheckin, lerConfiguracoes } from './configuracoes-evento';

export interface ResultadoCheckin {
  liberado: boolean;
  motivo: string;
  participante?: {
    nome: string;
    matricula: string;
    presencaId: string;
    jaEstava: boolean;
  };
}

/**
 * Check-in remoto do filiado na sala virtual.
 *
 * O QUE ISTO REGISTRA — E O QUE NÃO É
 * Guardamos CPF informado, IP, user-agent e o instante do servidor. Isso prova
 * que ALGUÉM, de posse daquele CPF, acessou daquele endereço naquele momento,
 * com o vínculo associativo conferido na hora. É evidência forte de
 * participação e sustenta a apuração de quórum.
 *
 * NÃO é assinatura digital: não há certificado ICP-Brasil nem chave privada do
 * signatário, e nada impede que outra pessoa digite o CPF alheio. Chamar de
 * assinatura atribuiria ao dossiê um valor probatório que ele não tem — e é o
 * primeiro ponto que a parte contrária ataca.
 *
 * LGPD (Lei nº 13.709/2018): endereço IP é dado pessoal. A tela avisa ANTES de
 * capturar; avisar depois de coletar não é aviso.
 */
@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cobrancas: CobrancasService,
  ) {}

  /**
   * Estado da sala para quem ainda não entrou.
   *
   * Rota pública: devolve o mínimo para a tela se desenhar (nome do evento,
   * se o check-in está aberto, o aviso configurado) e NADA sobre participantes.
   * Quem tem o link não precisa saber quem já entrou.
   */
  async salaPublica(eventoId: string) {
    const evento = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: {
        id: true, nome: true, descricao: true, dataInicio: true, dataFim: true,
        status: true, tipo: true, linkReuniao: true, configuracoes: true,
      },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const cfg = lerConfiguracoes(evento.configuracoes);
    const janela = janelaCheckin(evento, cfg);

    return {
      id: evento.id,
      nome: evento.nome,
      descricao: evento.descricao,
      dataInicio: evento.dataInicio,
      tipo: evento.tipo,
      status: evento.status,
      checkinAberto: janela.aberto,
      motivo: janela.motivo,
      exigeAdimplencia: cfg.exigeAdimplencia,
      avisoCheckin: cfg.avisoCheckin ?? null,
      // O link só sai DEPOIS do check-in — é o que dá sentido a registrar
      // presença. Entregá-lo aqui tornaria o check-in opcional.
      linkReuniao: null as string | null,
    };
  }

  /**
   * Registra a presença do filiado.
   *
   * A ordem das verificações importa: primeiro o que é do evento (janela), depois
   * o que é da pessoa (cadastro, situação, adimplência). Assim quem chega cedo
   * recebe "o check-in abre às 18h" em vez de "você está inadimplente" — a
   * segunda mensagem é mais grave e não era o problema dele.
   */
  async entrar(dados: {
    eventoId: string;
    cpf: string;
    ip?: string;
    userAgent?: string;
  }): Promise<ResultadoCheckin> {
    const evento = await this.prisma.evento.findUnique({ where: { id: dados.eventoId } });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const cfg = lerConfiguracoes(evento.configuracoes);
    const janela = janelaCheckin(evento, cfg);
    if (!janela.aberto) throw new ForbiddenException(janela.motivo);

    const digitos = (dados.cpf ?? '').replace(/\D/g, '');
    if (digitos.length !== 11) {
      throw new BadRequestException('Informe um CPF com 11 dígitos.');
    }

    const filiado = await this.prisma.filiado.findUnique({
      where: { cpf: digitos },
      select: { id: true, nomeCompleto: true, matricula: true, situacao: true },
    });

    // Mensagem deliberadamente igual para "não existe" e "CPF errado": dizer
    // "este CPF não está cadastrado" confirmaria a estranhos, num link público,
    // quem é ou não filiado do sindicato.
    if (!filiado) {
      return {
        liberado: false,
        motivo: 'CPF não localizado no cadastro de filiados. Procure a secretaria.',
      };
    }

    if (filiado.situacao !== SituacaoFiliado.ATIVO) {
      return {
        liberado: false,
        motivo: `Cadastro ${filiado.situacao.toLowerCase()} — procure a secretaria para regularizar.`,
      };
    }

    if (cfg.exigeAdimplencia) {
      // Regra vinda do módulo financeiro, não reescrita aqui: se o critério
      // mudar lá, muda aqui junto.
      const fin = await this.cobrancas.situacaoFinanceira(filiado.id);
      if (!fin.adimplente) {
        return {
          liberado: false,
          motivo:
            `Há ${fin.parcelasVencidas} parcela(s) em atraso. ` +
            'Este evento exige contribuição em dia — procure a secretaria.',
        };
      }
    }

    // Reentrada é normal: cai a internet, troca de aparelho, fecha a aba. A
    // presença original é PRESERVADA (com o IP e o horário do primeiro acesso,
    // que é o que vale para o quórum) e a pessoa entra de novo sem atrito.
    const existente = await this.prisma.presenca.findFirst({
      where: { eventoId: dados.eventoId, filiadoId: filiado.id },
      select: { id: true },
    });
    if (existente) {
      return {
        liberado: true,
        motivo: 'Presença já registrada. Bem-vindo(a) de volta.',
        participante: {
          nome: filiado.nomeCompleto,
          matricula: filiado.matricula,
          presencaId: existente.id,
          jaEstava: true,
        },
      };
    }

    const presenca = await this.prisma.presenca.create({
      data: {
        eventoId: dados.eventoId,
        tipoPessoa: TipoPessoa.FILIADO,
        filiadoId: filiado.id,
        nomeSnapshot: filiado.nomeCompleto,
        origem: OrigemPresenca.AUTOATENDIMENTO_VIRTUAL,
        ip: dados.ip ?? null,
        userAgent: dados.userAgent?.slice(0, 500) ?? null,
        cpfInformado: digitos,
      },
      select: { id: true },
    });

    // O primeiro check-in coloca o evento EM ANDAMENTO.
    //
    // Antes o status só mudava por ação manual, e o resultado era um rótulo que
    // mentia: assembleias com votação já encerrada continuavam marcadas como
    // "Agendado" na lista. Quem chega para conferir não deveria precisar abrir
    // o evento para descobrir que ele já aconteceu.
    if (evento.status === StatusEvento.AGENDADO) {
      await this.prisma.evento
        .update({ where: { id: evento.id }, data: { status: StatusEvento.EM_ANDAMENTO } })
        .catch(() => undefined); // corrida entre dois check-ins simultâneos é inofensiva
    }

    await this.audit.registrar({
      acao: AcaoAuditoria.CREATE,
      entidade: 'Presenca',
      entidadeId: presenca.id,
      descricao: `Check-in virtual de ${filiado.nomeCompleto} no evento "${evento.nome}".`,
      ip: dados.ip,
      userAgent: dados.userAgent,
      metadata: { eventoId: dados.eventoId, filiadoId: filiado.id, origem: 'AUTOATENDIMENTO_VIRTUAL' },
    });

    return {
      liberado: true,
      motivo: 'Presença registrada.',
      participante: {
        nome: filiado.nomeCompleto,
        matricula: filiado.matricula,
        presencaId: presenca.id,
        jaEstava: false,
      },
    };
  }

  /**
   * Dados da sala para quem JÁ fez check-in — inclui o link da reunião.
   *
   * `presencaId` funciona como credencial da sessão: é um UUID que só quem fez
   * o check-in recebeu. Não é autenticação forte, e não precisa ser — o que ele
   * protege é o link de uma reunião cujo acesso o próprio Meet controla.
   */
  async sessao(eventoId: string, presencaId: string) {
    const presenca = await this.prisma.presenca.findFirst({
      where: { id: presencaId, eventoId },
      select: { id: true, nomeSnapshot: true, filiadoId: true },
    });
    if (!presenca) throw new ForbiddenException('Faça o check-in para entrar na sala.');

    const evento = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: {
        id: true, nome: true, status: true, linkReuniao: true,
        urlVideoDrive: true, configuracoes: true,
      },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const cfg = lerConfiguracoes(evento.configuracoes);
    return {
      evento: {
        id: evento.id,
        nome: evento.nome,
        status: evento.status,
        linkReuniao: evento.linkReuniao,
        urlVideoDrive: evento.urlVideoDrive,
      },
      participante: {
        presencaId: presenca.id,
        nome: presenca.nomeSnapshot,
        filiadoId: presenca.filiadoId,
      },
      recursos: {
        votacao: cfg.habilitarVotacao,
        sorteio: cfg.habilitarSorteio,
      },
    };
  }
}
