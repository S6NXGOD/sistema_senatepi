import type { ModuloKey } from '@/lib/permissoes';
import type { TenantConfigWeb } from './tenant/tenant.types';
import { senatepi } from './tenant/tenants/senatepi';
import { sindserm } from './tenant/tenants/sindserm';

export type { PaletaMarca, TenantConfigWeb } from './tenant/tenant.types';

/**
 * QUEM É O CLIENTE DESTA INSTALAÇÃO — lado da tela.
 *
 * O mesmo código serve a todos os sindicatos; `NEXT_PUBLIC_TENANT` diz qual é.
 *
 * A PALETA MORA AQUI, e o `tailwind.config.ts` a lê. É isso que faz trocar a
 * identidade visual do sistema ser editar um objeto, e não caçar 871 usos de
 * uma cor no meio do código.
 *
 * POR QUE `NEXT_PUBLIC_` — e por que, desta vez, ser resolvida no build é uma
 * VANTAGEM. As telas de flag (`duplicidade`) evitam `NEXT_PUBLIC_*` de
 * propósito, porque desligar uma flag não pode exigir rebuild. Aqui é o
 * contrário: a paleta é compilada dentro do CSS pelo Tailwind, então trocar de
 * cliente EXIGE rebuild de qualquer jeito. Fingir que é decisão de runtime só
 * criaria um estado impossível — cor de um cliente com nome de outro.
 *
 * Cada sindicato é um serviço próprio, com o seu build. O mesmo commit gera os
 * dois.
 */

const TENANTS: Record<string, TenantConfigWeb> = {
  senatepi,
  sindserm,
};

/**
 * Explode em vez de assumir um padrão — mesmo motivo do lado da API.
 *
 * Cair no SENATEPI quando a variável falta faria o front do SINDSERM abrir
 * verde, com o nome do SENATEPI, conversando com o banco do SINDSERM. Como isto
 * roda no build, a falha aparece como build quebrado com a causa escrita — e
 * não como um sistema no ar exibindo o cliente errado.
 */
function resolverTenant(): TenantConfigWeb {
  const id = (process.env.NEXT_PUBLIC_TENANT ?? '').trim().toLowerCase();
  const conhecidos = Object.keys(TENANTS).join(', ');

  if (!id) {
    throw new Error(
      'A variável de ambiente NEXT_PUBLIC_TENANT não está definida. ' +
        'Sem ela não há como saber de qual sindicato é esta instalação. ' +
        `Valores aceitos: ${conhecidos}.`,
    );
  }
  const escolhido = TENANTS[id];
  if (!escolhido) {
    throw new Error(
      `NEXT_PUBLIC_TENANT="${id}" não corresponde a nenhum cliente. Valores aceitos: ${conhecidos}.`,
    );
  }
  return escolhido;
}

export const tenant: TenantConfigWeb = resolverTenant();

/** O campo é usado nesta instalação? */
export function campoVisivel(campo: string): boolean {
  return !(tenant.camposOcultos ?? []).includes(campo);
}

/** O módulo está ligado nesta instalação? */
export function moduloAtivo(modulo: ModuloKey): boolean {
  return tenant.modulos.includes(modulo);
}
