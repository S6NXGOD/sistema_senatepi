import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AcaoAuditoria, AnexoDocumento } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../../common/audit/audit.service';
import { CriarAnexoDto, ListarAnexosQueryDto } from './dto/anexos.dto';

/**
 * AnexosService — gestão de documentos (anexos) de Atendimentos e Processos.
 *
 * LGPD (Lei nº 13.709/2018 — art. 6º, VII, princípio da SEGURANÇA): documentos
 * costumam conter dados pessoais/sensíveis (laudos, RG, comprovantes). Por isso:
 *  - o arquivo é gravado sob uma CHAVE OPACA (UUID) no storage, jamais pelo nome
 *    original enviado pelo usuário (evita path traversal / enumeração);
 *  - a leitura é feita por URL controlada pela API (driver local) ou por URL
 *    ASSINADA e TEMPORÁRIA (driver S3), nunca por caminho público adivinhável;
 *  - o tipo (MIME) e o tamanho são validados no ingresso;
 *  - toda criação/remoção é registrada na auditoria.
 */

/** Formatos aceitos (documentos e imagens comuns de acervo jurídico). */
const MIME_PERMITIDOS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
/** Teto de 15 MB por arquivo (também aplicado no interceptor do controller). */
export const ANEXO_TAMANHO_MAX = 15 * 1024 * 1024;

interface Ctx {
  userId?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AnexosService {
  private readonly logger = new Logger(AnexosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(arquivo: Express.Multer.File, dto: CriarAnexoDto, ctx: Ctx) {
    if (!arquivo) throw new BadRequestException('Arquivo "arquivo" é obrigatório.');

    const ext = MIME_PERMITIDOS[arquivo.mimetype];
    if (!ext) {
      throw new BadRequestException('Formato não permitido. Use PDF, DOC, DOCX, JPG ou PNG.');
    }
    if (arquivo.size > ANEXO_TAMANHO_MAX) {
      throw new BadRequestException('Arquivo excede o limite de 15 MB.');
    }

    const alvo = await this.resolverAlvo(dto.atendimentoId, dto.processoId);

    // Chave opaca (LGPD): nunca usa o nome original no caminho do storage.
    const storageKey = `${alvo.prefixo}/anexos/${randomUUID()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);
    const url = await this.storage.getSignedUrl(storageKey);

    const anexo = await this.prisma.anexoDocumento.create({
      data: {
        storageKey,
        url,
        nomeArquivo: this.sanitizarNome(arquivo.originalname),
        tipoMime: arquivo.mimetype,
        tamanhoBytes: arquivo.size,
        atendimentoId: dto.atendimentoId || null,
        processoId: dto.processoId || null,
      },
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'AnexoDocumento',
      entidadeId: anexo.id,
      descricao: `Anexo "${anexo.nomeArquivo}" (${Math.round(arquivo.size / 1024)} KB) enviado`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: alvo.meta,
    });

    return this.comUrlFresca(anexo);
  }

  async listar(q: ListarAnexosQueryDto) {
    if (!q.atendimentoId && !q.processoId) {
      throw new BadRequestException('Informe atendimentoId ou processoId.');
    }
    const anexos = await this.prisma.anexoDocumento.findMany({
      where: {
        atendimentoId: q.atendimentoId || undefined,
        processoId: q.processoId || undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(anexos.map((a) => this.comUrlFresca(a)));
  }

  async remover(id: string, ctx: Ctx) {
    const anexo = await this.prisma.anexoDocumento.findUnique({ where: { id } });
    if (!anexo) throw new NotFoundException('Anexo não encontrado.');

    // Remove primeiro do storage (best-effort) e depois o registro.
    void this.storage.delete(anexo.storageKey).catch(() => undefined);
    await this.prisma.anexoDocumento.delete({ where: { id } });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'AnexoDocumento',
      entidadeId: id,
      descricao: `Anexo "${anexo.nomeArquivo}" removido`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { atendimentoId: anexo.atendimentoId, processoId: anexo.processoId },
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Regenera a URL de leitura a cada resposta: no S3 a URL assinada é temporária
   * (expira), então nunca confiamos na `url` persistida para leitura.
   */
  private async comUrlFresca(a: AnexoDocumento) {
    const url = await this.storage.getSignedUrl(a.storageKey);
    return { ...a, url };
  }

  /** Valida que exatamente um vínculo foi informado e que ele existe. */
  private async resolverAlvo(atendimentoId?: string, processoId?: string) {
    if (!!atendimentoId === !!processoId) {
      throw new BadRequestException('Informe exatamente um vínculo: atendimentoId OU processoId.');
    }
    if (atendimentoId) {
      const at = await this.prisma.atendimento.findUnique({
        where: { id: atendimentoId },
        select: { id: true },
      });
      if (!at) throw new BadRequestException('Atendimento inválido.');
      return { prefixo: `atendimentos/${atendimentoId}`, meta: { atendimentoId } };
    }
    const proc = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true },
    });
    if (!proc) throw new BadRequestException('Processo inválido.');
    return { prefixo: `processos/${processoId}`, meta: { processoId } };
  }

  /** Nome exibível seguro: remove diretórios e caracteres de controle. */
  private sanitizarNome(nome: string): string {
    const base = (nome || 'documento').split(/[\\/]/).pop() ?? 'documento';
    // Mantém apenas caracteres imprimíveis (descarta controles) e limita o tamanho.
    const limpo = Array.from(base)
      .filter((c) => c >= ' ')
      .join('')
      .trim();
    return limpo.slice(0, 180) || 'documento';
  }
}
