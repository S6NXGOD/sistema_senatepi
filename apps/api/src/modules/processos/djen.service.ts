import { flagLigada } from '@core/infra';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { limparTextoPublicacao } from './utils/providencia.util';
import { integracaoAtiva } from '../../tenant/tenant.config';
import { CNJ_REQ_POR_MINUTO } from './utils/cota-cnj.util';

/**
 * DjenService — cliente da API Comunica PJe (DJEN / CNJ).
 *
 * O QUE ELA ENTREGA QUE O DATAJUD NÃO ENTREGA
 * O teor da publicação. O DataJud devolve o rótulo do ato ("Expedição de
 * documento") e deixa `conteudo` nulo quase sempre; o DJEN devolve o texto
 * inteiro da intimação, que é onde está a providência e o prazo.
 *
 * A API é PÚBLICA — não exige chave nem cabeçalho de autenticação (verificado
 * contra o ambiente de produção). Por isso não há segredo a configurar aqui,
 * apenas URL base e timeout.
 *
 * LGPD: ao contrário do DataJud, o `texto` traz nome das partes. Nenhum log
 * deste serviço imprime teor — só NPU, tribunal e contagens, mesma disciplina
 * já adotada em `DatajudService`.
 */

/**
 * Cota da janela esgotada e quem pediu não pode esperar (clique na tela).
 *
 * 429 é o status honesto aqui: não é falha do CNJ nem do sistema, é ritmo.
 */
export class CotaEsgotadaError extends HttpException {
  constructor(readonly esperaMs: number) {
    super(
      `O CNJ limita as consultas ao DJEN a 20 por minuto e a cota do momento acabou. ` +
        `Tente de novo em ${Math.ceil(esperaMs / 1000)} segundos.`,
      429,
    );
  }
}

/**
 * O CDN do CNJ recusou a requisição ANTES de ela chegar à API.
 *
 * COMO SE RECONHECE: 403 com `x-cache: Error from cloudfront`, corpo em HTML e
 * — o sinal decisivo — SEM os cabeçalhos `X-RateLimit-*`. Quando é cota, o CNJ
 * responde com eles; quando o bloqueio é do CloudFront, a requisição não chega
 * a ser contada, porque nem chegou lá.
 *
 * Medido lado a lado com a MESMA URL: do Brasil devolve 200, JSON e
 * `x-amz-cf-pop: GIG52` (Rio); do servidor em produção devolve 403, HTML e
 * `x-amz-cf-pop: SFO53` (San Francisco). É restrição por origem da requisição,
 * não por volume — nenhum ajuste de ritmo ou de cabeçalho contorna isso.
 */
export class DjenBloqueadoError extends HttpException {
  constructor() {
    super(
      'O CNJ está recusando as consultas ao DJEN vindas deste servidor (bloqueio do ' +
        'CDN por origem da requisição). Não é limite de uso nem falha do sistema.',
      403,
    );
  }
}

/** Falha vinda do próprio DJEN, carregando o status HTTP de ORIGEM. */
export class DjenIndisponivelError extends ServiceUnavailableException {
  constructor(
    mensagem: string,
    readonly statusUpstream: number,
  ) {
    super(mensagem);
  }
}

/** Advogado intimado, como o DJEN o descreve. */
export interface AdvogadoDjen {
  nome: string | null;
  numeroOab: string | null;
  ufOab: string | null;
}

/** Parte destinatária da comunicação. */
export interface DestinatarioDjen {
  nome: string | null;
  /** "A" (ativo) / "P" (passivo), como o DJEN envia. */
  polo: string | null;
}

/** Uma publicação/intimação, já normalizada para o formato do sistema. */
export interface ComunicacaoDjenDto {
  /** Chave natural — é o que garante idempotência na ingestão. */
  hash: string;
  /** NPU com 20 dígitos. */
  numeroProcesso: string;
  siglaTribunal: string;
  tipoComunicacao: string | null;
  /** Texto livre por tribunal — exibição apenas, nunca regra. */
  tipoDocumento: string | null;
  nomeOrgao: string | null;
  nomeClasse: string | null;
  meio: string | null;
  link: string | null;
  /** Teor integral do ato. */
  texto: string;
  /** ISO (yyyy-mm-dd). */
  dataDisponibilizacao: string;
  destinatarios: DestinatarioDjen[];
  advogados: AdvogadoDjen[];
}

