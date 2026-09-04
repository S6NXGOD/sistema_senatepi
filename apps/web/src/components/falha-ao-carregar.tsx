'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * FALHAR NÃO É "NÃO TEM NADA".
 *
 * O padrão que este componente existe para apagar: `const { data = [] } =
 * useQuery(...)` seguido de `if (lista.length === 0) return <p>Nenhum…</p>`. A
 * consulta falha, o valor padrão entra no lugar, e a tela AFIRMA que não há
 * nada — com a mesma cara de quando realmente não há.
 *
 * Custou um dia inteiro: a rota do painel de vínculos estava sendo engolida por
 * outra e respondia erro; a tela escrevia "Nenhum processo pendente de vínculo"
 * ao lado de um contador dizendo 29. Duas afirmações contraditórias na mesma
 * tela, e a errada era a que parecia normal.
 *
 * A MENSAGEM DA API VEM NA FRENTE quando existe: ela costuma dizer o que
 * aconteceu de verdade ("cota do CNJ esgotada", "sem permissão"), e trocá-la por
 * um texto genérico é jogar fora a única pista.
 */
export function FalhaAoCarregar({
  erro,
  onTentarDeNovo,
  oQue = 'os dados',
}: {
  erro: unknown;
  onTentarDeNovo?: () => void;
  /** Completa a frase "Não foi possível carregar ___". */
  oQue?: string;
}) {
  const mensagem =
    (erro as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  const texto = Array.isArray(mensagem) ? mensagem[0] : mensagem;

  return (
    <div className="space-y-3 py-10 text-center">
      <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/40">
        <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
      </span>
      <p className="text-sm font-medium">Não foi possível carregar {oQue}.</p>
      <p className="mx-auto max-w-sm text-xs leading-snug text-muted-foreground">
        {texto ??
          'Foi a consulta que falhou, não o conteúdo. Tente de novo; se insistir, avise a administração.'}
      </p>
      {onTentarDeNovo && (
        <Button variant="outline" size="sm" onClick={onTentarDeNovo}>
          <RefreshCw className="h-4 w-4" /> Tentar de novo
        </Button>
      )}
    </div>
  );
}
