import { BadRequestException, Injectable } from '@nestjs/common';
import { OrigemSincronizacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DatajudService, ParteDatajud } from './datajud.service';
import { ProcessosService } from './processos.service';
import { SincronizacaoLogService } from './sincronizacao-log.service';
import { NpuUtils } from './utils/npu.util';

/** Parte do processo já confrontada com a base de filiados. */
export interface ParteConferida extends ParteDatajud {
  /** Filiado encontrado pelo CPF/CNPJ (null quando não há correspondência). */
  filiado: { id: string; nomeCompleto: string; matricula: string } | null;
}

export type OrigemSugestao = 'DATAJUD_OAB' | 'DATAJUD_NOME' | 'CARTEIRA_FILIADO' | 'TRIAGEM';

/** Sugestão de advogado responsável — sempre FACULTATIVA. */
export interface SugestaoAdvogado {
  advogado: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null };
  origem: OrigemSugestao;
  /** Texto pronto para o badge (ex.: "Sugerido pelo DataJud · OAB 12345/PI"). */
  motivo: string;
  /** 0–100: quão forte é o indício (ordena quando há mais de uma sugestão). */
  confianca: number;
}

/** Nome comparável: sem acento, sem pontuação, maiúsculo, espaços colapsados. */
function normalizarNome(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Só os dígitos da inscrição (o CNJ manda "12345/PI", "PI012345", etc.). */
function digitosOab(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Partículas que não ajudam a identificar ninguém. */
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'DR', 'DRA']);

/**
 * Similaridade entre dois nomes (0–1) pela proporção de sobrenomes em comum.
 *
 * Nome de advogado varia muito entre o tribunal e o nosso cadastro ("Maria S.
 * Costa" vs "Maria Silva Costa"), então comparação exata perde casos óbvios.
 * Usamos tokens: ignoramos partículas e aceitamos abreviação (inicial que casa
 * com o começo do outro token). Dois sobrenomes iguais já é um indício forte.
 */
function similaridadeNome(a: string, b: string): number {
  const tokens = (v: string) =>
    normalizarNome(v).split(' ').filter((t) => t.length > 1 && !PARTICULAS.has(t));
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;

  const casa = (x: string, y: string) =>
    x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));

  const usados = new Set<number>();
  let comuns = 0;
  for (const t of ta) {
    const i = tb.findIndex((u, idx) => !usados.has(idx) && casa(t, u));
    if (i >= 0) {
      usados.add(i);
      comuns++;
    }
  }
  return comuns / Math.max(ta.length, tb.length);
}

