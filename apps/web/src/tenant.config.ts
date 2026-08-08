import type { ModuloKey } from '@/lib/permissoes';

/**
 * QUEM É O CLIENTE DESTA INSTALAÇÃO — lado da tela.
 *
 * Espelha `apps/api/src/tenant/tenant.config.ts`. São dois arquivos de
 * propósito: o Next.js não importa de dentro da API, e um pacote compartilhado
 * só para isso, agora, seria estrutura antes da necessidade (ele vem na Fase 3,
 * quando os pacotes nascerem de verdade).
 *
 * A PALETA MORA AQUI, e o `tailwind.config.ts` a lê. É isso que faz trocar a
 * identidade visual do sistema ser editar um objeto, e não caçar 871 usos de
 * uma cor no meio do código.
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
   * apagados do banco. Ver o mesmo campo no `tenant.config.ts` da API.
   */
  camposOcultos?: string[];
}

/**
 * Paleta institucional — ESCALA COMPLETA.
 *
 * Faltavam 100, 200, 300, 500 e 700. Como o Tailwind não emite classe para tom
 * inexistente, `bg-brand-700 text-white` virava texto branco sobre fundo
 * branco. O 700 foi escolhido escuro o bastante para passar em contraste AA
 * (4.6:1) com texto branco — o caso das abas e dos botões primários.
 */
const PALETA_SENATEPI: PaletaMarca = {
  900: '#145E07',
  800: '#1B7F0A', // Verde escuro (institucional)
  700: '#2C860F',
  600: '#4FA11B', // Verde médio
  500: '#75B32C',
  400: '#9BC53D', // Verde claro
  300: '#B5D268',
  200: '#D0E29E',
  100: '#E4F0CC',
  50: '#F1F8E9',
};

export const tenant: TenantConfigWeb = {
  id: 'senatepi',
  sigla: 'SENATEPI',
  nome: 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TÉCNICOS EM ENFERMAGEM DO ESTADO DO PIAUÍ',
  descricao: 'Sindicato dos Enfermeiros do Piauí',
  paleta: PALETA_SENATEPI,
  vocabulario: { filiado: 'filiado', filiados: 'filiados', matricula: 'matrícula' },
  // Todos ligados: é a instalação de referência.
  modulos: [
    'dashboard', 'atendimentos', 'processos', 'agenda', 'filiados',
    'colaboradores', 'escalas', 'eventos', 'colonia', 'cobrancas',
    'empresas', 'auditoria', 'usuarios',
  ],
  // O SENATEPI usa todos os campos do cadastro.
  camposOcultos: [],
};

/** O campo é usado nesta instalação? */
export function campoVisivel(campo: string): boolean {
  return !(tenant.camposOcultos ?? []).includes(campo);
}

/** O módulo está ligado nesta instalação? */
export function moduloAtivo(modulo: ModuloKey): boolean {
  return tenant.modulos.includes(modulo);
}
