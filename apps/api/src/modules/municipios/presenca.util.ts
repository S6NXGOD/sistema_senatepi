import { PrismaService } from '../../prisma/prisma.service';
import { PRE_PROCESSUAIS } from '../processos/processos.service';

/**
 * A PRESENÇA DO SINDICATO NUM ENTE PÚBLICO — cinco números, e cada um responde
 * UMA pergunta.
 *
 * A versão anterior tinha três contadores genéricos ("filiados", "organizações",
 * "processos") e misturava perguntas diferentes debaixo do mesmo nome. A ficha
 * do Governo do Piauí dizia "3.077 filiados · 114 processos". Medido na produção
 * em 11/09/2026:
 *
 *  - 3.077 era quem MORA no Piauí. Morar no estado não diz quem é servidor do
 *    Governo — quem trabalha em órgão ligado ao Estado são 16.
 *  - 114 era o que TRAMITA em comarca do Piauí, qualquer que fosse o réu. O
 *    Estado é réu em 8 ações.
 *
 * Dois números grandes e errados convencem mais que dois pequenos e certos — e é
 * justamente por isso que eles não podiam ficar.
 */
export interface Presenca {
  /** Filiados ATIVOS com endereço neste município. Estado e União não têm morador. */
  moram: number;
  /** Filiados ATIVOS com vínculo de trabalho numa organização ligada a este ente. */
  trabalham: number;
  /** Organizações ativas do cadastro ligadas a este ente. */
  organizacoes: number;
  /** Ações (fora do pré-processual) em que o ente, ou órgão ligado a ele, é RÉU. */
  acoesContra: number;
  /**
   * Ações que TRAMITAM na comarca deste município. Não diz nada sobre a parte:
   * a ação contra o Município de Ilha Grande tramita em Parnaíba.
   */
  naComarca: number;
}

export const PRESENCA_VAZIA: Presenca = Object.freeze({
  moram: 0,
  trabalham: 0,
  organizacoes: 0,
  acoesContra: 0,
  naComarca: 0,
});

/**
 * A PRESENÇA DE TODOS OS ENTES DE UMA VEZ — cinco agregações, nenhuma por ente.
 *
 * As tabelas são pequenas (7 mil filiados, centenas de vínculos e de partes), e
 * agregar tudo custa menos que montar listas de códigos para filtrar. Mais
 * importante: a listagem, a ficha, o relatório e a varredura do Tesouro leem
 * DESTA função. Quando cada um contava do seu jeito, o chip dizia um número e a
 * lista mostrava outro — o defeito que já apareceu nas filas de Processos.
 *
 * O PRÉ-PROCESSUAL FICA FORA dos dois contadores de ação pelo mesmo motivo: o
 * número vira link para a lista de Processos, e a lista padrão não mostra
 * pré-processual. "8 ações" que abrem uma lista de 9 seria a tela discordando
 * dela mesma.
 */
