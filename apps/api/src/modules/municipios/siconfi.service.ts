import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { diaBR } from '../processos/utils/data-br.util';

/**
 * O SICONFI — os números que o próprio município declarou ao Tesouro Nacional.
 *
 * API pública, sem chave e sem cota (conferido em 10/09/2026). São dois
 * relatórios, e cada um responde a uma pergunta que interessa na mesa de
 * negociação:
 *
 *  · RGF, Anexo 01 — quanto da receita vai para a folha, contra o teto da Lei
 *    de Responsabilidade Fiscal. Acima do limite prudencial (art. 22, parágrafo
 *    único) o município fica PROIBIDO de conceder aumento e de contratar. É a
 *    primeira alegação da prefeitura, e agora dá para conferi-la antes de sentar.
 *
 *  · RREO, Anexo 02 — a fatia da despesa que cai na função Saúde.
 *
 * TRÊS ARMADILHAS MEDIDAS, e as três devolvem HTTP 200:
 *
 *  1. `co_poder=E` é OBRIGATÓRIO no RGF. Sem ele, a resposta é 200 com ZERO
 *     linhas — não é erro, não é 400, é uma lista vazia que se parece com
 *     "o município não publicou". Uma medição inteira se perdeu nisso.
 *
 *  2. Um código de município ERRADO devolve 200 com os dados de OUTRO
 *     município. Nunca um 404. Por isso o código sai sempre do catálogo do
 *     IBGE gravado no banco, e nunca de um nome digitado.
 *
 *  3. Município que não publicou o relatório devolve 200 com zero linhas,
 *     igualzinho ao caso (1). Só dá para distinguir tendo certeza dos
 *     parâmetros — e é por isso que a janela é percorrida do mais novo para o
 *     mais velho, aceitando o primeiro período que vier com conteúdo.
 */

/** Uma leitura de despesa com pessoal, já traduzida para os nomes da casa. */
export interface PessoalDoEnte {
  exercicio: number;
  quadrimestre: number;
  percentualRcl: number | null;
  limiteMaximo: number | null;
  limitePrudencial: number | null;
  limiteAlerta: number | null;
  despesaPessoal: number | null;
  receitaCorrenteLiquida: number | null;
  populacao: number | null;
}

/** Uma leitura da despesa liquidada na função Saúde. */
export interface SaudeDoEnte {
  exercicio: number;
  bimestre: number;
  percentualDespesa: number | null;
  despesaLiquidada: number | null;
  populacao: number | null;
}

interface ItemSiconfi {
  cod_conta?: string;
  conta?: string;
  coluna?: string;
  valor?: number | string | null;
  populacao?: number | null;
}

interface RespostaSiconfi {
  items?: ItemSiconfi[];
  count?: number;
}

export class SiconfiIndisponivelError extends ServiceUnavailableException {
  constructor(
    mensagem: string,
    readonly statusUpstream?: number,
  ) {
    super(mensagem);
  }
}

/** A coluna que carrega o percentual no RGF. Texto exato, vindo da API. */
const COLUNA_PERCENTUAL = '% sobre a RCL Ajustada';
const COLUNA_VALOR = 'Valor';

/** No RREO Anexo 02 as linhas de total por função têm este código de conta. */
const CONTA_FUNCAO = 'RREO2TotalDespesas';

/**
 * O nome da função vem acentuado e o corpo chega em ISO-8859-1 — dependendo de
 * como o texto foi decodificado, "Saúde" pode aparecer como "Sa?de". Casar por
 * padrão (qualquer caractere no lugar do "ú") é o que sobrevive aos dois casos.
 */
const FUNCAO_SAUDE = /^sa.de$/i;

@Injectable()
export class SiconfiService {
  private readonly logger = new Logger(SiconfiService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('SICONFI_BASE_URL') ||
      'https://apidatalake.tesouro.gov.br/ords/siconfi/tt';
    this.timeoutMs = Number(this.config.get('SICONFI_TIMEOUT_MS')) || 45_000;
  }

  /**
   * A JANELA DE PERÍODOS a percorrer, do mais recente para o mais antigo.
   *
   * Municípios pequenos publicam com meses de atraso, e alguns simplesmente não
   * publicam. Perguntar só pelo período corrente devolveria vazio para a maior
   * parte do interior — o que significaria "não temos o dado" quando na verdade
   * é "o dado é de dois quadrimestres atrás".
   *
   * Duas voltas para trás bastam: em 10/09/2026 o mais novo publicado era o 1º
   * quadrimestre de 2026, e a série de 2024 já estava completa.
   */
  private janelaQuadrimestres(agora = new Date()): Array<[number, number]> {
    const [ano, mes] = this.anoEMesBR(agora);
    const atual = Math.min(3, Math.max(1, Math.ceil(mes / 4)));
    const saida: Array<[number, number]> = [];
    let a = ano;
    let q = atual;
    for (let i = 0; i < 6; i += 1) {
      saida.push([a, q]);
      q -= 1;
      if (q === 0) {
        q = 3;
        a -= 1;
      }
    }
    return saida;
  }

  private janelaBimestres(agora = new Date()): Array<[number, number]> {
    const [ano, mes] = this.anoEMesBR(agora);
    const atual = Math.min(6, Math.max(1, Math.ceil(mes / 2)));
    const saida: Array<[number, number]> = [];
    let a = ano;
    let b = atual;
    for (let i = 0; i < 8; i += 1) {
      saida.push([a, b]);
      b -= 1;
      if (b === 0) {
        b = 6;
        a -= 1;
      }
    }
    return saida;
  }

