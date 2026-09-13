import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * ESQUELETO — a forma do que vai aparecer, enquanto não aparece.
 *
 * Substitui o "Carregando…" e o girador de 80 px, que eram trocados de uma vez
 * por uma tabela de 25 linhas: é isso que dá a sensação de tela que pula.
 *
 * As regras de uso:
 *   - SÓ em `isLoading` (primeira carga). Nunca em `isFetching`, e NUNCA em
 *     `isError` — esqueleto com erro é o "carregando infinito" de volta;
 *   - a forma segue o que VAI aparecer, inclusive o que o perfil recebe: não
 *     desenhe gráfico para quem não tem gráfico;
 *   - sem cor da marca: só `muted`, igual em qualquer sindicato e no escuro;
 *   - o girador pequeno DENTRO de botão fica como está.
 *
 * O brilho anda por `transform` (nada de largura animada) e some sozinho com
 * "reduzir movimento" (regra global do globals.css).
 */
export function Esqueleto({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      style={style}
    >
      <div className="absolute inset-0 -translate-x-full animate-brilho bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/[0.06]" />
    </div>
  );
}

/**
 * Grade de cartões de número, na medida do `KpiCard` (104 px): quando o número
 * chega, nada na grade se mexe. Troque a grade por `className` se a tela usar
 * outra (ex.: `grid-cols-1 sm:grid-cols-3`).
 */
export function EsqueletoCartoes({ quantidade = 4, className }: { quantidade?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('grid grid-cols-2 gap-4 lg:grid-cols-4', className)}>
      {Array.from({ length: Math.max(0, quantidade) }).map((_, i) => (
        <div key={i} className="h-[104px] rounded-xl border bg-card p-4 sm:p-5">
          <Esqueleto className="h-3 w-24 max-w-full" />
          <Esqueleto className="mt-3 h-7 w-16" />
          <Esqueleto className="mt-3 h-3 w-20 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/** Larguras que se alternam: linhas idênticas parecem papel quadriculado. */
const LARGURA_TITULO = ['w-2/5', 'w-1/2', 'w-1/3', 'w-3/5'];
const LARGURA_APOIO = ['w-1/4', 'w-1/3', 'w-1/5', 'w-2/5'];

/**
 * Linhas de lista ou tabela. `altura` é a altura da linha REAL (px ou valor
 * CSS), para a lista não pular quando chegar. Sem moldura: coloque dentro do
 * cartão ou da tabela que a tela já tem.
 */
export function EsqueletoLinhas({
  quantidade = 5,
  altura = 56,
  className,
}: {
  quantidade?: number;
  altura?: number | string;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn('divide-y divide-border/60', className)}>
      {Array.from({ length: Math.max(0, quantidade) }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4"
          style={{ height: typeof altura === 'number' ? `${altura}px` : altura }}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Esqueleto className={cn('h-3.5', LARGURA_TITULO[i % LARGURA_TITULO.length])} />
            <Esqueleto className={cn('h-3', LARGURA_APOIO[i % LARGURA_APOIO.length])} />
          </div>
          <Esqueleto className="hidden h-3 w-16 shrink-0 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Alturas das colunas do gráfico de mentira — fixas, para não mudar a cada render. */
const COLUNAS = [45, 70, 55, 85, 60, 75, 50, 65];

/** Cartão de gráfico: título e área de 256 px (a mesma dos gráficos do painel). */
export function EsqueletoGrafico({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('rounded-xl border bg-card', className)}>
      <div className="border-b px-5 py-4">
        <Esqueleto className="h-4 w-40 max-w-full" />
      </div>
      <div className="flex h-64 items-end gap-2 p-4 sm:gap-3">
        {COLUNAS.map((h, i) => (
          <Esqueleto key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * O invólucro de acessibilidade. Quem enxerga vê a forma; quem usa leitor de
 * tela ouve a frase ("Somando o período…") — que é a voz do sistema e é honesta,
 * por isso não se joga fora. `mostrarTexto` a deixa visível, pequena, acima.
 */
export function Carregando({
  texto,
  children,
  mostrarTexto = false,
  className,
}: {
  texto: string;
  children?: ReactNode;
  mostrarTexto?: boolean;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className={mostrarTexto ? 'mb-3 block text-sm text-muted-foreground' : 'sr-only'}>{texto}</span>
      {children ?? <EsqueletoLinhas quantidade={3} />}
    </div>
  );
}
