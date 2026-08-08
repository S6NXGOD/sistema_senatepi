import { StorageService, apenasDigitosCnpj, gerarPixCopiaECola } from '@core/infra';
import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusContribuicaoPatronal } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

import { GerarContribuicaoDto, ListarContribuicoesQueryDto } from './dto/contribuicao.dto';
import { tenant } from '../../tenant/tenant.config';

/** 15 MB por arquivo — folha de pagamento em PDF passa longe disso. */
export const TAMANHO_MAX_ANEXO = 15 * 1024 * 1024;

/** A relação de trabalhadores é documento formal: só PDF. */
const MIMES_RELACAO = new Set(['application/pdf']);
/** O comprovante costuma ser print do app do banco — PDF ou imagem. */
const MIMES_COMPROVANTE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/**
 * Status em que a empresa ainda pode enviar documentos.
 *
 * EM_ANALISE entra na lista de propósito: os anexos são independentes, então
 * quem mandou só o comprovante precisa poder voltar depois e completar com a
 * relação (ou trocar um arquivo enviado errado) enquanto o sindicato não decidiu.
 */
const ACEITA_ANEXO: StatusContribuicaoPatronal[] = [
  StatusContribuicaoPatronal.AGUARDANDO,
  StatusContribuicaoPatronal.EM_ANALISE,
  StatusContribuicaoPatronal.REJEITADA,
];

interface Ctx {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class ContribuicoesPatronaisService {
  private readonly logger = new Logger(ContribuicoesPatronaisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // =========================================================================
  // 1) Geração da guia + PIX
  // =========================================================================

  async gerar(empresaId: string, dto: GerarContribuicaoDto, ctx: Ctx) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, cnpj: true, razaoSocial: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');

    this.validarCompetencia(dto.mesReferencia);

    // Uma competência por vez: se já existe guia viva para o mês, a empresa
    // deve continuar aquela em vez de criar uma segunda. REJEITADA não conta —
    // aí o reenvio é justamente o esperado.
    const emAberto = await this.prisma.contribuicaoPatronal.findFirst({
      where: {
        empresaId,
        mesReferencia: dto.mesReferencia,
        status: { in: [
          StatusContribuicaoPatronal.AGUARDANDO,
          StatusContribuicaoPatronal.EM_ANALISE,
          StatusContribuicaoPatronal.HOMOLOGADA,
        ] },
      },
      select: { id: true, status: true },
    });
    if (emAberto) {
      throw new ConflictException(
        emAberto.status === StatusContribuicaoPatronal.HOMOLOGADA
          ? `A contribuição de ${this.competenciaLegivel(dto.mesReferencia)} já foi homologada.`
          : `Já existe uma declaração em andamento para ${this.competenciaLegivel(dto.mesReferencia)}.`,
      );
    }

    const contribuicao = await this.prisma.contribuicaoPatronal.create({
      data: {
        empresaId,
        mesReferencia: dto.mesReferencia,
        valorDeclarado: new Prisma.Decimal(dto.valorDeclarado.toFixed(2)),
        status: StatusContribuicaoPatronal.AGUARDANDO,
      },
    });

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'ContribuicaoPatronal',
      entidadeId: contribuicao.id,
      descricao:
        `Guia patronal gerada: ${empresa.razaoSocial} — ` +
        `${this.competenciaLegivel(dto.mesReferencia)}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cnpj: empresa.cnpj, mesReferencia: dto.mesReferencia },
    });

    const pix = await this.montarPix(contribuicao.id, empresa.cnpj, dto.mesReferencia, dto.valorDeclarado);
    return { contribuicao: this.apresentar(contribuicao), pix };
  }

  /** Regera o PIX de uma guia ainda não paga (a empresa pode retomar depois). */
  async pixDaGuia(empresaId: string, id: string) {
    const c = await this.buscarDaEmpresa(empresaId, id);
    if (c.status === StatusContribuicaoPatronal.HOMOLOGADA) {
      throw new BadRequestException('Esta contribuição já foi homologada.');
    }
    const empresa = await this.prisma.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      select: { cnpj: true },
    });
    return this.montarPix(c.id, empresa.cnpj, c.mesReferencia, Number(c.valorDeclarado));
  }

  // =========================================================================
  // 2) Anexos (comprovante + relação de trabalhadores)
  // =========================================================================

  async anexar(
    empresaId: string,
    id: string,
    arquivos: { comprovante?: Express.Multer.File[]; relacao?: Express.Multer.File[] },
    ctx: Ctx,
  ) {
    const contribuicao = await this.buscarDaEmpresa(empresaId, id);

    if (!ACEITA_ANEXO.includes(contribuicao.status)) {
      throw new BadRequestException('Esta contribuição já foi homologada.');
    }

    const comprovante = arquivos.comprovante?.[0];
    const relacao = arquivos.relacao?.[0];

    // Os dois documentos são INDEPENDENTES: a empresa pode mandar um agora e o
    // outro depois. Só não pode enviar nada.
    if (!comprovante && !relacao) {
      throw new BadRequestException(
        'Anexe ao menos um documento: o comprovante do PIX ou a relação de trabalhadores.',
      );
    }
    if (comprovante) {
      this.validarArquivo(comprovante, MIMES_COMPROVANTE, 'comprovante do PIX (PDF ou imagem)');
    }
    if (relacao) {
      this.validarArquivo(relacao, MIMES_RELACAO, 'relação de trabalhadores (PDF)');
    }

    // Prefixo por empresa e competência: facilita a conferência e permite
    // apagar tudo de uma empresa junto, se ela pedir eliminação (LGPD).
    const base = `contribuicoes/${empresaId}/${contribuicao.mesReferencia}/${contribuicao.id}`;
    const dados: Prisma.ContribuicaoPatronalUpdateInput = {};

    if (comprovante) {
      const chave = `${base}/comprovante-${Date.now()}${this.extensao(comprovante)}`;
      await this.storage.upload(chave, comprovante.buffer, comprovante.mimetype);
      // Só o arquivo SUBSTITUÍDO é apagado — o outro anexo continua valendo.
      await this.apagar(contribuicao.urlComprovantePix);
      dados.urlComprovantePix = chave;
    }
    if (relacao) {
      const chave = `${base}/relacao-${Date.now()}.pdf`;
      await this.storage.upload(chave, relacao.buffer, relacao.mimetype);
      await this.apagar(contribuicao.urlRelacaoTrabalhadores);
      dados.urlRelacaoTrabalhadores = chave;
    }

    const atualizada = await this.prisma.contribuicaoPatronal.update({
      where: { id: contribuicao.id },
      data: {
        ...dados,
        status: StatusContribuicaoPatronal.EM_ANALISE,
        // Carimba a PRIMEIRA entrega; completar depois não reinicia a espera.
        enviadoEm: contribuicao.enviadoEm ?? new Date(),
        // Um envio novo depois da recusa zera o motivo anterior.
        motivoRejeicao: null,
      },
    });

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ContribuicaoPatronal',
      entidadeId: contribuicao.id,
      descricao:
        `Documentos enviados para análise — ${this.competenciaLegivel(contribuicao.mesReferencia)}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { mesReferencia: contribuicao.mesReferencia },
    });

