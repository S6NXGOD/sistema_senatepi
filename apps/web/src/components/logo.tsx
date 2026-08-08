import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';

type Orientacao = 'horizontal' | 'vertical';
type Variante = 'auto' | 'cor' | 'branco';

/**
 * Logo da instalação (arquivos em /public, nomeados pelo id do cliente).
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
  /**
   * O arquivo é nomeado pelo ID DA INSTALAÇÃO — `/senatepi-horizontal-verde.png`
   * hoje, `/sindserm-horizontal-verde.png` no próximo cliente. Assim trocar a
   * marca é soltar quatro PNGs em `/public` e mudar o `id` no `tenant.config`,
   * sem tocar em componente.
   */
  const arquivo = (cor: 'verde' | 'branco') => `/${tenant.id}-${orientation}-${cor}.png`;

  if (variant === 'auto') {
    return (
      <span className={cn('inline-flex items-center', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={arquivo('verde')} alt={tenant.sigla} className="block h-full w-auto object-contain dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={arquivo('branco')} alt={tenant.sigla} className="hidden h-full w-auto object-contain dark:block" />
      </span>
    );
  }

  const cor = variant === 'branco' ? 'branco' : 'verde';
  return (
    <span className={cn('inline-flex items-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={arquivo(cor)} alt={tenant.sigla} className="h-full w-auto object-contain" />
    </span>
  );
}
