import {
  BadRequestException,
  CanActivate,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Logger,
  NotFoundException,
  Body,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JOB_DJEN_SYNC, comTravaDeJob } from '@core/infra';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OrigemSincronizacao } from '@prisma/client';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { OperacaoDeSistema } from '../../common/permissions/operacao-de-sistema.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { DjenService } from './djen.service';
import { DjenSyncService } from './djen-sync.service';
import { DjenBuscaService } from './djen-busca.service';
import { CaixaDePropostasService } from './caixa-de-propostas.service';
import { CorrelacaoService } from './correlacao.service';

/**
 * Interruptor da integração com o DJEN.
 *
 * Desligada, as rotas respondem 404 e não 403 — mesma semântica de
 * `DuplicidadeAtivaGuard`: guardar o link não adianta porque a porta não
 * existe. Ligar ou desligar é mudar `DJEN_INTEGRACAO` no ambiente e reiniciar,
 * sem alterar código e sem novo build.
 */
/**
 * A JANELA DA COLHEITA DE HISTÓRICO.
 *
 * A varredura diária olha 3 dias, e basta: quem está no acervo também é
 * consultado por NPU, e essa consulta traz o histórico inteiro do processo. Mas
 * ação NOVA — a que ainda não está cadastrada — só aparece pela busca por OAB,
 * que é limitada pela janela: um processo do sindicato distribuído há dois meses
 * e quieto nos últimos três dias é invisível para sempre.
 *
 * O parâmetro existe para a passada única que corrige isso. Opcional de
 * propósito: sem ele, o botão "Buscar agora" de sempre continua barato.
 */
