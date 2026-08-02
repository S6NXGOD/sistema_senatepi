import { Body, Controller, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  IsArray, IsInt, IsOptional, IsString, IsBoolean, IsEnum, Max, Min, MaxLength,
} from 'class-validator';
import { ModoVotacao, UserRole } from '@prisma/client';
import { VotacaoService } from './votacao.service';
import { SorteioService } from './sorteio.service';
import { DossieEventoService } from './dossie-evento.service';
import { CertificadoService } from './certificado.service';
import { EncerramentoService } from './encerramento.service';
import { PresencaListaService } from './presenca-lista.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

class CriarPautaDto {
  @IsString() @MaxLength(300) titulo!: string;
  @IsOptional() @IsString() @MaxLength(2000) descricao?: string;
  /** `[{ id, rotulo }]` — validado em `VotacaoService.validarOpcoes`. */
  @IsArray() opcoes!: unknown[];
  @IsOptional() @IsEnum(ModoVotacao) modo?: ModoVotacao;
  @IsOptional() @IsInt() @Min(1) quorumMinimo?: number;
  @IsOptional() @IsInt() @Min(0) ordem?: number;
}

class SortearDto {
  @IsString() @MaxLength(200) titulo!: string;
  @IsOptional() @IsString() @MaxLength(200) premio?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) quantidade?: number;
  @IsOptional() @IsBoolean() somenteAdimplentes?: boolean;
}

class VotarDto {
  /** Credencial do participante — devolvida no check-in. */
  @IsString() presencaId!: string;
  @IsString() opcaoId!: string;
}

/**
 * MESA DIRETORA — quem conduz a assembleia.
 *
 * Abrir e encerrar votação, criar pautas e sortear são atos de condução, não de
 * participação: ficam com ADMINISTRADOR e COORDENAÇÃO.
 */
@ApiTags('plenario')
@ApiBearerAuth()
@Controller('eventos/:eventoId/plenario')
export class PlenarioAdminController {
  constructor(
    private readonly votacao: VotacaoService,
    private readonly sorteio: SorteioService,
    private readonly dossie: DossieEventoService,
    private readonly certificado: CertificadoService,
    private readonly encerramento: EncerramentoService,
    private readonly presencaLista: PresencaListaService,
  ) {}

  @Get('pautas')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  listarPautas(@Param('eventoId') eventoId: string) {
    return this.votacao.listar(eventoId);
  }

  @Post('pautas')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  criarPauta(
    @Param('eventoId') eventoId: string,
    @Body() dto: CriarPautaDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.votacao.criar(eventoId, dto, autor);
  }

  @Post('pautas/:pautaId/abrir')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  abrir(@Param('pautaId') pautaId: string, @CurrentUser('nome') autor: string) {
    return this.votacao.abrir(pautaId, autor);
  }

  /** Encerra e devolve a apuração — é o momento em que o resultado existe. */
  @Post('pautas/:pautaId/encerrar')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  encerrar(@Param('pautaId') pautaId: string, @CurrentUser('nome') autor: string) {
    return this.votacao.encerrar(pautaId, autor);
  }

  @Get('pautas/:pautaId/apuracao')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  apurar(@Param('pautaId') pautaId: string) {
    return this.votacao.apurar(pautaId);
  }

  @Post('sorteios')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  sortear(
    @Param('eventoId') eventoId: string,
    @Body() dto: SortearDto,
    @CurrentUser('nome') autor: string,
  ) {
    return this.sorteio.sortear(eventoId, dto, autor);
  }

  @Get('sorteios')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  listarSorteios(@Param('eventoId') eventoId: string) {
    return this.sorteio.listar(eventoId);
  }

  /** Reexecuta a seed e confirma que o resultado gravado é o que ela produz. */
  @Get('sorteios/:sorteioId/conferir')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  conferir(@Param('sorteioId') sorteioId: string) {
    return this.sorteio.conferir(sorteioId);
  }

  /** Emite (ou reemite) o dossiê e o arquiva no storage. */
  @Post('dossie')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  emitirDossie(@Param('eventoId') eventoId: string, @CurrentUser('nome') autor: string) {
    return this.dossie.gerar(eventoId, autor);
  }

  @Get('dossie.pdf')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  @Header('Content-Type', 'application/pdf')
  async baixarDossie(@Param('eventoId') eventoId: string, @Res() res: Response) {
    const pdf = await this.dossie.baixar(eventoId);
    res.setHeader('Content-Disposition', `inline; filename="dossie-${eventoId}.pdf"`);
    res.send(pdf);
  }

  // -------------------------------------------------------------------------
  // Encerramento — o momento em que a assembleia vira registro
  // -------------------------------------------------------------------------

  /** O que vai acontecer se encerrar agora — alimenta a confirmação. */
  @Get('encerramento/previa')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  previaEncerramento(@Param('eventoId') eventoId: string) {
    return this.encerramento.previa(eventoId);
  }

