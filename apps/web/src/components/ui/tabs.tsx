'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabs (padrão Shadcn) — hand-rolled no estilo do projeto (sem Radix).
 * API: <Tabs defaultValue><TabsList><TabsTrigger/></TabsList><TabsContent/></Tabs>.
 * Mobile-first: a lista ocupa a largura total e divide os gatilhos igualmente.
 */
const TabsCtx = React.createContext<{ value: string; setValue: (v: string) => void } | null>(null);

function useTabs() {
  const ctx = React.useContext(TabsCtx);
  if (!ctx) throw new Error('Os componentes de Tabs devem estar dentro de <Tabs>.');
  return ctx;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const [interno, setInterno] = React.useState(defaultValue ?? '');
  const atual = value ?? interno;
  const setValue = React.useCallback(
    (v: string) => {
      if (value === undefined) setInterno(v);
      onValueChange?.(v);
    },
    [value, onValueChange],
  );
  return (
    <TabsCtx.Provider value={{ value: atual, setValue }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex w-full items-center gap-1 rounded-lg bg-muted p-1 md:w-auto',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useTabs();
  const ativo = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={() => ctx.setValue(value)}
      className={cn(
        'flex h-11 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors md:h-9 md:flex-none',
        ativo
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = useTabs();
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}
