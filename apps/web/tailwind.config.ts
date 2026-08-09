import type { Config } from 'tailwindcss';
import { tenant } from './src/tenant.config';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        /**
         * Paleta da MARCA — lida em TEMPO DE EXECUÇÃO, de variáveis CSS.
         *
         * Antes esta escala se chamava `senatepi` e estava escrita aqui. Com o
         * nome do cliente na classe de cor (`bg-senatepi-800`), trocar de
         * cliente exigiria caçar 871 usos pelo código. Depois passou a ser
         * `tenant.paleta`, compilada — e trocar a cor exigia um deploy.
         *
         * Agora o valor sai de `--brand-N`, que o layout emite com o padrão da
         * instalação e a tela de Identidade Visual sobrescreve. Trocar a cor
         * do sindicato deixou de exigir programador.
         *
         * POR QUE CANAIS (`27 127 10`) E NÃO HEXADECIMAL: é o que permite ao
         * Tailwind compor opacidade. Com `#1B7F0A` dentro da variável, as
         * dezenas de `bg-brand-400/20` e `dark:bg-brand-900/30` que existem no
         * código produziriam CSS inválido e a cor simplesmente sumiria.
         */
        brand: Object.fromEntries(
          Object.keys(tenant.paleta).map((tom) => [
            tom,
            `rgb(var(--brand-${tom}) / <alpha-value>)`,
          ]),
        ),
        cinza: {
          claro: '#F5F7FA',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
