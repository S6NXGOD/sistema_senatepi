'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { animate } from 'framer-motion';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { parteContrariaDoProcesso } from '@/components/agenda/identidade-do-processo';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import {
  type CompromissoCard,
  type PessoaResumo,
  STATUS_COMP_COR,
  STATUS_COMP_LABEL,
  horaCurta,
  primeiroNome,
} from '@/lib/dashboard';
import { corDeTipo, rotuloTipo } from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';

// ---------------------------------------------------------------------------
// Count-up: anima o número de 0 → valor (sensação de "tempo real")
// ---------------------------------------------------------------------------

export function useCountUp(value: number, duration = 0.9): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => setN(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, duration]);
  return n;
}

// ---------------------------------------------------------------------------
// Avatar (imagem ou iniciais)
// ---------------------------------------------------------------------------

export function AvatarMini({
  pessoa,
  size = 34,
  ring,
}: {
  pessoa: PessoaResumo;
  size?: number;
  ring?: boolean;
}) {
  const nome = pessoa.nomeExibicao || pessoa.nome;
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-[11px] font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-400',
        ring && 'ring-2 ring-white dark:ring-slate-900',
      )}
      style={{ width: size, height: size }}
      title={nome}
    >
      {pessoa.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pessoa.avatarUrl} alt={nome} className="h-full w-full object-cover" />
      ) : (
        iniciais || '—'
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KPI card (animado, opcionalmente clicável)
// ---------------------------------------------------------------------------

export interface KpiCardProps {
  label: string;
  valor?: number;
  sub?: string;
  icon: LucideIcon;
  cor: string; // ex.: 'text-brand-700 bg-brand-50'
  href?: string;
  destaque?: boolean;
}

export function KpiCard({ label, valor, sub, icon: Icon, cor, href, destaque }: KpiCardProps) {
  const n = useCountUp(valor ?? 0);
  const inner = (
    <Card
      className={cn(
        'group relative h-full overflow-hidden',
        href && 'cursor-pointer hover:border-brand-400',
        destaque && 'border-brand-400/70 bg-brand-50/40 dark:bg-brand-900/10',
      )}
    >
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 text-3xl font-bold tabular-nums leading-none">
            {valor === undefined ? '—' : n}
          </p>
          {sub && <p className="mt-2 truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className={cn('rounded-xl p-2.5 transition-transform group-hover:scale-110', cor)}>
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
      {href && (
        <ChevronRight className="absolute bottom-3 right-3 h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      )}
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ---------------------------------------------------------------------------
// Section card com header (ícone + título + contagem + ação)
// ---------------------------------------------------------------------------

export function SectionCard({
  title,
  icon: Icon,
  count,
  actionHref,
  actionLabel = 'Ver',
  className,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count?: number;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between gap-2 border-b px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-brand-800 dark:text-brand-400" />
          <h3 className="text-sm font-semibold">{title}</h3>
          {count !== undefined && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {actionHref && (
          <Link
            href={actionHref}
            className="flex items-center gap-0.5 text-xs font-medium text-brand-800 hover:underline dark:text-brand-400"
          >
            {actionLabel} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="flex-1 p-3">{children}</div>
    </Card>
  );
}

export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha de compromisso (atividades de hoje / pendências / audiências)
// ---------------------------------------------------------------------------

export function CompromissoRow({ c, mostrarData }: { c: CompromissoCard; mostrarData?: boolean }) {
  const { tipos } = useTiposEvento();
  const atrasada =
    (c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO') && new Date(c.inicio).getTime() < Date.now();
  const quando = mostrarData
    ? new Date(c.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : horaCurta(c.inicio);
  return (
    <Link
      // Abre a ATIVIDADE. Este componente é reusado em vários blocos do painel,
      // então o link genérico daqui era o mesmo beco sem saída em todos eles.
      href={`/agenda?compromisso=${c.id}`}
      className="flex items-stretch gap-3 rounded-lg px-2 py-2.5 transition hover:bg-muted/60"
    >
      <span className={cn('w-1 shrink-0 rounded-full', corDeTipo(c.tipo, tipos).ponto)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{c.titulo}</p>
          {c.urgente && (
            <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              Urgente
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">{rotuloTipo(c.tipo, tipos)}</span>
          <span>· {quando}</span>
          {c.filiado && <span className="truncate">· {c.filiado.nomeCompleto}</span>}
          {/*
            CONTRA QUEM — o que distingue duas linhas de mesmo título.
            "Verificação de Intimação / Prazo" é categoria, não identidade; sem
            isto, duas atividades de processos diferentes ficavam idênticas.
            Só a parte contrária: o nosso lado já está no filiado ao lado.
          */}
          {parteContrariaDoProcesso(c.processo) && (
            <span className="truncate">· contra {parteContrariaDoProcesso(c.processo)}</span>
          )}
          {c.local && <span className="truncate">· {c.local}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', STATUS_COMP_COR[c.status])}>
          {STATUS_COMP_LABEL[c.status]}
        </span>
        <div className="flex items-center gap-1">
          {atrasada && (
            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Atrasada</span>
          )}
          <AvatarMini pessoa={c.responsavel} size={22} />
        </div>
      </div>
    </Link>
  );
}

// Small helper: nome curto do responsável (reexport de conveniência)
export { primeiroNome };
