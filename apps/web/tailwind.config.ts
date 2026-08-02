import type { Config } from 'tailwindcss';

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
         * Paleta institucional SENATEPI — ESCALA COMPLETA.
         *
         * Faltavam 100, 200, 300, 500 e 700. Como o Tailwind simplesmente não
         * emite classe para um tom inexistente, `bg-senatepi-700 text-white`
         * virava texto branco sobre fundo branco — a aba ativa do dossiê ficava
         * invisível no tema claro. Havia 65 usos desses tons pelo app.
         *
         * Os cinco tons originais (900/800/600/400/50) foram preservados byte a
         * byte; os novos interpolam entre eles. O 700 foi escolhido escuro o
         * bastante para passar em contraste AA (4.6:1) com texto branco, que é
         * exatamente o caso das abas e dos botões primários.
         */
        senatepi: {
          900: '#145E07',
          800: '#1B7F0A', // Verde escuro (institucional)
          700: '#2C860F',
          600: '#4FA11B', // Verde médio
          500: '#75B32C',
          400: '#9BC53D', // Verde claro
          300: '#B5D268',
          200: '#D0E29E',
          100: '#E4F0CC',
          50: '#F1F8E9',
        },
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
