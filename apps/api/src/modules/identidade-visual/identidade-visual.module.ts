import { StorageService } from '@core/infra';
import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param,
  ParseFilePipeBuilder, Post, Put, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { AcaoAuditoria } from '@prisma/client';
import { IsOptional, IsString, Matches } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * IDENTIDADE VISUAL DA INSTALAÇÃO — cor institucional e logos.
 *
 * Existia só em arquivo: a paleta no `tenant.config.ts` e quatro PNGs em
 * `/public`. Trocar a cor de um sindicato exigia programador, commit e deploy.
 *
 * O ARQUIVO CONTINUA SENDO O PADRÃO. Esta tabela é uma sobreposição: linha
 * ausente, campo nulo ou banco fora do ar, e a instalação abre com a marca
 * compilada. Foi de propósito — a identidade visual não pode ficar refém de uma
 * consulta.
 */

/** Os quatro arquivos, e a coluna de cada um. */
const SLOTS = {
  'horizontal-cor': 'logoHorizontalCorKey',
  'horizontal-branco': 'logoHorizontalBrancoKey',
  'vertical-cor': 'logoVerticalCorKey',
  'vertical-branco': 'logoVerticalBrancoKey',
  // Não é um logo: é o quadrado da aba do navegador e do app instalado.
  // Entra na mesma tabela porque é a mesma pergunta — "qual é a marca desta
  // instalação?" — e separar em outro lugar só criaria uma segunda tela.
  icone: 'iconeKey',
} as const;

type Slot = keyof typeof SLOTS;

const ID_UNICO = 'unica';
const LOGO_TAMANHO_MAX = 2 * 1024 * 1024; // 2 MB — é um logo, não uma foto

class SalvarIdentidadeDto {
  @ApiProperty({ example: '#0F4C81', description: 'Cor institucional em hexadecimal.' })
  @IsOptional()
  @IsString()
  /**
   * Só a cor BASE é aceita. Os dez tons são derivados dela, com contraste
   * conferido — receber os dez do cliente devolveria o problema que a
   * derivação existe para resolver: um botão primário ilegível.
   */
  @Matches(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: 'Cor inválida. Use hexadecimal, por exemplo #0F4C81.',
  })
  corPrimaria?: string | null;
}

export interface IdentidadeVisualResposta {
  corPrimaria: string | null;
  logos: Record<Slot, string | null>;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

@Injectable()
export class IdentidadeVisualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * O que a instalação tem gravado. Nulo em tudo = nunca mexeram, e o front
   * usa a marca compilada.
   *
   * NÃO EXPLODE se a consulta falhar: a identidade visual é pedida no
   * carregamento de toda página, inclusive na tela de login. Um erro aqui
   * derrubaria o acesso ao sistema por causa de uma cor.
   */
  async obter(): Promise<IdentidadeVisualResposta> {
    const vazio: IdentidadeVisualResposta = {
      corPrimaria: null,
      logos: {
        'horizontal-cor': null, 'horizontal-branco': null,
        'vertical-cor': null, 'vertical-branco': null,
        icone: null,
      },
      atualizadoEm: null,
      atualizadoPor: null,
    };

    try {
      const linha = await this.prisma.identidadeVisual.findUnique({ where: { id: ID_UNICO } });
      if (!linha) return vazio;

      const logos = { ...vazio.logos };
      await Promise.all(
        (Object.keys(SLOTS) as Slot[]).map(async (slot) => {
          const chave = linha[SLOTS[slot]];
          if (chave) logos[slot] = await this.storage.getSignedUrl(chave, 3600);
        }),
      );

      return {
        corPrimaria: linha.corPrimaria,
        logos,
        atualizadoEm: linha.atualizadoEm?.toISOString() ?? null,
        atualizadoPor: linha.atualizadoPor,
      };
    } catch {
      return vazio;
    }
  }

  async salvarCor(cor: string | null, autor?: string): Promise<IdentidadeVisualResposta> {
    // Normaliza para `#RRGGBB` maiúsculo: o banco guarda uma forma só, então
    // comparar e exibir não depende de como a pessoa digitou.
    const normalizada = cor ? normalizarHex(cor) : null;
    if (cor && !normalizada) throw new BadRequestException('Cor inválida.');

    await this.prisma.identidadeVisual.upsert({
      where: { id: ID_UNICO },
      create: { id: ID_UNICO, corPrimaria: normalizada, atualizadoPor: autor },
      update: { corPrimaria: normalizada, atualizadoPor: autor },
    });

    await this.audit.registrar({
      acao: AcaoAuditoria.UPDATE,
      entidade: 'IdentidadeVisual',
      entidadeId: ID_UNICO,
      descricao: normalizada
        ? `Cor institucional definida como ${normalizada}`
        : 'Cor institucional voltou ao padrão da instalação',
      metadata: { corPrimaria: normalizada },
    });

    return this.obter();
  }

