import {
  LayoutDashboard, Users, Contact, CalendarDays, Umbrella,
  ScanLine, SlidersHorizontal, ShieldCheck, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSecao {
  titulo: string;
  itens: NavItem[];
}

/**
 * Navegação do administrativo, agrupada por área (compartilhada entre a Sidebar
 * e o menu mobile). Funcionários/Prestadores foram unificados em Colaboradores;
 * Carteirinhas é gerida dentro de Filiados.
 */
export const NAV_SECOES: NavSecao[] = [
  {
    titulo: 'Principal',
    itens: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/filiados', label: 'Filiados', icon: Users },
      { href: '/colaboradores', label: 'Colaboradores', icon: Contact },
    ],
  },
  {
    titulo: 'Operacional',
    itens: [
      { href: '/eventos', label: 'Eventos', icon: CalendarDays },
      { href: '/colonia-admin', label: 'Colônia de Férias', icon: Umbrella },
      { href: '/validacao', label: 'Validação (QR)', icon: ScanLine },
    ],
  },
  {
    titulo: 'Administração',
    itens: [
      { href: '/cadastros-base', label: 'Cadastros Base', icon: SlidersHorizontal },
      { href: '/auditoria', label: 'Auditoria', icon: ShieldCheck },
    ],
  },
];

/** Lista plana (compatibilidade). */
export const NAV_ITENS: NavItem[] = NAV_SECOES.flatMap((s) => s.itens);
