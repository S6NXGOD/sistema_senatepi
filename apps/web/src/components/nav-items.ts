import {
  LayoutDashboard, Users, Contact, CalendarDays, Umbrella,
  SlidersHorizontal, ShieldCheck, Receipt, Headset, CalendarClock, Gavel, UserCog, CalendarRange, type LucideIcon,
} from 'lucide-react';
import { podeVer, type ModuloKey } from '@/lib/permissoes';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Módulo permissionável — usado para ocultar o item de quem não tem acesso. */
  modulo?: ModuloKey;
}

export interface NavSecao {
  titulo: string;
  itens: NavItem[];
}

/**
 * Navegação do administrativo, agrupada por área (compartilhada entre a Sidebar
 * e o menu mobile). Cada item declara seu `modulo` para o gating por permissão.
 */
export const NAV_SECOES: NavSecao[] = [
  {
    titulo: 'Início',
    itens: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, modulo: 'dashboard' },
    ],
  },
  {
    // Fluxo jurídico, na ordem em que a demanda caminha: entra na triagem,
    // vira processo, gera prazos na agenda e é coberta pela escala de plantão.
    titulo: 'Jurídico',
    itens: [
      { href: '/atendimentos', label: 'Atendimentos', icon: Headset, modulo: 'atendimentos' },
      { href: '/processos', label: 'Processos', icon: Gavel, modulo: 'processos' },
      { href: '/agenda', label: 'Agenda e Prazos', icon: CalendarClock, modulo: 'agenda' },
      { href: '/escalas', label: 'Escalas dos Advogados', icon: CalendarRange, modulo: 'escalas' },
    ],
  },
  {
    titulo: 'Pessoas',
    itens: [
      { href: '/filiados', label: 'Filiados', icon: Users, modulo: 'filiados' },
      { href: '/colaboradores', label: 'Colaboradores', icon: Contact, modulo: 'colaboradores' },
    ],
  },
  {
    titulo: 'Financeiro',
    itens: [
      { href: '/cobrancas', label: 'Cobranças', icon: Receipt, modulo: 'cobrancas' },
    ],
  },
  {
    titulo: 'Serviços',
    itens: [
      { href: '/eventos', label: 'Eventos', icon: CalendarDays, modulo: 'eventos' },
      { href: '/colonia-admin', label: 'Colônia de Férias', icon: Umbrella, modulo: 'colonia' },
    ],
  },
  {
    titulo: 'Administração',
    itens: [
      { href: '/usuarios', label: 'Usuários e Perfis', icon: UserCog, modulo: 'usuarios' },
      { href: '/cadastros-base', label: 'Cadastros Base', icon: SlidersHorizontal, modulo: 'cadastros' },
      { href: '/auditoria', label: 'Auditoria', icon: ShieldCheck, modulo: 'auditoria' },
    ],
  },
];

/** Lista plana (compatibilidade). */
export const NAV_ITENS: NavItem[] = NAV_SECOES.flatMap((s) => s.itens);

/** Filtra as seções/itens de navegação segundo as permissões do usuário. */
export function filtrarNav(
  role: string | null | undefined,
  permissoes: unknown,
): NavSecao[] {
  return NAV_SECOES
    .map((secao) => ({
      ...secao,
      itens: secao.itens.filter((i) => !i.modulo || podeVer(role, permissoes, i.modulo)),
    }))
    .filter((secao) => secao.itens.length > 0);
}
