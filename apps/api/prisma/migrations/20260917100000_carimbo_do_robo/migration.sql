-- O ROBÔ GANHA COLUNAS PRÓPRIAS PARA A DECISÃO DELE (17/09/2026).
--
-- O ERRO QUE ISTO CORRIGE. Horas antes, no mesmo dia, o criador cego passou a
-- carimbar `dispensado_em/dispensado_por/dispensado_motivo` para registrar "não
-- abri tarefa porque o andamento é velho". Essas três colunas são a DISPENSA
-- HUMANA do radar de audiências, e `atoAcionavel` (utils/tpu.util.ts) apaga o
-- selo âmbar quando `dispensado_em` existe. O resultado não seria menos ruído:
-- seria SILÊNCIO — o ato sairia da agenda E da tela no mesmo movimento.
--
-- O DEFEITO NÃO CHEGOU A PRODUZIR DADO, e o número é este: a produção tem ZERO
-- linhas com `dispensado_motivo = 'ANDAMENTO_ANTIGO_SEM_TEOR'` (conferido em
-- 17/09/2026). O código errado subiu, mas a varredura noturna das 02h ainda não
-- rodou sob ele. As 65 dispensas que existem hoje têm AUTOR e outro motivo:
-- são o efeito de cancelar 29 tarefas inúteis pela porta da Agenda, que é a
-- decisão de gente funcionando como deve.
--
-- As decisões têm efeitos opostos e por isso não podem dividir coluna: a da
-- pessoa cala o aviso; a do robô é o que torna o aviso necessário.
--
-- ADITIVA E IDEMPOTENTE. Três colunas nuláveis, sem índice e sem chave
-- estrangeira. Na janela de troca o contêiner ANTIGO continua gravando nas
-- colunas velhas e a linha segue válida; o novo lê e escreve nas novas.
-- `avaliado_por` sem FK de propósito: é trilha de decisão, e apagar a pessoa não
-- pode travar nem ser travado por isto.
ALTER TABLE "movimentacoes_processuais" ADD COLUMN IF NOT EXISTS "avaliado_em" TIMESTAMP(3);
ALTER TABLE "movimentacoes_processuais" ADD COLUMN IF NOT EXISTS "avaliado_por" TEXT;
ALTER TABLE "movimentacoes_processuais" ADD COLUMN IF NOT EXISTS "avaliado_motivo" TEXT;

-- MOVE as linhas carimbadas por engano — ZERO hoje, e é por isso que ele fica.
--
-- Rodando agora, este UPDATE não casa nada. Ele existe pela JANELA DE TROCA: o
-- contêiner antigo atende contra o banco já migrado enquanto o novo sobe, e é
-- ele que ainda grava `ANDAMENTO_ANTIGO_SEM_TEOR` sem autor. Uma sincronização
-- nessa janela — ou o cron das 02h caindo nela — cria exatamente as linhas que
-- isto conserta. (O mesmo UPDATE roda também em toda varredura do código novo,
-- em `repararCarimboNasColunasDeGente`: migração é tiro único, e a janela não
-- tem hora marcada.)
--
-- Não é backfill inventado: se a linha existir, a decisão existe, foi gravada e
-- está no lugar errado. Ela vai para as colunas novas com a MESMA data
-- (`avaliado_em` recebe `dispensado_em`, e não `now()`: o que importa é quando o
-- robô decidiu, não quando a migração rodou), e a dispensa volta a NULL nessas
-- linhas — que é o que devolve o selo âmbar a elas.
--
-- `ANDAMENTO_ANTIGO_SEM_TEOR` foi o vocabulário de algumas horas. Vira
-- `ANDAMENTO_ANTIGO`, que é o nome do mesmo motivo em `MOTIVOS_DO_ROBO` — um
-- motivo que o código não conhece é um motivo que a tela não consegue explicar.
--
-- DUAS TRAVAS PARA NUNCA TOCAR EM DISPENSA DE GENTE:
--   · o motivo é exatamente o que só o robô escreveu;
--   · `dispensado_por IS NULL` — quando é uma pessoa, o id dela está lá.
--
-- IDEMPOTENTE: depois de rodar, `dispensado_motivo` dessas linhas é NULL e
-- nenhuma volta a casar. Rodar de novo não altera nada.
UPDATE "movimentacoes_processuais"
   SET "avaliado_em"      = "dispensado_em",
       "avaliado_por"     = NULL,
       "avaliado_motivo"  = 'ANDAMENTO_ANTIGO',
       "dispensado_em"    = NULL,
       "dispensado_por"   = NULL,
       "dispensado_motivo" = NULL
 WHERE "dispensado_motivo" = 'ANDAMENTO_ANTIGO_SEM_TEOR'
   AND "dispensado_por" IS NULL;
