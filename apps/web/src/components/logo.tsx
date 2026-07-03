import { cn } from '@/lib/utils';

type Orientacao = 'horizontal' | 'vertical';
type Variante = 'auto' | 'cor' | 'branco';

/**
 * Logo oficial do SENATEPI (arquivos em /public).
 * - variant="auto"   → verde no tema claro, branco no escuro (troca via CSS)
 * - variant="cor"    → sempre verde (fundos claros)
 * - variant="branco" → sempre branco (fundos escuros/verdes)
 *
 * A altura vem do className (ex.: `h-9`); a imagem ocupa a altura e mantém a proporção.
 */
export function Logo({
  className,
  variant = 'auto',
  orientation = 'horizontal',
}: {
  className?: string;
  variant?: Variante;
  orientation?: Orientacao;
}) {
  const arquivo = (cor: 'verde' | 'branco') => `/senatepi-${orientation}-${cor}.png`;

  if (variant === 'auto') {
    return (
      <span className={cn('inline-flex items-center', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={arquivo('verde')} alt="SENATEPI" className="block h-full w-auto object-contain dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={arquivo('branco')} alt="SENATEPI" className="hidden h-full w-auto object-contain dark:block" />
      </span>
    );
  }

  const cor = variant === 'branco' ? 'branco' : 'verde';
  return (
    <span className={cn('inline-flex items-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={arquivo(cor)} alt="SENATEPI" className="h-full w-auto object-contain" />
    </span>
  );
}
