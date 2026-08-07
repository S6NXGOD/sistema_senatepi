import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { flagLigada } from '../../common/utils/flag.util';
import { NpuUtils } from './utils/npu.util';

/**
 * DatajudService — cliente da API Pública do DATAJUD (CNJ).
 *
 * LGPD (Lei nº 13.709/2018): a API Pública do DATAJUD retorna apenas METADADOS
 * PROCESSUAIS PÚBLICOS (classe, assunto, órgão julgador, movimentações). Ela NÃO
 * expõe dados pessoais das partes. Por isso:
 *  - os logs registram somente o NPU (dado público) e o tribunal — nunca dados
 *    pessoais;
 *  - o mapeamento descarta qualquer campo que porventura pudesse conter dado
 *    pessoal, guardando apenas metadados de interesse jurídico.
 */

/**
 * Falha vinda do próprio CNJ. Carrega o status HTTP de ORIGEM (não o nosso 503)
 * para alimentar a tabela `logs_sincronizacao_datajud` — é o que permite
 * distinguir rate limit (429) de indisponibilidade (5xx) na manhã seguinte.
 */
export class DatajudIndisponivelError extends ServiceUnavailableException {
  constructor(
    mensagem: string,
    readonly statusUpstream: number,
  ) {
    super(mensagem);
  }
}

/** Complemento tabelado do CNJ: detalha o ato (tipo de documento, de petição…). */
export interface ComplementoDatajud {
  codigo: number | null;
  /** Chave técnica do complemento (ex.: `tipo_de_documento`). */
  descricao: string | null;
  valor: number | null;
  /** Valor legível (ex.: `Mandado de Citação`, `sorteio`). */
  nome: string | null;
}

export interface MovimentacaoDatajud {
  dataMovimento: string; // ISO
  descricao: string;
  codigoMovimento: number | null;
  /** Complementos crus, guardados para auditoria/uso futuro. */
  complementos: ComplementoDatajud[];
  /** Rótulo derivado: o "Contestação" de "Petição — Contestação". */
  detalhe: string | null;
  /** Teor/síntese do ato, quando o tribunal envia. */
  conteudo: string | null;
  /** Órgão que praticou o ato. */
  orgaoJulgador: string | null;
}

export interface AdvogadoDatajud {
  nome: string | null;
  oab: string | null;
}

export interface ParteDatajud {
  nome: string | null;
  /** CPF/CNPJ como veio do DATAJUD — normalmente MASCARADO (ex.: `***.123.456-**`). */
  documento: string | null;
  polo: string | null; // ATIVO / PASSIVO / ...
  tipoPessoa: string | null;
  advogados: AdvogadoDatajud[];
}

export interface ProcessoDatajud {
  numeroCNJ: string; // 20 dígitos
  tribunal: string | null;
  classeProcessual: string | null;
  classeCodigo: number | null;
  assuntoPrincipal: string | null;
  /** Todos os assuntos, com o principal sinalizado. */
  assuntos: { codigo: number | null; nome: string | null; principal: boolean }[];
  orgaoJulgador: string | null;
  orgaoJulgadorCodigo: string | null;
  municipioIBGE: number | null;
  grau: string | null;
  dataDistribuicao: string | null; // ISO
  valorCausa: number | null;
  /** "Eletrônico" / "Físico". */
  formato: string | null;
  /** Sistema de origem (PJe, eproc, Projudi…). */
  sistema: string | null;
  /** 0 = público; > 0 ⇒ segredo de justiça. */
  nivelSigilo: number | null;
  segredoJustica: boolean;
  /** Prioridades legais (Idoso, Réu preso…) quando o tribunal envia. */
  prioridades: string[];
  /** Carimbo de atualização informado pelo próprio CNJ. */
  atualizadoNoCnjEm: string | null;
  /**
   * Partes do processo. A API PÚBLICA do DATAJUD, em regra, NÃO expõe as partes
   * (confirmado em consulta real: o `_source` não traz `partes`/`poloAtivo`).
   * O parser é defensivo para aproveitar tribunais/campos que venham a expor.
   * Quando presentes, os documentos vêm MASCARADOS; o desmascaramento (só do
   * filiado vinculado) é feito no service.
   */
  partes: ParteDatajud[];
  movimentacoes: MovimentacaoDatajud[];
}

