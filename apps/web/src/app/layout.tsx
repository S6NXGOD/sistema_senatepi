import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'SENATEPI — Gestão Sindical',
  description:
    'Sistema de gestão do Sindicato dos Enfermeiros, Auxiliares e Técnicos em Enfermagem do Piauí',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/LOGO_PWA.png',
    shortcut: '/LOGO_PWA.png',
    apple: '/LOGO_PWA.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#1B7F0A', // senatepi-800
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
