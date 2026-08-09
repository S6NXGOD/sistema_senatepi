'use client';

import { usePathname } from 'next/navigation';
import { moduloDaRota } from '@/components/nav-items';
import { moduloAtivo } from '@/tenant.config';

/**
 * A ROTA DE UM MÓDULO DESLIGADO NÃO EXISTE.
 *
 * Esconder o item do menu não bastava: quem digitasse `/colonia-admin` numa
 * instalação sem colônia abria a tela inteira e só descobria o problema quando
 * a API respondia 404 — ou seja, uma tela quebrada em vez de uma rota
 * inexistente. Com dois sindicatos no mesmo código, isso vira um jeito de um
 * cliente esbarrar em funcionalidade do outro.
 *
 * Aqui é o par do `ModuloAtivoGuard` da API, que responde 404 pela mesma razão.
 * Os dois precisam existir: este dá a resposta certa para a pessoa, e o da API
 * é o que de fato protege — front não protege nada.
 *
 * Isto NÃO é permissão. Permissão é sobre quem a pessoa é (`podeVer`) e continua
 * onde sempre esteve; aqui a pergunta é se a INSTALAÇÃO tem o módulo — e, se não
 * tem, nem o administrador entra.
 */
export function GateDeModulo({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const modulo = moduloDaRota(pathname ?? '');

  if (modulo && !moduloAtivo(modulo)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
        <p className="text-5xl font-bold text-muted-foreground/40">404</p>
        <h1 className="mt-4 text-xl font-semibold">Esta página não existe aqui</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          O módulo não faz parte desta instalação do sistema.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