@Injectable()
export class ConsultaPreviaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly datajud: DatajudService,
    private readonly logSync: SincronizacaoLogService,
    private readonly processos: ProcessosService,
  ) {}

  /**
   * Consulta o DataJud SEM PERSISTIR nada — alimenta o auto-preenchimento do
   * modal "Novo Processo".
   *
   * Regra de vínculo de filiado: as partes que vierem do tribunal são
   * confrontadas com a tabela de Filiados por CPF/CNPJ. Havendo match, o filiado
   * é devolvido pronto para seleção automática. NÃO havendo, NADA é criado no
   * banco — a tela mostra "⚠️ Sem filiado vinculado" e oferece vincular a um
   * existente ou cadastrar manualmente. O vínculo nunca é obrigatório.
   */
  async consultar(numeroCNJ: string, siglaInformada?: string) {
    const numero = (numeroCNJ || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }

    const sigla = siglaInformada?.trim() || NpuUtils.siglaTribunal(numero);
    if (!sigla) {
      throw new BadRequestException(
        'Não foi possível identificar o tribunal pelo número; informe a sigla (ex.: TJPI, TRF1, TRT22).',
      );
    }

    // Já existe no cache local? A tela avisa em vez de deixar o usuário
    // descobrir só no 409 ao salvar.
    const jaImportado = await this.prisma.processo.findUnique({
      where: { numeroCNJ: numero },
      select: { id: true },
    });

    const t0 = Date.now();
    let dados;
    try {
      dados = await this.datajud.buscarProcessoPorNPU(numero, sigla);
    } catch (err) {
      await this.logSync.registrar({
        numeroCNJ: numero, tribunal: sigla, origem: OrigemSincronizacao.IMPORTACAO,
        sucesso: false, httpStatus: this.logSync.statusDe(err),
        mensagemErro: `[consulta prévia] ${(err as Error).message}`,
        duracaoMs: Date.now() - t0,
      });
      throw err;
    }

    if (!dados) {
      return {
        encontrado: false as const,
        jaImportado: !!jaImportado,
        processoExistenteId: jaImportado?.id ?? null,
        tribunalDerivado: sigla.toUpperCase(),
      };
    }

    const partes = await this.confrontarComFiliados(dados.partes);
    const filiadoSugerido = partes.find((p) => p.filiado)?.filiado ?? null;

    // Advogados informados pelo tribunal (achatados de todas as partes) +
    // histórico do filiado, quando ele já foi identificado pelo CPF.
    const advogadosDatajud = dados.partes.flatMap((p) => p.advogados ?? []);
    const sugestoesAdvogado = await this.sugerirAdvogado({
      advogadosDatajud,
      filiadoId: filiadoSugerido?.id,
    });

    return {
      encontrado: true as const,
      jaImportado: !!jaImportado,
      processoExistenteId: jaImportado?.id ?? null,
      tribunalDerivado: (dados.tribunal ?? sigla).toUpperCase(),
      /** Campos prontos para preencher o formulário. */
      preenchimento: {
        classeProcessual: dados.classeProcessual,
        assuntoPrincipal: dados.assuntoPrincipal,
        orgaoJulgador: dados.orgaoJulgador,
        tribunal: (dados.tribunal ?? sigla).toUpperCase(),
        grau: dados.grau,
        dataDistribuicao: dados.dataDistribuicao,
        valorCausa: dados.valorCausa,
        formato: dados.formato,
        sistema: dados.sistema,
        segredoJustica: dados.segredoJustica,
        nivelSigilo: dados.nivelSigilo,
        prioridades: dados.prioridades,
        totalMovimentacoes: dados.movimentacoes.length,
        ultimaMovimentacao: dados.movimentacoes[0]
          ? {
              data: dados.movimentacoes[0].dataMovimento,
              descricao: dados.movimentacoes[0].descricao,
              detalhe: dados.movimentacoes[0].detalhe,
            }
          : null,
        /** Sugestão de observação para o campo Descrição do formulário. */
        descricaoSugerida: this.montarDescricao(dados),
      },
      /** Polos separados, prontos para o card de prévia. */
      polos: {
        ativo: partes.filter((p) => p.polo === 'ATIVO'),
        passivo: partes.filter((p) => p.polo === 'PASSIVO'),
        outros: partes.filter((p) => p.polo !== 'ATIVO' && p.polo !== 'PASSIVO'),
      },
      partes,
      /** Advogados como o tribunal informou (vazio na API pública atual). */
      advogadosDatajud,
      /** Sugestões de responsável, da mais forte à mais fraca. Facultativas. */
      sugestoesAdvogado,
      filiadoSugerido,
      /** true quando o tribunal mandou partes mas nenhuma casou com um filiado. */
      semFiliadoVinculado: partes.length > 0 && !filiadoSugerido,
      /** true quando o tribunal não expõe partes (caso normal da API pública). */
      tribunalNaoExpoePartes: partes.length === 0,
    };
  }

  /** Diagnóstico do robô noturno (últimas chamadas ao CNJ). */
  listarLogs(limite = 50) {
    return this.logSync.listarRecentes(limite);
  }

  /**
   * RE-INDEXAÇÃO: re-sincroniza TODOS os processos para que a linha do tempo
   * passe a usar o parser atual (complementos, teor, órgão do ato).
   *
   * Roda com o mesmo cuidado do robô noturno — sequencial e com 2s entre as
   * chamadas — porque a API do CNJ é lenta (10–24s por consulta) e sensível a
   * rajadas. Para poucos processos é rápido; numa base grande, prefira deixar a
   * varredura da madrugada fazer isso sozinha (ela já é auto-corretiva).
   */
  async reindexar(limite = 50) {
    const processos = await this.prisma.processo.findMany({
      select: { id: true, numeroCNJ: true },
      orderBy: { ultimaSincronizacao: 'asc' },
      take: Math.min(200, Math.max(1, limite)),
    });

    let ok = 0;
    let falhas = 0;
    let atualizadas = 0;
    const erros: { numeroCNJ: string; erro: string }[] = [];

    for (let i = 0; i < processos.length; i++) {
      const p = processos[i];
      try {
        const { novas } = await this.processos.ressincronizarSilencioso(p.id);
        atualizadas += novas;
        ok++;
      } catch (err) {
        falhas++;
        // Processo administrativo pode não ter NPU — identifica pelo id.
        erros.push({ numeroCNJ: p.numeroCNJ ?? `(sem NPU · ${p.id.slice(0, 8)})`, erro: (err as Error).message });
      }
      if (i < processos.length - 1) await new Promise((r) => setTimeout(r, 2000));
    }
    return { processos: processos.length, ok, falhas, novasMovimentacoes: atualizadas, erros };
  }

  // =========================================================================
  // MOTOR DE SUGESTÃO DE ADVOGADO (sempre facultativo)
  // =========================================================================

  /**
   * Sugere o advogado responsável cruzando DUAS fontes, da mais forte à mais
   * fraca. A sugestão nunca é imposta: a tela mostra um badge e o operador
   * aceita com um clique ou escolhe outro.
   *
   * 1) DataJud — OAB/nome dos advogados que o tribunal informa no processo.
   *    ATENÇÃO: a API PÚBLICA do CNJ não devolve advogados hoje (verificado em
   *    TJPI e TJSP: o `_source` não tem `advogados`/`partes`). O caminho fica
   *    pronto e é usado assim que algum tribunal expuser — mas, sozinho, ele
   *    nunca dispararia. Por isso existe a fonte 2.
   * 2) Histórico local — quem já cuida desse filiado. Funciona HOJE, com dado
   *    nosso: o advogado da carteira do filiado e o encaminhado na triagem.
   */
  async sugerirAdvogado(params: {
    advogadosDatajud?: { nome: string | null; oab: string | null }[];
    filiadoId?: string;
  }): Promise<SugestaoAdvogado[]> {
    const equipe = await this.prisma.user.findMany({
      where: { role: 'ADVOGADO', ativo: true },
      select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, oab: true, oabUf: true },
    });
    if (!equipe.length) return [];

    const sugestoes = new Map<string, SugestaoAdvogado>();
    const registrar = (s: SugestaoAdvogado) => {
      const atual = sugestoes.get(s.advogado.id);
      // Mantém sempre o indício mais forte para o mesmo advogado.
      if (!atual || s.confianca > atual.confianca) sugestoes.set(s.advogado.id, s);
    };
    const publico = (u: (typeof equipe)[number]) => ({
      id: u.id, nome: u.nome, nomeExibicao: u.nomeExibicao, avatarUrl: u.avatarUrl,
    });

    // ---- Fonte 1: advogados informados pelo tribunal ----
    for (const adv of params.advogadosDatajud ?? []) {
      const oabAlvo = digitosOab(adv.oab);
      const nomeAlvo = normalizarNome(adv.nome ?? '');

      for (const u of equipe) {
        const oabUsuario = digitosOab(u.oab);
        if (oabAlvo && oabUsuario && oabAlvo === oabUsuario) {
          registrar({
            advogado: publico(u),
            origem: 'DATAJUD_OAB',
            motivo: `Sugerido pelo DataJud · OAB ${u.oab}${u.oabUf ? `/${u.oabUf}` : ''}`,
            confianca: 100, // OAB é identificador único: match exato
          });
          continue;
        }
        if (!nomeAlvo) continue;
        // Nome exato, e depois nome PARECIDO (abreviações, sobrenome faltando).
        const alvos = [u.nome, u.nomeExibicao].filter(Boolean) as string[];
        const semelhanca = Math.max(...alvos.map((n) => similaridadeNome(n, nomeAlvo)));
        if (semelhanca >= 0.99) {
          registrar({
            advogado: publico(u),
            origem: 'DATAJUD_NOME',
            motivo: 'Sugerido pelo DataJud · nome do advogado no processo',
            confianca: 85, // homônimos existem — menos confiável que a OAB
          });
        } else if (semelhanca >= 0.6) {
          registrar({
            advogado: publico(u),
            origem: 'DATAJUD_NOME',
            motivo: `Sugerido pelo DataJud · nome parecido com "${adv.nome}"`,
            // Escala com a semelhança, sempre abaixo do nome exato.
            confianca: Math.round(50 + semelhanca * 30),
          });
        }
      }
    }

    // ---- Fonte 2: histórico do filiado (funciona hoje) ----
    if (params.filiadoId) {
      const daEquipe = new Set(equipe.map((u) => u.id));

      // 2a) Advogado que já responde por outros processos deste filiado.
      const outros = await this.prisma.processo.groupBy({
        by: ['advogadoId'],
        where: { filiadoId: params.filiadoId, advogadoId: { not: null } },
        _count: { _all: true },
      });
      for (const g of outros) {
        const u = equipe.find((e) => e.id === g.advogadoId);
        if (!u || !daEquipe.has(u.id)) continue;
        const n = g._count._all;
        registrar({
          advogado: publico(u),
          origem: 'CARTEIRA_FILIADO',
          motivo: `Já responde por ${n} processo${n > 1 ? 's' : ''} deste filiado`,
          // Quanto mais processos, mais forte — teto abaixo do match por OAB.
          confianca: Math.min(90, 60 + n * 10),
        });
      }

      // 2b) Advogado a quem a triagem mais recente foi encaminhada.
      const compromisso = await this.prisma.compromisso.findFirst({
        where: { filiadoId: params.filiadoId, atendimentoId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { responsavelId: true, atendimento: { select: { numero: true } } },
      });
      const doAtendimento = compromisso && equipe.find((e) => e.id === compromisso.responsavelId);
      if (doAtendimento) {
        registrar({
          advogado: publico(doAtendimento),
          origem: 'TRIAGEM',
          motivo: `Atendeu a triagem #${compromisso!.atendimento?.numero ?? ''} deste filiado`.trim(),
          confianca: 70,
        });
      }
    }

    return [...sugestoes.values()].sort((a, b) => b.confianca - a.confianca);
  }

  /**
   * Confronta as partes com a base de filiados por CPF/CNPJ (só dígitos).
   * Uma única consulta com `in` — nada de N+1.
   */
  private async confrontarComFiliados(partes: ParteDatajud[]): Promise<ParteConferida[]> {
    if (!partes.length) return [];

    // Documentos MASCARADOS (***.123.456-**) não servem para casar — só usamos
    // os que vierem completos (11 ou 14 dígitos).
    const docs = partes
      .map((p) => (p.documento ?? '').replace(/\D/g, ''))
      .filter((d) => d.length === 11 || d.length === 14);

    const filiados = docs.length
      ? await this.prisma.filiado.findMany({
          where: { cpf: { in: [...new Set(docs)] } },
          select: { id: true, nomeCompleto: true, matricula: true, cpf: true },
        })
      : [];
    const porCpf = new Map(filiados.map((f) => [(f.cpf ?? '').replace(/\D/g, ''), f]));

    return partes.map((p) => {
      const d = (p.documento ?? '').replace(/\D/g, '');
      const achado = d.length === 11 || d.length === 14 ? porCpf.get(d) : undefined;
      return {
        ...p,
        filiado: achado
          ? { id: achado.id, nomeCompleto: achado.nomeCompleto, matricula: achado.matricula }
          : null,
      };
    });
  }

  /** Observação inicial sugerida (o usuário pode editar antes de salvar). */
  private montarDescricao(d: {
    classeProcessual: string | null;
    orgaoJulgador: string | null;
    assuntoPrincipal: string | null;
  }): string {
    const partes = [
      d.classeProcessual,
      d.assuntoPrincipal ? `Assunto: ${d.assuntoPrincipal}` : null,
      d.orgaoJulgador,
    ].filter(Boolean);
    return partes.length ? `Importado do DataJud — ${partes.join(' · ')}.` : 'Importado do DataJud.';
  }
}
