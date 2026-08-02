import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria, OrigemPresenca, SituacaoFiliado, StatusEvento,
  TipoHistoricoFiliado, TipoPessoa,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CobrancasService } from '../cobrancas/cobrancas.service';
import { termosDeBusca } from '../../common/utils/busca.util';
import { janelaCheckin, lerConfiguracoes } from './configuracoes-evento';

export interface ResultadoCheckin {
  liberado: boolean;
  motivo: string;
  /**
   * O CPF não localizou ninguém — a tela deve pedir os demais dados.
   *
   * NÃO é erro nem recusa: 70% da base histórica veio da planilha sem CPF, e o
   * filiado não tem culpa disso. A tela pede a complementação como se fosse
   * parte normal do fluxo, porque para ele é.
   */
  precisaComplementar?: boolean;
  participante?: {
    nome: string;
    matricula: string;
    presencaId: string;
    jaEstava: boolean;
    /** Falso quando não foi possível vincular a um filiado (ver `entrarComDados`). */
    identificado: boolean;
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

    // CPF não localizado: pede a complementação em vez de barrar.
    //
    // 70% da base histórica veio da planilha SEM CPF — o cadastro é que está
    // incompleto, não a pessoa que está errada. Barrar aqui deixaria a maioria
    // dos filiados de fora da própria assembleia.
    //
    // A mensagem não diz "você não está cadastrado": além de ser provavelmente
    // falso, num link público isso revelaria a estranhos quem é ou não filiado.
    if (!filiado) {
      return {
        liberado: false,
        precisaComplementar: true,
        motivo: 'Precisamos de mais alguns dados para confirmar sua presença.',
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
          identificado: true,
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
        identificado: true,
      },
    };
  }

