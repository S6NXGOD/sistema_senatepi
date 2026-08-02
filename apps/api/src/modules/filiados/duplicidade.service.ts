import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria,
  DecisaoDuplicata,
  Prisma,
  TipoHistoricoFiliado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

/**
 * Confiança de que o grupo é a MESMA pessoa cadastrada mais de uma vez.
 *
 * O nível NÃO vem da semelhança do nome — vem da ausência de contradição entre
 * os campos e da presença de corroboração. Dois "MARIA DA SILVA" idênticos são
 * fracos como evidência; dois "MARIA DA SILVA" na mesma cidade, um deles com
 * CPF e o outro vazio, são fortes.
 */
export type Confianca = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface CandidatoDuplicata {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  numeroCoren: string | null;
  cidade: string | null;
  estado: string | null;
  telefonePrincipal: string | null;
  email: string | null;
  dataNascimento: Date | null;
  endereco: string | null;
  situacao: string;
  dataFiliacao: Date | null;
  createdAt: Date;
  temFoto: boolean;
  vinculos: number;
  /** Quanto o cadastro está preenchido — ver `PESOS`. */
  pontuacao: number;
  /** Sugerido para MANTER. Falso em todos quando há empate. */
  sugerido: boolean;
}

export interface GrupoDuplicata {
  chave: string;
  confianca: Confianca;
  /** Como o grupo foi formado, em português. */
  criterio: string;
  /** Por que o sugerido foi escolhido — nulo quando não houve escolha. */
  motivoSugestao: string | null;
  /**
   * Falso quando os candidatos empatam em completude. A tela precisa dizer
   * "o sistema não sabe escolher" em vez de fingir uma recomendação: em 261
   * dos grupos de produção não há critério que decida, e 144 deles estão
   * completamente vazios dos dois lados.
   */
  decidiu: boolean;
  /** Campos que divergem entre os candidatos (o que derruba a confiança). */
  contradicoes: string[];
  candidatos: CandidatoDuplicata[];
}

/**
 * Peso de cada campo na completude do cadastro.
 *
 * CPF e COREN valem mais porque IDENTIFICAM a pessoa: um cadastro com CPF é
 * recuperável e conferível, um com telefone não. Os demais valem 1 — são
 * dados úteis, não âncoras de identidade.
 */
const PESOS = {
  cpf: 3,
  numeroCoren: 3,
  dataNascimento: 2,
  cidade: 1,
  telefonePrincipal: 1,
  email: 1,
  endereco: 1,
  foto: 1,
  vinculo: 1,
} as const;

/** Campos que, divergindo entre dois cadastros, indicam pessoas diferentes. */
const CAMPOS_CONTRADITORIOS = [
  { campo: 'cpf', rotulo: 'CPF' },
  { campo: 'numeroCoren', rotulo: 'COREN' },
  { campo: 'cidade', rotulo: 'cidade' },
  { campo: 'dataNascimento', rotulo: 'data de nascimento' },
] as const;

/** Linha crua devolvida pelas consultas de agrupamento. */
interface LinhaCandidato {
  chave: string;
  id: string;
  nome_completo: string;
  matricula: string;
  cpf: string | null;
  numero_coren: string | null;
  cidade: string | null;
  estado: string | null;
  telefone_principal: string | null;
  email: string | null;
  data_nascimento: Date | null;
  endereco: string | null;
  situacao: string;
  data_filiacao: Date | null;
  created_at: Date;
  tem_foto: boolean;
  vinculos: number;
  /** Só nos pares por subconjunto: a inicial abreviada casa com o nome extenso. */
  abreviacao?: boolean;
}

