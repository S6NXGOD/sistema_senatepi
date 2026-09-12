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