/** Formato bruto de um item devolvido pela API (campos em snake_case misto). */
interface ItemBruto {
  hash?: unknown;
  numero_processo?: unknown;
  siglaTribunal?: unknown;
  tipoComunicacao?: unknown;
  tipoDocumento?: unknown;
  nomeOrgao?: unknown;
  nomeClasse?: unknown;
  meio?: unknown;
  link?: unknown;
  texto?: unknown;
  data_disponibilizacao?: unknown;
  destinatarios?: unknown;
  destinatarioadvogados?: unknown;
  /** Sinais de cancelamento pelo tribunal — ver o parser. */
  ativo?: unknown;
  status?: unknown;
  motivo_cancelamento?: unknown;
  data_cancelamento?: unknown;
}

/**
 * Teto de páginas por consulta.
 *
 * A API devolve `count` saturado em 10000 — não dá para confiar nele como
 * total. A paginação para quando uma página vem vazia; este teto existe só para
 * que um comportamento inesperado do CNJ não prenda o robô num laço infinito.
 */
const MAX_PAGINAS = 20;
/**
 * Teto para a consulta de UM processo DENTRO DE UMA JANELA DE DATAS.
 *
 * Um processo isolado, em poucos dias, não passa de 300 comunicações nem com
 * doze intimados por ato. Cada página custa uma requisição de uma cota de 20
 * por minuto, e com teto maior um clique em "Sincronizar" podia gastar a cota
 * inteira e deixar a pessoa esperando a janela virar.
 *
 * A leitura do HISTÓRICO (sem data) usa outro teto, escolhido por quem chama
 * (`DJEN_HISTORICO_MAX_PAGINAS`, padrão 10).
 */
export const PAGINAS_DO_NUMERO_NA_JANELA = 3;
const ITENS_POR_PAGINA = 100;

/**
 * O QUE UMA CONSULTA PAGINADA DEVOLVE — os itens E o que ficou sem ler.
 *
 * `paginar` devolvia só a lista. Bater no teto de páginas virava um `warn` no
 * stdout, e uma falha na terceira página jogava fora as duas já lidas. Nenhum
 * dos dois chegava ao banco nem à tela, então quem carimba "lido até hoje" não
 * tinha como saber que não era verdade (auditoria do DJEN, 14/09/2026).
 *
 * A ORDEM IMPORTA PARA LER ESTE OBJETO: medido pela ponte em 13/09/2026, o CNJ
 * devolve do mais NOVO para o mais antigo. Quando o teto corta, o que fica de
 * fora é o mais antigo da consulta, nunca o ato de ontem.
 */
export interface LeituraDjen {
  itens: ComunicacaoDjenDto[];
  /** Páginas efetivamente lidas. */
  paginas: number;
  /** A última página permitida veio cheia: pode haver mais do que foi lido. */
  bateuNoTeto: boolean;
  /** Falha numa página depois da primeira; os itens já lidos vêm assim mesmo. */
  interrompidaPor: string | null;
  /** Identificador público da consulta (OAB ou NPU), nunca teor. */
  rotulo: string;
}

/**
 * LIMITE DE REQUISIÇÕES DO DJEN — medido, não estimado.
 *
 * A API responde com `X-RateLimit-Limit: 20` e `X-RateLimit-Remaining`, e a
 * janela repõe o saldo em ~60 s (verificado: seis chamadas seguidas levaram o
 * saldo de 19 a 14, e um minuto depois ele voltou a 19).
 *
 * Estourar não devolve 429: o CloudFront à frente da API corta com **403**. Foi
 * o que apareceu como "O DJEN retornou HTTP 403" ao clicar em "Buscar no DJEN" —
 * a paginação disparava até 20 chamadas em rajada e consumia a cota inteira
 * numa tacada.
 *
 * O teto local fica ABAIXO do limite real de propósito: o saldo é por IP, e a
 * varredura noturna, o botão da tela e uma segunda réplica da API dividem a
 * mesma cota sem saber uma da outra.
 */
/*
  O NÚMERO MORA EM `cota-cnj.util`, e não aqui.

  O DataJud ganhou limitador próprio depois de estourar a cota (6× HTTP 429 em
  04/09/2026). Dois serviços com o mesmo teto escrito em dois arquivos é a
  receita conhecida deste projeto para divergir em silêncio — basta alguém
  afrouxar um lado.

  CORRIGIDO EM 14/09/2026: este comentário dizia que os dois "dividem UM saldo".
  Desde 03/09/2026 o DJEN sai pela ponte da VPS brasileira (`DJEN_BASE_URL`),
  com outro IP, e o saldo dele é só dele. O número continua um só porque a
  regra do CNJ é a mesma (20/min) e a folga continua valendo em cada IP. Ver o
  cabeçalho de `cota-cnj.util`.

  O resto do limitador continua aqui de propósito: ler `X-RateLimit-Remaining` e
  abrir o disjuntor no 403 por origem são particularidades do DJEN, não regras
  gerais de cota.
*/
const LIMITE_PADRAO_POR_MINUTO = CNJ_REQ_POR_MINUTO;
const JANELA_MS = 60_000;
/** Abaixo disto, espera a janela virar em vez de gastar o resto do saldo. */
const RESERVA_MINIMA = 2;
/** Tentativas extras quando o CNJ corta por excesso (403/429). */
const MAX_TENTATIVAS = 3;

