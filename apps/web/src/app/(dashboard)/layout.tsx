import type { Metadata } from 'next';
import { DashboardShell } from '@/components/dashboard-shell';
import { GateDeModulo } from '@/components/gate-de-modulo';
import { GateDePermissao } from '@/components/gate-de-permissao';

// PWA exclusivo do administrativo: o manifest só é vinculado nas rotas internas.
export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  /*
    OS GATES FICAM DENTRO DO SHELL: a pessoa continua vendo o menu e navega para
    outro lugar. Fora dele, a tela de recusa apareceria solta, sem saída.

    A ORDEM IMPORTA e responde a duas perguntas diferentes, na sequência certa:

      1. GateDeModulo    — esta INSTALAÇÃO tem o módulo? Se não, a rota não
                           existe (404), nem para o administrador.
      2. GateDePermissao — ESTA PESSOA pode? Se não, existe mas é negada (403).

    Invertido, alguém descobriria pela mensagem que o outro sindicato tem um
    módulo que este não tem — "sem permissão" para algo que sequer existe aqui.
  */
  return (
    <DashboardShell>
      <GateDeModulo>
        <GateDePermissao>{children}</GateDePermissao>
      </GateDeModulo>
    </DashboardShell>
  );
}
