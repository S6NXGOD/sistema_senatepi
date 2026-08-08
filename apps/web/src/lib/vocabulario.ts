import { tenant } from '@/tenant.config';

/**
 * COMO ESTA INSTALAÇÃO CHAMA AS PESSOAS QUE REPRESENTA.
 *
 * "Filiado" no SENATEPI, "servidor" no SINDSERM. O `tenant.vocabulario` já
 * guardava isso, mas NINGUÉM lia — a configuração existia e a tela continuava
 * escrita à mão. Este módulo é a ponte que faltava.
 *
 * AS QUATRO FORMAS existem porque português exige as quatro, e concatenar
 * `.toUpperCase()` no lugar errado produz "Filiados" virando "SERVIDORES" no
 * meio de uma frase. É mais honesto ter as formas prontas do que espalhar
 * manipulação de string pela interface.
 *
 * NÃO USE ISTO PARA: rota (`/filiados` é URL, não texto), chave de permissão
 * (`'filiados'` é identificador), nome de campo da API (`filiadoId`) ou nome de
 * arquivo. Trocar qualquer um desses quebra o sistema sem mudar uma palavra na
 * tela.
 */

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const V = {
  /** "filiado" · "servidor" */
  filiado: tenant.vocabulario.filiado,
  /** "filiados" · "servidores" */
  filiados: tenant.vocabulario.filiados,
  /** "Filiado" · "Servidor" — início de frase, rótulo, título. */
  Filiado: capitalizar(tenant.vocabulario.filiado),
  /** "Filiados" · "Servidores" — menu, título de página, aba. */
  Filiados: capitalizar(tenant.vocabulario.filiados),
  /** "matrícula" · como a instalação chama o número de identificação. */
  matricula: tenant.vocabulario.matricula,
  /** "Matrícula" */
  Matricula: capitalizar(tenant.vocabulario.matricula),
} as const;