/**
 * O RECUO DEPOIS DE UMA RECUSA QUE NÃO É COTA — 22/09/2026.
 *
 * Medido contra a ponte, no ritmo exato do cron (14/min, 4,3 s entre chamadas):
 *
 *   direto do CNJ, do Brasil ...... 12 de 12 respondem
 *   pela ponte .................... 8 de 16, em BLOCOS: ~4 passam, ~4 recusam
 *
 * E o saldo devolvido pelo CNJ nunca desce de 18 nos dois casos — ou seja, **não
 * é cota**. É o CDN recusando rajadas vindas do IP da VPS, que é de datacenter e
 * apanha de regra mais dura que um IP residencial. O bloco de recusa dura uns
 * 15 a 20 segundos e passa sozinho.
 *
 * O RETRY EXISTIA E NÃO SALVAVA, e o motivo estava na conta da espera: ela usava
 * `esperaAteJanelaVirar()`, que mede a COTA LOCAL. Com a rodada em ritmo, a
 * requisição mais antiga da janela já tem quase 60 s, então a espera calculada
 * caía para o mínimo de **1 segundo** — e as três tentativas se esgotavam
 * dentro do mesmo bloco de recusa, em três segundos.
 *
 * Cota e recusa do CDN pedem esperas diferentes: a cota espera a janela virar
 * (é isso que a repõe); a recusa do CDN espera o bloco passar, e para isso o
 * que serve é um recuo que CRESCE. 5 s cobre o fim de um bloco, 15 s cobre um
 * bloco inteiro, 45 s cobre o pior caso observado com folga.
 */
const RECUO_APOS_RECUSA_MS = [5_000, 15_000, 45_000];
/** Recusas de origem seguidas antes de suspender as tentativas. */
/**
 * POR QUANTO TEMPO UM 200 AINDA VALE COMO PROVA DE QUE A ORIGEM PASSA.
 *
 * Cinco minutos: uma varredura inteira leva minutos, então o sucesso do começo
 * cobre o 403 de cota do meio. E é curto o bastante para um bloqueio de origem
 * que comece no meio da noite ser reconhecido na rodada seguinte.
 */
const JANELA_DE_SUCESSO_RECENTE_MS = 5 * 60_000;

const BLOQUEIOS_PARA_ABRIR = 3;
/** Quanto tempo o serviço para de tentar depois de confirmar o bloqueio. */
const PAUSA_APOS_BLOQUEIO_MS = 60 * 60_000;

