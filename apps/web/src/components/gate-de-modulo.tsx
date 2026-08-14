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
 *
 * Gate mais FINO que o módulo (uma migração de sistema antigo, por exemplo) não
 * cabe aqui, porque o módulo que a contém está ligado. Esses usam a
 * `PaginaInexistente` abaixo direto na tela — a resposta que a pessoa vê é a
 * mesma, e é isso que importa.
 */
export function GateDeModulo({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const modulo = moduloDaRota(pathname ?? '');

  if (modulo && !moduloAtivo(modulo)) {
    return <PaginaInexistente motivo="O módulo não faz parte desta instalação do sistema." />;
  }

  return <>{children}</>;
}

/**
 * A cara de "aqui não existe" — a MESMA para todo gate de instalação.
 *
 * Extraída porque o gate de módulo deixou de ser o único: uma migração de
 * sistema antigo é ligada por cliente e mais fina que o módulo (ver
 * `importadorAtivo`). Redirecionar para outra tela, que foi a primeira ideca,
 * seria pior — a pessoa que digitou a URL ficaria sem saber se errou o endereço
 * ou se a funcionalidade sumiu.
 */
export function PaginaInexistente({ motivo }: { motivo: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl font-bold text-muted-foreground/40">404</p>
      <h1 className="mt-4 text-xl font-semibold">Esta página não existe aqui</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{motivo}</p>
    </div>
  );
}
