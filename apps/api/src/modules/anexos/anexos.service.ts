import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AcaoAuditoria, AnexoDocumento, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  AcervoQueryDto, CriarAnexoDto, ListarAnexosQueryDto, OrigemAcervo, PuxarAnexosDto,
} from './dto/anexos.dto';

/**
 * AnexosService — gestão de documentos (anexos) de Atendimentos, Processos e
 * atividades da Agenda.
 *
 * LGPD (Lei nº 13.709/2018 — art. 6º, VII, princípio da SEGURANÇA): documentos
 * costumam conter dados pessoais/sensíveis (laudos, RG, comprovantes). Por isso:
 *  - o arquivo é gravado sob uma CHAVE OPACA (UUID) no storage, jamais pelo nome
 *    original enviado pelo usuário (evita path traversal / enumeração);
 *  - a leitura é feita por URL controlada pela API (driver local) ou por URL
 *    ASSINADA e TEMPORÁRIA (driver S3), nunca por caminho público adivinhável;
 *  - o tipo (MIME) e o tamanho são validados no ingresso;
 *  - toda criação/remoção é registrada na auditoria.
 *
 * REAPROVEITAMENTO ("puxar documento"): o mesmo laudo é pedido ao filiado em
 * atendimentos diferentes. `acervo()` reúne tudo que o filiado já entregou e
 * `puxar()` vincula os escolhidos ao registro atual reusando a MESMA chave de
 * storage — sem novo upload e sem duplicar o arquivo no bucket. Só o vínculo é
 * novo; por isso a exclusão faz contagem de referências antes de apagar o
 * arquivo (ver `remover`).
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

/** Vínculo do anexo — exatamente um destes é usado por vez. */
interface Alvo {
  atendimentoId?: string;
  processoId?: string;
  compromissoId?: string;
}

/** Item consolidado do acervo do filiado (o que dá para "puxar"). */
export interface ItemAcervo {
  origemTipo: OrigemAcervo;
  /** Id do registro de origem (anexo ou documento do cadastro). */
  origemId: string;
  /** Registro ao qual a origem pertence (atendimento/processo/atividade). */
  origemRegistroId: string | null;
  origemRotulo: string;
  storageKey: string;
  nomeArquivo: string;
  tipoMime: string;
  tamanhoBytes: number | null;
  createdAt: Date;
  url: string;
  /** O documento já está disponível no registro atual (anexado ou herdado). */
  jaVinculado: boolean;
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