    this.logger.log(`[PATRONAL] Contribuição ${contribuicao.id} entrou em análise`);
    return this.apresentar(atualizada);
  }

  // =========================================================================
  // 3) Histórico
  // =========================================================================

  async listar(empresaId: string, query: ListarContribuicoesQueryDto) {
    const contribuicoes = await this.prisma.contribuicaoPatronal.findMany({
      where: {
        empresaId,
        ...(query.mesReferencia ? { mesReferencia: query.mesReferencia } : {}),
      },
      orderBy: [{ mesReferencia: 'desc' }, { createdAt: 'desc' }],
    });
    return contribuicoes.map((c) => this.apresentar(c));
  }

  async detalhe(empresaId: string, id: string) {
    return this.apresentar(await this.buscarDaEmpresa(empresaId, id));
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Carrega a contribuição SEMPRE amarrada à empresa da sessão.
   *
   * É o que impede uma empresa de ler ou anexar na guia de outra trocando o id
   * na URL: o filtro por `empresaId` está no WHERE, não numa checagem depois.
   */
  private async buscarDaEmpresa(empresaId: string, id: string) {
    const c = await this.prisma.contribuicaoPatronal.findFirst({
      where: { id, empresaId },
    });
    if (!c) throw new NotFoundException('Contribuição não encontrada.');
    return c;
  }

  private async montarPix(
    contribuicaoId: string,
    cnpj: string,
    mesReferencia: string,
    valor: number,
  ) {
    const cfg = await this.prisma.configuracaoSindicato.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!cfg?.pixChave) {
      throw new BadRequestException(
        'O sindicato ainda não configurou a chave PIX. Entre em contato com a secretaria.',
      );
    }

    // TXID rastreável e dentro do limite EMV (25 alfanuméricos):
    // PAT + 8 dígitos finais do CNPJ + competência sem hífen.
    const identificador = `PAT${apenasDigitosCnpj(cnpj).slice(-8)}${mesReferencia.replace('-', '')}`;

    const copiaECola = gerarPixCopiaECola({
      chave: cfg.pixChave,
      nome: cfg.pixNomeRecebedor ?? tenant.sigla,
      cidade: cfg.pixCidade ?? 'TERESINA',
      valor,
      identificador,
    });
    const qrDataUrl = await QRCode.toDataURL(copiaECola, { width: 320, margin: 1 });

    return {
      contribuicaoId,
      valor,
      identificador,
      copiaECola,
      qrDataUrl,
      recebedor: cfg.pixNomeRecebedor ?? tenant.sigla,
    };
  }

  /**
   * Baixa um dos documentos, sempre pela sessão da empresa.
   *
   * A leitura passa por aqui e NÃO por uma URL do storage porque, no driver
   * `local`, o `/uploads` é servido estaticamente — sem autenticação e sem
   * expiração. A relação de trabalhadores tem dados pessoais de terceiros;
   * um link eterno e aberto contradiria o aviso de LGPD mostrado no envio.
   */
  async baixarDocumento(empresaId: string, id: string, tipo: 'comprovante' | 'relacao') {
    const c = await this.buscarDaEmpresa(empresaId, id);
    const chave = tipo === 'comprovante' ? c.urlComprovantePix : c.urlRelacaoTrabalhadores;
    if (!chave) throw new NotFoundException('Documento não enviado.');

    const buffer = await this.storage.getBuffer(chave);
    if (!buffer) throw new NotFoundException('Documento indisponível.');

    const ext = chave.slice(chave.lastIndexOf('.')).toLowerCase();
    const contentType =
      ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';
    const nome =
      `${tipo === 'comprovante' ? 'comprovante-pix' : 'relacao-trabalhadores'}-${c.mesReferencia}${ext}`;

    return { buffer, contentType, nome };
  }

  /**
   * Formata para o portal.
   *
   * As CHAVES do storage não saem daqui: em lugar delas vão apenas indicadores
   * de que o documento existe. O conteúdo é servido por `baixarDocumento`.
   */
  private apresentar(c: {
    id: string; empresaId: string; mesReferencia: string; valorDeclarado: Prisma.Decimal;
    status: StatusContribuicaoPatronal; urlComprovantePix: string | null;
    urlRelacaoTrabalhadores: string | null; motivoRejeicao: string | null;
    enviadoEm: Date | null; analisadoEm: Date | null;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: c.id,
      mesReferencia: c.mesReferencia,
      competencia: this.competenciaLegivel(c.mesReferencia),
      valorDeclarado: Number(c.valorDeclarado),
      status: c.status,
      temComprovante: !!c.urlComprovantePix,
      temRelacao: !!c.urlRelacaoTrabalhadores,
      // Sem isto a empresa vê "rejeitada" e não sabe o que corrigir — o motivo
      // exigido do analista existe justamente para chegar até aqui.
      motivoRejeicao: c.motivoRejeicao,
      enviadoEm: c.enviadoEm,
      analisadoEm: c.analisadoEm,
      createdAt: c.createdAt,
    };
  }

  private validarArquivo(f: Express.Multer.File, permitidos: Set<string>, rotulo: string) {
    if (!permitidos.has(f.mimetype)) {
      throw new BadRequestException(`Formato inválido para o ${rotulo}.`);
    }
    if (f.size > TAMANHO_MAX_ANEXO) {
      throw new BadRequestException(`O arquivo do ${rotulo} deve ter no máximo 15 MB.`);
    }
    if (!f.size) throw new BadRequestException(`O arquivo do ${rotulo} está vazio.`);
  }

  /**
   * Remove o arquivo que acabou de ser substituído.
   * Guardar dado pessoal que não serve mais é o oposto do que a LGPD pede.
   */
  private async apagar(chave: string | null) {
    if (chave) await this.storage.delete(chave).catch(() => undefined);
  }

  private extensao(f: Express.Multer.File): string {
    if (f.mimetype === 'application/pdf') return '.pdf';
    if (f.mimetype === 'image/png') return '.png';
    if (f.mimetype === 'image/webp') return '.webp';
    return '.jpg';
  }

  /** Não aceita competência no futuro — não há folha de um mês que não fechou. */
  private validarCompetencia(mesReferencia: string) {
    const agora = new Date();
    const atual = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
    if (mesReferencia > atual) {
      throw new BadRequestException('A competência não pode ser um mês futuro.');
    }
  }

  private competenciaLegivel(mesReferencia: string): string {
    const [ano, mes] = mesReferencia.split('-');
    const nomes = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ];
    return `${nomes[Number(mes) - 1] ?? mes}/${ano}`;
  }
}