/**
 * Uma instância (grau) devolvida pelo CNJ, com o `_id` do documento.
 *
 * É o mesmo `ProcessoDatajud` de sempre acrescido de `docId` — a identidade do
 * documento no índice do tribunal, que é o que permite reconhecer, na próxima
 * sincronização, que aquele G2 é o MESMO G2 e deve ser atualizado em vez de
 * duplicado.
 */
export interface InstanciaDatajud extends ProcessoDatajud {
  /** `_id` do documento no DataJud (ex.: "TJPI_G1_08312362420238180140"). */
  docId: string;
}

/**
 * Data do movimento mais recente de uma instância, em ms.
 *
 * As movimentações já chegam ordenadas por data decrescente do `mapear`, mas
 * depender disso seria depender de um detalhe de outro método; o `reduce`
 * custa nada e não quebra se aquela ordenação mudar.
 */
function ultimoMovimentoMs(instancia: ProcessoDatajud): number {
  return instancia.movimentacoes.reduce((maior, m) => {
    const t = new Date(m.dataMovimento).getTime();
    return Number.isFinite(t) && t > maior ? t : maior;
  }, -Infinity);
}

/**
 * Graus a partir dos quais existe recurso ao tribunal superior.
 *
 * Recurso de revista pressupõe acórdão de 2º grau, então processo que só tem 1º
 * grau nunca está no TST — e consultar o índice superior para ele seria gastar
 * cota do CNJ para receber zero resultados.
 */
const GRAUS_QUE_SOBEM = new Set(['G2', 'G3', 'TR', 'G4']);

@Injectable()
export class DatajudService {
  private readonly logger = new Logger(DatajudService.name);
  private readonly baseUrl = 'https://api-publica.datajud.cnj.jus.br';
  private readonly apiKey: string;
  /**
   * A API Pública do CNJ é LENTA: medições reais no TJPI deram 10s, 17s e 24s
   * para o MESMO processo. Com o timeout antigo (15s) boa parte das
   * sincronizações morria por engano e era registrada como falha. 45s dá folga
   * sem prender o robô indefinidamente. Ajustável por ambiente.
   */
  private readonly timeoutMs: number;

  /**
   * Ler TODAS as instâncias do processo, e não só a primeira devolvida.
   *
   * Desligado, o serviço se comporta exatamente como antes da mudança: uma
   * instância por processo, a que o Elasticsearch ranquear em primeiro. É o
   * rollback da funcionalidade sem redeploy.
   */
  private readonly multiInstancia: boolean;

  constructor(private readonly config: ConfigService) {
    // Header exata da API Pública do DATAJUD (configurável por ambiente).
    this.apiKey = this.config.get<string>(
      'DATAJUD_API_KEY',
      'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==',
    );
    this.timeoutMs = Number(this.config.get('DATAJUD_TIMEOUT_MS')) || 45_000;
    this.multiInstancia = flagLigada(this.config.get<string>('DATAJUD_MULTI_INSTANCIA'));
  }

  /** A flag está ligada? (rota `/processos/instancias/status` lê daqui) */
  get multiInstanciaAtiva(): boolean {
    return this.multiInstancia;
  }

  /** Alias/índice do tribunal no DATAJUD (ex.: TJPI → api_publica_tjpi, TRE-PI → api_publica_tre-pi). */
  private aliasTribunal(sigla: string): string {
    // Preserva o hífen (usado por TREs), removendo apenas o restante da pontuação.
    const s = (sigla || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!s) throw new BadRequestException('Informe a sigla do tribunal (ex.: TJPI, TRT22, TRF1).');
    return `api_publica_${s}`;
  }