  async salvarLogo(slot: Slot, arquivo: Express.Multer.File, autor?: string) {
    const coluna = SLOTS[slot];
    const chave = `identidade/${slot}-${Date.now()}.png`;
    await this.storage.upload(chave, arquivo.buffer, arquivo.mimetype);

    const anterior = await this.prisma.identidadeVisual.findUnique({ where: { id: ID_UNICO } });

    await this.prisma.identidadeVisual.upsert({
      where: { id: ID_UNICO },
      create: { id: ID_UNICO, [coluna]: chave, atualizadoPor: autor },
      update: { [coluna]: chave, atualizadoPor: autor },
    });

    // O arquivo antigo sai do storage DEPOIS de a nova chave estar gravada:
    // apagar antes deixaria a instalação sem logo se a gravação falhasse.
    const chaveAnterior = anterior?.[coluna];
    if (chaveAnterior) await this.storage.delete(chaveAnterior).catch(() => undefined);

    await this.audit.registrar({
      acao: AcaoAuditoria.UPDATE,
      entidade: 'IdentidadeVisual',
      entidadeId: ID_UNICO,
      descricao: `Logo "${slot}" substituído`,
      metadata: { logo: slot },
    });

    return this.obter();
  }

  /** Volta ao arquivo de `/public`. Não é "apagar o logo" — é parar de sobrepor. */
  async removerLogo(slot: Slot, autor?: string) {
    const coluna = SLOTS[slot];
    const atual = await this.prisma.identidadeVisual.findUnique({ where: { id: ID_UNICO } });
    const chave = atual?.[coluna];
    if (!chave) return this.obter();

    await this.prisma.identidadeVisual.update({
      where: { id: ID_UNICO },
      data: { [coluna]: null, atualizadoPor: autor },
    });
    await this.storage.delete(chave).catch(() => undefined);

    await this.audit.registrar({
      acao: AcaoAuditoria.UPDATE,
      entidade: 'IdentidadeVisual',
      entidadeId: ID_UNICO,
      descricao: `Logo "${slot}" voltou ao arquivo padrão da instalação`,
      metadata: { logoRemovido: slot },
    });

    return this.obter();
  }
}

/** `#abc`, `abc`, `#AABBCC` → `#AABBCC`. `null` quando não é cor. */
function normalizarHex(valor: string): string | null {
  const limpo = valor.trim().replace(/^#/, '');
  const completo = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  return /^[0-9a-fA-F]{6}$/.test(completo) ? `#${completo.toUpperCase()}` : null;
}

@ApiTags('Identidade Visual')
@Controller('identidade-visual')
export class IdentidadeVisualController {
  constructor(private readonly service: IdentidadeVisualService) {}

  /**
   * PÚBLICA de propósito: a tela de LOGIN precisa da marca, e ali ninguém está
   * autenticado. O que ela devolve é a cor e o logo do sindicato — informação
   * que qualquer visitante já vê na tela.
   *
   * Sem `@ModuloTenant`: identidade visual não é módulo, é a instalação.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Cor institucional e logos desta instalação.' })
  obter() {
    return this.service.obter();
  }

  @ApiBearerAuth()
  @Roles('ADMINISTRADOR')
  @Put()
  @ApiOperation({ summary: 'Define a cor institucional (os dez tons são derivados dela).' })
  salvar(@Body() dto: SalvarIdentidadeDto, @CurrentUser() usuario?: { nome?: string }) {
    return this.service.salvarCor(dto.corPrimaria ?? null, usuario?.nome);
  }

  @ApiBearerAuth()
  @Roles('ADMINISTRADOR')
  @Post('logo/:slot')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: LOGO_TAMANHO_MAX } }))
  @ApiOperation({ summary: 'Envia um dos quatro logos.' })
  enviarLogo(
    @Param('slot') slot: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        // PNG e SVG: logo precisa de fundo transparente, e JPEG não tem.
        .addFileTypeValidator({ fileType: /^image\/(png|svg\+xml|webp)$/ })
        .addMaxSizeValidator({ maxSize: LOGO_TAMANHO_MAX })
        .build(),
    )
    arquivo: Express.Multer.File,
    @CurrentUser() usuario?: { nome?: string },
  ) {
    return this.service.salvarLogo(validarSlot(slot), arquivo, usuario?.nome);
  }

  @ApiBearerAuth()
  @Roles('ADMINISTRADOR')
  @Delete('logo/:slot')
  @ApiOperation({ summary: 'Remove o logo enviado e volta ao arquivo padrão da instalação.' })
  removerLogo(@Param('slot') slot: string, @CurrentUser() usuario?: { nome?: string }) {
    return this.service.removerLogo(validarSlot(slot), usuario?.nome);
  }
}

function validarSlot(slot: string): Slot {
  if (!(slot in SLOTS)) {
    throw new BadRequestException(
      `Logo desconhecido: "${slot}". Aceitos: ${Object.keys(SLOTS).join(', ')}.`,
    );
  }
  return slot as Slot;
}

@Module({
  controllers: [IdentidadeVisualController],
  providers: [IdentidadeVisualService],
  exports: [IdentidadeVisualService],
})
export class IdentidadeVisualModule {}
