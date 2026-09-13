'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { chaveLocal } from '@/lib/armazenamento';
import {
  baseDaAba,
  decidirAtualizacao,
  lerVersao,
  mostrarAviso,
  trocouDeTela,
  versaoUtil,
} from '@/lib/versao-no-ar';

/**
 * Aviso de versão nova — o jeito de pôr todo mundo na versão publicada sem pedir
 * que cada um recarregue a página.
 *
 * O PROBLEMA
 * Uma aba aberta (o balcão da triagem, o app instalado no celular) pode passar o
 * dia inteiro sem recarregar. O Next só descobre o build novo quando a navegação
 * vai ao servidor, e isso não acontece na mesma tela abrindo gavetas, nem quando
 * a rota cai no cache do roteador. Resultado: gente usando a versão velha sem
 * saber — já teve print do sino dias depois de ele sair do sistema.
 *
 * COMO FUNCIONA (a regra está em `lib/versao-no-ar.ts`, com teste)
 *  - O build carimba o próprio SHA (`VERSAO_DO_BUILD`, no `next.config.ts`).
 *  - A cada 5 minutos, e ao voltar para a aba, lê o `/versao` DA PRÓPRIA WEB —
 *    mesma origem, sem token, sem banco. Antes lia o `/api/health`, e a API sobe
 *    sem ordem em relação à web: avisava cedo demais e depois calava.
 *  - Diferente e a pessoa na mesma tela: aparece o cartão.
 *  - Diferente e a pessoa troca de tela (o caminho, não a query): recarrega ali.
 *    A tela de destino remonta com o código novo; o formulário da tela anterior
 *    ela já tinha deixado para trás.
 *
 * DECISÕES
 *  - Nunca recarrega sozinho por tempo ou ao voltar para a aba: quem saiu para
 *    copiar um CPF perderia o que estava digitando.
 *  - "Agora não" vale só para a versão dispensada; a seguinte avisa de novo.
 *  - Falha em silêncio: se `/versao` não responde, o problema é outro.
 *  - Fica fora do AuthProvider (ver `providers.tsx`): vale também no login.
 *  - Abaixo dos diálogos e gavetas (z-50): o cartão nunca cobre o botão de
 *    salvar de um formulário aberto. Acima das barras fixas das páginas (z-40).
 */
const INTERVALO_MS = 5 * 60_000;
const TEMPO_LIMITE_MS = 10_000;

/**
 * Escrito por extenso de propósito: o Next só troca pelo valor o acesso literal
 * a `process.env.X`. Desestruturado, viraria `undefined` no navegador.
 */
const VERSAO_DO_BUILD = process.env.VERSAO_DO_BUILD;

/** Por aba (sessionStorage): sobrevive à recarga e impede recarregar em laço. */
const CHAVE_RECARGA = chaveLocal('recarregou-para-versao');

function lerRecarga(): string | null {
  try {
    return window.sessionStorage.getItem(CHAVE_RECARGA);
  } catch {
    return null;
  }
}

function marcarRecarga(versao: string) {
  try {
    window.sessionStorage.setItem(CHAVE_RECARGA, versao);
  } catch {
    /* navegador sem armazenamento: recarrega do mesmo jeito, só perde a trava */
  }
}

export function AvisoNovaVersao() {
  const pathname = usePathname();
  const [base, setBase] = useState<string | null>(() => versaoUtil(VERSAO_DO_BUILD));
  const [noAr, setNoAr] = useState<string | null>(null);
  const [dispensadaVersao, setDispensadaVersao] = useState<string | null>(null);
  const caminhoAnterior = useRef(pathname);

  useEffect(() => {
    let vivo = true;
    let emCurso: AbortController | null = null;

    async function conferir() {
      if (document.visibilityState !== 'visible' || emCurso) return;
      const controle = new AbortController();
      emCurso = controle;
      const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
      try {
        const resposta = await fetch('/versao', {
          cache: 'no-store',
          credentials: 'omit',
          signal: controle.signal,
        });
        if (!resposta.ok) return;
        const versao = lerVersao(await resposta.json());
        if (!vivo || !versao) return;
        setBase((atual) => baseDaAba(atual, versao));
        setNoAr(versao);
      } catch {
        /* web fora do ar, rede caída, tempo esgotado: não é este aviso que opina */
      } finally {
        clearTimeout(limite);
        emCurso = null;
      }
    }

    conferir();
    const t = setInterval(conferir, INTERVALO_MS);
    document.addEventListener('visibilitychange', conferir);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', conferir);
    };
  }, []);

  // Só o caminho dispara: `base` e `noAr` são os desta renderização, e a chegada
  // de uma versão nova, sozinha, nunca recarrega a tela em que a pessoa está.
  useEffect(() => {
    const anterior = caminhoAnterior.current;
    caminhoAnterior.current = pathname;
    const decisao = decidirAtualizacao({
      doBuild: base,
      noAr,
      trocouDeTela: trocouDeTela(anterior, pathname),
      jaRecarregouPara: lerRecarga(),
    });
    if (decisao === 'recarregar' && noAr) {
      marcarRecarga(noAr);
      window.location.reload();
    }
  }, [pathname]);

  const decisao = decidirAtualizacao({ doBuild: base, noAr, trocouDeTela: false });
  if (!mostrarAviso({ decisao, noAr, dispensadaVersao })) return null;

  function atualizarAgora() {
    if (noAr) marcarRecarga(noAr);
    window.location.reload();
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md animate-surgir items-start gap-3 rounded-xl border border-brand-300 bg-card p-3 shadow-lg dark:border-brand-800"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-900/40"
        >
          <RefreshCw className="h-4 w-4 text-brand-800 dark:text-brand-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Versão nova do sistema</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ela entra sozinha quando você mudar de tela. Para usar agora, salve o que estiver
            preenchendo e atualize.
          </p>
          <Button type="button" onClick={atualizarAgora} className="mt-2 h-11 md:h-10">
            Atualizar agora
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setDispensadaVersao(noAr)}
          aria-label="Agora não"
          title="Agora não"
          className="-mr-1 -mt-1 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