@Injectable()
export class DuplicidadeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Varredura
  // =========================================================================

  /**
   * Procura possíveis duplicatas na base inteira.
   *
   * Roda SOB DEMANDA, não em cron: a duplicidade nasceu de uma carga que já
   * aconteceu, o CPF é único e o COREN não repete — um agendamento rodaria
   * todo dia para não achar nada, e o alerta viraria ruído.
   */
  async varrer(): Promise<GrupoDuplicata[]> {
    const [porNome, porSubconjunto, decisoes] = await Promise.all([
      this.gruposPorNomeIdentico(),
      this.paresPorSubconjuntoDeTokens(),
      this.prisma.duplicataDecisao.findMany({
        select: { filiadoIdA: true, filiadoIdB: true },
      }),
    ]);

    const jaJulgado = new Set(decisoes.map((d) => `${d.filiadoIdA}|${d.filiadoIdB}`));

    const grupos = [
      ...this.montarGrupos(porNome, () => 'nome idêntico (ignorando acento e caixa)'),
      ...this.montarGrupos(
        porSubconjunto,
        (l) =>
          l.abreviacao
            ? 'nome abreviado na mesma cidade (a inicial casa com o nome por extenso)'
            : 'um nome contém o outro, na mesma cidade',
        'BAIXA',
      ),
    ];

    return grupos
      .map((g) => this.removerJulgados(g, jaJulgado))
      .filter((g): g is GrupoDuplicata => g !== null)
      .sort((a, b) => {
        const ordem = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
        return ordem[a.confianca] - ordem[b.confianca];
      });
  }

  /** Quantos grupos ainda esperam decisão — alimenta o status da tela. */
  async pendentes(): Promise<number> {
    return (await this.varrer()).length;
  }

  // =========================================================================
  // Formação dos grupos (SQL)
  // =========================================================================

  /**
   * Grupos por nome normalizado idêntico.
   *
   * Reaproveita `busca_normalizada`, a coluna mantida por gatilho desde a
   * migração 20260802210000 — já está pronta, já é indexada e já ignora
   * acento, caixa e pontuação. Fazer a normalização aqui de novo seria
   * recalcular 7 mil vezes o que o banco já tem gravado.
   */
  private async gruposPorNomeIdentico(): Promise<LinhaCandidato[]> {
    return this.prisma.$queryRaw<LinhaCandidato[]>`
      WITH chave AS (
        SELECT senatepi_normalizar_busca(nome_completo) AS nn
          FROM filiados
         GROUP BY 1
        HAVING count(*) > 1
      )
      SELECT senatepi_normalizar_busca(f.nome_completo) AS chave,
             f.id, f.nome_completo, f.matricula, f.cpf, f.numero_coren,
             f.cidade, f.estado, f.telefone_principal, f.email,
             f.data_nascimento, f.endereco, f.situacao::text AS situacao,
             f.data_filiacao, f.created_at,
             (f.foto_key IS NOT NULL) AS tem_foto,
             (SELECT count(*)::int FROM vinculos_profissionais v WHERE v.filiado_id = f.id) AS vinculos
        FROM filiados f
        JOIN chave c ON senatepi_normalizar_busca(f.nome_completo) = c.nn
       ORDER BY chave, f.created_at
    `;
  }

  /**
   * Pares em que um nome é subconjunto do outro — "JOÃO PEDRO" e
   * "JOÃO P. PINTO" — E que estão na MESMA CIDADE preenchida.
   *
   * A exigência de cidade não é rigor decorativo: sem ela, o critério devolve
   * 709 pares em produção e a maioria é homônimo. "MARIA DO SOCORRO IBIAPINA
   * SILVA" e "MARIA DO SOCORRO SILVA" casam por subconjunto e são quase
   * certamente duas mulheres diferentes — em Piauí esse nome é comum. Já
   * "SILVIA CASSANDRA SANTOS DAMASCENO" e "SILVIA CASSANDRA S. DAMASCENO",
   * ambas em Teresina, é duplicata real. A cidade é o que separa os dois.
   *
   * A BLOCAGEM por primeiro+último token é o que torna a consulta viável:
   * comparar todos contra todos seriam 25 milhões de pares.
   */
  private async paresPorSubconjuntoDeTokens(): Promise<LinhaCandidato[]> {
    return this.prisma.$queryRaw<LinhaCandidato[]>`
      WITH base AS (
        -- Normaliza o NOME, e não a coluna busca_normalizada: aquela guarda
        -- nome + matrícula + COREN + CPF de propósito (serve à busca livre da
        -- listagem). Usá-la aqui punha "sen", "2026" e os dígitos do CPF entre
        -- os tokens — o "último token" virava o CPF em vez do sobrenome, e o
        -- teste de subconjunto não casava NUNCA. Custou zero par encontrado
        -- até o teste contra dados reais revelar.
        SELECT f.*, string_to_array(senatepi_normalizar_busca(f.nome_completo), ' ') AS toks
          FROM filiados f
         WHERE f.cidade IS NOT NULL AND f.cidade <> ''
      ), chaves AS (
        SELECT b.*,
               b.toks[1] AS primeiro,
               b.toks[array_length(b.toks, 1)] AS ultimo,
               -- Fora preposições e iniciais soltas: "de", "da" e "P." não
               -- distinguem ninguém, e mantê-las faria "JOÃO P. PINTO" nunca
               -- casar com "JOÃO PEDRO PINTO".
               ARRAY(
                 SELECT t FROM unnest(b.toks) t
                  WHERE length(t) > 1 AND t NOT IN ('de','da','do','dos','das','e')
               ) AS sig
          FROM base b
      ), pares AS (
        SELECT a.id AS id_a, z.id AS id_b,
               -- ABREVIAÇÃO x NOME MAIS CURTO — a diferença entre um par quase
               -- certo e um provável homônimo.
               --
               -- "ANTÔNIA MARIA V. DO NASCIMENTO" e "ANTONIA MARIA VIEIRA DO
               -- NASCIMENTO": o "V." solto casa com "VIEIRA", que só existe no
               -- outro. É a mesma pessoa, escrita duas vezes.
               --
               -- "MARIA DAS GRAÇAS SILVA" e "MARIA DAS GRAÇAS MENDES SILVA":
               -- não há inicial nenhuma justificando o "MENDES". São duas
               -- mulheres diferentes com nome comum.
               EXISTS (
                 SELECT 1
                   FROM unnest(CASE WHEN cardinality(a.sig) < cardinality(z.sig)
                                    THEN a.toks ELSE z.toks END) AS ini
                   JOIN unnest(CASE WHEN cardinality(a.sig) < cardinality(z.sig)
                                    THEN z.sig ELSE a.sig END) AS ext
                     ON left(ext, 1) = ini
                  WHERE length(ini) = 1
                    AND ext <> ALL (CASE WHEN cardinality(a.sig) < cardinality(z.sig)
                                         THEN a.sig ELSE z.sig END)
               ) AS abreviacao
          FROM chaves a
          JOIN chaves z
            ON a.primeiro = z.primeiro
           AND a.ultimo = z.ultimo
           AND a.id < z.id
           AND senatepi_normalizar_busca(a.cidade) = senatepi_normalizar_busca(z.cidade)
         WHERE a.sig <> z.sig
           AND (a.sig <@ z.sig OR z.sig <@ a.sig)
      )
      SELECT p.id_a || '::' || p.id_b AS chave,
             p.abreviacao,
             f.id, f.nome_completo, f.matricula, f.cpf, f.numero_coren,
             f.cidade, f.estado, f.telefone_principal, f.email,
             f.data_nascimento, f.endereco, f.situacao::text AS situacao,
             f.data_filiacao, f.created_at,
             (f.foto_key IS NOT NULL) AS tem_foto,
             (SELECT count(*)::int FROM vinculos_profissionais v WHERE v.filiado_id = f.id) AS vinculos
        FROM pares p
        JOIN filiados f ON f.id IN (p.id_a, p.id_b)
       ORDER BY chave, f.created_at
    `;
  }

  // =========================================================================
  // Julgamento
  // =========================================================================

  private montarGrupos(
    linhas: LinhaCandidato[],
    criterio: (primeiraLinha: LinhaCandidato) => string,
    forcarConfianca?: Confianca,
  ): GrupoDuplicata[] {
    const porChave = new Map<string, LinhaCandidato[]>();
    for (const l of linhas) {
      const atual = porChave.get(l.chave) ?? [];
      atual.push(l);
      porChave.set(l.chave, atual);
    }

    const grupos: GrupoDuplicata[] = [];
    for (const [chave, membros] of porChave) {
      if (membros.length < 2) continue;
      const candidatos = membros.map((m) => this.paraCandidato(m));
      const contradicoes = this.contradicoes(candidatos);
      const { sugeridoId, decidiu, motivo } = this.escolherMantido(candidatos, contradicoes);

      grupos.push({
        chave,
        confianca: forcarConfianca ?? this.classificar(candidatos, contradicoes),
        criterio: criterio(membros[0]),
        motivoSugestao: motivo,
        decidiu,
        contradicoes: contradicoes.map((c) => c.rotulo),
        candidatos: candidatos.map((c) => ({ ...c, sugerido: c.id === sugeridoId })),
      });
    }
    return grupos;
  }

  private paraCandidato(l: LinhaCandidato): CandidatoDuplicata {
    const preenchido = (v: unknown) => v !== null && v !== undefined && v !== '';
    const pontuacao =
      (preenchido(l.cpf) ? PESOS.cpf : 0) +
      (preenchido(l.numero_coren) ? PESOS.numeroCoren : 0) +
      (l.data_nascimento ? PESOS.dataNascimento : 0) +
      (preenchido(l.cidade) ? PESOS.cidade : 0) +
      (preenchido(l.telefone_principal) ? PESOS.telefonePrincipal : 0) +
      (preenchido(l.email) ? PESOS.email : 0) +
      (preenchido(l.endereco) ? PESOS.endereco : 0) +
      (l.tem_foto ? PESOS.foto : 0) +
      l.vinculos * PESOS.vinculo;

    return {
      id: l.id,
      nomeCompleto: l.nome_completo,
      matricula: l.matricula,
      cpf: l.cpf,
      numeroCoren: l.numero_coren,
      cidade: l.cidade,
      estado: l.estado,
      telefonePrincipal: l.telefone_principal,
      email: l.email,
      dataNascimento: l.data_nascimento,
      endereco: l.endereco,
      situacao: l.situacao,
      dataFiliacao: l.data_filiacao,
      createdAt: l.created_at,
      temFoto: l.tem_foto,
      vinculos: l.vinculos,
      pontuacao,
      sugerido: false,
    };
  }

  /**
   * Campos em que dois candidatos têm valores DIFERENTES e ambos preenchidos.
   *
   * Só conta quando os dois lados têm valor: campo vazio de um lado não
   * contradiz nada — é justamente o padrão do cadastro duplicado incompleto.
   */
  private contradicoes(candidatos: CandidatoDuplicata[]) {
    return CAMPOS_CONTRADITORIOS.filter(({ campo }) => {
      const valores = new Set(
        candidatos
          .map((c) => {
            const v = c[campo as keyof CandidatoDuplicata];
            if (v === null || v === undefined || v === '') return null;
            return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).toLowerCase();
          })
          .filter((v): v is string => v !== null),
      );
      return valores.size > 1;
    });
  }

  private classificar(
    candidatos: CandidatoDuplicata[],
    contradicoes: ReturnType<DuplicidadeService['contradicoes']>,
  ): Confianca {
    // Qualquer contradição derruba para BAIXA: CPFs ou cidades diferentes são
    // evidência de pessoas distintas, não de cadastro repetido.
    if (contradicoes.length > 0) return 'BAIXA';

    // Corroboração: todos na mesma cidade, e a cidade está preenchida.
    const cidades = candidatos.map((c) => c.cidade?.trim().toLowerCase()).filter(Boolean);
    if (cidades.length === candidatos.length && new Set(cidades).size === 1) return 'ALTA';

    return 'MEDIA';
  }

  /**
   * Qual candidato manter: o mais completo. Empate devolve `decidiu: false`.
   *
   * O desempate por `createdAt` mais antigo NÃO é usado para forçar uma
   * escolha quando a completude empata — só ordena a lista. Empate é uma
   * resposta legítima: quando os dois cadastros estão igualmente vazios, não
   * existe critério técnico que diga qual apagar, e inventar um seria pior do
   * que admitir que a decisão é humana.
   */
  private escolherMantido(
    candidatos: CandidatoDuplicata[],
    contradicoes: ReturnType<DuplicidadeService['contradicoes']>,
  ): { sugeridoId: string | null; decidiu: boolean; motivo: string | null } {
    // Com contradição, o sistema não opina: os dois podem ser pessoas reais.
    if (contradicoes.length > 0) {
      return {
        sugeridoId: null,
        decidiu: false,
        motivo: null,
      };
    }

    const ordenados = [...candidatos].sort(
      (a, b) => b.pontuacao - a.pontuacao || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const melhor = ordenados[0];
    const segundo = ordenados[1];

    if (melhor.pontuacao === segundo.pontuacao) {
      return { sugeridoId: null, decidiu: false, motivo: null };
    }

    const tem: string[] = [];
    if (melhor.cpf && !segundo.cpf) tem.push('CPF');
    if (melhor.numeroCoren && !segundo.numeroCoren) tem.push('COREN');
    if (melhor.cidade && !segundo.cidade) tem.push('cidade');
    if (melhor.dataNascimento && !segundo.dataNascimento) tem.push('data de nascimento');
    if (melhor.telefonePrincipal && !segundo.telefonePrincipal) tem.push('telefone');
    if (melhor.vinculos > segundo.vinculos) tem.push('locais de trabalho');

    return {
      sugeridoId: melhor.id,
      decidiu: true,
      motivo: tem.length
        ? `Tem ${tem.join(', ')} — o outro registro não tem.`
        : 'Cadastro mais completo.',
    };
  }

  /**
   * Tira do grupo quem já foi julgado como pessoa diferente de todos os outros.
   *
   * Um par marcado como DISTINTOS não deve voltar. Num grupo de três, porém,
   * "A é diferente de B" não elimina A: ele ainda pode ser duplicata de C. Por
   * isso o candidato só sai quando já foi separado de TODOS os demais.
   */
  private removerJulgados(
    grupo: GrupoDuplicata,
    jaJulgado: Set<string>,
  ): GrupoDuplicata | null {
    const par = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

    const restantes = grupo.candidatos.filter((c) =>
      grupo.candidatos.some((o) => o.id !== c.id && !jaJulgado.has(par(c.id, o.id))),
    );

    if (restantes.length < 2) return null;
    if (restantes.length === grupo.candidatos.length) return grupo;

    // O grupo encolheu: reavalia, porque quem saiu podia ser a fonte da
    // contradição ou o candidato sugerido.
    const contradicoes = this.contradicoes(restantes);
    const { sugeridoId, decidiu, motivo } = this.escolherMantido(restantes, contradicoes);
    return {
      ...grupo,
      confianca: this.classificar(restantes, contradicoes),
      contradicoes: contradicoes.map((c) => c.rotulo),
      motivoSugestao: motivo,
      decidiu,
      candidatos: restantes.map((c) => ({ ...c, sugerido: c.id === sugeridoId })),
    };
  }

  // =========================================================================
  // Ações
  // =========================================================================

  /** Registra que o par é de pessoas diferentes — nunca mais será perguntado. */
  async marcarDistintos(idA: string, idB: string, autor?: string) {
    const [a, b] = this.ordenarPar(idA, idB);
    await this.exigirExistencia([a, b]);

    await this.prisma.duplicataDecisao.upsert({
      where: { filiadoIdA_filiadoIdB: { filiadoIdA: a, filiadoIdB: b } },
      create: { filiadoIdA: a, filiadoIdB: b, decisao: DecisaoDuplicata.DISTINTOS, autor },
      update: { decisao: DecisaoDuplicata.DISTINTOS, autor },
    });
    return { ok: true };
  }

  /**
   * Consolida dois cadastros: copia para o mantido o que só o descartado tem,
   * move os vínculos, registra o histórico e SÓ ENTÃO apaga o descartado.
   *
   * A ordem importa e tudo acontece na MESMA transação. `Filiado` tem 14
   * relações, quase todas `onDelete: Cascade` — apagar primeiro e copiar
   * depois destruiria o que se pretendia salvar. Se qualquer passo falhar,
   * nada acontece.
   */
  async fundir(manterId: string, descartarId: string, autor?: string) {
    if (manterId === descartarId) {
      throw new BadRequestException('Os dois registros informados são o mesmo.');
    }

    return this.prisma.$transaction(async (tx) => {
      const [manter, descartar] = await Promise.all([
        tx.filiado.findUnique({ where: { id: manterId }, include: { vinculos: true } }),
        tx.filiado.findUnique({ where: { id: descartarId }, include: { vinculos: true } }),
      ]);
      if (!manter) throw new NotFoundException('Filiado a manter não encontrado.');
      if (!descartar) throw new NotFoundException('Filiado a descartar não encontrado.');

      // Guarda de segurança: CPFs diferentes e ambos preenchidos são pessoas
      // diferentes. A tela já não sugere esse caso, mas a regra vive aqui —
      // uma chamada direta à API não pode furar o que a interface protege.
      if (manter.cpf && descartar.cpf && manter.cpf !== descartar.cpf) {
        throw new BadRequestException(
          'Os dois cadastros têm CPFs diferentes — são pessoas distintas e não podem ser fundidos.',
        );
      }

      // 1) Absorve os campos que só o descartado tem.
      const absorvidos: Record<string, unknown> = {};
      const copiar = <K extends keyof typeof manter>(campo: K) => {
        const atual = manter[campo];
        const outro = descartar[campo];
        const vazio = atual === null || atual === undefined || atual === '';
        const temOutro = outro !== null && outro !== undefined && outro !== '';
        if (vazio && temOutro) absorvidos[campo as string] = outro;
      };
      (
        [
          'cpf', 'rg', 'ufRg', 'dataNascimento', 'sexo', 'estadoCivil', 'naturalidade',
          'telefonePrincipal', 'telefoneSecundario', 'email', 'cep', 'endereco', 'numero',
          'complemento', 'bairro', 'cidade', 'estado', 'numeroCoren', 'dataAdmissao',
          'formacao', 'formacaoOutro', 'dataFiliacao', 'modalidadeContribuicao',
          'fotoKey', 'fotoThumbKey',
        ] as const
      ).forEach(copiar);

      if (Object.keys(absorvidos).length) {
        await tx.filiado.update({ where: { id: manterId }, data: absorvidos });
      }

      // 2) Move os locais de trabalho, continuando a numeração de ordem.
      const proximaOrdem =
        manter.vinculos.reduce((max, v) => Math.max(max, v.ordem ?? 0), 0) + 1;
      for (const [i, v] of descartar.vinculos.entries()) {
        await tx.vinculoProfissional.update({
          where: { id: v.id },
          data: { filiadoId: manterId, ordem: proximaOrdem + i },
        });
      }

      // 3) Histórico no mantido. É o que impede a matrícula do descartado de
      //    virar um número que não existe em lugar nenhum: quem procurar por
      //    ela mais tarde encontra aqui o registro de para onde foi.
      const camposAbsorvidos = Object.keys(absorvidos);
      await tx.filiadoHistorico.create({
        data: {
          filiadoId: manterId,
          tipo: TipoHistoricoFiliado.ALTERACAO,
          descricao:
            `Cadastro duplicado consolidado. Registro removido: ${descartar.nomeCompleto} ` +
            `(matrícula ${descartar.matricula}). ` +
            (camposAbsorvidos.length
              ? `Dados aproveitados: ${camposAbsorvidos.join(', ')}.`
              : 'Nenhum dado adicional a aproveitar.') +
            (descartar.vinculos.length
              ? ` ${descartar.vinculos.length} local(is) de trabalho transferido(s).`
              : ''),
          autor,
          metadata: {
            descartadoId: descartar.id,
            descartadoMatricula: descartar.matricula,
            descartadoNome: descartar.nomeCompleto,
            descartadoCpf: descartar.cpf,
            camposAbsorvidos,
            vinculosTransferidos: descartar.vinculos.length,
          } as Prisma.InputJsonValue,
        },
      });

      // 4) Decisão permanente do par.
      const [a, b] = this.ordenarPar(manterId, descartarId);
      await tx.duplicataDecisao.upsert({
        where: { filiadoIdA_filiadoIdB: { filiadoIdA: a, filiadoIdB: b } },
        create: {
          filiadoIdA: a,
          filiadoIdB: b,
          decisao: DecisaoDuplicata.FUNDIDO,
          autor,
          metadata: {
            mantidoId: manterId,
            descartadoId: descartarId,
            descartadoMatricula: descartar.matricula,
            descartadoNome: descartar.nomeCompleto,
            camposAbsorvidos,
          } as Prisma.InputJsonValue,
        },
        update: { decisao: DecisaoDuplicata.FUNDIDO, autor },
      });

      // 5) Agora sim: apaga o descartado (as cascatas levam o que restou).
      await tx.filiado.delete({ where: { id: descartarId } });

      // Auditoria como DELETE, e `entidadeId` do registro APAGADO: é o id que
      // alguém vai procurar quando estranhar um cadastro que sumiu. Não criei
      // uma ação nova no enum AcaoAuditoria porque acrescentar valor a enum do
      // Postgres exige `ALTER TYPE ADD VALUE`, que não roda dentro de
      // transação — e esta linha roda dentro de uma. O que a fusão faz, no
      // fim, É uma exclusão; o resto está na descrição e no metadata.
      await this.audit.registrar({
        acao: AcaoAuditoria.DELETE,
        entidade: 'Filiado',
        entidadeId: descartarId,
        descricao:
          `Cadastro duplicado consolidado: ${descartar.nomeCompleto} (${descartar.matricula}) ` +
          `foi fundido em ${manter.nomeCompleto} (${manter.matricula}) e removido.`,
        metadata: {
          mantidoId: manterId,
          mantidoMatricula: manter.matricula,
          descartadoMatricula: descartar.matricula,
          camposAbsorvidos,
          vinculosTransferidos: descartar.vinculos.length,
        },
      });

      return { ok: true, camposAbsorvidos, vinculosTransferidos: descartar.vinculos.length };
    });
  }

  // =========================================================================
  // Apoio
  // =========================================================================

  /** O par é sempre gravado com A < B — ver a migração. */
  private ordenarPar(x: string, y: string): [string, string] {
    return x < y ? [x, y] : [y, x];
  }

  private async exigirExistencia(ids: string[]) {
    const achados = await this.prisma.filiado.count({ where: { id: { in: ids } } });
    if (achados !== ids.length) {
      throw new NotFoundException('Filiado não encontrado.');
    }
  }
}
