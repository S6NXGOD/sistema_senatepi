import type { Metadata } from 'next';
import { DashboardShell } from '@/components/dashboard-shell';

// PWA exclusivo do administrativo: o manifest só é vinculado nas rotas internas.
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
