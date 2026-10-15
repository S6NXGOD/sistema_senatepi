import { UserRole } from '@prisma/client';
import {
  MODULOS,
  ModuloKey,
  NivelPermissao,
  RANK_NIVEL,
  nivelEfetivo,
} from '../../common/permissions/permissoes.constants';

/**
 * DE ONDE O DOCUMENTO VEM × PARA ONDE ELE VAI — e por que os dois não podem
 * exigir a mesma coisa.
 *
 * 15/10/2026. Uma advogada tentou usar um documento de um filiado e levou
 * *"Você não tem permissão para acessar os documentos deste registro."* O
 * perfil dela (reproduzido com a matriz real: `filiados: VISUALIZAR`,
 * `processos: EDITAR`, `agenda: EDITAR`) estava certo para o que ela queria
 * fazer — e mesmo assim o `POST /anexos/puxar` era recusado nos TRÊS destinos,
 * inclusive naqueles em que ela edita.
 *
 * A CAUSA. A regra antiga tirava UM nível do verbo HTTP e o aplicava a TODOS
 * os módulos citados na requisição. Num `puxar`, `filiadoId` só diz **de quem é
 * o acervo que está sendo LIDO** — nenhum dado do filiado é alterado —, mas
 * como o verbo era POST, ele passou a exigir `filiados: EDITAR`. O comentário
 * do código dizia a regra certa ("precisa poder VER o filiado") e o código
 * fazia o contrário.
 *
 * Consequência medida: **nenhum ADVOGADO conseguia puxar documento do acervo**,
 * porque o preset do perfil é `filiados: VISUALIZAR`. A função existia desde
 * setembro com ZERO usos, e em 05/10 eu atribuí isso a falta de peso visual
 * (`senatepi-peso-nao-lugar`). Era também um 403.
 *
 * A REGRA QUE FICA:
 *
 *   ORIGEM (`filiadoId`) .......... sempre VISUALIZAR — só se lê o acervo
 *   DESTINO (processo/atendimento/
 *            compromisso) ......... VISUALIZAR na leitura, EDITAR na escrita
 *
 * É pura e mora aqui fora porque DOIS caminhos precisam dela: o guarda (rotas
 * JSON) e o próprio handler de upload — que o guarda não consegue inspecionar,
 * ver `exigenciasDoAnexo`.
 */

export interface ExigenciaDeAnexo {
  modulo: ModuloKey;
  nivel: NivelPermissao;
}

const LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/** O destino, e o módulo sob o qual ele vive. */
const DESTINOS: { campo: string; modulo: ModuloKey }[] = [
  { campo: 'processoId', modulo: 'processos' },
  { campo: 'compromissoId', modulo: 'agenda' },
  { campo: 'atendimentoId', modulo: 'atendimentos' },
];

/**
 * O que esta requisição exige, módulo a módulo.
 *
 * `fonte` é a união de query e body — o que der para ler. Sem nenhum pai
 * identificado a lista vem vazia, e aí quem recusa é o DTO, não a permissão.
 */
export function exigenciasDoAnexo(
  metodo: string,
  fonte: Record<string, unknown>,
): ExigenciaDeAnexo[] {
  const doMetodo: NivelPermissao = LEITURA.has(metodo.toUpperCase())
    ? 'VISUALIZAR'
    : 'EDITAR';

  const exigencias: ExigenciaDeAnexo[] = [];

  /*
    A ORIGEM É SEMPRE LEITURA. Quem monta a lista de documentos de um filiado
    precisa poder VER o filiado — e só. Puxar um documento dele para um
    processo não muda nada na ficha dele; o que muda é o processo, e esse é
    cobrado logo abaixo, com EDITAR.
  */
  if (fonte.filiadoId) exigencias.push({ modulo: 'filiados', nivel: 'VISUALIZAR' });

  for (const { campo, modulo } of DESTINOS) {
    if (fonte[campo]) exigencias.push({ modulo, nivel: doMetodo });
  }

  return exigencias;
}

/** Quem está pedindo — só o que a decisão precisa saber. */
export interface QuemPede {
  role: UserRole;
  permissoes?: unknown;
}

/**
 * A primeira exigência que esta pessoa não cumpre — ou `null` se cumpre todas.
 *
 * Devolve a exigência inteira (e não um booleano) porque a recusa tem de DIZER
 * o que faltou: foi exatamente a falta disso que transformou este caso num
 * chamado. Ver `fraseDaRecusa`.
 */
export function faltaParaOAnexo(
  quem: QuemPede,
  exigencias: ExigenciaDeAnexo[],
): ExigenciaDeAnexo | null {
  // O Administrador alcança tudo, como no `PermissionsGuard`.
  if (quem.role === UserRole.ADMINISTRADOR) return null;
  for (const e of exigencias) {
    if (RANK_NIVEL[nivelEfetivo(quem.role, quem.permissoes, e.modulo)] < RANK_NIVEL[e.nivel]) {
      return e;
    }
  }
  return null;
}

/**
 * A RECUSA NOMEIA O QUE FALTOU — a mesma forma do `PermissionsGuard`.
 *
 * A frase antiga era *"Você não tem permissão para acessar os documentos deste
 * registro."*: ela não diz qual módulo, nem qual nível, nem o que pedir. A
 * advogada não tinha como abrir um chamado útil, e quem administra não tinha
 * como saber qual linha da matriz mexer sem abrir log de servidor.
 */
export function fraseDaRecusa(quem: QuemPede, falta: ExigenciaDeAnexo): string {
  const rotulo = MODULOS.find((m) => m.key === falta.modulo)?.label ?? falta.modulo;
  const nivel = nivelEfetivo(quem.role, quem.permissoes, falta.modulo);
  const comoEsta = nivel === 'SEM_ACESSO' ? 'sem acesso' : 'somente visualização';
  const exigido = falta.nivel === 'EDITAR' ? 'edição' : 'visualização';
  return (
    `Este documento pertence a "${rotulo}", e seu perfil está ${comoEsta} nesse módulo ` +
    `— a ação exige ${exigido}. Peça a um Administrador para ajustar a matriz de permissões.`
  );
}