  /**
   * TODAS as instâncias do processo, pelo NPU, no índice do tribunal.
   *
   * O DataJud guarda UM DOCUMENTO POR GRAU no mesmo índice, com `_id` no
   * formato `<TRIBUNAL>_<GRAU>_<NPU>`, e cada documento traz o próprio array de
   * movimentos. Verificado no NPU 0831236-24.2023.8.18.0140: `TJPI_G2` com 16
   * movimentos e `TJPI_G1` com 42.
   *
   * A versão anterior deste método lia `hits.hits[0]` e devolvia só isso — qual
   * grau sobrevivia dependia da ordenação por relevância do Elasticsearch, e as
   * movimentações do outro nunca chegavam ao banco.
   *
   * DECISÕES DA CONSULTA
   *  - `size: 20`: o default do Elasticsearch é 10 e não havia `size` nenhum
   *    antes. Vinte cobre com folga o número de graus que um processo pode ter e
   *    ainda serve de teto contra uma resposta absurda.
   *  - `_source` sem exclusões: `movimentos` é o que interessa e é o campo
   *    grande; recortá-lo não vale a complexidade.
   *  - CONFERÊNCIA DO NPU: `match` é análise de texto, não igualdade — pode
   *    devolver documento de outro processo. O filtro abaixo é o que impede que
   *    andamento alheio entre na ficha do filiado.
   */
  /**
   * TODAS as instâncias do processo: as do tribunal de origem MAIS a do
   * tribunal superior, quando houver.
   *
   * POR QUE PRECISA DE DUAS CONSULTAS
   * O DataJud guarda cada tribunal num índice próprio. O recurso ao TST não
   * aparece no índice do TRT — é um documento separado, com o mesmo NPU, em
   * `api_publica_tst`. Enquanto só o índice de origem era consultado, essa
   * instância não existia para o sistema: o 0001000-26.2022.5.22.0002 mostrava
   * "2 instâncias" havendo três (o AIRR no TST, baixado em 20/08/2025).
   *
   * O CUSTO É CONTIDO: a consulta ao superior só acontece quando o processo tem
   * instância de 2º grau ou acima — sem acórdão não há recurso de revista. No
   * acervo atual isso significa 4 chamadas extras por varredura, e 2 delas
   * encontram algo.
   */
  async buscarInstanciasPorNPU(npu: string, siglaTribunal: string): Promise<InstanciaDatajud[]> {
    const numero = (npu || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }

    const instancias = await this.consultarIndice(this.aliasTribunal(siglaTribunal), numero);
    if (!this.multiInstancia) return instancias;

    const superior = NpuUtils.tribunalSuperior(numero);
    // Sem 2º grau não há o que subir: recurso de revista pressupõe acórdão.
    const subiu = instancias.some((i) => GRAUS_QUE_SOBEM.has((i.grau ?? '').toUpperCase()));
    if (!superior || !subiu) return instancias;

    try {
      const noSuperior = await this.consultarIndice(this.aliasTribunal(superior), numero);
      if (noSuperior.length) {
        this.logger.log(`[DATAJUD] NPU ${numero}: +${noSuperior.length} instância(s) em ${superior}.`);
      }
      return [...instancias, ...noSuperior];
    } catch (err) {
      /**
       * Falha no índice superior NÃO derruba a sincronização.
       *
       * O tribunal de origem já respondeu e traz o grosso do processo; perder a
       * instância superior nesta rodada é um dado a menos, e ela volta na
       * próxima. Propagar o erro faria o oposto: uma instabilidade do TST
       * impediria de atualizar o 1º grau, que é onde o processo anda.
       */
      this.logger.warn(
        `[DATAJUD] NPU ${numero}: falha ao consultar ${superior} — seguindo só com ` +
          `${siglaTribunal.toUpperCase()}. (${(err as Error).message})`,
      );
      return instancias;
    }
  }

