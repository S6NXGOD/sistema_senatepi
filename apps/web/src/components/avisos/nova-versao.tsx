'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Aviso de versão nova — o jeito de atualizar o aplicativo de todo mundo sem
 * pedir que cada um limpe o cache do navegador.
 *
 * O PROBLEMA
 * O sistema é instalável (PWA). Num celular, o aplicativo aberto pode ficar
 * dias sem recarregar a página: o Next serve arquivos com hash, então o
 * navegador só pega a versão nova quando há uma NAVEGAÇÃO — e no app instalado
 * isso pode simplesmente não acontecer. O resultado é gente usando uma versão
 * antiga sem saber, e correções publicadas que não chegam.
 *
 * COMO FUNCIONA
 * A API informa em `/health` o commit publicado. Este componente guarda o valor
 * que estava no ar quando a página carregou e compara de tempos em tempos.
 * Mudou = saiu deploy novo; aparece o aviso, e o clique faz `location.reload()`,
 * que é o que efetivamente troca os arquivos.
 *
 * DECISÕES
 *  - Não recarrega sozinho. Recarregar por conta própria no meio de um
 *    formulário faria a pessoa perder o que estava digitando; a atualização é
 *    oferecida, não imposta.
 *  - Consulta a cada 5 minutos e só quando a aba está visível: em aba de fundo
 *    não há o que atualizar, e o celular agradece a bateria.
 *  - Falha em silêncio. Se `/health` não responde, o problema é outro e este
 *    aviso não deve competir com ele.
 */
const INTERVALO_MS = 5 * 60_000;

export function AvisoNovaVersao() {
  const versaoInicial = useRef<string | null>(null);
  const [temNova, setTemNova] = useState(false);
  const [dispensado, setDispensado] = useState(false);

  useEffect(() => {
    let vivo = true;

    async function conferir() {
      if (document.visibilityState !== 'visible') return;
      try {
        const { data } = await api.get<{ versao?: string }>('/health', { timeout: 10_000 });
        const versao = data?.versao;
        if (!vivo || !versao || versao === 'dev') return;
        if (versaoInicial.current === null) {
          versaoInicial.current = versao;
          return;
        }
        if (versao !== versaoInicial.current) setTemNova(true);
      } catch {
        /* API fora do ar é outro problema — este aviso não opina sobre ele */
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

  if (!temNova || dispensado) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 sm:bottom-4">
      <div className="flex w-full max-w-md items-center gap-3 rounded-xl border border-senatepi-300 bg-card p-3 shadow-lg dark:border-senatepi-800">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-senatepi-50 dark:bg-senatepi-900/40">
          <RefreshCw className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Atualização disponível</p>
          <p className="text-xs text-muted-foreground">
            Recarregue para usar a versão nova do sistema.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-senatepi-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-senatepi-700"
        >
          Atualizar
        </button>
        <button
          type="button"
          onClick={() => setDispensado(true)}
          aria-label="Agora não"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
