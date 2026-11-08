/**
 * POR QUE A BUSCA NO DIÁRIO PAROU — a frase que o aviso não sabia dizer.
 *
 * O aviso do painel dizia *"O Diário de Justiça não respondeu às últimas
 * tentativas"* desde 02/11/2026. Não era verdade: medido no log da produção, a
 * partir de 04/11 as consultas não conseguiam nem CONECTAR (timeout de conexão,
 * 8 a 14 seguidas por noite) — quem não respondia era a ponte, o servidor no
 * Brasil por onde o sistema chega ao Diário. O Diário estava no ar o tempo todo.
 *
 * Culpar o Diário manda esperar; culpar a ponte manda reiniciar um servidor. A
 * diferença é a ação inteira, e ela já estava escrita: desde 03/11 a linha de
 * resumo da rodada grava o motivo da parada (`DjenService.motivoDaSuspensao`).
 * Faltava a tela ler.
 *
 * Devolve `null` quando o motivo não é reconhecido — aí o aviso continua com a
 * frase genérica, que é vaga mas não é falsa.
 */
export function causaDaParada(fonte: string, ultimoErro: string | null | undefined): string | null {
  if (fonte !== 'DJEN' || !ultimoErro) return null;
  if (/não alcançaram o Diário|falha de rede|CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(ultimoErro)) {
    return 'A ponte no Brasil, por onde o sistema chega ao Diário, não está respondendo — o Diário em si está no ar.';
  }
  const recusa = /quem recusou: ([^)]+)\)/.exec(ultimoErro);
  if (recusa) return `O Diário recusou as consultas vindas deste servidor (quem recusou: ${recusa[1]}).`;
  return null;
}
