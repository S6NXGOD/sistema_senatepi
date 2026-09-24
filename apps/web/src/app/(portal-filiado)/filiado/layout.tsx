import type { Metadata } from 'next';
import { PortalGuard } from '@/components/portal-filiado/portal-guard';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

/**
 * Layout do PORTAL DO FILIADO.
 *
 * Área externa: sem sidebar, sem o shell do administrativo e sem o manifest
 * (PWA) das rotas internas. Só a casca da marca e o conteúdo.
 *
 * A ROTA É `/filiado` e não `/portal` porque `/portal` já é do portal patronal
 * desde antes — e mexer nele quebraria o link que as empresas já têm salvo. A
 * URL não passa pelo vocabulário do cliente (é rota, não texto), então continua
 * `/filiado` mesmo no SINDSERM, onde a tela escreve "servidor".
 */
export const metadata: Metadata = {
  title: `Portal do ${V.Filiado} — ${tenant.sigla}`,
  description: `Área do ${V.filiado} do ${tenant.sigla}: carteirinha, processos e cadastro.`,
};

export default function PortalFiliadoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cinza-claro dark:bg-background">
      <PortalGuard>{children}</PortalGuard>
    </div>
  );
}