@Injectable()
export class DjenService {
  private readonly logger = new Logger(DjenService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly ativa: boolean;
  /** Janela de dias que cada varredura cobre para trás. */
  readonly janelaDias: number;

  /** Teto local de requisições por minuto (fica abaixo do limite real do CNJ). */
  private readonly limitePorMinuto: number;
  /** Instantes das requisições feitas na janela corrente. */
  private readonly historico: number[] = [];
  /**
   * Fila de um: TODA chamada ao DJEN passa por aqui, em série.
   *
   * Sem isto, duas varreduras simultâneas (o robô e alguém clicando no botão)
   * consultariam o mesmo contador ao mesmo tempo, cada uma achando que tem saldo
   * — e as duas estourariam junto.
   */
  private fila: Promise<unknown> = Promise.resolve();
  /** Último saldo informado pelo próprio CNJ (`X-RateLimit-Remaining`). */
  private saldoInformado: number | null = null;

  /**
   * DISJUNTOR do bloqueio de origem.
   *
   * Quando o CDN recusa por origem, ele vai recusar TODAS — insistir só produz
   * centenas de falhas por noite no log e prende o robô por horas. Depois de
   * algumas recusas seguidas, o serviço para de tentar por um tempo e responde
   * na hora, dizendo o motivo.
   */
  private bloqueiosSeguidos = 0;
  private bloqueadoAte = 0;
  /**
   * QUANDO O CNJ NOS RESPONDEU PELA ÚLTIMA VEZ — o desempate do 403.
   *
   * 22/09/2026, com a ponte de volta no ar: a varredura entrou, gravou 7
   * publicações e mesmo assim registrou "159 de 165 consulta(s) em falha" — em
   * SEIS SEGUNDOS. Seis segundos para 165 chamadas é o disjuntor aberto, não
   * rede lenta.
   *
   * Medido contra a ponte, do meu lado: 20 chamadas seguidas devolvem 12 × 200
   * e 8 × 403, com `X-RateLimit-Limit: 20` nos 200 e `X-Amz-Cf-Pop: GRU1`
   * (São Paulo) — ou seja, a ponte funciona e o CNJ recusa por VOLUME. Só que
   * nesse 403 ele não manda `X-RateLimit-*`, e a heurística de 14/09 ("403 sem
   * o cabeçalho = o CDN recusou a origem") classificava cota como bloqueio,
   * abria o disjuntor por 60 minutos e derrubava as outras 159.
   *
   * O cabeçalho não basta para distinguir os dois — mas o HISTÓRICO basta: se o
   * CNJ respondeu 200 a esta mesma origem há instantes, ele não está
   * bloqueando a origem. Está dizendo "devagar".
   */
  private ultimoSucessoEm = 0;

  /**
   * A CHAVE DA PONTE — 22/09/2026.
   *
   * O repassador brasileiro (`DJEN_BASE_URL`) é, por natureza, um proxy aberto
   * para a API do CNJ: quem descobrir o IP consome a cota em nome do sindicato,
   * e a cota é POR IP (20/min). Um cabeçalho combinado é o mínimo que separa a
   * nossa chamada da de qualquer um — o Nginx recusa quem não o traz.
   *
   * VAZIA, NENHUM CABEÇALHO É ENVIADO. É o que permite ligar os dois lados em
   * qualquer ordem, e é o que faz a chamada direta ao CNJ (sem ponte) continuar
   * funcionando igual — ele não conhece este cabeçalho e o ignoraria, mas
   * mandar segredo para fora de casa não se faz.
   */
  private readonly ponteChave: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('DJEN_BASE_URL') || 'https://comunicaapi.pje.jus.br/api/v1';
    this.ponteChave = (this.config.get<string>('DJEN_PONTE_CHAVE') ?? '').trim();
    this.timeoutMs = Number(this.config.get('DJEN_TIMEOUT_MS')) || 30_000;
    this.janelaDias = Number(this.config.get('DJEN_JANELA_DIAS')) || 3;
    this.limitePorMinuto =
      Number(this.config.get('DJEN_REQ_POR_MINUTO')) || LIMITE_PADRAO_POR_MINUTO;
    // A declaração do cliente é a fonte; `DJEN_INTEGRACAO` continua valendo
    // como interruptor de emergência — o CNJ já bloqueou o IP deste servidor,
    // e nessa hora desligar precisa ser variável e restart, não um deploy.
    this.ativa = integracaoAtiva('djen', this.config.get<string>('DJEN_INTEGRACAO'));
  }

  /** A integração está ligada? (o Guard das rotas e o cron leem daqui) */
  get integracaoAtiva(): boolean {
    return this.ativa;
  }

  /**
   * O CDN do CNJ está recusando as consultas vindas deste servidor?
   *
   * A tela precisa saber para dizer a verdade a quem clica: sem isto, um
   * bloqueio de origem apareceria como "erro ao consultar", e a equipe tentaria
   * de novo indefinidamente achando ser instabilidade.
   */
  get bloqueadoNaOrigem(): boolean {
    return Date.now() < this.bloqueadoAte;
  }

  /**
   * Publicações de um advogado, por inscrição na OAB, em todos os tribunais.
   *
   * É a consulta que sustenta a varredura diária: UMA chamada por advogado
   * cobre o país inteiro. Numa verificação real, a busca por uma única OAB
   * devolveu publicações de 22 tribunais distintos (TJPI, TJCE, TRF5, TJSP…).
   * A alternativa — consultar processo a processo — multiplicaria as chamadas
   * pelo tamanho do acervo.
   */
  /*
    DIAS COMO TEXTO, E NÃO COMO `Date` (14/09/2026).

    A assinatura recebia `Date` e mandava `toISOString().slice(0, 10)`: o dia de
    GREENWICH. Às 05:00 de Teresina dá o mesmo dia, mas o botão clicado às 22h
    pedia "a partir de amanhã" e perdia um dia inteiro. Quem chama agora passa o
    dia de Teresina já calculado (`djen-leitura.util`), que é também o que o
    carimbo `djen_lido_ate` guarda.
  */
  async lerPorOab(
    numeroOab: string,
    ufOab: string,
    de: string,
    ate: string,
  ): Promise<LeituraDjen> {
    const oab = (numeroOab || '').replace(/\D/g, '');
    const uf = (ufOab || '').trim().toUpperCase();
    if (!oab || !/^[A-Z]{2}$/.test(uf)) {
      throw new BadRequestException('Informe número da OAB e UF válidos (ex.: 13217 / PI).');
    }
    return this.paginar(
      {
        numeroOab: oab,
        ufOab: uf,
        dataDisponibilizacaoInicio: diaValido(de),
        dataDisponibilizacaoFim: diaValido(ate),
      },
      `OAB ${uf} ${oab}`,
    );
  }

