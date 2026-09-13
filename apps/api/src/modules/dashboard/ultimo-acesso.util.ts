import type { PrismaService } from '../../prisma/prisma.service';

/**
 * QUANDO A PESSOA ESTEVE AQUI PELA ÚLTIMA VEZ — e por que são três fontes.
 *
 * `ultimoLoginEm` sozinho mente: a sessão se renova sem login novo. Em
 * 12/09/2026, o último login de um advogado era de 24/08, e ele tinha usado o
 * sistema às 6h daquele mesmo dia. A renovação da sessão grava um refresh token
 * novo, e o trabalho grava auditoria — o maior dos três é o último uso real.
 *
 * A linha de LOGIN da auditoria não entra: o login que deu certo já está em
 * `ultimoLoginEm`, e quem só chegou até a tela de senha não usou o sistema.
 */
export function ultimoUsoReal(...datas: (Date | null | undefined)[]): Date | null {
  let maior: Date | null = null;
  for (const d of datas) {
    if (d && (!maior || d.getTime() > maior.getTime())) maior = d;
  }
  return maior;
}

/**
 * O ÚLTIMO USO REAL DE VÁRIAS PESSOAS DE UMA VEZ — três consultas para qualquer
 * quantidade de gente.
 *
 * Fez falta fora da "Carga da equipe": para avisar os colegas de que o
 * responsável por uma tarefa sumiu, a faixa, o painel e a gaveta da atividade
 * precisam saber quando ele esteve aqui — pelas mesmas três fontes.
 *
 * Quem não existe mais, ou foi desativado, volta com `ativo: false`.
 */
export async function ultimosUsosReais(
  prisma: Pick<PrismaService, 'user' | 'refreshToken' | 'auditoria'>,
  ids: string[],
): Promise<Map<string, { ativo: boolean; ultimoUso: Date | null }>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const usos = new Map<string, { ativo: boolean; ultimoUso: Date | null }>();
  if (!unicos.length) return usos;

  const [pessoas, sessoes, acoes] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: unicos } },
      select: { id: true, ativo: true, ultimoLoginEm: true },
    }),
    prisma.refreshToken.groupBy({
      by: ['userId'],
      where: { userId: { in: unicos } },
      _max: { createdAt: true },
    }),
    prisma.auditoria.groupBy({
      by: ['userId'],
      where: { userId: { in: unicos }, acao: { not: 'LOGIN' } },
      _max: { createdAt: true },
    }),
  ]);
  const sessaoDe = new Map(sessoes.map((s) => [s.userId, s._max.createdAt]));
  const acaoDe = new Map(acoes.map((a) => [a.userId, a._max.createdAt]));
  for (const p of pessoas) {
    usos.set(p.id, {
      ativo: p.ativo,
      ultimoUso: ultimoUsoReal(p.ultimoLoginEm, sessaoDe.get(p.id), acaoDe.get(p.id)),
    });
  }
  return usos;
}
