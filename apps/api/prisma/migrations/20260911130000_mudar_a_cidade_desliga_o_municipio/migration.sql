-- MUDOU A CIDADE, O MUNICÍPIO LIGADO SAI — em qualquer porta de escrita.
--
-- `filiados.municipio_codigo` é DERIVADO do texto (`cidade`/`estado`): quem o
-- escreve é a varredura da madrugada ou, desde Contas Públicas, uma pessoa que
-- confirmou uma grafia ("Monte Alegre" é Monte Alegre do Piauí), e essa
-- ligação fica MANUAL — a varredura não encosta nela.
--
-- O DEFEITO QUE ISTO FECHA: ligada a Monte Alegre do Piauí, a filiada se muda
-- e o balcão troca a cidade dela para "Parnaíba". Nada desfazia a ligação: ela
-- continuaria contando em "moram" de Monte Alegre, e aparecendo na lista de
-- quem mora lá com "Parnaíba" escrito na ficha. Há pelo menos cinco portas que
-- gravam cidade de filiado (ficha, recadastramento, duas importações, colônia,
-- mesclagem de duplicados) — consertar uma a uma deixaria a sexta aberta.
--
-- A REGRA: se o UPDATE muda `cidade` ou `estado` e NÃO mexe na ligação, a
-- ligação é apagada; a madrugada liga de novo pelo texto novo. Quem grava a
-- ligação junto com o texto (nenhuma porta hoje) é respeitado.
--
-- IDEMPOTENTE (CREATE OR REPLACE + DROP IF EXISTS): roda em um banco por
-- sindicato, e já houve DDL que derrubou a API por reexecução.

CREATE OR REPLACE FUNCTION filiados_mudou_a_cidade() RETURNS trigger AS $$
BEGIN
  IF (NEW.cidade IS DISTINCT FROM OLD.cidade OR NEW.estado IS DISTINCT FROM OLD.estado)
     AND NEW.municipio_codigo IS NOT DISTINCT FROM OLD.municipio_codigo
     AND NEW.municipio_origem IS NOT DISTINCT FROM OLD.municipio_origem THEN
    NEW.municipio_codigo := NULL;
    NEW.municipio_origem := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS filiados_mudou_a_cidade ON "filiados";

CREATE TRIGGER filiados_mudou_a_cidade
  BEFORE UPDATE OF cidade, estado ON "filiados"
  FOR EACH ROW EXECUTE FUNCTION filiados_mudou_a_cidade();
