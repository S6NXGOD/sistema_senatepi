import type { Metadata } from 'next';
import { DashboardShell } from '@/components/dashboard-shell';
import { GateDeModulo } from '@/components/gate-de-modulo';

// PWA exclusivo do administrativo: o manifest só é vinculado nas rotas internas.
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // O gate fica DENTRO do shell: a pessoa continua vendo o menu e navega para
  // outro lugar. Fora dele, a tela de 404 apareceria solta, sem saída.
  return (
    <DashboardShell>
      <GateDeModulo>{children}</GateDeModulo>
    </DashboardShell>
  );
}
