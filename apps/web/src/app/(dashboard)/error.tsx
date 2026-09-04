'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * QUANDO UMA TELA QUEBRA, O SISTEMA INTEIRO NÃO PRECISA SUMIR.
 *
 * Sem este arquivo, qualquer exceção de componente dava a tela branca do Next
 * — "Application error: a client-side exception has occurred (see the browser
 * console for more information)". Aconteceu de verdade, ao clicar num
 * processo: o painel inteiro morria, o menu sumia, e a única saída era recarregar
 * a página no braço. Pedir "veja o console do navegador" a uma secretária no
 * balcão é o mesmo que não dizer nada.
 *
 * O QUE ELE NÃO FAZ: fingir que está tudo bem. Não há mensagem tranquilizadora
 * genérica nem "ops!". A tela diz que a página falhou, oferece as duas saídas
 * que realmente existem (tentar de novo e voltar) e mostra a identificação
 * técnica — é ela que resolve o chamado, e escondê-la só transfere o trabalho
 * para quem for investigar.
 *
 * ESCOPO: fica no segmento `(dashboard)`, então o cabeçalho e o menu continuam
 * de pé. Quem quebrou foi a página, não o sistema — e continuar navegando é
 * quase sempre possível.
 */
export default function ErroNaPagina({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // O console continua sendo onde se investiga; isto só garante que a
    // mensagem não se perca quando o Next substitui a árvore pela tela de erro.
    console.error('[painel] falha ao renderizar a página:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md p-6 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/40">
          <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
        </span>
        <h1 className="mt-3 text-base font-semibold">Esta página não abriu</h1>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          Alguma coisa falhou ao montar a tela. O resto do sistema continua funcionando — dá para
          tentar de novo ou voltar para a página anterior.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4" /> Tentar de novo
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
        </div>

        {/*
          O CÓDIGO É PARA QUEM VAI CONSERTAR. O `digest` do Next é o que liga
          esta tela à linha do log do servidor; sem ele, o chamado começa com
          "deu erro numa tela" e ninguém acha nada.
        */}
        {error.digest && (
          <p className="mt-4 border-t pt-3 font-mono text-[11px] text-muted-foreground">
            Código da falha: {error.digest}
          </p>
        )}
      </Card>
    </div>
  );
}
