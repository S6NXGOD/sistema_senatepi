import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brand-800 text-white shadow hover:bg-brand-900',
        outline: 'border border-input bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        secondary: 'bg-brand-400 text-brand-900 hover:bg-brand-600 hover:text-white',
      },
      size: {
        // Mobile-first: alvos de toque de 48px (h-12) / 44px (icon) no celular,
        // mais densos no desktop (md:). 'sm' permanece compacto para toolbars.
        default: 'h-12 px-4 py-2 md:h-10',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-12 rounded-md px-8',
        icon: 'h-11 w-11 md:h-10 md:w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
