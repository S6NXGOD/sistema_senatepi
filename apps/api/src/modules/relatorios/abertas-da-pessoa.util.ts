import { Prisma, StatusCompromisso } from '@prisma/client';
import { NAO_E_RESERVA, ORIGEM_RESERVA } from '../agenda/equipe.util';

/**
 * EM ABERTO E ATRASADAS, PESSOA POR PESSOA — pela régua `daPessoa`.
 *
 * Até 13/09/2026 o Uso e produtividade contava só `responsavel_id`, enquanto o
 * sino, o painel e o espelho do relatório contavam também quem foi posto na
 * atividade por gente. A mesma pessoa podia ter "1 atrasada" no painel e "0
 * atrasadas" no PDF — duas definições discordando na tela, o defeito que a
 * régua única existe para impedir.
 *
 * `daPessoa(id)` é um `where` para UMA pessoa; para a equipe inteira seriam
 * dois `count` por pessoa. Com cerca de vinte contas, sai mais barato ler uma
 * vez as abertas de qualquer um deles (com a equipe) e somar em memória. As
 * duas metades — o `where` e a soma — repetem a mesma regra, e o spec prova as
 * duas contra os mesmos dados.
 */

const ABERTOS = [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO];

/** As abertas em que ALGUÉM de `ids` responde ou participa por escolha de gente. */
export function abertasDeAlguem(ids: string[]): Prisma.CompromissoWhereInput {
  return {
    status: { in: ABERTOS },
    OR: [
      { responsavelId: { in: ids } },
      { equipe: { some: { usuarioId: { in: ids }, ...NAO_E_RESERVA } } },
    ],
  };
}

/** O que a soma precisa de cada atividade — é o `select` de quem chama. */
export const SELECAO_DAS_ABERTAS = {
  responsavelId: true,
  inicio: true,
  equipe: { select: { usuarioId: true, origem: true } },
} satisfies Prisma.CompromissoSelect;

export interface AbertaComEquipe {
  responsavelId: string | null;
  inicio: Date;
  equipe?: { usuarioId: string; origem: string | null }[];
}

export interface AbertasDaPessoa {
  abertas: number;
  atrasadas: number;
}

/**
 * Soma por pessoa. Uma atividade conta UMA vez para cada pessoa, mesmo que ela
 * seja responsável e também esteja na equipe. A reserva do robô não conta.
 * Atrasada é o dia que virou (`inicio` antes do início de hoje em Teresina), e
 * não a hora que passou.
 */
export function contarAbertasPorPessoa(
  abertas: AbertaComEquipe[],
  hojeIni: Date,
): Map<string, AbertasDaPessoa> {
  const mapa = new Map<string, AbertasDaPessoa>();
  for (const c of abertas) {
    const donos = new Set<string>();
    if (c.responsavelId) donos.add(c.responsavelId);
    for (const e of c.equipe ?? []) {
      if (e.origem !== ORIGEM_RESERVA) donos.add(e.usuarioId);
    }
    for (const id of donos) {
      const atual = mapa.get(id) ?? { abertas: 0, atrasadas: 0 };
      atual.abertas++;
      if (c.inicio < hojeIni) atual.atrasadas++;
      mapa.set(id, atual);
    }
  }
  return mapa;
}