  /**
   * Encerra a assembleia: fecha votações abertas, trava o check-in e emite o
   * dossiê. É POST, e não DELETE, porque não apaga nada — consolida.
   */
  @Post('encerrar')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  encerrarAssembleia(
    @Param('eventoId') eventoId: string,
    @CurrentUser('nome') autor: string,
  ) {
    return this.encerramento.encerrar(eventoId, autor);
  }

  /** Resumo do que aconteceu — a resposta para "e aí, o que eu tenho agora?". */
  @Get('resumo')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  resumo(@Param('eventoId') eventoId: string) {
    return this.encerramento.resumo(eventoId);
  }

  /**
   * Lista de presença para a TELA.
   *
   * CPF mascarado e SEM IP. O IP tem finalidade probatória, não operacional:
   * ele consta do dossiê, que é documento de circulação restrita, e não de uma
   * tela que fica aberta no telão durante a assembleia (LGPD, art. 6º, III —
   * necessidade).
   */
  @Get('presencas')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  presencas(@Param('eventoId') eventoId: string) {
    return this.presencaLista.listar(eventoId);
  }

  /**
   * A mesma lista em CSV.
   *
   * O dossiê é bom para arquivo e ruim para trabalhar. A secretaria vai querer
   * cruzar presença com quem pagou, com quem faltou, com quem votou — e isso
   * se faz numa planilha, não num PDF.
   */
  @Get('presencas.csv')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async presencasCsv(@Param('eventoId') eventoId: string, @Res() res: Response) {
    const csv = await this.presencaLista.csv(eventoId);
    res.setHeader('Content-Disposition', `attachment; filename="presenca-${eventoId}.csv"`);
    // BOM UTF-8: sem ele o Excel em português abre "JOSÉ" como "JOSÃ‰".
    res.send('﻿' + csv);
  }

  /** Quem tem direito a certificado, já com o código de verificação. */
  @Get('certificados')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  certificados(@Param('eventoId') eventoId: string) {
    return this.certificado.elegiveis(eventoId);
  }

  @Get('certificados/:presencaId.pdf')
  @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  @Header('Content-Type', 'application/pdf')
  async baixarCertificado(
    @Param('eventoId') eventoId: string,
    @Param('presencaId') presencaId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.certificado.gerar(eventoId, presencaId);
    res.setHeader('Content-Disposition', `inline; filename="certificado-${presencaId}.pdf"`);
    res.send(pdf);
  }
}

/**
 * Conferência pública de certificado.
 *
 * Rota SEM login de propósito: quem recebe o documento — hospital,
 * universidade, banca de concurso — precisa validar sem ter conta no sistema do
 * sindicato. Certificado que só o emissor consegue conferir não vale como
 * comprovante.
 *
 * Devolve apenas nome, evento, data e carga horária: o suficiente para
 * confirmar o que o papel afirma, e nada além disso.
 */
@ApiTags('certificados')
@Public()
@Controller('certificados')
export class CertificadoPublicoController {
  constructor(private readonly certificado: CertificadoService) {}

  @Get('verificar/:codigo')
  verificar(@Param('codigo') codigo: string) {
    return this.certificado.verificar(codigo);
  }
}

/**
 * PARTICIPANTE — quem está na assembleia, sem login.
 *
 * A credencial é o `presencaId`, entregue no check-in. Sem ele não há voto:
 * é o que amarra a urna ao quórum, porque não existe voto de quem não consta
 * como presente.
 */
@ApiTags('plenario-publico')
@Public()
@Controller('sala/:eventoId')
export class PlenarioPublicoController {
  constructor(
    private readonly votacao: VotacaoService,
    private readonly sorteio: SorteioService,
  ) {}

  /**
   * Estado ao vivo da sala. É este endpoint que a tela consulta a cada 3s.
   *
   * Enquanto a pauta está ABERTA, devolve só quantos já votaram — nunca o
   * placar. Resultado parcial influencia quem ainda não votou.
   */
  @Get('ao-vivo')
  async aoVivo(
    @Param('eventoId') eventoId: string,
    @Query('presencaId') presencaId?: string,
  ) {
    const [pauta, sorteios] = await Promise.all([
      this.votacao.pautaAoVivo(eventoId, presencaId),
      this.sorteio.listar(eventoId),
    ]);
    return {
      pauta,
      ultimoSorteio: sorteios[0] ?? null,
      // Muda sempre que algo relevante muda: a tela só redesenha quando a
      // versão avança, em vez de a cada resposta do polling.
      versao: [
        pauta?.id ?? '-',
        pauta?.status ?? '-',
        pauta?.votantes ?? '-',
        sorteios[0]?.id ?? '-',
      ].join('|'),
    };
  }

  @Post('votar/:pautaId')
  votar(@Param('pautaId') pautaId: string, @Body() dto: VotarDto) {
    return this.votacao.votar({
      pautaId,
      presencaId: dto.presencaId,
      opcaoId: dto.opcaoId,
    });
  }
}
