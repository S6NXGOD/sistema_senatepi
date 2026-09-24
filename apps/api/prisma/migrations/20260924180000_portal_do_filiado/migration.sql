-- PORTAL DO FILIADO — o acesso da própria pessoa ao que é dela. 24/09/2026.
--
-- O PEDIDO DO DONO: "um portal do filiado com o login sendo o CPF e uma senha
-- provisória gerada pelo sistema tanto pelo admin como no recadastramento
-- (caso seja o primeiro login). Pode ser mudada a senha pelo administrativo."
--
-- O LOGIN NÃO PODE SER SÓ O CPF, e quem decidiu foi a medição (5.810 ATIVOS):
--
--   matrícula ........... 5.810 (100%), todas distintas
--   CPF ................. 2.293 (39%)
--   nascimento .............. 545 (9%)
--   e-mail .................. 302 (5%)
--
-- CPF sozinho trancaria 3.517 pessoas para fora no dia 1. O portal aceita CPF
-- **ou** matrícula no mesmo campo: os dois já são ÚNICOS no banco, o CPF é o que
-- a pessoa lembra e a matrícula é o que ela tem impressa na carteirinha. O
-- recadastramento vai colhendo CPF e ele vira o caminho principal sozinho.
--
-- MESMA FORMA DO PORTAL PATRONAL, de propósito: `senha_hash` + `primeiro_acesso`
-- já são o desenho que a casa conhece (ver `portal-empresa`), com segredo de JWT
-- próprio e troca obrigatória da provisória. Repetir o que funciona custa menos
-- do que inventar um segundo jeito de autenticar.
--
-- NULO EM `portal_senha_hash` = SEM ACESSO. Não é um estado de erro: é o estado
-- dos 5.810 hoje, e é o que a estratégia checa para recusar a sessão na hora em
-- que a secretaria revogar.
--
-- ADITIVA E IDEMPOTENTE. Nenhuma coluna existente é alterada ou removida, e
-- todas nascem opcionais (ou com default), para o contêiner ANTIGO continuar
-- atendendo contra este banco durante a janela de troca do deploy.
ALTER TABLE "filiados"
  ADD COLUMN IF NOT EXISTS "portal_senha_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "portal_primeiro_acesso" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "portal_senha_definida_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "portal_ultimo_acesso_em" TIMESTAMP(3);

-- Só quem TEM acesso interessa às listagens ("quantos filiados usam o portal?"),
-- e são poucos no começo: índice parcial, que não paga o custo das 5.810 linhas
-- sem acesso.
CREATE INDEX IF NOT EXISTS "filiados_portal_com_acesso"
  ON "filiados" ("portal_ultimo_acesso_em")
  WHERE "portal_senha_hash" IS NOT NULL;
