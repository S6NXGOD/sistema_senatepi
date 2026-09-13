'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DURACAO, deveContar, suavizarEntrada } from '@/lib/movimento';
import { prefereMenosMovimento } from '@/lib/use-reduzir-movimento';
import { cn } from '@/lib/utils';

/** No servidor não existe layout; no navegador, decidir antes da pintura. */
const useEfeitoAntesDaPintura = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const formatarPadrao = (n: number) => n.toLocaleString('pt-BR');

/**
 * Um número que conta de 0 até o valor — UMA vez, na montagem.
 *
 * O contador antigo (`useCountUp`) voltava a zero toda vez que o valor mudava.
 * Com o painel revalidando a cada 60 s, "Atrasadas" passava de 3 para 4 e o
 * cartão afirmava "0" por um instante, com o visual de número que pede atenção.
 *
 * As regras daqui:
 *   - só conta com valor ≥ 10 (contar até 2 é teatro) e sem "reduzir movimento";
 *   - dura 600 ms e começa antes da primeira pintura: não pisca o valor final
 *     para depois voltar a zero;
 *   - qualquer mudança depois da montagem (revalidação, filtro) troca SECO, e
 *     interrompe a contagem se ela ainda estiver no meio;
 *   - o leitor de tela lê só o valor final, nunca os intermediários;
 *   - a largura do valor final fica reservada: o cartão não "respira" enquanto
 *     o número ganha dígitos.
 *
 * Uso: KPIs do painel e Resumo dos Relatórios. Nunca em gaveta, nunca em dado
 * por PESSOA (número contando por pessoa é placar).
 */
export function NumeroAnimado({
  valor,
  formatar = formatarPadrao,
  className,
}: {
  valor: number;
  formatar?: (n: number) => string;
  className?: string;
}) {
  const [exibido, setExibido] = useState<number | null>(null);
  const quadro = useRef<number | null>(null);
  const valorDaMontagem = useRef(valor);

  const parar = () => {
    if (quadro.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(quadro.current);
    }
    quadro.current = null;
  };

  useEfeitoAntesDaPintura(() => {
    const alvo = valorDaMontagem.current;
    if (!deveContar({ valor: alvo, reduzir: prefereMenosMovimento() })) return;
    if (typeof requestAnimationFrame !== 'function') return;

    const inteiro = Number.isInteger(alvo);
    let inicio: number | null = null;
    setExibido(0);

    const passo = (agora: number) => {
      if (inicio === null) inicio = agora;
      const t = (agora - inicio) / DURACAO.dado;
      if (t >= 1) {
        quadro.current = null;
        setExibido(null);
        return;
      }
      const v = alvo * suavizarEntrada(t);
      setExibido(inteiro ? Math.round(v) : v);
      quadro.current = requestAnimationFrame(passo);
    };
    quadro.current = requestAnimationFrame(passo);
    return parar;
    // Só na montagem, de propósito: revalidação não recomeça a contagem.
  }, []);

  useEffect(() => {
    if (valor === valorDaMontagem.current) return;
    parar();
    setExibido(null);
  }, [valor]);

  const final = formatar(valor);

  if (exibido === null) {
    return <span className={cn('tabular-nums', className)}>{final}</span>;
  }

  return (
    <span className={cn('tabular-nums', className)}>
      {/* A camada invisível reserva a largura do valor final. */}
      <span aria-hidden="true" className="inline-grid">
        <span className="invisible col-start-1 row-start-1">{final}</span>
        <span className="col-start-1 row-start-1">{formatar(exibido)}</span>
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