    const alvo = await this.resolverAlvo(dto);

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
        compromissoId: dto.compromissoId || null,
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
    if (!q.atendimentoId && !q.processoId && !q.compromissoId) {
      throw new BadRequestException('Informe atendimentoId, processoId ou compromissoId.');
    }
    const anexos = await this.prisma.anexoDocumento.findMany({
      where: {
        atendimentoId: q.atendimentoId || undefined,
        processoId: q.processoId || undefined,
        compromissoId: q.compromissoId || undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(anexos.map((a) => this.comUrlFresca(a)));
  }

  /**
   * Remove o VÍNCULO do documento com o registro.
   *
   * O arquivo em si só sai do bucket se nenhuma outra linha ainda apontar para a
   * mesma chave — desde o "puxar", uma chave é compartilhada por vários vínculos
   * (e pode ser também um documento do cadastro do filiado). Apagar o arquivo
   * junto com o primeiro vínculo deixaria os demais quebrados.
   */
  async remover(id: string, ctx: Ctx) {
    const anexo = await this.prisma.anexoDocumento.findUnique({ where: { id } });
    if (!anexo) throw new NotFoundException('Anexo não encontrado.');

    await this.prisma.anexoDocumento.delete({ where: { id } });

    const [aindaUsadoEmAnexos, aindaUsadoEmDocumentos] = await Promise.all([
      this.prisma.anexoDocumento.count({ where: { storageKey: anexo.storageKey } }),
      this.prisma.documento.count({ where: { storageKey: anexo.storageKey } }),
    ]);
    const compartilhado = aindaUsadoEmAnexos + aindaUsadoEmDocumentos > 0;
    if (!compartilhado) {
      void this.storage.delete(anexo.storageKey).catch(() => undefined);
    }

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'AnexoDocumento',
      entidadeId: id,
      descricao: compartilhado
        ? `Vínculo do anexo "${anexo.nomeArquivo}" removido (arquivo mantido — em uso em outro registro)`
        : `Anexo "${anexo.nomeArquivo}" removido`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        atendimentoId: anexo.atendimentoId,
        processoId: anexo.processoId,
        compromissoId: anexo.compromissoId,
        arquivoMantido: compartilhado,
      },
    });
    return { ok: true, arquivoMantido: compartilhado };
  }

  // -------------------------------------------------------------------------
  // Acervo do filiado — "puxar documento de outro atendimento"
  // -------------------------------------------------------------------------

  /**
   * Tudo que o filiado já entregou: anexos de atendimentos, de processos em que
   * ele é parte, de atividades da agenda, e os documentos do cadastro (RG, CPF,
   * comprovantes). Deduplicado por chave de storage — o mesmo arquivo puxado
   * três vezes aparece uma só, pela sua origem mais antiga.
   */
  async acervo(q: AcervoQueryDto): Promise<ItemAcervo[]> {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: q.filiadoId },
      select: { id: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');

    const [anexos, documentos, chavesNoAlvo] = await Promise.all([
      this.prisma.anexoDocumento.findMany({
        where: this.doFiliado(q.filiadoId),
        orderBy: { createdAt: 'asc' },
        include: {
          atendimento: { select: { id: true, numero: true, createdAt: true } },
          processo: { select: { id: true, numeroCNJ: true, titulo: true, classeProcessual: true } },
          compromisso: { select: { id: true, titulo: true, inicio: true } },
        },
      }),
      this.prisma.documento.findMany({
        where: { filiadoId: q.filiadoId },
        orderBy: { createdAt: 'asc' },
      }),
      this.chavesDisponiveisNoAlvo(q),
    ]);

    // Dedupe por chave: o cadastro entra primeiro (é a origem canônica quando o
    // arquivo veio de lá) e os anexos em ordem cronológica (o mais antigo é o
    // original; os demais são cópias puxadas).
    const porChave = new Map<string, ItemAcervo>();

    for (const d of documentos) {
      porChave.set(d.storageKey, {
        origemTipo: OrigemAcervo.CADASTRO,
        origemId: d.id,
        origemRegistroId: q.filiadoId,
        origemRotulo: `Cadastro do filiado · ${this.rotuloTipoDocumento(d.tipo)}`,
        storageKey: d.storageKey,
        nomeArquivo: d.titulo,
        tipoMime: d.mimeType ?? 'application/octet-stream',
        tamanhoBytes: d.tamanhoBytes,
        createdAt: d.createdAt,
        url: '',
        jaVinculado: chavesNoAlvo.has(d.storageKey),
      });
    }

    for (const a of anexos) {
      if (porChave.has(a.storageKey)) continue;
      const origem = this.rotularOrigemAnexo(a);
      porChave.set(a.storageKey, {
        origemTipo: origem.tipo,
        origemId: a.id,
        origemRegistroId: origem.registroId,
        origemRotulo: origem.rotulo,
        storageKey: a.storageKey,
        nomeArquivo: a.nomeArquivo,
        tipoMime: a.tipoMime,
        tamanhoBytes: a.tamanhoBytes,
        createdAt: a.createdAt,
        url: '',
        jaVinculado: chavesNoAlvo.has(a.storageKey),
      });
    }

    const itens = [...porChave.values()].sort(
      (x, y) => y.createdAt.getTime() - x.createdAt.getTime(),
    );
    // URL assinada só na resposta — permite pré-visualizar antes de puxar.
    return Promise.all(
      itens.map(async (i) => ({
        ...i,
        url: await this.storage.getSignedUrl(i.storageKey).catch(() => ''),
      })),
    );
  }

  /**
   * Vincula documentos do acervo ao registro atual SEM novo upload: cria linhas
   * novas apontando para a mesma chave de storage, guardando a procedência.
   *
   * Silenciosamente ignora o que já está disponível no registro (inclusive por
   * herança da triagem de origem) — puxar duas vezes não duplica nada.
   */
  async puxar(dto: PuxarAnexosDto, ctx: Ctx) {
    const alvo = await this.resolverAlvo(dto);
    if (!alvo.filiadoId) {
      throw new BadRequestException(
        'Este registro não tem filiado vinculado — não há acervo de onde puxar documentos.',
      );
    }

    // Só o que está no acervo DESTE filiado pode ser puxado: impede vincular o
    // documento de um filiado ao registro de outro passando um id qualquer.
    const acervo = await this.acervo({
      filiadoId: alvo.filiadoId,
      atendimentoId: dto.atendimentoId,
      processoId: dto.processoId,
      compromissoId: dto.compromissoId,
    });
    const porOrigem = new Map(acervo.map((i) => [`${i.origemTipo}:${i.origemId}`, i]));

    const escolhidos: ItemAcervo[] = [];
    for (const item of dto.itens) {
      const achado = porOrigem.get(`${item.origemTipo}:${item.origemId}`);
      if (!achado) {
        throw new BadRequestException('Documento fora do acervo deste filiado.');
      }
      if (achado.jaVinculado) continue; // já disponível aqui
      if (escolhidos.some((e) => e.storageKey === achado.storageKey)) continue;
      escolhidos.push(achado);
    }

    if (escolhidos.length === 0) {
      return { criados: [], ignorados: dto.itens.length };
    }

    // Um create por item (e não createMany) para devolver as linhas criadas —
    // a tela precisa saber exatamente o que entrou.
    const novos = await this.prisma.$transaction(
      escolhidos.map((i) =>
        this.prisma.anexoDocumento.create({
          data: {
            storageKey: i.storageKey,
            url: '', // regenerada a cada leitura (assinada/temporária no S3)
            nomeArquivo: i.nomeArquivo,
            tipoMime: i.tipoMime,
            tamanhoBytes: i.tamanhoBytes,
            atendimentoId: dto.atendimentoId || null,
            processoId: dto.processoId || null,
            compromissoId: dto.compromissoId || null,
            origemAnexoId: i.origemTipo === OrigemAcervo.CADASTRO ? null : i.origemId,
            origemDocumentoId: i.origemTipo === OrigemAcervo.CADASTRO ? i.origemId : null,
          },
        }),
      ),
    );

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'AnexoDocumento',
      entidadeId: alvo.registroId,
      descricao:
        `${escolhidos.length} documento(s) do acervo do filiado reaproveitado(s) em ${alvo.rotulo}: ` +
        escolhidos.map((e) => `"${e.nomeArquivo}"`).join(', '),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        ...alvo.meta,
        filiadoId: alvo.filiadoId,
        origens: escolhidos.map((e) => ({ tipo: e.origemTipo, id: e.origemId })),
        ignorados: dto.itens.length - escolhidos.length,
      },
    });

    const criados = await Promise.all(novos.map((a) => this.comUrlFresca(a)));
    return { criados, ignorados: dto.itens.length - escolhidos.length };
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

  /** Todo anexo que pertence, direta ou indiretamente, a um filiado. */
  private doFiliado(filiadoId: string): Prisma.AnexoDocumentoWhereInput {
    return {
      OR: [
        { atendimento: { filiadoId } },
        // Processo: filiado principal (atalho) OU parte no polo (N:N).
        { processo: { OR: [{ filiadoId }, { partes: { some: { filiadoId } } }] } },
        { compromisso: { filiadoId } },
      ],
    };
  }

  /** Valida que exatamente um vínculo foi informado, que ele existe, e o descreve. */
  private async resolverAlvo(alvo: Alvo) {
    const informados = [alvo.atendimentoId, alvo.processoId, alvo.compromissoId].filter(Boolean);
    if (informados.length !== 1) {
      throw new BadRequestException(
        'Informe exatamente um vínculo: atendimentoId, processoId OU compromissoId.',
      );
    }

    if (alvo.atendimentoId) {
      const at = await this.prisma.atendimento.findUnique({
        where: { id: alvo.atendimentoId },
        select: { id: true, numero: true, filiadoId: true },
      });
      if (!at) throw new BadRequestException('Atendimento inválido.');
      return {
        prefixo: `atendimentos/${at.id}`,
        meta: { atendimentoId: at.id },
        registroId: at.id,
        rotulo: `atendimento #${at.numero}`,
        filiadoId: at.filiadoId as string | null,
      };
    }

    if (alvo.compromissoId) {
      const c = await this.prisma.compromisso.findUnique({
        where: { id: alvo.compromissoId },
        select: { id: true, titulo: true, filiadoId: true },
      });
      if (!c) throw new BadRequestException('Atividade da agenda inválida.');
      return {
        prefixo: `compromissos/${c.id}`,
        meta: { compromissoId: c.id },
        registroId: c.id,
        rotulo: `atividade "${c.titulo}"`,
        filiadoId: c.filiadoId,
      };
    }

    const proc = await this.prisma.processo.findUnique({
      where: { id: alvo.processoId },
      select: {
        id: true, numeroCNJ: true, titulo: true, filiadoId: true,
        partes: { where: { principal: true }, select: { filiadoId: true }, take: 1 },
      },
    });
    if (!proc) throw new BadRequestException('Processo inválido.');
    return {
      prefixo: `processos/${proc.id}`,
      meta: { processoId: proc.id },
      registroId: proc.id,
      rotulo: `processo ${proc.numeroCNJ ?? proc.titulo ?? proc.id}`,
      filiadoId: proc.filiadoId ?? proc.partes[0]?.filiadoId ?? null,
    };
  }

  /**
   * Chaves já disponíveis no registro — as dele e as HERDADAS.
   *
   * A herança é a regra combinada com a triagem: um documento puxado no
   * atendimento aparece na consulta que nasceu daquele encaminhamento, então não
   * pode ser oferecido para puxar de novo na agenda.
   */
  private async chavesDisponiveisNoAlvo(alvo: Alvo): Promise<Set<string>> {
    const ors: Prisma.AnexoDocumentoWhereInput[] = [];
    if (alvo.atendimentoId) ors.push({ atendimentoId: alvo.atendimentoId });
    if (alvo.processoId) ors.push({ processoId: alvo.processoId });

    if (alvo.compromissoId) {
      ors.push({ compromissoId: alvo.compromissoId });
      const c = await this.prisma.compromisso.findUnique({
        where: { id: alvo.compromissoId },
        select: { atendimentoId: true, processoId: true },
      });
      if (c?.atendimentoId) ors.push({ atendimentoId: c.atendimentoId });
      if (c?.processoId) ors.push({ processoId: c.processoId });
    }

    if (ors.length === 0) return new Set();
    const linhas = await this.prisma.anexoDocumento.findMany({
      where: { OR: ors },
      select: { storageKey: true },
    });
    return new Set(linhas.map((l) => l.storageKey));
  }

  /** Rótulo humano de onde o anexo está hoje ("Atendimento #393 · 12/03/2026"). */
  private rotularOrigemAnexo(a: {
    atendimento: { id: string; numero: number; createdAt: Date } | null;
    processo: { id: string; numeroCNJ: string | null; titulo: string | null; classeProcessual: string | null } | null;
    compromisso: { id: string; titulo: string; inicio: Date } | null;
  }): { tipo: OrigemAcervo; registroId: string | null; rotulo: string } {
    if (a.atendimento) {
      return {
        tipo: OrigemAcervo.ATENDIMENTO,
        registroId: a.atendimento.id,
        rotulo: `Atendimento #${a.atendimento.numero} · ${this.dataBr(a.atendimento.createdAt)}`,
      };
    }
    if (a.processo) {
      const nome =
        a.processo.numeroCNJ ?? a.processo.titulo ?? a.processo.classeProcessual ?? 'sem número';
      return { tipo: OrigemAcervo.PROCESSO, registroId: a.processo.id, rotulo: `Processo ${nome}` };
    }
    if (a.compromisso) {
      return {
        tipo: OrigemAcervo.COMPROMISSO,
        registroId: a.compromisso.id,
        rotulo: `Agenda · ${a.compromisso.titulo} (${this.dataBr(a.compromisso.inicio)})`,
      };
    }
    return { tipo: OrigemAcervo.ATENDIMENTO, registroId: null, rotulo: 'Origem desconhecida' };
  }

  private rotuloTipoDocumento(tipo: string): string {
    const mapa: Record<string, string> = {
      TERMO_CONSENTIMENTO: 'Termo de consentimento',
      FICHA_FILIACAO: 'Ficha de filiação',
      CONTRATO: 'Contrato',
      DOCUMENTO_PESSOAL: 'Documento pessoal',
      OUTRO: 'Outro',
    };
    return mapa[tipo] ?? tipo;
  }

  private dataBr(d: Date): string {
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
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
