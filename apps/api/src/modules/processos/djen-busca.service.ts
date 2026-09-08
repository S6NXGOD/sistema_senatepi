import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { deQuemEAOrdem } from './utils/de-quem-e-a-ordem.util';
import { tenant } from '../../tenant/tenant.config';

/**
 * BUSCA NO ACERVO DE PUBLICAÇÕES JÁ BAIXADAS.
 *
 * Não consulta o CNJ: procura no que a varredura já trouxe. E existe porque a
 * conta não fechava — em 03/09/2026 havia 136 publicações guardadas e só 14
 * viraram atividade. As outras 122 só eram alcançáveis abrindo processo por
 * processo e rolando a aba, o que na prática quer dizer que não eram
 * alcançáveis.
 *
 * O QUE A API DO CNJ NÃO FAZ, ESTA BUSCA FAZ. Os parâmetros `nomeParte` e
 * `nomeAdvogado` do Comunica PJe são IGNORADOS pelo servidor deles — verifiquei
 * mandando um nome inexistente e recebendo exatamente o mesmo resultado. Mas o
 * nome das partes e dos advogados vem DENTRO de cada publicação, e nós
 * guardamos os dois. Então procurar por parte é impossível na origem e trivial
 * aqui.
 */

export interface FiltroBuscaDjen {
  /** Texto livre: teor, número do processo, nome de parte, advogado ou OAB. */
  q?: string;
  providencia?: string;
  tribunal?: string;
  /** COM_TAREFA | SEM_TAREFA — separa o que já virou trabalho do que não. */
  situacao?: 'COM_TAREFA' | 'SEM_TAREFA';
  /**
   * QUEM FOI INTIMADO — e não "de quem é o processo".
   *
   * `meusProcessosDe` filtra pelo ACERVO do advogado (a tabela de vínculo).
   * Este filtra por CITAÇÃO: o nome dele está no ato. São perguntas diferentes e
   * as respostas divergem muito — medido em 07/09/2026, a Dra. Jaqueline tinha
   * 0 publicações pelo acervo e 4 que a citavam; a Dra. Morgana, 32 pelo acervo
   * e 6 que a citavam.
   *
   * O prazo corre para quem foi INTIMADO. Por isso o filtro da tela é este.
   */
  citaAdvogado?: string;
  /**
   * ONDE procurar o termo — e isto é escolha de PERGUNTA, não filtro.
   *
   * A primeira versão tratava o polo como filtro sobre a busca ampla, e o
   * resultado foi quase inútil: "Hapvida" devolvia 32 no polo passivo e 31 no
   * ativo, porque o nome da parte aparece TAMBÉM no teor e o `OR` deixava
   * passar por lá. O recorte existia e não recortava nada.
   *
   * Escolher o campo é outra coisa: "Hapvida" em RÉU procura só entre os
   * destinatários do polo passivo, e a resposta é "os processos contra a
   * Hapvida" — que é a pergunta que alguém tinha.
   */
  onde?: 'TUDO' | 'AUTOR' | 'REU' | 'NUMERO' | 'TEOR';

  /**
   * Só os processos DESTE usuário.
   *
   * Mesma régua do filtro "meus" da tela de Processos: inclui o processo que a
   * pessoa acompanha sem ser a responsável principal. Nove advogados dividem
   * o acervo; sem o recorte, cada um procura no acervo dos outros oito.
   */
  meusProcessosDe?: string;
  pagina?: number;
  limite?: number;
}

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

/**
 * O CNJ MANDA NOME SEM ACENTO — "SHERAD", "PIAUI", "MINISTERIO PUBLICO".
 *
 * Quem digita, não: escreve "Shérad". Por isso quem é dobrado é o TERMO, e o
 * dado fica como veio. O teor, ao contrário, chega acentuado ("JUDICIÁRIO"),
 * então ele é procurado com o termo original — as duas formas entram no OR e
 * qualquer uma que case serve.
 */
