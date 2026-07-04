'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2, Search, ExternalLink, Copy, Settings2, Umbrella, Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { listarCampanhas, CampanhaResumo } from '@/lib/colonia';

type FiltroStatus = 'TODAS' | 'ATIVA' | 'INATIVA';

export default function ColoniaCampanhasPage() {
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState<FiltroStatus>('TODAS');

  const { data, isLoading } = useQuery({
    queryKey: ['colonia-campanhas'],
    queryFn: listarCampanhas,
  });

  const q = busca.trim().toLowerCase();
  const campanhas = (data ?? []).filter((c) => {
    const okStatus = status === 'TODAS' || c.status === status;
    const okBusca = !q || c.nome.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q);
    return okStatus && okBusca;
  });

  function copiarLink(slug: string) {
    const url = `${window.location.origin}/colonia/${slug}`;
    navigator.clipboard?.writeText(url).then(
      () => toast.success('Link público copiado'),
      () => toast.error('Não foi possível copiar'),
    );
  }

  const filtros: { valor: FiltroStatus; label: string }[] = [
    { valor: 'TODAS', label: 'Todas' },
    { valor: 'ATIVA', label: 'Abertas' },
    { valor: 'INATIVA', label: 'Fechadas' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <Umbrella className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Colônia de Férias</h2>
            <p className="text-sm text-muted-foreground">Campanhas e links públicos de reserva</p>
          </div>
        </div>
      </div>

      {/* Filtros rápidos */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou link…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-lg border border-input bg-card p-1">
          {filtros.map((f) => (
            <button
              key={f.valor}
              onClick={() => setStatus(f.valor)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                status === f.valor
                  ? 'bg-senatepi-800 text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" />
        </div>
      ) : campanhas.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center text-muted-foreground">
            {data && data.length > 0 ? 'Nenhuma campanha encontrada com esses filtros.' : 'Nenhuma campanha cadastrada.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campanhas.map((c) => (
            <CardCampanha key={c.id} c={c} onCopiar={() => copiarLink(c.slug)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardCampanha({ c, onCopiar }: { c: CampanhaResumo; onCopiar: () => void }) {
  const ativa = c.status === 'ATIVA';
  const pct = c.totalVagas > 0 ? Math.round((c.ocupadas / c.totalVagas) * 100) : 0;

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words font-semibold leading-tight">{c.nome}</h3>
            <p className="text-xs text-muted-foreground">{c.totalLotes} lote(s) · {c.ano}</p>
          </div>
          {ativa ? (
            <Badge className="shrink-0 bg-senatepi-50 text-senatepi-900 dark:bg-senatepi-900/30 dark:text-senatepi-400">Aberta</Badge>
          ) : (
            <Badge className="shrink-0 bg-muted text-muted-foreground">Fechada</Badge>
          )}
        </div>

        {/* Link público */}
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">/colonia/{c.slug}</code>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onCopiar} title="Copiar link">
            <Copy className="h-4 w-4" />
          </Button>
          <a href={`/colonia/${c.slug}`} target="_blank" rel="noopener noreferrer" title="Abrir link público"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        {/* Ocupação */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3.5 w-3.5" /> Ocupação</span>
            <span className="font-medium tabular-nums">{c.ocupadas}/{c.totalVagas}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-senatepi-600" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <Link href={`/colonia-admin/${c.id}`} className="mt-auto pt-1">
          <Button className="w-full"><Settings2 className="h-4 w-4" /> Gerenciar</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
