-- CORTE DE SESSÃO — permite deslogar todo mundo de imediato.
--
-- O PROBLEMA
-- Apagar as linhas de `refresh_tokens` NÃO desloga ninguém. O token de acesso é
-- um JWT autocontido, assinado e válido por 30 dias (`JWT_ACCESS_EXPIRES_IN`):
-- enquanto ele não expira, nenhuma requisição chega a pedir refresh, e a sessão
-- continua de pé. Na prática, tirar alguém de um aparelho emprestado — ou
-- encerrar uma demonstração feita com a conta administrativa — dependia de
-- esperar um mês.
--
-- A SOLUÇÃO
-- Uma marca de tempo por usuário. O `JwtStrategy` compara o `iat` (instante de
-- emissão) do token com esta coluna e recusa o que for mais antigo. Como a
-- validação já busca o usuário no banco a cada requisição — é assim que
-- desativar um usuário tem efeito imediato —, a checagem não custa consulta
-- nova.
--
-- NULO é o estado normal: nunca houve corte para aquele usuário. A coluna só é
-- preenchida pelo script `npm run forcar-logout -w @senatepi/api`, que não faz
-- parte de nenhuma rotina.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "sessoes_validas_apos" TIMESTAMP(3);