export async function presencaPorEnte(prisma: PrismaService): Promise<Map<number, Presenca>> {
  const [moram, organizacoes, naComarca, trabalham, acoesContra] = await Promise.all([
    prisma.filiado.groupBy({
      by: ['municipioCodigo'],
      where: { situacao: 'ATIVO', municipioCodigo: { not: null } },
      _count: { _all: true },
    }),
    prisma.parteExterna.groupBy({
      by: ['enteCodigo'],
      where: { ativo: true, enteCodigo: { not: null } },
      _count: { _all: true },
    }),
    prisma.processo.groupBy({
      by: ['municipioIBGE'],
      where: { municipioIBGE: { not: null }, statusInterno: { notIn: PRE_PROCESSUAIS } },
      _count: { _all: true },
    }),
    /*
      QUEM TRABALHA PARA O ENTE passa por DUAS ligações: o vínculo do filiado
      aponta para a organização, e a organização aponta para o ente. É por isso
      que o Hospital Getúlio Vargas, enquanto ninguém disser que é do Estado,
      não conta para o Estado — e a tela precisa dizer isso.
    */
    prisma.$queryRaw<Array<{ codigo: number; n: number }>>`
      SELECT pe.ente_codigo AS codigo, COUNT(DISTINCT v.filiado_id)::int AS n
        FROM vinculos_profissionais v
        JOIN partes_externas pe ON pe.id = v.parte_externa_id
        JOIN filiados f ON f.id = v.filiado_id
       WHERE pe.ente_codigo IS NOT NULL
         AND pe.ativo
         AND f.situacao = 'ATIVO'
       GROUP BY pe.ente_codigo`,
    /*
      RÉU, e só réu. Medido na produção: as 41 participações de ente em processo
      são todas no polo PASSIVO. Se um dia o Estado aparecer como autor ao lado
      do sindicato, ele não vira "ação contra o Estado" por engano.
    */
    prisma.$queryRaw<Array<{ codigo: number; n: number }>>`
      SELECT pe.ente_codigo AS codigo, COUNT(DISTINCT pp.processo_id)::int AS n
        FROM partes_processo pp
        JOIN partes_externas pe ON pe.id = pp.parte_externa_id
        JOIN processos p ON p.id = pp.processo_id
       WHERE pe.ente_codigo IS NOT NULL
         AND pp.polo = 'PASSIVO'
         AND NOT (p.status_interno::text = ANY(${PRE_PROCESSUAIS as string[]}))
       GROUP BY pe.ente_codigo`,
  ]);

  const mapa = new Map<number, Presenca>();
  const pegar = (codigo: number) => {
    let p = mapa.get(codigo);
    if (!p) {
      p = { ...PRESENCA_VAZIA };
      mapa.set(codigo, p);
    }
    return p;
  };
  for (const g of moram) if (g.municipioCodigo) pegar(g.municipioCodigo).moram = g._count._all;
  for (const g of organizacoes) if (g.enteCodigo) pegar(g.enteCodigo).organizacoes = g._count._all;
  for (const g of naComarca) if (g.municipioIBGE) pegar(g.municipioIBGE).naComarca = g._count._all;
  for (const g of trabalham) pegar(Number(g.codigo)).trabalham = Number(g.n);
  for (const g of acoesContra) pegar(Number(g.codigo)).acoesContra = Number(g.n);
  return mapa;
}

/**
 * ONDE O SINDICATO ATUA — quem mora, quem trabalha, quem é réu, ou organização
 * cadastrada. A COMARCA NÃO ENTRA.
 *
 * Com a comarca, "onde atuamos" trazia Brasília (12 processos que tramitam lá e
 * nenhum filiado, nenhuma ação contra o Distrito Federal) e mais quatro
 * municípios do Piauí pela mesma porta. Tramitar num fórum não é relação com a
 * prefeitura daquela cidade.
 *
 * Função pura sobre o mapa, e não outra consulta: a tela, o relatório e a
 * varredura do Tesouro precisam do MESMO recorte.
 */
export function ondeAtuamos(presenca: Map<number, Presenca>): Set<number> {
  const s = new Set<number>();
  for (const [codigo, p] of presenca) {
    if (p.moram || p.trabalham || p.organizacoes || p.acoesContra) s.add(codigo);
  }
  return s;
}

/**
 * QUANTO DO CADASTRO OS CONTADORES ENXERGAM — o denominador que dá sentido a
 * "16 trabalham para o Estado".
 *
 * Medido em 11/09/2026: dos 7.309 filiados ativos, 4.166 não têm cidade no
 * cadastro e só 119 têm o local de trabalho ligado a uma organização. Um
 * contador que esconde isso faz parecer que o sindicato quase não existe no
 * Estado, quando o que falta é o cadastro dizer onde as pessoas trabalham.
 */
export async function coberturaDoCadastro(prisma: PrismaService) {
  const [r] = await prisma.$queryRaw<
    Array<{ ativos: number; semCidade: number; comLocalDeTrabalho: number }>
  >`
    SELECT COUNT(*)::int AS ativos,
           COUNT(*) FILTER (WHERE f.cidade IS NULL OR btrim(f.cidade) = '')::int AS "semCidade",
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM vinculos_profissionais v
                WHERE v.filiado_id = f.id AND v.parte_externa_id IS NOT NULL
             )
           )::int AS "comLocalDeTrabalho"
      FROM filiados f
     WHERE f.situacao = 'ATIVO'`;
  return {
    ativos: Number(r?.ativos ?? 0),
    semCidade: Number(r?.semCidade ?? 0),
    comLocalDeTrabalho: Number(r?.comLocalDeTrabalho ?? 0),
  };
}
