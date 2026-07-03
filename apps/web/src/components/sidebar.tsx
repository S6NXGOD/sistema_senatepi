'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { NAV_ITENS } from './nav-items';

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-16 items-center border-b px-6">
        <Logo orientation="horizontal" variant="auto" className="h-9" />
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITENS.map((item) => {
          const ativo = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                ativo
                  ? 'bg-senatepi-800 text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-4 text-xs text-muted-foreground">
        <UserPlus className="mb-1 h-4 w-4" />
        SENATEPI · v0.1
      </div>
    </aside>
  );
}