  /**
   * Publicações de UM processo, por NPU.
   *
   * Complementa a varredura por OAB: pega o processo em que a OAB do sindicato
   * não consta do polo — herdado de outro escritório, substabelecimento não
   * lançado no tribunal — e que por isso nunca apareceria na consulta acima.
   *
   * COM `de`/`ate`, lê só a janela: o CNJ respeita o filtro de data junto com o
   * número (medido pela ponte em 13/09/2026: 25 itens caíram para 2). SEM eles,
   * lê o histórico do processo, do mais novo para o mais antigo, até
   * `maxPaginas`.
   */
  async lerPorProcesso(
    npu: string,
    opcoes: { esperarCota?: boolean; maxPaginas?: number; de?: string; ate?: string } = {},
  ): Promise<LeituraDjen> {
    const numero = (npu || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }
    const filtros: Record<string, string> = { numeroProcesso: numero };
    if (opcoes.de) filtros.dataDisponibilizacaoInicio = diaValido(opcoes.de);
    if (opcoes.ate) filtros.dataDisponibilizacaoFim = diaValido(opcoes.ate);
    return this.paginar(
      filtros,
      `NPU ${numero}`,
      Math.max(1, opcoes.maxPaginas ?? PAGINAS_DO_NUMERO_NA_JANELA),
      opcoes.esperarCota ?? true,
    );
  }

  // -------------------------------------------------------------------------

  /**
   * Percorre as páginas até esgotar.
   *
   * Para quando a página volta vazia, e NÃO quando atinge `count`: aquele campo
   * satura em 10000 e mentiria sobre o total em qualquer consulta grande.
   */
  /*
    FALHA NA PRIMEIRA PÁGINA SOBE; FALHA DEPOIS DELA VOLTA COM O QUE JÁ LEU.

    Sem nada lido, não há o que devolver, e quem chama continua recebendo o
    erro de sempre (o 429 do botão, o 503 do timeout). Com páginas já lidas,
    jogá-las fora era perder atos de verdade por causa de uma página seguinte.
    Elas voltam com `interrompidaPor` preenchido, e o carimbo não avança.
  */
  private async paginar(
    filtros: Record<string, string>,
    rotulo: string,
    maxPaginas = MAX_PAGINAS,
    esperarCota = true,
  ): Promise<LeituraDjen> {
    const acumulado: ComunicacaoDjenDto[] = [];
    let paginas = 0;
    let bateuNoTeto = false;
    let interrompidaPor: string | null = null;

    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      let itens: ComunicacaoDjenDto[];
      try {
        itens = await this.consultar(
          { ...filtros, pagina: String(pagina), itensPorPagina: String(ITENS_POR_PAGINA) },
          esperarCota,
        );
      } catch (err) {
        if (pagina === 1) throw err;
        interrompidaPor = (err as Error)?.message ?? String(err);
        this.logger.warn(
          `[DJEN] ${rotulo}: página ${pagina} falhou (${interrompidaPor}) — ` +
            `${acumulado.length} publicação(ões) das páginas anteriores seguem para a ingestão.`,
        );
        break;
      }
      paginas = pagina;
      acumulado.push(...itens);
      if (itens.length < ITENS_POR_PAGINA) break;

      if (pagina === maxPaginas) {
        bateuNoTeto = true;
        this.logger.warn(
          `[DJEN] ${rotulo}: teto de ${maxPaginas} páginas atingido — pode haver publicação não lida.`,
        );
      }
    }