  /**
   * Ano e mês em Teresina, lidos da chave de dia — e não de `getMonth()`.
   *
   * O contêiner roda em UTC. Nas primeiras três horas do dia 1º, `getMonth()`
   * no fuso do processo ainda devolve o mês anterior, e a janela pediria um
   * período que ninguém publicou.
   */
  private anoEMesBR(base: Date): [number, number] {
    const [ano, mes] = diaBR(base).split('-');
    return [Number(ano), Number(mes)];
  }

  /** DESPESA COM PESSOAL × RCL — o número do art. 22 da LRF. */
  async pessoal(codigoIBGE: number, agora = new Date()): Promise<PessoalDoEnte | null> {
    for (const [exercicio, quadrimestre] of this.janelaQuadrimestres(agora)) {
      const itens = await this.consultar('rgf', {
        an_exercicio: String(exercicio),
        nr_periodo: String(quadrimestre),
        co_tipo_demonstrativo: 'RGF',
        no_anexo: 'RGF-Anexo 01',
        in_periodicidade: 'Q',
        // Sem isto a resposta é 200 com zero linhas. Ver o cabeçalho da classe.
        co_poder: 'E',
        id_ente: String(codigoIBGE),
      });
      if (!itens.length) continue;

      const pct = (conta: string) => this.acharNumero(itens, conta, COLUNA_PERCENTUAL);
      const val = (conta: string) => this.acharNumero(itens, conta, COLUNA_VALOR);
      return {
        exercicio,
        quadrimestre,
        percentualRcl: pct('DespesaComPessoalTotal'),
        limiteMaximo: pct('LimiteMaximoDespesaComPessoalTotal'),
        limitePrudencial: pct('LimitePrudencialDespesaComPessoalTotal'),
        limiteAlerta: pct('LimiteDeAlertaDespesaComPessoalTotal'),
        despesaPessoal: val('DespesaComPessoalTotal'),
        receitaCorrenteLiquida: val('ReceitaCorrenteLiquidaAjustada'),
        populacao: this.acharPopulacao(itens),
      };
    }
    return null;
  }

  /** DESPESA NA FUNÇÃO SAÚDE — a fatia do orçamento, não o mínimo constitucional. */
  async saude(codigoIBGE: number, agora = new Date()): Promise<SaudeDoEnte | null> {
    for (const [exercicio, bimestre] of this.janelaBimestres(agora)) {
      const itens = await this.consultar('rreo', {
        an_exercicio: String(exercicio),
        nr_periodo: String(bimestre),
        co_tipo_demonstrativo: 'RREO',
        no_anexo: 'RREO-Anexo 02',
        id_ente: String(codigoIBGE),
      });
      if (!itens.length) continue;

      const daFuncao = itens.filter(
        (i) => i.cod_conta === CONTA_FUNCAO && FUNCAO_SAUDE.test((i.conta ?? '').trim()),
      );
      if (!daFuncao.length) continue;

      const porPrefixo = (prefixo: string) =>
        this.numero(daFuncao.find((i) => (i.coluna ?? '').startsWith(prefixo))?.valor);

      return {
        exercicio,
        bimestre,
        percentualDespesa: porPrefixo('% (d/total d)'),
        despesaLiquidada: porPrefixo('DESPESAS LIQUIDADAS AT'),
        populacao: this.acharPopulacao(itens),
      };
    }
    return null;
  }

  private async consultar(caminho: string, params: Record<string, string>): Promise<ItemSiconfi[]> {
    const url = `${this.baseUrl}/${caminho}?${new URLSearchParams(params).toString()}`;
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.timeoutMs);
    try {
      const resposta = await fetch(url, {
        signal: controle.signal,
        headers: { Accept: 'application/json' },
      });
      if (!resposta.ok) {
        throw new SiconfiIndisponivelError(
          `O Tesouro Nacional respondeu ${resposta.status} à consulta do SICONFI.`,
          resposta.status,
        );
      }
      const corpo = (await resposta.json()) as RespostaSiconfi;
      return corpo.items ?? [];
    } catch (err) {
      if (err instanceof SiconfiIndisponivelError) throw err;
      const ehTimeout = (err as Error)?.name === 'AbortError';
      throw new SiconfiIndisponivelError(
        ehTimeout
          ? `O Tesouro Nacional não respondeu em ${Math.round(this.timeoutMs / 1000)}s.`
          : 'Não foi possível falar com o SICONFI (Tesouro Nacional).',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private acharNumero(itens: ItemSiconfi[], conta: string, coluna: string): number | null {
    return this.numero(itens.find((i) => i.cod_conta === conta && i.coluna === coluna)?.valor);
  }

  /**
   * A POPULAÇÃO VEM DE CARONA. O catálogo de localidades do IBGE não a publica,
   * mas todo item do SICONFI a carrega no cabeçalho. É ela que transforma
   * "R$ 1,8 bilhão em saúde" em "R$ 1.987 por habitante" — que é o número que
   * significa alguma coisa quando se comparam dois municípios de porte diferente.
   */
  private acharPopulacao(itens: ItemSiconfi[]): number | null {
    const achado = itens.find((i) => typeof i.populacao === 'number' && i.populacao > 0);
    return achado?.populacao ?? null;
  }

  private numero(valor: number | string | null | undefined): number | null {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = typeof valor === 'number' ? valor : Number(valor);
    return Number.isFinite(n) ? n : null;
  }
}