  /**
   * Segunda etapa: o CPF não localizou ninguém e a pessoa informa os demais dados.
   *
   * O PROBLEMA REAL
   * A carga legada trouxe 7.173 filiados ativos e só 2.145 com CPF. Nascimento
   * existe em 381, COREN em 34, telefone em 37. Ou seja: para 70% da base, o
   * CPF simplesmente não está lá — e não há um segundo campo confiável para
   * usar no lugar.
   *
   * A matrícula seria universal, mas 6.976 delas são números sequenciais do
   * sistema antigo: chutar "1850" é trivial, e numa eleição de diretoria isso
   * invalidaria o pleito. Por isso ela NÃO é aceita como identificação.
   *
   * O QUE ESTE MÉTODO FAZ
   * Procura o filiado pelo NOME (normalizado, ignorando acento e ordem) e:
   *
   *   1 resultado, sem CPF gravado  → vincula, GRAVA o CPF informado e libera.
   *                                   A assembleia vira mutirão de limpeza: a
   *                                   cada evento, mais gente passa a ter CPF.
   *   1 resultado, com outro CPF    → não vincula. O CPF informado não é dessa
   *                                   pessoa, e sobrescrever seria corromper.
   *   vários resultados             → NÃO ADIVINHA. Registra a presença sem
   *                                   vínculo e deixa para a mesa resolver —
   *                                   há 1.309 grupos de nomes repetidos na
   *                                   base, e errar aqui é dar o voto de uma
   *                                   pessoa a outra.
   *   nenhum resultado              → presença sem vínculo, idem.
   *
   * PRESENÇA SEM VÍNCULO NÃO VOTA E NÃO CONTA PARA QUÓRUM.
   * Isso não é limitação técnica: quórum e deliberação são de ASSOCIADOS, e
   * enquanto ninguém confirmou que aquela pessoa é associada, ela é visitante.
   * A mesa resolve pelo painel em segundos, e aí ela passa a votar.
   */
  async entrarComDados(dados: {
    eventoId: string;
    cpf: string;
    nomeCompleto: string;
    dataNascimento?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<ResultadoCheckin> {
    const evento = await this.prisma.evento.findUnique({ where: { id: dados.eventoId } });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const cfg = lerConfiguracoes(evento.configuracoes);
    const janela = janelaCheckin(evento, cfg);
    if (!janela.aberto) throw new ForbiddenException(janela.motivo);

    const digitos = (dados.cpf ?? '').replace(/\D/g, '');
    const nome = (dados.nomeCompleto ?? '').trim();
    if (digitos.length !== 11) throw new BadRequestException('Informe um CPF com 11 dígitos.');
    if (nome.length < 5) throw new BadRequestException('Informe seu nome completo.');

    // Se nesse meio-tempo o CPF passou a existir (a mesa vinculou, ou outra
    // pessoa completou o cadastro), o caminho normal volta a valer.
    const porCpf = await this.prisma.filiado.findUnique({ where: { cpf: digitos } });
    if (porCpf) return this.entrar({ ...dados, cpf: digitos });

    const termos = termosDeBusca(nome);
    const candidatos = termos.length
      ? await this.prisma.filiado.findMany({
          where: {
            situacao: SituacaoFiliado.ATIVO,
            AND: termos.map((t) => ({ buscaNormalizada: { contains: t } })),
          },
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true,
            dataNascimento: true,
          },
          take: 10,
        })
      : [];

    // Nascimento, quando informado E existente no cadastro, desempata. É o
    // único campo adicional que a base tem em quantidade relevante (381), e
    // usá-lo só ajuda: nunca elimina candidato que não tem a data gravada.
    const nascimento = dados.dataNascimento ? new Date(dados.dataNascimento) : null;
    const refinados =
      nascimento && candidatos.some((c) => c.dataNascimento)
        ? candidatos.filter(
            (c) =>
              !c.dataNascimento ||
              c.dataNascimento.toISOString().slice(0, 10) === nascimento.toISOString().slice(0, 10),
          )
        : candidatos;

    const unico = refinados.length === 1 ? refinados[0] : null;
    // Só vincula quando o cadastro está SEM CPF. Com CPF diferente, o dado
    // informado não é daquela pessoa — vincular corromperia o cadastro alheio.
    const vinculavel = unico && !unico.cpf ? unico : null;

    if (vinculavel) {
      // GRAVA o CPF que faltava. É o ganho estrutural: cada assembleia devolve
      // ao cadastro o dado que a planilha não trouxe. O histórico registra a
      // origem, para a alteração ser rastreável e reversível.
      await this.prisma.$transaction(async (tx) => {
        await tx.filiado.update({ where: { id: vinculavel.id }, data: { cpf: digitos } });
        await tx.filiadoHistorico.create({
          data: {
            filiadoId: vinculavel.id,
            tipo: TipoHistoricoFiliado.ALTERACAO,
            descricao:
              `CPF informado pelo próprio filiado no check-in do evento "${evento.nome}". ` +
              'O cadastro estava sem CPF.',
            autor: 'Autoatendimento — check-in',
            metadata: { eventoId: dados.eventoId, origem: 'CHECKIN_VIRTUAL' },
          },
        });
      });
      return this.entrar({ ...dados, cpf: digitos });
    }

    // Não deu para identificar com segurança: registra a presença SEM vínculo.
    // A pessoa entra na sala e assiste; votar depende de a mesa confirmar quem
    // ela é. Adivinhar entre homônimos seria dar o voto de alguém a outro.
    return this.registrarSemVinculo({
      eventoId: dados.eventoId,
      nome,
      cpf: digitos,
      ip: dados.ip,
      userAgent: dados.userAgent,
      evento,
    });
  }

  /**
   * Presença de quem não pôde ser vinculada a um cadastro.
   *
   * NÃO cria filiado. É apenas o registro de que alguém esteve na sala,
   * aguardando a mesa confirmar de quem se trata.
   */
  private async registrarSemVinculo(d: {
    eventoId: string;
    nome: string;
    cpf: string;
    ip?: string;
    userAgent?: string;
    evento: { nome: string };
  }): Promise<ResultadoCheckin> {
    // Mesmo CPF na mesma sala = mesma pessoa recarregando a página.
    const existente = await this.prisma.presenca.findFirst({
      where: { eventoId: d.eventoId, cpfInformado: d.cpf, filiadoId: null },
      select: { id: true, nomeSnapshot: true },
    });
    if (existente) {
      return {
        liberado: true,
        motivo: 'Presença já registrada.',
        participante: {
          nome: existente.nomeSnapshot,
          matricula: '—',
          presencaId: existente.id,
          jaEstava: true,
          identificado: false,
        },
      };
    }

    const presenca = await this.prisma.presenca.create({
      data: {
        eventoId: d.eventoId,
        tipoPessoa: TipoPessoa.FILIADO,
        filiadoId: null,
        nomeSnapshot: d.nome.toUpperCase(),
        origem: OrigemPresenca.AUTOATENDIMENTO_VIRTUAL,
        ip: d.ip ?? null,
        userAgent: d.userAgent?.slice(0, 500) ?? null,
        cpfInformado: d.cpf,
      },
      select: { id: true },
    });

    await this.audit.registrar({
      acao: AcaoAuditoria.CREATE,
      entidade: 'Presenca',
      entidadeId: presenca.id,
      descricao:
        `Check-in de ${d.nome} no evento "${d.evento.nome}" SEM vínculo confirmado ` +
        'com o cadastro — aguardando identificação pela mesa.',
      ip: d.ip,
      metadata: { eventoId: d.eventoId, cpfInformado: d.cpf, identificado: false },
    });

    return {
      liberado: true,
      motivo: 'Presença registrada.',
      participante: {
        nome: d.nome.toUpperCase(),
        matricula: '—',
        presencaId: presenca.id,
        jaEstava: false,
        identificado: false,
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
