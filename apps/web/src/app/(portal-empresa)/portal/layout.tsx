import type { Metadata } from 'next';
import { PortalGuard } from '@/components/portal-empresa/portal-guard';

/**
 * Layout do PORTAL DA EMPRESA.
 *
 * Área externa: sem sidebar, sem o shell do administrativo e sem o manifest
 * (PWA) das rotas internas. Só a casca da marca e o conteúdo.
 */
export const metadata: Metadata = {
  title: 'Portal da Empresa — SENATEPI',
  description: 'Área da empresa conveniada ao SENATEPI.',
};

export default function PortalEmpresaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cinza-claro dark:bg-background">
      <PortalGuard>{children}</PortalGuard>
    </div>
  );
}
