-- ETIQUETAS QUE O SISTEMA PASSA A MANTER SOZINHO.
--
-- POR QUE APAGAR ETIQUETA QUE ALGUÉM DIGITOU
-- Porque estas quatro não são opinião de ninguém: são consequência de dados que
-- o sistema já tem. Guardá-las como texto criava duas verdades sobre o mesmo
-- fato, e a segunda envelhecia — foi assim que um processo arquivado em
-- fevereiro continuou exibindo "Fase de Execução" escrito meses antes.
--
-- Os números da produção em 07/08/2026 mostram que o trabalho manual dava
-- trabalho E saía errado:
--   · "Fase de Execução" em 4 processos — a coluna de fase processual já dizia
--     isso nos 5, com regra testada e que se corrige sozinha;
--   · "Coletiva" em 3 de 5 processos — sendo que os 5 são institucionais, ou
--     seja, coletivos por definição. Alguém esqueceu em dois;
--   · "Perícia" em nenhum — mesmo havendo um processo cujo assunto é Adicional
--     de Insalubridade, que exige laudo pericial por lei. Ninguém lembrou.
--
-- A PARTIR DAQUI:
--   · Coletiva e Perícia são DERIVADAS na leitura (`etiquetasDerivadas`), com
--     raio ⚡ na tela, e nunca gravadas — o que não é armazenado não fica velho;
--   · Fase de Execução e Recurso somem: a coluna de fase já responde, melhor;
--   · o campo de etiquetas fica para o que só uma pessoa sabe — Urgente,
--     Acordo, Aguardando Cliente, Prioridade Idoso.
--
-- Nada além destas quatro é tocado.

UPDATE "processos"
   SET "etiquetas" = COALESCE(
     (SELECT array_agg(e ORDER BY ord)
        FROM unnest("etiquetas") WITH ORDINALITY AS t(e, ord)
       WHERE e NOT IN ('Fase de Execução', 'Coletiva', 'Recurso', 'Perícia')),
     '{}'
   )
 WHERE "etiquetas" && ARRAY['Fase de Execução', 'Coletiva', 'Recurso', 'Perícia'];