function semAcento(termo: string): string {
  return termo.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

@Injectable()
export class DjenBuscaService {
  constructor(private readonly prisma: PrismaService) {}

  async buscar(filtro: FiltroBuscaDjen) {
    const limite = Math.min(Math.max(Number(filtro.limite) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
    const pagina = Math.max(Number(filtro.pagina) || 1, 1);

    const where: Prisma.ComunicacaoDjenWhereInput[] = [];

    if (filtro.providencia) where.push({ providencia: filtro.providencia });
    if (filtro.tribunal) where.push({ siglaTribunal: filtro.tribunal.toUpperCase() });
    if (filtro.situacao === 'COM_TAREFA') where.push({ compromissoId: { not: null } });
    if (filtro.situacao === 'SEM_TAREFA') where.push({ compromissoId: null });
    if (filtro.meusProcessosDe) {
      where.push({ processo: { advogados: { some: { advogadoId: filtro.meusProcessosDe } } } });
    }
    if (filtro.citaAdvogado) {
      /*
        PELA OAB, e não pelo nome: o tribunal escreve "ICARO SOL ALMONDES SANTOS"
        e o cadastro tem "Ícaro Sol Almondes Santos". É a mesma chave que traz a
        foto do advogado no cartão e que descobre ação nova no Diário.
      */
      const ids = await this.idsQueCitamAdvogado(filtro.citaAdvogado);
      where.push({ id: { in: ids } });
    }

    const termo = (filtro.q ?? '').trim();
    if (termo) {
      const digitos = termo.replace(/\D/g, '');
      const ids = await this.idsPorTexto(termo, digitos, filtro.onde ?? 'TUDO');
      where.push({ id: { in: ids } });
    }

    const filtros: Prisma.ComunicacaoDjenWhereInput = where.length ? { AND: where } : {};

    const [total, itens] = await this.prisma.$transaction([
      this.prisma.comunicacaoDjen.count({ where: filtros }),
      this.prisma.comunicacaoDjen.findMany({
        where: filtros,
        orderBy: { dataDisponibilizacao: 'desc' },
        skip: (pagina - 1) * limite,
        take: limite,
        select: {
          id: true, hash: true, siglaTribunal: true, tipoComunicacao: true,
          tipoDocumento: true, nomeOrgao: true, nomeClasse: true, meio: true,
          link: true, texto: true, dataDisponibilizacao: true, providencia: true,
          prazoMencionadoDias: true, compromissoId: true, movimentacaoId: true,
          // POR QUE não há tarefa. Sem isto a tela só sabe que não há, e
          // "sem tarefa" tanto pode ser decisão do robô quanto falha dele.
          tarefaDispensadaMotivo: true,
          destinatarios: true, advogados: true,
          /*
            AS PARTES VÊM JUNTO, e é o que faltava para a tela fazer sentido.

            A lista mostrava tribunal, órgão e uma parede de texto — e não
            dizia DE QUEM era o processo. Quem varre 984 publicações precisa
            reconhecer o caso pela linha "Fulano × Município", não por ler o
            cabeçalho do acórdão. `destinatarios` (do DJEN) diz quem foi
            intimado e em que polo; `partes` (do cadastro) diz o confronto.
          */
          processo: {
            select: {
              id: true,
              numeroCNJ: true,
              partes: {
                where: { principal: true },
                select: { nome: true, polo: true },
                orderBy: { polo: 'asc' },
              },
            },
          },
          compromisso: { select: { id: true, titulo: true, status: true, inicio: true } },
        },
      }),
    ]);

    return {
      total,
      pagina,
      limite,
      paginas: Math.max(Math.ceil(total / limite), 1),
      itens: await this.comTitularidade(itens),
    };
  }

  /**
   * DE QUEM É A ORDEM — calculado na LEITURA, e de propósito.
   *
   * `tarefaDispensadaMotivo` guarda o que o ROBÔ decidiu, no dia em que
   * decidiu. São perguntas diferentes: uma publicação pode ter sido dispensada
   * por ser NOTÍCIA VELHA e, ao mesmo tempo, trazer ordem da parte contrária. E
   * as 1.433 publicações do acervo foram processadas antes de a regra existir —
   * carimbá-las agora reescreveria a decisão que o robô tomou, que é justamente
   * o que este projeto não faz com registro histórico.
   *
   * Então o campo do robô fica intacto e a tela ganha um dado NOVO, derivado do
   * mesmo util que a automação usa. Uma regra, um arquivo, dois consumidores.
   *
   * CUSTO: uma consulta por página (dezenas de linhas), e um regex por texto.
   * O polo sai do VÍNCULO com o cadastro institucional, nunca do nome.
   */
  private async comTitularidade<
    T extends { texto: string; processo: { id: string } | null },
  >(itens: T[]): Promise<(T & { ordemEhNossa: boolean | null })[]> {
    const ids = [...new Set(itens.map((i) => i.processo?.id).filter(Boolean))] as string[];
    if (!ids.length) return itens.map((i) => ({ ...i, ordemEhNossa: null }));

    const nossas = await this.prisma.parteProcesso.findMany({
      where: { processoId: { in: ids }, parteExterna: { institucional: true } },
      select: { processoId: true, polo: true },
    });
    const polos = new Map<string, 'ATIVO' | 'PASSIVO' | null>();
    for (const id of ids) {
      const meus = nossas.filter((x) => x.processoId === id);
      const ativo = meus.some((x) => x.polo === 'ATIVO');
      const passivo = meus.some((x) => x.polo === 'PASSIVO');
      // Nos dois polos (recurso) não há papel a comparar.
      polos.set(id, ativo && !passivo ? 'ATIVO' : passivo && !ativo ? 'PASSIVO' : null);
    }

    return itens.map((i) => {
      const lado = deQuemEAOrdem(i.texto, polos.get(i.processo?.id ?? '') ?? null, tenant.sigla);
      // `null` = indefinido: a tela não afirma nada, que é o certo quando o
      // texto não permite decidir.
      return { ...i, ordemEhNossa: lado === 'INDEFINIDO' ? null : lado === 'NOSSA' };
    });
  }

  /**
   * O texto livre precisa de SQL cru porque parte e advogado moram dentro de um
   * JSON — `jsonb_array_elements` não tem equivalente no Prisma. Devolve só os
   * ids; quem monta a página é o Prisma, com tipo.
   */
  private async idsPorTexto(
    termo: string,
    digitos: string,
    onde: 'TUDO' | 'AUTOR' | 'REU' | 'NUMERO' | 'TEOR',
  ): Promise<string[]> {
    const like = `%${termo.toUpperCase()}%`;
    const likeSemAcento = `%${semAcento(termo).toUpperCase()}%`;
    const comDigitos = `%${digitos}%`;
    /**
     * Sentinela do termo SEM dígito nenhum — precisa ser algo que nenhuma
     * inscrição da OAB seja.
     *
     * Era o byte nulo, e o Postgres o RECUSA: 'invalid byte sequence for
     * encoding UTF8', com a consulta inteira morrendo. Só apareceu ao rodar
     * a busca contra o banco de verdade — o typecheck passava.
     */
    const oab = digitos || '-';
    /** 'A' autor, 'P' réu — os códigos que o DJEN usa no destinatário. */
    const polo = onde === 'AUTOR' ? 'A' : onde === 'REU' ? 'P' : '%';

    const noTeor = onde === 'TUDO' || onde === 'TEOR';
    const noNumero = onde === 'TUDO' || onde === 'NUMERO';
    const naParte = onde === 'TUDO' || onde === 'AUTOR' || onde === 'REU';
    // Advogado e OAB só na busca ampla: quem escolheu "réu" está procurando
    // empresa, e casar pelo advogado ali devolveria resultado sem explicação.
    const noAdvogado = onde === 'TUDO';

    const linhas = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM comunicacoes_djen c
      WHERE
        (${noTeor} AND (upper(c.texto) LIKE ${like} OR upper(c.texto) LIKE ${likeSemAcento}))
        OR (${noTeor} AND upper(coalesce(c.nome_orgao, '')) LIKE ${likeSemAcento})
        OR (${noNumero} AND length(${digitos}) >= 4 AND c.numero_processo LIKE ${comDigitos})
        OR (${naParte} AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(c.destinatarios, '[]'::jsonb)) d
               WHERE upper(coalesce(d->>'nome', '')) LIKE ${likeSemAcento}
                 AND coalesce(d->>'polo', '') LIKE ${polo}))
        OR (${noAdvogado} AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(c.advogados, '[]'::jsonb)) a
               WHERE upper(coalesce(a->>'nome', '')) LIKE ${likeSemAcento}
                  OR a->>'numeroOab' = ${oab}))
      LIMIT 5000
    `;
    return linhas.map((l) => l.id);
  }

  /**
   * As publicações que NOMEIAM este advogado.
   *
   * Advogado sem OAB no cadastro não pode ser casado, e devolver "tudo" seria
   * pior que devolver nada: o filtro pareceria ligado e não filtraria. Lista
   * vazia é uma resposta honesta — a tela mostra zero e a pessoa entende.
   */
  private async idsQueCitamAdvogado(advogadoId: string): Promise<string[]> {
    const adv = await this.prisma.user.findUnique({
      where: { id: advogadoId },
      select: { oab: true, oabUf: true },
    });
    const numero = (adv?.oab ?? '').replace(/\D/g, '');
    const uf = (adv?.oabUf ?? '').trim().toUpperCase();
    if (!numero || !uf) return [];

    const linhas = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "comunicacoes_djen" c
       WHERE c."advogados" IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(c."advogados"::jsonb) a
            WHERE regexp_replace(a->>'numeroOab', '\D', '', 'g') = ${numero}
              AND upper(a->>'ufOab') = ${uf}
         )
       LIMIT 5000
    `;
    return linhas.map((l) => l.id);
  }

  /** Tribunais e providências presentes no acervo — alimenta os filtros. */
  async facetas() {
    // Duas contagens independentes — nada aqui precisa de atomicidade, e o
    // `$transaction` em array apaga a tipagem discriminada do `groupBy`.
    const [tribunais, providencias] = await Promise.all([
      this.prisma.comunicacaoDjen.groupBy({
        by: ['siglaTribunal'],
        _count: { siglaTribunal: true },
        orderBy: { siglaTribunal: 'asc' },
      }),
      this.prisma.comunicacaoDjen.groupBy({
        by: ['providencia'],
        _count: { providencia: true },
        where: { providencia: { not: null } },
        orderBy: { providencia: 'asc' },
      }),
    ]);
    return {
      tribunais: tribunais.map((t) => ({ sigla: t.siglaTribunal, total: t._count.siglaTribunal })),
      providencias: providencias.map((p) => ({ slug: p.providencia!, total: p._count.providencia })),
    };
  }
}
