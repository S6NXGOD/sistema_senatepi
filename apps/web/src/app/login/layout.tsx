import type { Metadata } from 'next';

// A tela de login (entrada do administrativo) também vincula o manifest para
// permitir a instalação do PWA a partir dela.
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
