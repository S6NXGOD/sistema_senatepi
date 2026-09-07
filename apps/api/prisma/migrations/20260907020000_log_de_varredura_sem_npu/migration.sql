-- A LINHA DE RESUMO DA VARREDURA NÃO TEM NPU.
--
-- O log guardava uma linha por PROCESSO consultado, e por isso não sabia dizer
-- se o robô havia rodado: no DJEN, `logSync.registrar` só era chamado quando
-- havia publicação NOVA para gravar. Uma varredura de fim de semana — quando o
-- Diário não circula — corria inteira, consultava as oito OABs, não achava nada
-- e não deixava rastro nenhum.
--
-- A tela então lia "nenhuma consulta bem-sucedida em 48h" e anunciava a
-- integração como PARADA. Ela estava funcionando; era sábado.
--
-- A varredura agora grava uma linha de resumo por rodada, e essa linha não fala
-- de um processo — fala da rodada. Daí o NPU opcional.
--
-- ADITIVA POR CONSTRUÇÃO: soltar o NOT NULL não invalida nenhuma linha
-- existente nem quebra o contêiner antigo, que continua mandando o número em
-- toda chamada. É o que a janela de troca do deploy exige.
ALTER TABLE "logs_sincronizacao_datajud"
  ALTER COLUMN "numero_cnj" DROP NOT NULL;
