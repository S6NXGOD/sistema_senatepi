import { StorageService, dataCalendario, diasPossiveis } from '@core/infra';
import {
  BadRequestException, ConflictException, ForbiddenException, GoneException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, hkdfSync, randomUUID } from 'node:crypto';
import {
  DesafioRecadastramento, Prisma, SituacaoFiliado, StatusRecadastramento, TipoHistoricoFiliado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { marcarNadaMudou } from '../../common/audit/audit.contexto';
import { AcaoAuditoria } from '@prisma/client';
import { segredoDaInstalacao } from '../../common/segredo.util';
import { RecadastroPublicoDto } from './dto/recadastro-publico.dto';
import { camposDoLink, vinculosPeloLink } from './dados-do-link';
import {
  MeioDeEnvio, deveRegistrarPreparo, emailUtilizavel, fraseDoPreparo, planejarEnvio, primeiroNome,
  JANELA_SEM_REPETIR_REGISTRO_MS,
} from './planejar-envio';
import { celularParaWhatsApp } from './whatsapp.util';

import { FiliadosService } from '../filiados/filiados.service';
import { protegerImutaveis } from '../filiados/campos-imutaveis';

import {
  montarSincronizacaoDependentes, resumirDependentes,
} from '../dependentes/dependentes.sync';
import { campoVisivel } from '../../tenant/tenant.config';

interface Ctx {
  userId?: string;
  nome?: string;
  ip?: string;
  userAgent?: string;
}

/** Validade padrão do link. */
const HORAS_VALIDADE = 24;
/** Tentativas erradas no desafio antes de queimar o link. */
const MAX_TENTATIVAS = 5;
/** A rota da foto é pública — o que entra precisa ser imagem e ter tamanho sensato. */
const MIMES_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TAMANHO_MAX_FOTO = 8 * 1024 * 1024;

@Injectable()
export class LinkRecadastramentoService {
  private readonly logger = new Logger(LinkRecadastramentoService.name);
  private chaveDerivada?: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly filiados: FiliadosService,
    private readonly storage: StorageService,
  ) {}

  /** Guardamos só o hash — o token em claro existe apenas na URL enviada. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * O TOKEN DE UM LINK, DERIVADO DO ID — desde 13/09/2026.
   *
   * Antes eram 32 bytes aleatórios mostrados uma única vez, e por isso não havia
   * como reenviar um link sem gerar outro (que revoga o anterior). Agora o token
   * é `base64url(HMAC-SHA256(chave, link.id))`, com a chave derivada por HKDF do
   * `JWT_ACCESS_SECRET` com o rótulo 'recadastro-link'. Continua com 256 bits,
   * e o banco continua guardando só o sha256 dele: `carregarValido` não mudou, e
   * o contêiner antigo abre os links novos na janela de troca.
   *
   * O que custa, escrito para quem mexer na variável: TROCAR o
   * `JWT_ACCESS_SECRET` invalida os links ativos (no máximo 24h de estrago).
   * Vazá-lo permite derivar links vivos — mas quem tem essa chave já forja sessão
   * de Administrador, então o risco não cresce.
   */
  tokenDoLink(linkId: string): string {
    if (!this.chaveDerivada) {
      const segredo = segredoDaInstalacao(
        'JWT_ACCESS_SECRET',
        this.config.get<string>('JWT_ACCESS_SECRET'),
      );
      this.chaveDerivada = Buffer.from(hkdfSync('sha256', segredo, 'recadastro-link', '', 32));
    }
    return createHmac('sha256', this.chaveDerivada).update(linkId).digest('base64url');
  }

  /**
   * Decide o desafio a partir do que o cadastro TEM hoje.
   *
   * Regra de negócio: quem não tem CPF, nascimento nem COREN não teria como
   * provar identidade — nesses casos o link abre direto (e é de uso único).
   */
  private definirDesafio(f: { cpf: string | null; dataNascimento: Date | null; numeroCoren: string | null }): DesafioRecadastramento {
    if (f.cpf && f.dataNascimento) return DesafioRecadastramento.CPF_NASCIMENTO;
    // Na prática o COREN já seria nulo numa instalação que esconde o campo; a
    // checagem existe para o caso de dado importado de fora, que passaria a
    // pedir na tela um número de conselho de enfermagem a um servidor público.
    if (f.numeroCoren && campoVisivel('numeroCoren')) return DesafioRecadastramento.COREN;
    return DesafioRecadastramento.NENHUM;
  }

  /**
   * DESFILIADO NÃO RECEBE LINK. Recadastrar quem saiu do quadro é trabalho para
   * a porta de reativação, que registra o motivo do retorno; o link gravaria o
   * cadastro de alguém que o sindicato não representa mais.
   */
  private exigirQueNaoSejaDesfiliado(situacao: SituacaoFiliado) {
    if (situacao === SituacaoFiliado.DESFILIADO) {
      throw new BadRequestException('Reative o cadastro antes de pedir o recadastramento.');
    }
  }

  // =========================================================================
  // 1) GERAÇÃO (equipe autenticada)
  // =========================================================================

  /**
   * Cria o link e revoga os anteriores. O id nasce AQUI, e não no banco, porque
   * o token é derivado dele e o hash tem de ir junto no mesmo INSERT.
   */
  private async criarLink(
    filiado: { id: string; cpf: string | null; dataNascimento: Date | null; numeroCoren: string | null },
    ctx: Ctx,
  ) {
    const id = randomUUID();
    const token = this.tokenDoLink(id);
    const desafio = this.definirDesafio(filiado);
    const expiraEm = new Date(Date.now() + HORAS_VALIDADE * 3600_000);

    // Um link novo invalida os anteriores do mesmo filiado — evita vários
    // links vivos ao mesmo tempo para a mesma pessoa.
    await this.prisma.linkRecadastramento.updateMany({
      where: { filiadoId: filiado.id, usadoEm: null, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });

    const link = await this.prisma.linkRecadastramento.create({
      data: {
        id,
        filiadoId: filiado.id,
        tokenHash: this.hash(token),
        desafio,
        expiraEm,
        criadoPor: ctx.userId ?? null,
      },
      select: { id: true, desafio: true, expiraEm: true },
    });
    return { link, token };
  }

  async gerar(filiadoId: string, ctx: Ctx) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: {
        id: true, nomeCompleto: true, cpf: true, dataNascimento: true, numeroCoren: true, situacao: true,
      },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');
    this.exigirQueNaoSejaDesfiliado(filiado.situacao);

    const { link, token } = await this.criarLink(filiado, ctx);

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'LinkRecadastramento',
      entidadeId: link.id,
      descricao: `Link de recadastramento gerado para ${filiado.nomeCompleto} (desafio: ${link.desafio})`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { filiadoId, desafio: link.desafio, expiraEm: link.expiraEm.toISOString() },
    });

    return {
      ...link,
      url: this.urlDoToken(token),
      token,
      filiado: { id: filiado.id, nomeCompleto: filiado.nomeCompleto },
    };
  }

  /**
   * PREPARAR O ENVIO — o que o botão de WhatsApp, Compartilhar, Copiar ou E-mail
   * chama ANTES de abrir o destino.
   *
   * Reaproveita o link vivo (ver `planejarEnvio`) ou gera um se não houver.
   * Registra na auditoria que o link foi PREPARADO para envio, por qual meio e se
   * foi reaproveitado — nunca "enviado", que o sistema não tem como saber.
   */
  async prepararEnvio(filiadoId: string, meio: MeioDeEnvio, ctx: Ctx) {
    const agora = new Date();
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: {
        id: true, nomeCompleto: true, cpf: true, dataNascimento: true, numeroCoren: true,
        situacao: true, telefonePrincipal: true, telefoneSecundario: true, email: true,
      },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');
    this.exigirQueNaoSejaDesfiliado(filiado.situacao);

    const celularWhatsApp = celularParaWhatsApp(filiado.telefonePrincipal, filiado.telefoneSecundario);
    const email = emailUtilizavel(filiado.email);
    // Recusar ANTES de gerar: senão o registro diria "preparado por WhatsApp"
    // um envio que não tinha para onde ir.
    if (meio === 'WHATSAPP' && !celularWhatsApp) {
      throw new BadRequestException(
        'Este cadastro não tem celular com WhatsApp (nem no telefone principal, nem no secundário).',
      );
    }
    if (meio === 'EMAIL' && !email) {
      throw new BadRequestException('Este cadastro não tem e-mail válido.');
    }

    const vivos = await this.prisma.linkRecadastramento.findMany({
      where: { filiadoId, usadoEm: null, revogadoEm: null, expiraEm: { gt: agora } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, tokenHash: true, desafio: true, expiraEm: true,
        usadoEm: true, revogadoEm: true, createdAt: true,
      },
    });
    const plano = planejarEnvio({
      links: vivos,
      agora,
      hashDoTokenDerivado: (id) => this.hash(this.tokenDoLink(id)),
      desafioAtual: this.definirDesafio(filiado),
    });

    let link: { id: string; desafio: DesafioRecadastramento; expiraEm: Date };
    let token: string;
    const reaproveitado = plano.acao === 'REAPROVEITAR';
    if (plano.acao === 'REAPROVEITAR') {
      link = vivos.find((l) => l.id === plano.link.id)!;
      token = this.tokenDoLink(link.id);
    } else {
      ({ link, token } = await this.criarLink(filiado, ctx));
    }

    // Link recém-gerado não tem registro anterior; só o reaproveitado precisa olhar.
    const ultimo = reaproveitado
      ? await this.prisma.auditoria.findFirst({
          where: {
            entidade: 'LinkRecadastramento',
            entidadeId: link.id,
            userId: ctx.userId ?? null,
            createdAt: { gte: new Date(agora.getTime() - JANELA_SEM_REPETIR_REGISTRO_MS) },
            metadata: { path: ['meio'], equals: meio },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
      : null;

    if (deveRegistrarPreparo(ultimo?.createdAt, agora)) {
      await this.audit.registrar({
        userId: ctx.userId ?? null,
        // Sem valor novo no enum (seria migração): gerar é CREATE, reaproveitar é UPDATE.
        acao: reaproveitado ? AcaoAuditoria.UPDATE : AcaoAuditoria.CREATE,
        entidade: 'LinkRecadastramento',
        entidadeId: link.id,
        descricao: fraseDoPreparo({
          nome: filiado.nomeCompleto, meio, reaproveitado, expiraEm: link.expiraEm,
        }),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: {
          filiadoId,
          meio,
          reaproveitado,
          // A DECISÃO fica carimbada, não só o resultado.
          decisao: plano.acao === 'GERAR' ? plano.motivo : 'REAPROVEITADO',
          desafio: link.desafio,
          expiraEm: link.expiraEm.toISOString(),
        },
      });
    } else {
      // Olhou e decidiu não repetir: cala também o interceptor de último recurso.
      marcarNadaMudou();
    }

    return {
      url: this.urlDoToken(token),
      expiraEm: link.expiraEm,
      desafio: link.desafio,
      reaproveitado,
      primeiroNome: primeiroNome(filiado.nomeCompleto),
      celularWhatsApp,
      email,
    };
  }

  /** Links do filiado (para a equipe ver o que está ativo). */
  listar(filiadoId: string) {
    return this.prisma.linkRecadastramento.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, desafio: true, expiraEm: true, usadoEm: true,
        revogadoEm: true, tentativas: true, createdAt: true,
      },
    });
  }

  async revogar(id: string, ctx: Ctx) {
    const link = await this.prisma.linkRecadastramento.findUnique({ where: { id }, select: { id: true } });
    if (!link) throw new NotFoundException('Link não encontrado.');
    await this.prisma.linkRecadastramento.update({ where: { id }, data: { revogadoEm: new Date() } });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'LinkRecadastramento',
      entidadeId: id, descricao: 'Link de recadastramento revogado', ip: ctx.ip, metadata: {},
    });
    return { ok: true };
  }

  // =========================================================================
  // 2) ACESSO PÚBLICO (sem login)
  // =========================================================================

  /** Carrega e valida o link. Devolve só o necessário para montar a tela. */
  async abrir(token: string, ip?: string) {
    const link = await this.carregarValido(token);
    await this.prisma.linkRecadastramento.update({
      where: { id: link.id },
      data: { ipUltimoAcesso: ip ?? null },
    });

    return {
      desafio: link.desafio,
      expiraEm: link.expiraEm,
      // Primeiro nome só para a pessoa reconhecer que é o cadastro dela.
      // LGPD: nada além disso antes de passar o desafio.
      primeiroNome: link.filiado.nomeCompleto.trim().split(/\s+/)[0],
    };
  }

  /**
   * Confere o desafio e libera os dados do cadastro para edição.
   * Retorna o filiado COMPLETO — é o que o formulário precisa preencher.
   */
  async validarDesafio(token: string, resposta: { cpf?: string; dataNascimento?: string; coren?: string }) {
    const link = await this.carregarValido(token);
    const f = link.filiado;

    await this.exigirDesafio(link, resposta);
    // Acertar o desafio não muda o cadastro. Sem esta marca, o interceptor de
    // último recurso gravava a linha com a URL — e a URL tem o token.
    marcarNadaMudou();

    const completo = await this.prisma.filiado.findUnique({
      where: { id: f.id },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        // O filiado precisa ver os dependentes atuais para poder corrigi-los.
        dependentes: { orderBy: { createdAt: 'asc' } },
      },
    });
    // A foto atual entra como URL assinada só para o filiado ver o que está no
    // cadastro hoje — as chaves de storage não saem daqui.
    const { fotoKey, fotoThumbKey, ...dados } = completo!;
    const fotoUrl = fotoKey ? await this.storage.getSignedUrl(fotoKey).catch(() => null) : null;
    return { filiado: { ...dados, fotoUrl }, desafio: link.desafio };
  }

  /**
   * Troca a foto pelo link público.
   *
   * Só vale enquanto o link está válido (antes do envio, que o queima). O
   * arquivo passa pelo MESMO processamento da equipe — recorte, WebP e
   * miniatura — então nada cru do filiado chega ao storage.
   *
   * PEDE O DESAFIO (13/09/2026). Bastava o token: num link CPF_NASCIMENTO
   * encaminhado, quem não sabia CPF nem nascimento trocava a foto da carteirinha
   * — e a anterior é apagada do storage, sem volta. O erro conta nas mesmas
   * tentativas de validar e do envio.
   */
  async atualizarFoto(
    token: string,
    arquivo: Buffer,
    mimetype: string,
    resposta: { cpf?: string; dataNascimento?: string; coren?: string } = {},
    ip?: string,
  ) {
    if (!MIMES_FOTO.has(mimetype)) {
      throw new BadRequestException('Envie uma imagem JPG, PNG ou WebP.');
    }
    if (arquivo.length > TAMANHO_MAX_FOTO) {
      throw new BadRequestException('A imagem deve ter no máximo 8 MB.');
    }
    const link = await this.carregarValido(token);
    await this.exigirDesafio(link, resposta);
    await this.filiados.atualizarFoto(link.filiado.id, arquivo, 'Filiado (link online)');
    // Registro próprio, sem o token: também cala o interceptor, que gravaria a URL.
    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: link.filiado.id,
      descricao: `Foto trocada pelo próprio filiado (link) — ${link.filiado.nomeCompleto}`,
      ip,
      metadata: { linkId: link.id, desafio: link.desafio },
    });
    return { ok: true };
  }

  /**
   * Grava o recadastramento feito pelo próprio filiado.
   *
   * O desafio é conferido DE NOVO aqui: a etapa anterior é só de tela, e um
   * cliente malicioso poderia pular direto para o envio.
   */
  async submeter(token: string, dto: RecadastroPublicoDto, ip?: string) {
    const link = await this.carregarValido(token);
    const atual = link.filiado;

    // Nas MESMAS tentativas de validar (13/09/2026): antes o erro aqui só dizia
    // "inválida", sem contar nem queimar — e o envio virava a porta para
    // varrer datas de nascimento que o /validar fechava.
    await this.exigirDesafio(link, {
      cpf: dto.cpfConfirmacao,
      dataNascimento: dto.dataNascimentoConfirmacao,
      coren: dto.corenConfirmacao,
    });

    // LISTA EXPLÍCITA: só os campos de `CAMPOS_DO_CADASTRO_PELO_LINK` saem do
    // corpo. Nada de espalhar o dto — foi assim que `situacao` e
    // `cobrancas: { deleteMany }` chegavam ao Prisma.
    const entrada = camposDoLink(dto as unknown as Record<string, unknown>);

    // O filiado não altera CPF, RG, nascimento nem naturalidade pelo link —
    // esses dados não mudam. Se estiverem em branco, o envio PREENCHE.
    const cadastroAtual = await this.prisma.filiado.findUniqueOrThrow({
      where: { id: atual.id },
      select: { cpf: true, rg: true, ufRg: true, dataNascimento: true, naturalidade: true },
    });
    const { dados, ignorados } = protegerImutaveis(cadastroAtual, entrada);

    const cpfLimpo = dados.cpf ? String(dados.cpf).replace(/\D/g, '') : undefined;
    await this.garantirUnicidade(atual.id, cpfLimpo, dados.numeroCoren as string | undefined);

    const completoAntes = await this.prisma.filiado.findUnique({
      where: { id: atual.id },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        dependentes: { orderBy: { createdAt: 'asc' } },
      },
    });
    const dadosAnteriores: Prisma.InputJsonValue = JSON.parse(JSON.stringify(completoAntes));
    const syncDependentes = montarSincronizacaoDependentes(
      dto.dependentes,
      completoAntes?.dependentes ?? [],
    );
    const resumo = resumirDependentes(dto.dependentes, completoAntes?.dependentes ?? []);

    const [filiado] = await this.prisma.$transaction([
      this.prisma.filiado.update({
        where: { id: atual.id },
        data: {
          ...(dados as Prisma.FiliadoUpdateInput),
          // De `dados`, nunca de `dto`: o protegido já saiu de lá.
          cpf: cpfLimpo,
          dataNascimento: dataCalendario(dados.dataNascimento as string | undefined),
          dataAdmissao: dataCalendario(dados.dataAdmissao as string | undefined),
          vinculos: dto.vinculos
            ? {
                deleteMany: {},
                create: vinculosPeloLink(dto.vinculos, completoAntes?.vinculos ?? []),
              }
            : undefined,
          dependentes: syncDependentes,
        },
        include: { vinculos: true, dependentes: true },
      }),
      this.prisma.recadastramento.create({
        data: {
          filiadoId: atual.id,
          // Veio do próprio filiado, sem conferência da equipe: fica PENDENTE
          // de revisão. O dado já entra (o filiado é o titular), e a ficha
          // mostra o de→para com o botão "Conferido" (PATCH /recadastramentos/:id/conferir).
          status: StatusRecadastramento.PENDENTE,
          dadosAnteriores,
          dadosNovos: {
            ...dados,
            ...(dto.vinculos ? { vinculos: dto.vinculos } : {}),
            ...(dto.dependentes ? { dependentes: dto.dependentes } : {}),
          } as unknown as Prisma.InputJsonValue,
          observacao: 'Recadastramento ONLINE feito pelo próprio filiado (link).',
        },
      }),
      this.prisma.filiadoHistorico.create({
        data: {
          filiadoId: atual.id,
          tipo: TipoHistoricoFiliado.RECADASTRAMENTO,
          descricao:
            'Recadastramento online realizado pelo filiado via link.' +
            (resumo ? ` ${resumo}` : '') +
            (ignorados.length ? ` Campos protegidos ignorados: ${ignorados.join(', ')}.` : ''),
          autor: 'Filiado (link online)',
        },
      }),
      // USO ÚNICO: o link morre aqui.
      this.prisma.linkRecadastramento.update({
        where: { id: link.id },
        data: { usadoEm: new Date(), ipUltimoAcesso: ip ?? null },
      }),
    ]);

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: atual.id,
      descricao: `Recadastramento online concluído por ${filiado.nomeCompleto}`,
      ip,
      metadata: { linkId: link.id, desafio: link.desafio },
    });

    return { ok: true, nome: filiado.nomeCompleto };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Busca o link pelo token e valida validade/uso/revogação. */
  private async carregarValido(token: string) {
    if (!token || token.length < 20) throw new NotFoundException('Link inválido.');
    const link = await this.prisma.linkRecadastramento.findUnique({
      where: { tokenHash: this.hash(token) },
      include: {
        filiado: {
          select: {
            id: true, nomeCompleto: true, cpf: true, dataNascimento: true, numeroCoren: true,
            situacao: true,
          },
        },
      },
    });
    if (!link) throw new NotFoundException('Link inválido ou inexistente.');
    if (link.revogadoEm) throw new GoneException('Este link foi cancelado. Solicite um novo ao sindicato.');
    if (link.usadoEm) throw new GoneException('Este link já foi utilizado. Solicite um novo ao sindicato.');
    if (link.expiraEm < new Date()) throw new GoneException('Este link expirou. Solicite um novo ao sindicato.');
    // Rede para o link mandado ANTES da desfiliação (13/09/2026): `desfiliar`
    // já revoga os vivos, mas o que vale é a situação de agora.
    if (link.filiado.situacao === SituacaoFiliado.DESFILIADO) {
      throw new GoneException('Este link foi cancelado. Solicite um novo ao sindicato.');
    }
    return link;
  }

  /**
   * CONFERE O DESAFIO E CONTA O ERRO — um contador só para validar, foto e
   * envio (13/09/2026).
   *
   * Só o /validar contava. O /enviar respondia "inválida" sem contar nem queimar,
   * e a foto nem perguntava: quem sabia o CPF varria as datas de nascimento pela
   * porta ao lado, a 120/min, sem nunca queimar o link.
   *
   * O incremento é ATÔMICO no banco: dez pedidos em paralelo lendo o mesmo
   * `tentativas` gravariam todos "1".
   */
  private async exigirDesafio(
    link: {
      id: string;
      desafio: DesafioRecadastramento;
      tentativas: number;
      filiado: { cpf: string | null; dataNascimento: Date | null; numeroCoren: string | null };
    },
    resposta: { cpf?: string; dataNascimento?: string; coren?: string },
  ): Promise<void> {
    if (link.desafio === DesafioRecadastramento.NENHUM) return;

    if (this.conferir(link.desafio, link.filiado, resposta)) {
      // Acertou: zera o contador.
      if (link.tentativas > 0) {
        await this.prisma.linkRecadastramento.update({ where: { id: link.id }, data: { tentativas: 0 } });
      }
      return;
    }

    const { tentativas } = await this.prisma.linkRecadastramento.update({
      where: { id: link.id },
      data: { tentativas: { increment: 1 } },
      select: { tentativas: true },
    });
    if (tentativas >= MAX_TENTATIVAS) {
      // Estourou o limite? Queima o link (revoga) — não adianta insistir.
      await this.prisma.linkRecadastramento.update({
        where: { id: link.id },
        data: { revogadoEm: new Date() },
      });
      throw new ForbiddenException(
        'Muitas tentativas incorretas. Este link foi bloqueado — solicite um novo ao sindicato.',
      );
    }
    throw new ForbiddenException(
      `Dados não conferem. Restam ${MAX_TENTATIVAS - tentativas} tentativa(s).`,
    );
  }

  /** Compara a resposta do desafio com o cadastro (sem vazar qual campo errou). */
  private conferir(
    desafio: DesafioRecadastramento,
    f: { cpf: string | null; dataNascimento: Date | null; numeroCoren: string | null },
    r: { cpf?: string; dataNascimento?: string; coren?: string },
  ): boolean {
    if (desafio === DesafioRecadastramento.COREN) {
      const a = (f.numeroCoren ?? '').replace(/\W/g, '').toUpperCase();
      const b = (r.coren ?? '').replace(/\W/g, '').toUpperCase();
      return !!a && a === b;
    }
    const cpfOk = (f.cpf ?? '') === (r.cpf ?? '').replace(/\D/g, '') && !!f.cpf;
    // A data é comparada como DIA, aceitando as duas convenções que convivem na
    // base (meia-noite UTC e meia-noite de Brasília). Sem isso, um cadastro
    // gravado na convenção errada mostra 23/06 na ficha e exige 24/06 aqui —
    // o filiado digita o que vê e leva "dados não conferem".
    const nascOk =
      !!r.dataNascimento && diasPossiveis(f.dataNascimento).includes(r.dataNascimento.slice(0, 10));
    return cpfOk && nascOk;
  }

  /** CPF e COREN são únicos no sistema — o filiado não pode colidir com outro. */
  private async garantirUnicidade(filiadoId: string, cpf?: string, coren?: string) {
    if (cpf) {
      const outro = await this.prisma.filiado.findFirst({
        where: { cpf, id: { not: filiadoId } },
        select: { id: true },
      });
      if (outro) throw new ConflictException('Este CPF já está cadastrado para outro filiado.');
    }
    if (coren?.trim()) {
      const outro = await this.prisma.filiado.findFirst({
        where: { numeroCoren: coren.trim(), id: { not: filiadoId } },
        select: { id: true },
      });
      if (outro) throw new ConflictException('Este número do COREN já está cadastrado para outro filiado.');
    }
  }

  private urlDoToken(token: string): string {
    return `${this.baseUrlPublica()}/recadastro/${token}`;
  }

  /** URL pública do sistema (para montar o link enviado ao filiado). */
  private baseUrlPublica(): string {
    const url =
      this.config.get<string>('APP_PUBLIC_URL') ??
      this.config.get<string>('CORS_ORIGINS')?.split(',')[0]?.trim() ??
      'http://localhost:3000';
    return url.replace(/\/+$/, '');
  }
}