class VarrerDjenQueryDto {
  @ApiPropertyOptional({
    description: 'Dias de histórico a varrer (1 a 180). Sem isto, usa a janela diária.',
    example: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  dias?: number;
}

@Injectable()
export class DjenAtivoGuard implements CanActivate {
  constructor(private readonly djen: DjenService) {}

  canActivate(): boolean {
    if (!this.djen.integracaoAtiva) {
      throw new NotFoundException('Cannot access /api/djen');
    }
    return true;
  }
}

/**
 * Filtros da busca no acervo de publicações.
 *
 * DECLARADO ANTES DO CONTROLLER, e isso não é estilo: com
 * `emitDecoratorMetadata`, o decorador do parâmetro guarda uma REFERÊNCIA à
 * classe avaliada na definição do método. Classe declarada depois passa no
 * `tsc --noEmit` e derruba a aplicação no carregamento do módulo com
 * "Cannot access 'X' before initialization" — já aconteceu neste projeto.
 */
export class BuscaPublicacoesDto {
  @ApiPropertyOptional({ description: 'Teor, número do processo, nome da parte, advogado ou OAB.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ description: 'Slug da providência classificada.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  providencia?: string;

  @ApiPropertyOptional({ description: 'Sigla do tribunal (TRT22, TJPI…).' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  tribunal?: string;

  @ApiPropertyOptional({
    enum: ['COM_TAREFA', 'SEM_TAREFA', 'SEM_DECISAO'],
    description: 'SEM_DECISAO: com providência, sem tarefa e sem motivo de dispensa.',
  })
  @IsOptional()
  @IsIn(['COM_TAREFA', 'SEM_TAREFA', 'SEM_DECISAO'])
  situacao?: 'COM_TAREFA' | 'SEM_TAREFA' | 'SEM_DECISAO';

  @ApiPropertyOptional({ description: 'Só as disponibilizadas nos últimos N dias (1 a 3650).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  dias?: number;

  @ApiPropertyOptional({ description: 'Só as publicações dos processos de quem está pedindo.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  meus?: 'true' | 'false';

  /**
   * FILTRAR PELO ADVOGADO CITADO NO ATO — e por que aqui o id na query pode.
   *
   * A nota do `meus` diz que aceitar um `advogadoId` deixaria qualquer um ler o
   * acervo de um colega mudando a URL. Vale para AQUELE parâmetro, que ESCOPA a
   * consulta — ele decide o universo.
   *
   * Este RECORTA dentro do universo que a pessoa já pode ver: a lista completa
   * das publicações do acervo, com o nome e a foto dos advogados citados
   * impressos em cada cartão. Filtrar por um deles não revela nada que rolar a
   * página não revelasse — só evita rolar.
   */
  @ApiPropertyOptional({ description: 'Só as publicações que CITAM este advogado (por OAB).' })
  @IsOptional()
  @IsString()
  citaAdvogado?: string;

  @ApiPropertyOptional({
    enum: ['TUDO', 'AUTOR', 'REU', 'NUMERO', 'TEOR'],
    description: 'ONDE procurar o termo. Padrão TUDO. Ver o comentário do serviço.',
  })
  @IsOptional()
  @IsIn(['TUDO', 'AUTOR', 'REU', 'NUMERO', 'TEOR'])
  onde?: 'TUDO' | 'AUTOR' | 'REU' | 'NUMERO' | 'TEOR';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
}

/**
 * Validade da trava da varredura pedida à mão — a mesma do robô das 05:00.
 *
 * A pior rodada manual é a colheita de 180 dias (~15 minutos de cota). O que o
 * prazo precisa garantir é nunca expirar com a varredura ainda correndo; se o
 * servidor cair no meio, a trava se solta sozinha nesse tempo.
 */
const TTL_DA_VARREDURA_MANUAL_MIN = 180;

/** A frase do 409: o que está acontecendo, o que fazer e quando destrava sozinho. */
export const VARREDURA_DO_DIARIO_OCUPADA =
  'A varredura do Diário já está rodando (a do robô das 5h ou uma pedida por outra pessoa). ' +
  'Tente de novo quando ela terminar. Se o servidor caiu no meio de uma varredura, ' +
  'a trava se solta sozinha em até 3 horas.';

@ApiTags('djen')
@ApiBearerAuth()
@Modulo('processos')
@Controller('djen')
export class DjenController {
  private readonly logger = new Logger(DjenController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly djen: DjenService,
    private readonly sync: DjenSyncService,
    private readonly busca: DjenBuscaService,
    private readonly caixa: CaixaDePropostasService,
    private readonly correlacao: CorrelacaoService,
  ) {}

  /*
    A CAIXA DE ENTRADA DO ADVOGADO.

    Vive em `@Modulo('processos')` como o resto do DJEN, e o ESCOPO é sempre o
    usuário autenticado: `listar` filtra pelo id de quem pergunta. Quem coordena
    pode pedir a caixa inteira, e isso é uma decisão de negócio, não de
    permissão — a coordenação precisa ver a proposta órfã, cujo dono saiu da
    equipe, ou ela some do mundo.
  */
  @Get('propostas')
  @ApiOperation({ summary: 'Propostas de tarefa esperando decisão do advogado.' })
  listarPropostas(
    @CurrentUser() user: AuthUser,
    @Query('todas') todas?: string,
  ) {
    return this.caixa.listar(user.id, todas === '1' && podeVerTodasAsPropostas(user));
  }

  @Get('propostas/contagem')
  @ApiOperation({ summary: 'Quantas propostas esperam decisão — o número do selo.' })
  async contarPropostas(@CurrentUser() user: AuthUser, @Query('todas') todas?: string) {
    return { total: await this.caixa.contar(user.id, todas === '1' && podeVerTodasAsPropostas(user)) };
  }

  /**
   * ACEITAR é POST porque CRIA a atividade — e o verbo importa para o
   * `PermissionsGuard`, que resolve o nível por método HTTP: GET vira
   * VISUALIZAR, POST vira EDITAR. Aceitar e recusar exigem EDITAR em processos,
   * que é o certo: quem só consulta não mexe na agenda de ninguém.
   */
  @Post('propostas/:id/aceitar')
  @ApiOperation({ summary: 'Aceita a proposta: vira atividade na agenda de quem aceitou.' })
  aceitarProposta(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.caixa.aceitar(id, user.id);
  }

  @Post('propostas/:id/recusar')
  @ApiOperation({ summary: 'Recusa a proposta: não vira atividade, e o motivo fica gravado.' })
  recusarProposta(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: { motivo?: string },
  ) {
    return this.caixa.recusar(id, user.id, dto?.motivo);
  }

  /**
   * Estado da integração — a ÚNICA rota que responde com o DJEN desligado.
   *
   * O front pergunta aqui em vez de carregar a decisão embutida: as
   * `NEXT_PUBLIC_*` do Next são resolvidas no build, então uma flag no front
   * exigiria rebuildar o serviço web só para desligar. Perguntando à API, o
   * desligamento vale na hora.
   */
  @Get('status')
  async status() {
    const ativo = this.djen.integracaoAtiva;
    return {
      ativo,
      /** O CDN do CNJ está recusando consultas vindas deste servidor. */
      bloqueadoNaOrigem: this.djen.bloqueadoNaOrigem,
      janelaDias: this.djen.janelaDias,
      publicacoes: ativo ? await this.prisma.comunicacaoDjen.count() : 0,
      /**
       * Advogados que a varredura por OAB alcança — zero aqui explica silêncio.
       *
       * Contava `oab: { not: null }`, e a OAB gravada como texto vazio entrava
       * na conta sem ser consultada nunca. Agora é a MESMA lista que a
       * varredura usa, então o número da tela e o do robô não divergem.
       */
      advogadosComOab: ativo ? (await this.sync.advogadosConsultaveis()).length : 0,
      /**
       * QUEM O ROBÔ NÃO ENXERGA, com nome — para a tela de Usuários mostrar a
       * linha na pessoa certa (14/09/2026).
       *
       * A contagem só ia para o log da rodada, e a frase ATENÇÃO sumia quando
       * havia qualquer falha. A Dra. Lara Cortez está sem OAB desde 07/09 e
       * nada na tela dizia isso. Vazio com a integração desligada: no SINDSERM
       * não há Diário, e a linha âmbar lá seria alarme sobre nada.
       */
      advogadosSemOab: ativo ? await this.sync.advogadosSemOab() : [],
    };
  }

  /**
   * DE ONDE VÊM AS INTIMAÇÕES DESTE PROCESSO — a linha de estado da aba
   * Publicações (14/09/2026).
   *
   * Responde "se sair um ato amanhã, ele chega?": pela OAB de quem, pelo número
   * com que frequência, e quando foi a última consulta. Calculada no servidor,
   * porque são três fatos que só ele tem juntos.
   *
   * DECLARADA ANTES de `publicacoes/:id` e `processo/:processoId`, como as outras
   * rotas literais deste controller (memória das rotas que colidem). Com três
   * segmentos ela não casa com `processo/:processoId`, mas a ordem é a regra da
   * casa, e o spec `rotas-que-colidem` confere.
   */
  @Get('processo/:processoId/cobertura')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Como o Diário acompanha este processo: OAB da equipe e consulta pelo número.' })
  async coberturaDoProcesso(@Param('processoId') processoId: string) {
    const cobertura = await this.sync.coberturaDoProcesso(processoId);
    if (!cobertura) throw new NotFoundException('Processo não encontrado.');
    return cobertura;
  }

  /**
   * BUSCA NO ACERVO — a tela que faltava.
   *
   * Declarada ANTES de `processo/:processoId` de propósito: o Nest casa rotas
   * na ordem de declaração, e um `@Get('processo/:x')` acima engoliria
   * `/djen/publicacoes` como se "publicacoes" fosse um id.
   */
  @Get('publicacoes')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Procura no que já foi baixado: teor, parte, advogado, OAB ou NPU.' })
  buscar(@Query() filtro: BuscaPublicacoesDto, @CurrentUser() user: AuthUser) {
    /**
     * O ESCOPO VEM DO TOKEN, NUNCA DO CLIENTE.
     *
     * O parâmetro é um booleano — "quero só os meus" — e o id de quem são "os
     * meus" sai do usuário autenticado. Aceitar um `advogadoId` na query
     * deixaria qualquer um ler o acervo de qualquer colega mudando a URL.
     */
    return this.busca.buscar({
      ...filtro,
      meusProcessosDe: filtro.meus === 'true' ? user.id : undefined,
    });
  }

  /** Tribunais e providências presentes no acervo — alimenta os filtros. */
  @Get('publicacoes/facetas')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Valores disponíveis para filtrar a busca.' })
  facetas() {
    return this.busca.facetas();
  }

  /**
   * UMA PUBLICAÇÃO, COM O TEOR — para ler sem sair de onde se está.
   *
   * O painel listava "Analisar intimação · somos autor · sem tarefa" e, ao
   * clicar, jogava a pessoa na ficha do processo. O ato em si — o que o juiz
   * escreveu, que é a única coisa capaz de responder "isto é urgente?" — ficava
   * a mais dois cliques de distância. Quem lê o painel de manhã quer decidir
   * ali: é sério, vira tarefa, ou é despacho de expediente.
   *
   * DEPOIS de `publicacoes/facetas` na ordem de declaração, senão o Nest casa
   * "facetas" como se fosse um id — o mesmo cuidado que o comentário de
   * `publicacoes` já documenta.
   */
  @Get('publicacoes/:id')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Uma publicação com o teor completo.' })
  async umaPublicacao(@Param('id') id: string) {
    const c = await this.prisma.comunicacaoDjen.findUnique({
      where: { id },
      select: {
        id: true, siglaTribunal: true, tipoComunicacao: true, tipoDocumento: true,
        nomeOrgao: true, nomeClasse: true, meio: true, link: true, texto: true,
        dataDisponibilizacao: true, providencia: true, prazoMencionadoDias: true,
        compromissoId: true, tarefaDispensadaMotivo: true,
        numeroProcesso: true, destinatarios: true, advogados: true,
        processo: { select: { id: true, numeroCNJ: true } },
        compromisso: { select: { id: true, titulo: true, status: true, inicio: true } },
      },
    });
    if (!c) throw new NotFoundException('Publicação não encontrada.');
    return c;
  }

  /**
   * "ISTO PRECISA VIRAR TAREFA" — em um toque, de onde a pessoa já está.
   *
   * O robô só agenda o que consegue provar: publicação com providência
   * reconhecida e dentro da janela. O resto fica marcado "sem tarefa" no painel
   * e dependia de alguém abrir o processo, ir na agenda e digitar tudo de novo
   * — quatro telas para uma decisão de um segundo, que é como uma intimação
   * vira prazo perdido.
   *
   * REUSA `criarAtividadeDaProposta`, o mesmo caminho da caixa de entrada: a
   * regra de título, prazo e descrição mora num lugar só. Escrever a criação
   * aqui de novo seria a quinta cópia de uma regra que já divergiu antes.
   *
   * O DONO É O DO CASO, não quem clicou. Clicar aqui é dizer "isto precisa ser
   * feito", não "eu faço" — e o dono do caso é o `principal` de
   * `processos_advogados`, que bate em 131 de 131 processos. Quem quiser puxar
   * para si tem o botão "Assumir" na própria atividade.
   *
   * IDEMPOTENTE: se a publicação já tem tarefa aberta, devolve a que existe em
   * vez de criar a segunda. Dois toques no mesmo item são a coisa mais provável
   * de acontecer numa lista.
   */
  /**
   * A PRÉVIA DA TAREFA — o que a publicação VAI virar, sem virar.
   *
   * "Ao clicar em Criar tarefa vai direto para criar tarefa mas não tenho nem um
   * preview de como ela vai ficar." Data, urgência e dono são decididos pelo
   * sistema; criar às cegas é pedir confiança e depois conferência.
   *
   * Devolve o MESMO objeto que a criação usa (`planejarAtividade`), então o que
   * a tela mostra é literalmente o que vai ser gravado. `null` significa "não há
   * o que planejar" — a tela explica em vez de oferecer um botão que falharia.
   */
  @Get('publicacoes/:id/previa-da-tarefa')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'O que a publicação vira, sem criar nada.' })
  previaDaTarefa(@Param('id') id: string) {
    return this.correlacao.previaDaAtividade(id);
  }

  @Post('publicacoes/:id/tarefa')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Cria (ou devolve) a atividade da publicação, para o dono do caso.' })
  async tarefaDaPublicacao(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const c = await this.prisma.comunicacaoDjen.findUnique({
      where: { id },
      select: {
        id: true, processoId: true, providencia: true,
        tarefaPropostaEm: true, tarefaDispensadaEm: true,
        compromisso: { select: { id: true, status: true } },
      },
    });
    if (!c) throw new NotFoundException('Publicação não encontrada.');
    if (!c.processoId) {
      throw new BadRequestException(
        'Esta publicação ainda não está ligada a um processo do acervo — cadastre a ação primeiro.',
      );
    }
    // Já tem tarefa em aberto: devolve a mesma. Concluída ou cancelada não
    // conta, porque aí o trabalho voltou a existir.
    if (c.compromisso && !['CONCLUIDO', 'CANCELADO'].includes(c.compromisso.status)) {
      return { compromissoId: c.compromisso.id, criada: false };
    }
    if (!c.providencia || c.providencia === 'NENHUMA') {
      throw new BadRequestException(
        'O sistema não reconheceu uma providência neste ato — crie a atividade pela agenda, ' +
          'descrevendo o que precisa ser feito.',
      );
    }
    const compromissoId = await this.correlacao.criarAtividadeDaProposta(c.id, null);
    if (!compromissoId) {
      throw new BadRequestException('Não foi possível criar a atividade para esta publicação.');
    }
    /*
      A TAREFA CRIADA AQUI NUNCA ERA LIGADA À PUBLICAÇÃO.

      `criarAtividadeDaProposta` só cria a atividade; quem liga é o chamador — a
      caixa (`aceitar`) e a rede (`escalarEsquecidas`) sempre fizeram isso, e
      esta rota não. Resultado: a checagem de idempotência logo acima (que lê
      `c.compromisso`) nunca via a tarefa, dois toques criavam duas, e a
      publicação continuava "sem tarefa" no painel depois de alguém resolvê-la.

      E SE ELA ERA UMA PROPOSTA ABERTA, ISTO É UMA DECISÃO. Clicar aqui tira a
      proposta da caixa do mesmo jeito que aceitar; sem o carimbo, a decisão
      sumia dos Relatórios. Carimba quem clicou — foi quem decidiu —, mesmo que
      a tarefa vá para o dono do caso.
    */
    const eraPropostaAberta = !!c.tarefaPropostaEm && !c.tarefaDispensadaEm && !c.compromisso;
    await this.prisma.comunicacaoDjen.update({
      where: { id: c.id },
      data: {
        compromissoId,
        ...(eraPropostaAberta ? { tarefaDecididaEm: new Date(), tarefaDecididaPor: user.id } : {}),
      },
    });
    return { compromissoId, criada: true };
  }

  /** Publicações de um processo, mais recentes primeiro. */
  @Get('processo/:processoId')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Publicações do DJEN casadas com o processo.' })
  listarDoProcesso(@Param('processoId') processoId: string, @Query('limite') limite?: string) {
    return this.prisma.comunicacaoDjen.findMany({
      where: { processoId },
      orderBy: { dataDisponibilizacao: 'desc' },
      take: Math.min(Number(limite) || 50, 200),
      select: {
        id: true, hash: true, siglaTribunal: true, tipoComunicacao: true,
        tipoDocumento: true, nomeOrgao: true, nomeClasse: true, meio: true,
        link: true, texto: true, dataDisponibilizacao: true, providencia: true,
        prazoMencionadoDias: true, compromissoId: true, movimentacaoId: true,
        // POR QUE não há tarefa — ver o comentário da coluna no schema.
        tarefaDispensadaMotivo: true,
        destinatarios: true, advogados: true,
      },
    });
  }

  /** Busca as publicações de UM processo sob demanda (botão da ficha). */
  @Post('processo/:processoId/sincronizar')
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Consulta o DJEN para este processo e grava o que houver de novo.' })
  sincronizarProcesso(@Param('processoId') processoId: string) {
    return this.sync.sincronizarProcesso(processoId);
  }

  /**
   * Dispara a varredura completa fora do horário do robô.
   *
   * Restrita a ADMINISTRADOR: percorre a OAB de todos os advogados e consulta o
   * CNJ dezenas de vezes. A cadência é imposta pelo próprio `DjenService`, que
   * respeita a cota de 20 requisições por minuto do CNJ — por isso a varredura
   * completa pode demorar minutos, e é melhor assim que levar 403 no meio.
   */
  @Post('sincronizar')
  @OperacaoDeSistema()
  @UseGuards(DjenAtivoGuard)
  @ApiOperation({ summary: 'Varredura completa do DJEN (OAB dos advogados + processos mudos).' })
  async varrer(@Query() q: VarrerDjenQueryDto) {
    /*
      A MESMA TRAVA DO ROBÔ DAS 05:00 — e ela faltava aqui.

      O cron rodava dentro de `comTravaDeJob`; a rota chamava a varredura direto.
      Um clique durante a rodada das 05:00 (de 1 a 25 minutos, ~15 na colheita
      de 180 dias) punha duas varreduras lendo o mesmo estado ainda não gravado:
      as duas viam a sugestão sem tarefa e criavam cada uma a sua "Cadastrar ação
      do Diário", e a primeira ficava órfã na agenda de alguém (auditoria dos
      robôs, 13/09/2026). Agora quem chega depois recebe 409 e uma frase.
    */
    const rodada = await comTravaDeJob(
      this.prisma,
      JOB_DJEN_SYNC,
      this.logger,
      { ttlMinutos: TTL_DA_VARREDURA_MANUAL_MIN },
      /*
        MANUAL, e não CRON. O parâmetro existe para dizer QUEM disparou, e a
        rota deixava o padrão passar — a varredura clicada por alguém aparecia
        no log como se fosse a das 5h. Sem isto, a linha de resumo mentiria
        sobre a origem justamente na hora em que alguém está investigando.

        `dias` só vem na colheita de HISTÓRICO — a passada única que descobre
        ação do sindicato distribuída antes de o sistema existir. Sem ele, a
        janela é a de sempre (3 dias), que é o que a rodada diária precisa.
      */
      () => this.sync.varrer(undefined, OrigemSincronizacao.MANUAL, q.dias),
    );
    if (!rodada.executou) throw new ConflictException(VARREDURA_DO_DIARIO_OCUPADA);
    return rodada.resultado;
  }
}


/**
 * QUEM VÊ A CAIXA INTEIRA.
 *
 * Não é permissão de módulo — é escopo. O advogado vê a caixa DELE porque a
 * proposta é endereçada a uma pessoa; a coordenação vê todas porque é ela que
 * precisa notar a proposta órfã (dono desligado) antes de o prazo passar.
 *
 * Escrito como função e não como `@Roles`: `@Roles` numa rota ATROPELA a matriz
 * de permissões em silêncio, e aqui o gate de módulo tem de continuar valendo.
 */
function podeVerTodasAsPropostas(user: { role?: string | null }): boolean {
  return user.role === 'ADMINISTRADOR' || user.role === 'COORDENACAO';
}
