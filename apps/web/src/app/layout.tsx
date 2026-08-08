import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { tenant } from '@/tenant.config';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: `${tenant.sigla} — Gestão Sindical`,
  description:
    'Sistema de gestão do Sindicato dos Enfermeiros, Auxiliares e Técnicos em Enfermagem do Piauí',
  // NB: o `manifest` (PWA) NÃO é global — é vinculado só nas rotas administrativas
  // (login + dashboard), mantendo o Portal do Filiado como web puro, sem instalação.
  icons: {
    icon: '/LOGO_PWA.png',
    shortcut: '/LOGO_PWA.png',
    apple: '/LOGO_PWA.png',
  },
};

export const viewport: Viewport = {
  // Cor da barra do navegador e do app instalado (PWA). Vinha cravada em
  // verde: a aba do SINDSERM abria com a marca do SENATEPI.
  themeColor: tenant.paleta[800],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
