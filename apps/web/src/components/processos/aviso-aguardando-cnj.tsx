'use client';

import { CloudOff, RefreshCw } from 'lucide-react';

import { dataBr } from '@/lib/dossie';

/**
 * "O PROCESSO EXISTE, O CNJ AINDA NÃO SABE."
 *
 * O CASO REAL. Um advogado cadastra hoje um processo distribuído ontem. O
 * índice público do CNJ é alimentado em lote pelos tribunais e leva dias — às
 * vezes semanas — para conhecê-lo. Até lá a ficha abre com classe, vara,
 * assunto e linha do tempo todos vazios.
 *
 * O sistema SEMPRE tratou isso direito por dentro: o processo entra como
 * PENDENTE, que é faixa rápida da varredura, o robô o consulta TODA NOITE, o
 * retorno vazio só grava a tentativa e não apaga nada, e no dia em que o
 * tribunal alimentar o índice tudo é preenchido sozinho. Conferido na produção
 * em 25/08/2026 no 0856490-91.2026.8.18.0140: cadastrado no dia 24, consultado
 * às 03:41 do dia 25, zero resultados no índice do TJPI — comportamento
 * correto, do começo ao fim.
 *
 * O QUE FALTAVA ERA DIZER ISSO. A ficha vazia é indistinguível de uma ficha
 * quebrada, e quem cadastrou não tem como saber se errou o número, se o sistema
 * falhou, ou se é só o CNJ demorando. Na dúvida a pessoa recadastra, abre
 * chamado, ou desconfia do sistema inteiro — três desfechos ruins para um caso
 * em que nada está errado.
 *
 * Por isso o aviso mostra a ÚLTIMA TENTATIVA com data e hora: é a prova de que
 * alguém está olhando. "Aguardando" sem carimbo seria só outra forma de vazio.
 */
export function AvisoAguardandoCnj({
  numeroCNJ,
  ultimaSincronizacao,
}: {
  numeroCNJ: string;
  ultimaSincronizacao: string | null;
}) {
  const tentativa = ultimaSincronizacao ? new Date(ultimaSincronizacao) : null;

  return (
    <div className="rounded-xl border border-dashed border-sky-300 bg-sky-50/60 p-4 dark:border-sky-800 dark:bg-sky-950/30">
      <div className="flex items-start gap-3">
        <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold text-sky-900 dark:text-sky-200">
            Aguardando o CNJ publicar este processo
          </p>
          <p className="text-[13px] leading-relaxed text-sky-800/90 dark:text-sky-300/90">
            O número está cadastrado, mas ainda não aparece no índice público do
            tribunal — os tribunais alimentam esse índice em lote, e um processo
            recém-distribuído costuma levar alguns dias para entrar.{' '}
            <strong className="font-semibold">Não é preciso fazer nada.</strong>{' '}
            O sistema consulta o CNJ toda madrugada e preenche classe, vara,
            assunto e andamentos sozinho assim que eles existirem.
          </p>
          <p className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-sky-700/80 dark:text-sky-400/80">
            <RefreshCw className="h-3 w-3" />
            {tentativa ? (
              <>
                Última consulta em {dataBr(tentativa.toISOString())} às{' '}
                {tentativa.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                {' — sem resultado ainda.'}
              </>
            ) : (
              <>A primeira consulta acontece na próxima madrugada.</>
            )}
          </p>
          {/*
            O número à vista, e de propósito: se o CNJ não acha o processo por
            semanas, a causa mais provável é um dígito errado no cadastro — e a
            pessoa só percebe isso relendo o número que ela mesma digitou.
          */}
          <p className="pt-0.5 text-[11px] text-sky-700/70 dark:text-sky-400/70">
            Se a demora passar de duas semanas, confira o número digitado:{' '}
            <span className="font-mono font-medium">{numeroCNJ}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