    // LGPD: contagem e identificador público apenas — nunca o teor.
    this.logger.log(`[DJEN] ${rotulo}: ${acumulado.length} publicação(ões) recebida(s).`);
    return { itens: acumulado, paginas, bateuNoTeto, interrompidaPor, rotulo };
  }

  /**
   * Enfileira a consulta e respeita a cota antes de disparar.
   *
   * Todas as chamadas passam por aqui em SÉRIE. Paralelismo aqui não traria
   * ganho — a cota é por minuto, não por conexão — e traria o 403.
   */
  private consultar(
    params: Record<string, string>,
    esperarCota = true,
  ): Promise<ComunicacaoDjenDto[]> {
    const proxima = this.fila.then(() => this.consultarAgora(params, 1, esperarCota));
    // A fila não pode morrer por causa de uma consulta que falhou: o `catch`
    // aqui só a mantém encadeada; o erro segue para quem chamou.
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }

  private async consultarAgora(
    params: Record<string, string>,
    tentativa = 1,
    esperarCota = true,
  ): Promise<ComunicacaoDjenDto[]> {
    // Disjuntor aberto: responde na hora, sem tocar na rede.
    if (Date.now() < this.bloqueadoAte) throw new DjenBloqueadoError();

    await this.aguardarCota(esperarCota);

    const url = `${this.baseUrl}/comunicacao?${new URLSearchParams(params).toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      this.historico.push(Date.now());
      const res = await fetch(url, {
        /*
          A CHAVE SÓ VAI PELA PONTE. Ver `ponteChave`: mandá-la na chamada
          direta ao CNJ seria entregar um segredo nosso a um servidor de fora.
        */
        headers: {
          Accept: 'application/json',
          ...(this.ponteChave && !this.baseUrl.includes('pje.jus.br')
            ? { 'X-Ponte-Chave': this.ponteChave }
            : {}),
        },
        signal: controller.signal,
      });

      // O CNJ informa o saldo restante a cada resposta — usar o número dele é
      // melhor que confiar só na nossa contagem, que não enxerga outra réplica
      // da API consumindo a mesma cota do mesmo IP.
      /*
        SEM CABEÇALHO É `null`, E NÃO ZERO (14/09/2026).

        `Number(null)` dá 0. O saldo ausente virava "saldo zero": o 403 do CDN,
        que chega sem `X-RateLimit-*`, caía no ramo da cota e repetia com um
        minuto de espera, o disjuntor nunca abria e a tela nunca dizia "o CNJ
        está recusando". E um 200 sem o cabeçalho fazia dormir um minuto antes
        de cada chamada. Medido em 14/09/2026: o CNJ manda X-RateLimit-Remaining
        e X-RateLimit-Limit no 200, e a ponte repassa os dois. Sem o cabeçalho,
        quem respondeu não foi o CNJ.
      */
      const bruto = res.headers.get('x-ratelimit-remaining');
      const restante = bruto === null || bruto.trim() === '' ? NaN : Number(bruto);
      this.saldoInformado = Number.isFinite(restante) ? restante : null;

      // BLOQUEIO DE ORIGEM x COTA — a diferença está no cabeçalho.
      // Com `X-RateLimit-*`, a requisição chegou ao CNJ e foi barrada por
      // volume: vale esperar a janela e repetir. SEM eles, quem recusou foi o
      // CDN, antes da API — repetir não muda nada e só gasta tempo.
      /*
        O 403 DEPOIS DE UM SUCESSO RECENTE É COTA, NÃO ORIGEM (22/09/2026).

        O CDN bloqueia a origem por IP: ou recusa tudo, ou não recusa nada — não
        alterna. Um 403 chegando poucos minutos depois de um 200 pela mesma rota
        só pode ser volume. Cair no ramo do disjuntor aqui custa a rodada
        inteira, e foi o que aconteceu no dia em que a ponte voltou.
      */
      const respondeuHaPouco =
        Date.now() - this.ultimoSucessoEm < JANELA_DE_SUCESSO_RECENTE_MS;
      if (res.status === 403 && this.saldoInformado === null && !respondeuHaPouco) {
        clearTimeout(timer);
        this.bloqueiosSeguidos++;
        if (this.bloqueiosSeguidos >= BLOQUEIOS_PARA_ABRIR) {
          this.bloqueadoAte = Date.now() + PAUSA_APOS_BLOQUEIO_MS;
          this.logger.error(
            `[DJEN] Bloqueio de origem confirmado (${this.bloqueiosSeguidos}x) — ` +
              `suspendendo consultas por ${PAUSA_APOS_BLOQUEIO_MS / 60_000} min. ` +
              'O CDN do CNJ recusa requisições vindas deste servidor.',
          );
        }
        throw new DjenBloqueadoError();
      }

      // Recusado: espera e tenta de novo, sem incomodar o usuário.
      if ((res.status === 403 || res.status === 429) && tentativa < MAX_TENTATIVAS) {
        clearTimeout(timer);
        /*
          DUAS RECUSAS, DUAS ESPERAS. Ver `RECUO_APOS_RECUSA_MS`.

          COM saldo no cabeçalho, quem recusou foi a contagem do CNJ: o que
          repõe é a janela virar, e é isso que se espera.

          SEM saldo, foi o CDN recusando uma rajada — e a janela local não diz
          nada sobre quanto esse bloco dura. Era aqui que a espera virava 1
          segundo e o retry queimava as três tentativas dentro do mesmo bloco.
        */
        const ehCota = this.saldoInformado !== null;
        const espera = ehCota
          ? this.esperaAteJanelaVirar()
          : (RECUO_APOS_RECUSA_MS[tentativa - 1] ?? RECUO_APOS_RECUSA_MS.at(-1)!);
        this.logger.warn(
          `[DJEN] HTTP ${res.status} (${ehCota ? 'cota do CNJ' : 'recusa do CDN'}) — ` +
            `aguardando ${Math.ceil(espera / 1000)}s e tentando de novo ` +
            `(${tentativa + 1}/${MAX_TENTATIVAS}).`,
        );
        // Só a cota repõe com a janela; na recusa do CDN a contagem local continua valendo.
        if (ehCota) this.historico.length = 0;
        await dormir(espera);
        return this.consultarAgora(params, tentativa + 1, esperarCota);
      }

      if (!res.ok) {
        // O corpo diz o que a mensagem genérica esconde (bloqueio do CDN, erro
        // de parâmetro, manutenção). LGPD: resposta de erro não traz teor.
        const corpo = await res.text().catch(() => '');
        this.logger.error(
          `[DJEN] HTTP ${res.status} — ${corpo.slice(0, 300) || '(sem corpo)'}`,
        );
        throw new DjenIndisponivelError(
          res.status === 403 || res.status === 429
            ? 'O DJEN está limitando as consultas no momento (cota por minuto). Tente de novo em um minuto.'
            : `O DJEN retornou HTTP ${res.status}. Tente novamente em instantes.`,
          res.status,
        );
      }

      this.bloqueiosSeguidos = 0;
      // O carimbo do 200 é o que distingue "cota" de "origem" no próximo 403.
      this.ultimoSucessoEm = Date.now();
      const json = (await res.json()) as { items?: unknown };
      const itens = Array.isArray(json?.items) ? json.items : [];
      return itens
        .map((i) => this.mapear(i as ItemBruto))
        .filter((c): c is ComunicacaoDjenDto => c !== null);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const isTimeout = (err as Error)?.name === 'AbortError';
      this.logger.error(
        `[DJEN] Falha na consulta: ${isTimeout ? 'timeout' : (err as Error).message}`,
      );
      // A mensagem diz O QUE aconteceu: "não foi possível" sozinho não permite
      // nem decidir se vale tentar de novo.
      throw new ServiceUnavailableException(
        isTimeout
          ? `O DJEN não respondeu em ${Math.round(this.timeoutMs / 1000)}s. Tente de novo em instantes.`
          : 'Não foi possível alcançar o DJEN (falha de rede). Tente de novo em instantes.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Segura a próxima chamada até haver saldo na janela de um minuto.
   *
   * `esperarCota = false` é o modo de quem está OLHANDO A TELA: em vez de
   * prender o botão por até um minuto — que foi exatamente o "carregamento
   * demorado" relatado —, desiste na hora e diz quanto falta. O robô da
   * madrugada continua esperando, porque lá o tempo não custa nada a ninguém.
   */
  private async aguardarCota(esperar = true): Promise<void> {
    const agora = Date.now();
    // Descarta o que saiu da janela.
    while (this.historico.length && agora - this.historico[0] >= JANELA_MS) {
      this.historico.shift();
    }

    // O CNJ disse que está no fim — respeita o número dele, não o nosso.
    if (this.saldoInformado !== null && this.saldoInformado <= RESERVA_MINIMA) {
      const espera = this.esperaAteJanelaVirar();
      if (!esperar) throw new CotaEsgotadaError(espera);
      this.logger.log(`[DJEN] Saldo do CNJ em ${this.saldoInformado} — pausando ${Math.ceil(espera / 1000)}s.`);
      this.saldoInformado = null;
      this.historico.length = 0;
      await dormir(espera);
      return;
    }

    if (this.historico.length < this.limitePorMinuto) return;

    const espera = this.esperaAteJanelaVirar();
    if (!esperar) throw new CotaEsgotadaError(espera);
    this.logger.log(`[DJEN] Cota local atingida — pausando ${Math.ceil(espera / 1000)}s.`);
    await dormir(espera);
    return this.aguardarCota(esperar);
  }

  /** Quanto falta para a requisição mais antiga sair da janela (+1s de folga). */
  private esperaAteJanelaVirar(): number {
    const maisAntiga = this.historico[0];
    if (!maisAntiga) return JANELA_MS;
    return Math.max(1_000, JANELA_MS - (Date.now() - maisAntiga) + 1_000);
  }

  /**
   * Item bruto → DTO. Devolve `null` para o que não serve.
   *
   * Descarta sem hash, sem texto ou sem NPU de 20 dígitos: sem hash não há
   * idempotência, sem texto a publicação não acrescenta nada ao que o DataJud
   * já dá, e sem NPU não há como casar com processo nenhum.
   */
  private mapear(item: ItemBruto): ComunicacaoDjenDto | null {
    const hash = texto(item.hash);
    // Parte dos tribunais publica o ato em HTML (verificado no TJPI: atos do PJe
    // chegam com <div>, <img> e entidades). Limpar aqui, na entrada, faz o banco
    // guardar o teor já legível — e evita que a tela, a atividade da agenda e o
    // classificador limpem cada um do seu jeito.
    const bruto = texto(item.texto);
    const conteudo = bruto ? limparTextoPublicacao(bruto) : null;
    const numeroProcesso = texto(item.numero_processo)?.replace(/\D/g, '') ?? '';
    const data = texto(item.data_disponibilizacao);

    if (!hash || !conteudo || numeroProcesso.length !== 20 || !data) return null;

    /**
     * COMUNICAÇÃO CANCELADA PELO TRIBUNAL NÃO VIRA PRAZO.
     *
     * O CNJ devolve `ativo`, `status` e, quando é o caso, `motivo_cancelamento`
     * e `data_cancelamento` — e o parser ignorava os quatro. Uma intimação
     * anulada entraria como qualquer outra: viraria tarefa, viraria urgência, e
     * o advogado trabalharia sobre um ato que deixou de existir.
     *
     * Medido em 400 publicações reais deste acervo: todas com `ativo: true` e
     * `status: 'P'`, nenhuma cancelada. É raro — e é exatamente por ser raro
     * que ninguém perceberia o dia em que acontecesse. Ler o campo custa três
     * linhas; descobrir na marra custa um prazo.
     */
    const ativo = item.ativo;
    const cancelada =
      ativo === false ||
      !!texto(item.motivo_cancelamento) ||
      !!texto(item.data_cancelamento);
    if (cancelada) return null;

    const advogadosBrutos = Array.isArray(item.destinatarioadvogados)
      ? item.destinatarioadvogados
      : [];
    const destinatariosBrutos = Array.isArray(item.destinatarios) ? item.destinatarios : [];

    return {
      hash,
      numeroProcesso,
      siglaTribunal: texto(item.siglaTribunal)?.toUpperCase() ?? 'ND',
      tipoComunicacao: texto(item.tipoComunicacao),
      tipoDocumento: texto(item.tipoDocumento),
      nomeOrgao: texto(item.nomeOrgao),
      nomeClasse: texto(item.nomeClasse),
      meio: texto(item.meio),
      link: texto(item.link),
      texto: conteudo,
      dataDisponibilizacao: data,
      destinatarios: destinatariosBrutos.map((d: any) => ({
        nome: texto(d?.nome),
        polo: texto(d?.polo),
      })),
      // O DJEN aninha o advogado dentro do vínculo (`{advogado: {...}}`).
      advogados: advogadosBrutos.map((a: any) => ({
        nome: texto(a?.advogado?.nome),
        numeroOab: texto(a?.advogado?.numero_oab),
        ufOab: texto(a?.advogado?.uf_oab)?.toUpperCase() ?? null,
      })),
    };
  }
}

/** Campo de texto do JSON, aparado; null quando ausente ou vazio. */
function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Dia no formato que a API espera (AAAA-MM-DD), conferido antes de sair.
 *
 * Um dia mal formado não dá erro no CNJ: o filtro é ignorado em silêncio e a
 * consulta devolve a carteira inteira — o mesmo jeito que ele já ignora a busca
 * por nome de parte. Melhor recusar aqui, com a mensagem certa.
 */
function diaValido(dia: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    throw new BadRequestException(`Dia fora do formato AAAA-MM-DD: "${dia}".`);
  }
  return dia;
}

/** Pausa simples — usada só para respeitar a cota do CNJ. */
function dormir(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
