-- Ícone da aba do navegador e do app instalado, enviado pela tela.
--
-- Migration separada da que criou a tabela, e não uma edição dela: a anterior
-- já foi aplicada nos bancos de desenvolvimento, e reescrever migration já
-- rodada deixa os ambientes fora de sincronia sem aviso.
ALTER TABLE "identidade_visual" ADD COLUMN "icone_key" TEXT;
