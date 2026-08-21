'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * O SELO DE URGÊNCIA — um só, para atividade, processo e triagem.
 *
 * POR QUE VIROU COMPONENTE. O mesmo bloco estava copiado em três arquivos da
 * agenda (card, barra de alertas e gaveta), cada um com um tamanho de ícone e
 * um arredondamento ligeiramente diferente. Um selo que muda de forma conforme
 * a tela deixa de ser sinal e vira ruído: quem varre o quadro procurando o que
 * é urgente precisa reconhecer a mesma coisa em todo lugar. Agora processos e
 * triagem entram na mesma marca, que é o que o pedido de "boa UI/UX para
 * entender que é urgente" quer dizer na prática.
 *
 * O QUE MUDOU ALÉM DE UNIFICAR — e é a parte que importa:
 *
 * 1. O SELO DIZ O PORQUÊ. `motivo` vira o `title` (e é lido por leitor de tela
 *    junto do rótulo). Antes o selo dizia "Urgente" e ponto; quem abria a fila
 *    não tinha como saber se aquilo ainda valia. Urgência sem justificativa não
 *    se revisa, e fila que não se revisa fica inteira urgente.
 *
 * 2. NÃO É SÓ COR. Ícone + palavra + cor, sempre juntos. Vermelho sozinho não
 *    chega a quem tem deuteranopia — que é a forma mais comum de daltonismo —,
 *    nem sobrevive à impressão em preto e branco do dossiê.
 *
 * 3. TAMANHO ACOMPANHA O CONTEXTO, a forma não. Numa lista densa o selo é
 *    menor; num cabeçalho, maior. O que nunca muda é o que ele é.
 */

export type TamanhoSelo = 'sm' | 'md';

const TAMANHO: Record<TamanhoSelo, { caixa: string; icone: string }> = {
  sm: { caixa: 'gap-1 px-1.5 py-0.5 text-[10px]', icone: 'h-2.5 w-2.5' },
  md: { caixa: 'gap-1 px-2 py-0.5 text-[11px]', icone: 'h-3 w-3' },
};

export function SeloUrgente({
  motivo,
  desde,
  tamanho = 'md',
  className,
}: {
  /** POR QUE é urgente. Vira a dica ao passar o mouse e o rótulo acessível. */
  motivo?: string | null;
  /** Desde quando — registros antigos, migrados da etiqueta, não têm. */
  desde?: string | null;
  tamanho?: TamanhoSelo;
  className?: string;
}) {
  const t = TAMANHO[tamanho];
  const quando = desde ? formatarData(desde) : null;
  const explicacao = [motivo?.trim(), quando ? `marcado em ${quando}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      // `title` e `aria-label` juntos: o primeiro atende o mouse, o segundo o
      // leitor de tela. Sem o segundo, quem navega por teclado ouviria só
      // "Urgente" e perderia a única informação que permite julgar a fila.
      title={explicacao || 'Marcado como urgente'}
      aria-label={explicacao ? `Urgente: ${explicacao}` : 'Urgente'}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full font-semibold',
        'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        t.caixa,
        className,
      )}
    >
      <AlertTriangle className={t.icone} aria-hidden />
      Urgente
    </span>
  );
}

/**
 * A LINHA DE MOTIVO, para onde há espaço (gaveta, ficha, detalhe).
 *
 * O selo cabe numa lista; a explicação não. Aqui ela aparece por extenso, que é
 * onde a decisão de "isto ainda é urgente?" é realmente tomada.
 */
export function MotivoUrgencia({
  motivo,
  desde,
  className,
}: {
  motivo?: string | null;
  desde?: string | null;
  className?: string;
}) {
  if (!motivo?.trim()) return null;
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5',
        'text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {motivo.trim()}
        {desde && (
          <span className="ml-1 opacity-70">· marcado em {formatarData(desde)}</span>
        )}
      </span>
    </p>
  );
}

function formatarData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}
