import {
  LayoutDashboard, Users, Briefcase, Handshake, CalendarDays,
  ScanLine, CreditCard, ShieldCheck, Umbrella, Contact, SlidersHorizontal, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Itens de navegação do administrativo (compartilhados entre Sidebar e MobileNav). */
export const NAV_ITENS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/filiados', label: 'Filiados', icon: Users },
  { href: '/colaboradores', label: 'Colaboradores', icon: Contact },
  { href: '/cadastros-base', label: 'Cadastros Base', icon: SlidersHorizontal },
  { href: '/funcionarios', label: 'Funcionários', icon: Briefcase },
  { href: '/prestadores', label: 'Prestadores', icon: Handshake },
  { href: '/eventos', label: 'Eventos', icon: CalendarDays },
  { href: '/colonia-admin', label: 'Colônia de Férias', icon: Umbrella },
  { href: '/validacao', label: 'Validação (QR)', icon: ScanLine },
  { href: '/carteirinhas', label: 'Carteirinhas', icon: CreditCard },
  { href: '/auditoria', label: 'Auditoria', icon: ShieldCheck },
];
