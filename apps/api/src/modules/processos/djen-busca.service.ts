import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

    const termo = (filtro.q ?? '').trim();
    if (termo) {
      const digitos = termo.replace(/\D/g, '');
      const ids = await this.idsPorTexto(termo, digitos);
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
          destinatarios: true, advogados: true,
          processo: { select: { id: true, numeroCNJ: true } },
          compromisso: { select: { id: true, titulo: true, status: true, inicio: true } },
        },
      }),
    ]);

    return { total, pagina, limite, paginas: Math.max(Math.ceil(total / limite), 1), itens };
  }

  /**
   * O texto livre precisa de SQL cru porque parte e advogado moram dentro de um
   * JSON — `jsonb_array_elements` não tem equivalente no Prisma. Devolve só os
   * ids; quem monta a página é o Prisma, com tipo.
   */
  private async idsPorTexto(termo: string, digitos: string): Promise<string[]> {
    const like = `%${termo.toUpperCase()}%`;
    const likeSemAcento = `%${semAcento(termo).toUpperCase()}%`;
    /**
     * Sentinela do termo SEM dígito nenhum — precisa ser algo que nenhuma
     * inscrição da OAB seja.
     *
     * Era o byte nulo, e o Postgres o RECUSA: 'invalid byte sequence for
     * encoding UTF8', com a consulta inteira morrendo. Só apareceu ao rodar
     * a busca contra o banco de verdade — o typecheck passava.
     */
    const oab = digitos || '-';

    const linhas = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM comunicacoes_djen c
      WHERE upper(c.texto) LIKE ${like}
         OR upper(c.texto) LIKE ${likeSemAcento}
         OR (length(${digitos}) >= 4 AND c.numero_processo LIKE ${'%' + digitos + '%'})
         OR upper(coalesce(c.nome_orgao, '')) LIKE ${likeSemAcento}
         OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(c.destinatarios, '[]'::jsonb)) d
               WHERE upper(coalesce(d->>'nome', '')) LIKE ${likeSemAcento})
         OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(c.advogados, '[]'::jsonb)) a
               WHERE upper(coalesce(a->>'nome', '')) LIKE ${likeSemAcento}
                  OR a->>'numeroOab' = ${oab})
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
