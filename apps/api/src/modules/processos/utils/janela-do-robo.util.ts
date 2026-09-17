/**
 * OS NÚMEROS DO ROBÔ, NUM LUGAR SÓ (17/09/2026).
 *
 * POR QUE ESTE ARQUIVO NASCEU
 * Quatro números mandam em tudo o que a automação faz, e os quatro estavam
 * escritos em arquivos diferentes, cada um com a sua explicação:
 *
 *   · 15 dias  — `DIAS_ATO_RECENTE`, em `automacao-prazos.service.ts`;
 *   · 30 dias  — literal em `processos.service.ts` (`dispararAutomacao`) E de
 *                novo em `VALIDADE_DIAS` (`tpu.util.ts`), casados por comentário
 *                e por um teste que lê o fonte do outro lado;
 *   · 3 dias úteis — `PRAZO_PADRAO_DIAS_UTEIS`, em `automacao-prazos`;
 *   · 3 dias   — `JANELA_DIAS`, em `correlacao.util.ts`.
 *
 * Números casados por comentário se descasam. Já aconteceu nesta área: o selo
 * âmbar não tinha janela nenhuma e a automação tinha 30 dias, e a lista passou
 * semanas mostrando onze avisos que a ficha do mesmo processo não mostrava.
 *
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * Não muda valor nenhum. É mudança de ENDEREÇO, de propósito: quem for mexer
 * num destes números vai ler aqui o que ele significa para os outros três antes
 * de mexer. Cada constante carrega o porquê inteiro, e não um resumo.
 */

/**
 * ATÉ QUANDO O ATO AINDA É NOTÍCIA — 15 dias.
 *
 * É a régua da URGÊNCIA, compartilhada entre as duas automações que escrevem na
 * mesma agenda (o robô de prazos e a correlação do DJEN). Réguas diferentes
 * fariam duas noções de "urgente" conviverem na mesma coluna.
 *
 * A fronteira tem base no prazo processual, não em preferência: 15 dias úteis é
 * o prazo recursal do CPC (art. 1.003) e 8 dias o da CLT. Descobrir um ato
 * dentro desta faixa é descobrir algo que talvez ainda dê para salvar — e é
 * exatamente isso que "urgente" deveria significar. Passado ele, o que havia
 * para perder já se perdeu, e marcar como urgente hoje não recupera nada: só
 * rebaixa o que é urgente de verdade.
 *
 * O corte anterior era de 7 dias, e tornava a marca quase inalcançável: com o
 * lembrete de conferência vencendo em 3 dias úteis (~5 corridos), só um ato de
 * exatamente sete dias caía na janela. Uma regra que nunca dispara não é
 * conservadora, é morta.
 *
 * Desde 17/09/2026 este número tem um segundo emprego: é ele que separa
 * `ANDAMENTO_ANTIGO` de `SEM_TEOR_NO_DATAJUD` no carimbo do robô. A mesma
 * pergunta ("o prazo ainda pode estar correndo?") não pode ter duas réguas.
 */
export const DIAS_ATO_RECENTE = 15;

/**
 * JANELA DE CAPTURA E DE VALIDADE — 30 dias.
 *
 * Duas coisas que PRECISAM ser o mesmo número, e por isso são um só:
 *
 *  1. o robô só olha andamentos dos últimos 30 dias (`dispararAutomacao`). Sem
 *     essa janela, importar um processo antigo despejaria a história inteira na
 *     agenda de alguém — o acervo tem movimentos de até 3.466 dias;
 *
 *  2. o selo âmbar de PRAZO (`VALIDADE_DIAS.PRAZO`, em `tpu.util.ts`) vale
 *     pelos mesmos 30 dias. Enquanto os dois forem iguais, "ato dentro da janela
 *     sem providência" significa uma coisa só, e é essa que o selo denuncia. Se
 *     divergirem, o selo volta a mentir — foi o defeito de 25/08/2026, quando a
 *     lista não tinha janela nenhuma e mostrava onze avisos, nenhum com menos de
 *     15 dias e dez com mais de 30.
 *
 * O DJEN usa o mesmo corte para rotular `FORA_DA_JANELA`: publicação com mais
 * de 30 dias não vira tarefa nem proposta.
 */
export const DIAS_JANELA_DE_CAPTURA = 30;

