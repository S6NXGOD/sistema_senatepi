import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { MarcaCss } from '@/components/marca-css';
import { tenant } from '@/tenant.config';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: `${tenant.sigla} — Gestão Sindical`,
  // Vinha com o nome do SENATEPI escrito à mão — a descrição da aba do
  // SINDSERM anunciaria o sindicato errado.
  description: `Sistema de gestão do ${tenant.descricao}`,
  // NB: o `manifest` (PWA) NÃO é global — é vinculado só nas rotas administrativas
  // (login + dashboard), mantendo o Portal do Filiado como web puro, sem instalação.
  // Ícone da aba e do app instalado. Segue a convenção dos logos:
  // `<id-do-cliente>-icone.png`. Estava cravado em `/LOGO_PWA.png`, que é o do
  // SENATEPI — a aba do SINDSERM abria com a marca do outro sindicato.
  icons: {
    icon: `/${tenant.id}-icone.png`,
    shortcut: `/${tenant.id}-icone.png`,
    apple: `/${tenant.id}-icone.png`,
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
      <head>
        {/* Antes de tudo: sem as variáveis da marca, `bg-brand-800` não pinta. */}
        <MarcaCss />
      </head>
      <body className={`${inter.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
