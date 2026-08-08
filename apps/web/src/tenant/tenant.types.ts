import type { ModuloKey } from '@/lib/permissoes';

/**
 * O CONTRATO DE UM CLIENTE — lado da tela.
 *
 * Espelha `apps/api/src/tenant/tenant.types.ts`. São dois arquivos de propósito:
 * o Next.js não importa de dentro da API. O que garante que os dois lados
 * concordem não é o compilador, é a CI construindo os dois apps no mesmo push.
 */

/**
 * Escala de 50 a 900, no formato que o Tailwind espera.
 *
 * `Record<string, string>` e não uma interface com os dez tons fixos: o
 * `tailwind.config.ts` exige uma assinatura de índice, e travar os tons aqui
 * impediria um cliente de ter uma escala com mais (ou menos) degraus.
 */
export type PaletaMarca = Record<string, string>;

export interface TenantConfigWeb {
  /** Identificador técnico — é o valor de `NEXT_PUBLIC_TENANT` no ambiente. */
  id: string;
  sigla: string;
  /** Nome completo — usado em título de página e documento. */
  nome: string;
  /** Descrição curta para o rodapé do login. */
  descricao: string;
  paleta: PaletaMarca;
  vocabulario: { filiado: string; filiados: string; matricula: string };
  /**
   * Módulos ligados nesta instalação — a MESMA lista da API.
   *
   * O menu some para módulo desligado, e a rota some junto (a API responde 404
   * pelo `ModuloAtivoGuard`). Os dois lados precisam concordar: menu escondido
   * com rota viva deixa a funcionalidade acessível por URL; menu visível com
   * rota morta leva a pessoa a um erro.
   */
  modulos: ModuloKey[];
  /**
   * Campos do cadastro que esta instalação não usa — escondidos na tela, nunca
   * apagados do banco. Ver o mesmo campo no `tenant.types.ts` da API.
   */
  camposOcultos?: string[];
}
