import { Prisma } from '@prisma/client';

/** O mínimo que se precisa saber do advogado para achá-lo nas publicações. */
export interface InscricaoOab {
  oab: string | null;
  oabUf: string | null;
}

/**
 * Tem inscrição utilizável? Sem número ou sem UF o vínculo por citação não
 * existe, e quem chama precisa DIZER isso na tela em vez de mostrar zero como
 * se fosse resultado.
 */
export function temInscricao(advogado: InscricaoOab | null | undefined): boolean {
  return !!(advogado?.oab ?? '').replace(/\D/g, '') && !!(advogado?.oabUf ?? '').trim();
}

/** Só dígitos, do jeito que a comparação precisa. */
export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/**
 * AS PUBLICAÇÕES QUE NOMEIAM ESTA OAB — uma regra só, para três chamadores.
 *
 * A ligação é pelo NÚMERO + UF, nunca pelo nome: o DJEN manda "ICARO SOL
 * ALMONDES SANTOS" e o cadastro tem "Ícaro Sol Almondes Santos". Casar por
 * texto perderia todo mundo com acento e ainda arriscaria homônimo.
 *
 * ESTA FUNÇÃO NASCEU DE TRÊS CÓPIAS (18/09/2026). O painel do advogado, a busca
 * do DJEN e — agora — o relatório individual faziam a mesma consulta, escrita
 * três vezes. E as três carregavam o MESMO defeito.
 *
 * O DEFEITO, QUE É SUTIL E CARO: escreviam `'\D'` dentro de um template
 * literal. Em JavaScript `\D` num template é escape desconhecido e a barra
 * SOME — o Postgres recebia `regexp_replace(numeroOab, 'D', '', 'g')`, que tira
 * a letra D em vez dos não-dígitos. Com uma OAB escrita "12.345" o resultado
 * continuava "12.345", nunca casava com o "12345" do cadastro, e a publicação
 * sumia do painel do advogado sem erro nenhum.
 *
 * A CORREÇÃO NÃO É PÔR MAIS UMA BARRA — é não precisar de barra. `[^0-9]` diz
 * a mesma coisa, é imune a escape e se lê melhor. Um teste compara o SQL
 * COZIDO (não o texto do arquivo), que é a única forma de pegar esta classe.
 *
 * O RECORTE DE DATA VEM ANTES do `jsonb_array_elements`: sem ele a expansão
 * varreria as 1.408 publicações do acervo para responder sobre sete dias.
 * `ate` é exclusivo, como todo fim de período neste sistema.
 */
export function sqlDasPublicacoesQueCitam(
  numero: string,
  uf: string,
  opcoes: { de?: Date; ate?: Date; limite?: number } = {},
): Prisma.Sql {
  const de = opcoes.de ? Prisma.sql`AND c."data_disponibilizacao" >= ${opcoes.de}` : Prisma.empty;
  const ate = opcoes.ate ? Prisma.sql`AND c."data_disponibilizacao" < ${opcoes.ate}` : Prisma.empty;
  const limite = opcoes.limite ? Prisma.sql`LIMIT ${opcoes.limite}` : Prisma.empty;

  return Prisma.sql`
    SELECT c."id"
      FROM "comunicacoes_djen" c
     WHERE c."advogados" IS NOT NULL
       ${de}
       ${ate}
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(c."advogados"::jsonb) a
          WHERE regexp_replace(a->>'numeroOab', '[^0-9]', '', 'g') = ${numero}
            AND upper(a->>'ufOab') = ${uf}
       )
     ${limite}
  `;
}

export async function publicacoesQueCitam(
  prisma: { $queryRaw: <T>(q: Prisma.Sql) => Promise<T> },
  advogado: InscricaoOab | null | undefined,
  opcoes: { de?: Date; ate?: Date; limite?: number } = {},
): Promise<string[]> {
  const numero = soDigitos(advogado?.oab);
  const uf = (advogado?.oabUf ?? '').trim().toUpperCase();
  if (!numero || !uf) return [];

  const linhas = await prisma.$queryRaw<{ id: string }[]>(
    sqlDasPublicacoesQueCitam(numero, uf, opcoes),
  );
  return linhas.map((l) => l.id);
}