/**
 * PRAZO DE CONFERÊNCIA — 3 dias úteis.
 *
 * Eram 5, e 5 é justamente o prazo processual mais comum depois de uma
 * publicação (embargos de declaração, entre outros). Um lembrete que existe para
 * PERGUNTAR "isto tem prazo?" chegando no último dia da janela curta não sobra
 * tempo para nada. Três deixa dois dias úteis de margem, sem encher a agenda de
 * lembrete prematuro.
 *
 * SEM LEITOR NO CAMINHO CEGO, DESDE 17/09/2026 — e fica aqui por isso mesmo.
 * Quem lia este número era o criador cego de `criarPrazo`, que parou de existir:
 * sem o teor do ato, nenhuma data de conferência é honesta. O número continua
 * sendo a régua da casa para quando houver um criador que SAIBA o que pedir; o
 * caminho do Diário, que sabe, calcula os seus dias por providência
 * (`diasParaLembrete`, em `providencia.util.ts`), e não por este padrão.
 *
 * Apagar a constante seria perder a única coisa que a decisão de 17/09 não
 * revogou: o valor certo, com o porquê dele, para o dia em que voltar a ser
 * preciso.
 */
export const DIAS_UTEIS_DE_CONFERENCIA = 3;

/**
 * JANELA DO CASAMENTO DataJud ↔ DJEN — e ela tem DOIS lados, de tamanhos
 * diferentes.
 *
 * Quanto tempo pode separar o ato (DataJud) da publicação (DJEN) para que os
 * dois sejam tratados como o MESMO fato. Até 17/09/2026 havia um número só e um
 * sinal só: valia apenas publicação DEPOIS do ato. Mas o DJEN chega em D+0 e o
 * DataJud tem mediana de 62 dias de atraso, então na prática o teor chega
 * PRIMEIRO — e a regra o ignorava. Nas 294 movimentações de publicação/intimação
 * dos 60 dias anteriores, 153 tinham publicação até 5 dias ANTES do ato e só 94
 * até 3 dias depois; 106 das 153 viraram tarefa cega com o texto do ato já
 * gravado no banco, a cinco dias dali.
 */
export const DIAS_CASAMENTO_PUBLICACAO_DEPOIS = 3;

/**
 * O outro lado: publicação até 5 dias ANTES do ato.
 *
 * É o atraso do índice do CNJ em relação ao diário. A massa cabe em cinco (153)
 * e a cauda fica de fora (26). Esticar mais passaria a juntar ato com ato: num
 * processo movimentado, a intimação de segunda e a de sexta são fatos
 * diferentes, e um par errado é pior que par nenhum.
 */
export const DIAS_CASAMENTO_PUBLICACAO_ANTES = 5;

/**
 * O TETO DE QUEM SILENCIA — 3 dias, e mais apertado que a janela cheia.
 *
 * `vincularMovimentacoesNovas` é a única passada que grava
 * `movimentacao.compromissoId` a partir de uma publicação que JÁ virou
 * atividade. E `compromissoId` é o silenciador mais forte do sistema: apaga o
 * selo âmbar e tira o andamento da varredura, para sempre.
 *
 * Com a janela cheia dos dois lados, essa passada ganhou um jeito novo de errar:
 * adotar um ato POSTERIOR à publicação que na verdade é outro fato. Medido na
 * produção em 17/09/2026 — 12 pares candidatos, e NENHUM deles é o mesmo ato
 * chegando atrasado: uma publicação de "avaliar recurso" ao lado de uma
 * "Conclusão para julgamento" dois dias depois, uma de "elaborar manifestação"
 * ao lado de um "Decurso de Prazo" quatro dias depois. (O filtro de gatilho
 * rejeita os doze hoje, então o defeito é latente e não está no ar — mas quem o
 * segura é uma proteção de outro assunto.)
 *
 * Três dias é o que a razão ESTRUTURAL justifica: disponibilizado no dia D, o
 * ato é publicado em D+1, e o fim de semana estica isso até D+3. Do quarto dia
 * em diante não há mecanismo conhecido que explique o par — há só a coincidência
 * de datas, e o preço dela é o silêncio permanente de um ato de verdade.
 */
export const DIAS_ADOCAO_DO_ATO_POSTERIOR = 3;