  /** Uma consulta a UM índice do DataJud. */
  private async consultarIndice(alias: string, numero: string): Promise<InstanciaDatajud[]> {
    const url = `${this.baseUrl}/${alias}/_search`;

    // LGPD: log apenas com dado público (NPU + tribunal), sem nada pessoal.
    this.logger.log(`[DATAJUD] Consultando NPU ${numero} em ${alias}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Com a flag desligada o corpo volta a ser o de antes (sem `size`, o
          // ES aplica 10) e só o primeiro hit é aproveitado — comportamento
          // idêntico ao anterior, para o rollback ser real.
          ...(this.multiInstancia ? { size: 20 } : {}),
          query: { match: { numeroProcesso: numero } },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(`[DATAJUD] HTTP ${res.status} ao consultar ${alias} (NPU ${numero})`);
        throw new DatajudIndisponivelError(
          `O DATAJUD retornou HTTP ${res.status}. Tente novamente em instantes.`,
          res.status,
        );
      }

      const json = (await res.json()) as {
        hits?: { hits?: Array<{ _id?: string; _source?: unknown }> };
      };
      const hits = json?.hits?.hits ?? [];

      const candidatos = this.multiInstancia ? hits : hits.slice(0, 1);
      const instancias: InstanciaDatajud[] = [];
      let descartados = 0;

      for (const hit of candidatos) {
        const fonte = hit?._source as Record<string, any> | undefined;
        if (!fonte) continue;

        // O `match` do Elasticsearch é textual: um documento de OUTRO processo
        // pode pontuar e voltar aqui. Sem esta conferência ele seria gravado sob
        // o NPU pedido, misturando andamento de processo alheio na ficha —
        // o pior erro possível neste módulo.
        const numeroDoDoc = String(fonte.numeroProcesso ?? '').replace(/\D/g, '');
        if (numeroDoDoc && numeroDoDoc !== numero) {
          descartados++;
          continue;
        }

        instancias.push({
          ...this.mapear(fonte, numero),
          // Sem `_id` (não deveria acontecer), monta a chave no mesmo formato do
          // CNJ para a linha continuar reconhecível na próxima sincronização.
          docId: hit._id ?? `${(fonte.tribunal ?? 'ND')}_${(fonte.grau ?? 'G1')}_${numero}`,
        });
      }

      if (descartados) {
        this.logger.warn(
          `[DATAJUD] NPU ${numero}: ${descartados} documento(s) de outro processo descartado(s).`,
        );
      }
      if (!instancias.length) {
        this.logger.log(`[DATAJUD] Nenhum resultado para NPU ${numero} em ${alias}`);
        return [];
      }

      this.logger.log(
        `[DATAJUD] NPU ${numero}: ${instancias.length} instância(s) — ` +
          instancias.map((i) => `${i.grau ?? '?'}:${i.movimentacoes.length}mov`).join(', '),
      );
      return instancias;
    } catch (err) {
      // Erros HTTP tratados acima são repropagados; o resto vira 503 amigável.
      if (err instanceof HttpException) throw err;
      const isTimeout = (err as Error)?.name === 'AbortError';
      this.logger.error(
        `[DATAJUD] Falha ao consultar ${alias} (NPU ${numero}): ${isTimeout ? 'timeout' : (err as Error).message}`,
      );
      throw new ServiceUnavailableException('Não foi possível consultar o DATAJUD (CNJ) no momento.');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Um processo pelo NPU — a instância mais relevante.
   *
   * Mantido com a assinatura de sempre para os chamadores que só querem exibir
   * metadados (consulta prévia do modal de importação, formalização de
   * rascunho). Quem precisa gravar o processo usa `buscarInstanciasPorNPU`.
   */
  async buscarProcessoPorNPU(npu: string, siglaTribunal: string): Promise<ProcessoDatajud | null> {
    const instancias = await this.buscarInstanciasPorNPU(npu, siglaTribunal);
    if (!instancias.length) return null;
    // A escolha completa (baixa, último movimento) exige os dados já gravados;
    // aqui basta a instância que mais recentemente teve andamento.
    return [...instancias].sort((a, b) => ultimoMovimentoMs(b) - ultimoMovimentoMs(a))[0];
  }

  /**
   * Normaliza datas do DATAJUD para ISO-8601 (ou `null` se inválida).
   * O CNJ costuma devolver datas ISO (`2018-05-10T00:00:00.000Z`), mas também
   * aparecem formatos compactos (`yyyyMMddHHmmss` / `yyyyMMdd`). Aceitamos ambos
   * para que uma data mal-formada nunca chegue como `Invalid Date` no Prisma.
   */
  private parseData(v: unknown): string | null {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{14}$/.test(s)) {
      const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (/^\d{8}$/.test(s)) {
      const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /**
   * Extrai as partes do processo quando presentes na resposta, normalizando para
   * `{ nome, documento (mascarado), polo, tipoPessoa }`. A API pública em regra
   * não traz partes (LGPD) — então costuma retornar vazio. NÃO desmascara aqui.
   */
  private extrairPartes(src: Record<string, any>): ParteDatajud[] {
    const out: ParteDatajud[] = [];
    const advogadosDe = (p: any): AdvogadoDatajud[] => {
      const lista = p?.advogados ?? p?.advogado ?? p?.representantes ?? [];
      if (!Array.isArray(lista)) return [];
      return lista
        .map((a: any) => ({
          nome: a?.nome ?? a?.nomeAdvogado ?? null,
          oab:
            a?.oab ??
            a?.numeroOAB ??
            (a?.inscricao && a?.ufOab ? `${a.inscricao}/${a.ufOab}` : null) ??
            null,
        }))
        .filter((a: AdvogadoDatajud) => a.nome || a.oab);
    };

    const add = (p: any, poloFallback?: string | null) => {
      if (!p || typeof p !== 'object') return;
      const doc =
        p.documento ??
        p.cpf ??
        p.cpfCnpj ??
        p.numeroDocumento ??
        (Array.isArray(p.documentos)
          ? p.documentos.find((d: any) => /cpf|cnpj/i.test(String(d?.tipo)))?.numero ?? p.documentos[0]?.numero
          : null) ??
        null;
      out.push({
        nome: p.nome ?? p.nomeParte ?? null,
        documento: doc != null ? String(doc) : null,
        polo: this.normalizarPolo(p.polo ?? poloFallback),
        tipoPessoa: p.tipoPessoa ?? p.pessoa ?? null,
        advogados: advogadosDe(p),
      });
    };

    if (Array.isArray(src.partes)) src.partes.forEach((p) => add(p));
    if (Array.isArray(src.poloAtivo)) src.poloAtivo.forEach((p) => add(p, 'ATIVO'));
    if (Array.isArray(src.poloPassivo)) src.poloPassivo.forEach((p) => add(p, 'PASSIVO'));
    if (Array.isArray(src.polos)) {
      src.polos.forEach((grp: any) => {
        const polo = grp?.polo ?? null;
        const membros = grp?.partes ?? grp?.membros ?? [];
        if (Array.isArray(membros)) membros.forEach((p: any) => add(p, polo));
      });
    }
    return out;
  }

  /** "AT"/"ativo"/"POLO ATIVO" → ATIVO; "PA"/"passivo" → PASSIVO. */
  private normalizarPolo(v: unknown): string | null {
    const s = String(v ?? '').trim().toUpperCase();
    if (!s) return null;
    if (s === 'AT' || s.includes('ATIVO')) return 'ATIVO';
    if (s === 'PA' || s.includes('PASSIVO')) return 'PASSIVO';
    return s;
  }

  /**
   * Complementos tabelados → rótulo legível do ato.
   *
   * O CNJ manda, por exemplo, `{descricao: "tipo_de_documento", nome: "Mandado
   * de Citação"}`. Concatenamos os `nome` para virar o "— Mandado de Citação" de
   * "Expedição de documento — Mandado de Citação". Fazemos isso na ESCRITA para
   * a linha do tempo ser uma leitura barata (sem processar JSON a cada abertura).
   */
  private montarDetalhe(complementos: ComplementoDatajud[]): string | null {
    const nomes = complementos
      .map((c) => (c.nome ?? '').trim())
      .filter((n) => n.length > 0)
      // Evita repetir o mesmo rótulo quando o tribunal duplica complementos.
      .filter((n, i, arr) => arr.indexOf(n) === i);
    if (!nomes.length) return null;
    // Deixa a primeira letra maiúscula (o CNJ manda coisas como "sorteio").
    const texto = nomes.join(' · ');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  /**
   * Complementos do movimento, com FALLBACK entre os formatos que os tribunais
   * usam. Nem todo tribunal manda tudo — e, no mesmo processo, um movimento pode
   * vir completo e o seguinte sem nada.
   *
   *  1. `complementosTabelados` — formato atual: objetos {codigo, descricao, valor, nome}
   *  2. `complementos` / `complemento` — mesma ideia, nomes alternativos
   *  3. `complemento` como STRING (legado): "tipo_de_documento:80:Outros documentos"
   *     ou uma lista dessas strings.
   */
  private extrairComplementos(m: any): ComplementoDatajud[] {
    const brutos = m?.complementosTabelados ?? m?.complementos ?? m?.complemento ?? [];
    const lista = Array.isArray(brutos) ? brutos : [brutos];
    const out: ComplementoDatajud[] = [];

    for (const c of lista) {
      if (!c) continue;

      // Formato legado em texto: "chave:valor:nome" (às vezes só "nome").
      if (typeof c === 'string') {
        const partes = c.split(':').map((p) => p.trim());
        if (partes.length >= 3) {
          out.push({
            codigo: null,
            descricao: partes[0] || null,
            valor: Number.isFinite(Number(partes[1])) ? Number(partes[1]) : null,
            nome: partes.slice(2).join(':') || null,
          });
        } else if (c.trim()) {
          out.push({ codigo: null, descricao: null, valor: null, nome: c.trim() });
        }
        continue;
      }

      if (typeof c === 'object') {
        out.push({
          codigo: typeof c.codigo === 'number' ? c.codigo : null,
          descricao: c.descricao ?? c.chave ?? null,
          valor: typeof c.valor === 'number' ? c.valor : null,
          // Alguns tribunais chamam o rótulo legível de `descricaoComplemento`.
          nome: c.nome ?? c.descricaoComplemento ?? c.valorLiteral ?? null,
        });
      }
    }
    return out.filter((c) => c.nome || c.descricao);
  }

  /** Prioridades legais (Idoso, Réu preso…) — formatos variam por tribunal. */
  private extrairPrioridades(src: Record<string, any>): string[] {
    const brutas = src.prioridades ?? src.prioridade ?? src.tagsProcessuais ?? [];
    const lista = Array.isArray(brutas) ? brutas : [brutas];
    return lista
      .map((p: any) => (typeof p === 'string' ? p : p?.nome ?? p?.descricao ?? null))
      .filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0)
      .map((p) => p.trim());
  }

  /**
   * Extrai apenas o essencial da resposta (gigante) do Elasticsearch.
   * NÃO copia dados pessoais além do necessário — só metadados processuais.
   */
  private mapear(src: Record<string, any>, numeroFallback: string): ProcessoDatajud {
    const assuntosBrutos: any[] = Array.isArray(src.assuntos) ? src.assuntos : [];
    const principal = assuntosBrutos.find((a) => a?.principal) ?? assuntosBrutos[0];
    const movimentos: any[] = Array.isArray(src.movimentos) ? src.movimentos : [];
    const nivelSigilo = typeof src.nivelSigilo === 'number' ? src.nivelSigilo : null;

    return {
      numeroCNJ: src.numeroProcesso ? String(src.numeroProcesso).replace(/\D/g, '') : numeroFallback,
      tribunal: src.tribunal ?? null,
      classeProcessual: src.classe?.nome ?? null,
      classeCodigo: typeof src.classe?.codigo === 'number' ? src.classe.codigo : null,
      assuntoPrincipal: principal?.nome ?? null,
      assuntos: assuntosBrutos.map((a) => ({
        codigo: typeof a?.codigo === 'number' ? a.codigo : null,
        nome: a?.nome ?? null,
        principal: !!a?.principal || a === principal,
      })),
      orgaoJulgador: src.orgaoJulgador?.nome ?? null,
      orgaoJulgadorCodigo: src.orgaoJulgador?.codigo != null ? String(src.orgaoJulgador.codigo) : null,
      municipioIBGE:
        typeof src.orgaoJulgador?.codigoMunicipioIBGE === 'number'
          ? src.orgaoJulgador.codigoMunicipioIBGE
          : null,
      grau: src.grau ?? null,
      dataDistribuicao: this.parseData(src.dataAjuizamento),
      valorCausa: typeof src.valorCausa === 'number' ? src.valorCausa : null,
      formato: src.formato?.nome ?? null,
      sistema: src.sistema?.nome ?? null,
      nivelSigilo,
      // Segredo de justiça: qualquer nível acima de 0 restringe o acesso.
      segredoJustica: (nivelSigilo ?? 0) > 0,
      prioridades: this.extrairPrioridades(src),
      atualizadoNoCnjEm: this.parseData(src.dataHoraUltimaAtualizacao),
      // Documentos vêm mascarados; o desmascaramento (só do filiado) é no service.
      partes: this.extrairPartes(src),
      movimentacoes: movimentos
        .map((m) => {
          const complementos = this.extrairComplementos(m);
          return {
            dataMovimento: this.parseData(m?.dataHora),
            descricao: m?.nome ?? null,
            codigoMovimento: typeof m?.codigo === 'number' ? m.codigo : null,
            complementos,
            detalhe: this.montarDetalhe(complementos),
            // Teor do ato: nomes variam entre tribunais.
            conteudo: m?.conteudo ?? m?.descricao ?? m?.texto ?? null,
            orgaoJulgador: m?.orgaoJulgador?.nome ?? null,
          };
        })
        .filter((m): m is MovimentacaoDatajud => !!m.dataMovimento && !!m.descricao)
        .sort((a, b) => new Date(b.dataMovimento).getTime() - new Date(a.dataMovimento).getTime()),
    };
  }
}
