'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Search, Plus, Headset, Clock, User, ChevronLeft, ChevronRight, Inbox,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { NovoAtendimentoDrawer } from '@/components/atendimentos/novo-atendimento-drawer';
import { AtendimentoDrawer } from '@/components/atendimentos/atendimento-drawer';
import {
  listarAtendimentos, CanalAtendimento, DesfechoAtendimento,
  CANAIS, CANAL_LABEL, CANAL_COR, DESFECHO_LABEL, DESFECHO_COR, SETOR_LABEL, formatDataHora,
} from '@/lib/atendimentos';

const PAGE_SIZE = 20;
const inputCls = 'h-12 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

export default function AtendimentosPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [desfecho, setDesfecho] = useState<'' | DesfechoAtendimento>('');
  const [canal, setCanal] = useState<'' | CanalAtendimento>('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [page, setPage] = useState(1);

  const [novo, setNovo] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setBuscaDeb(busca.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => { setPage(1); }, [desfecho, canal, dataInicio, dataFim]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['atendimentos', buscaDeb, desfecho, canal, dataInicio, dataFim, page],
    queryFn: () => listarAtendimentos({
      busca: buscaDeb || undefined, desfecho: desfecho || undefined, canal: canal || undefined,
      dataInicio: dataInicio || undefined, dataFim: dataFim || undefined, page, pageSize: PAGE_SIZE,
    }),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['atendimentos'] });
  const itens = data?.items ?? [];
  const totalPaginas = data?.totalPaginas ?? 1;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <Headset className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Atendimentos</h2>
            <p className="text-sm text-muted-foreground">Triagem — o funil de entrada das demandas</p>
          </div>
        </div>
        <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo atendimento</Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por filiado (nome, matrícula, CPF)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select className={inputCls} value={desfecho} onChange={(e) => setDesfecho(e.target.value as any)} aria-label="Status">
            <option value="">Todos os status</option>
            <option value="RESOLVIDO_ATO">{DESFECHO_LABEL.RESOLVIDO_ATO}</option>
            <option value="ENCAMINHADO">{DESFECHO_LABEL.ENCAMINHADO}</option>
          </select>
          <select className={inputCls} value={canal} onChange={(e) => setCanal(e.target.value as any)} aria-label="Canal">
            <option value="">Todos os canais</option>
            {CANAIS.map((c) => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">De
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">até
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className={inputCls} />
          </label>
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" /></div>
      ) : itens.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground">
            <Inbox className="h-8 w-8 opacity-40" />
            Nenhum atendimento encontrado com esses filtros.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="space-y-3 sm:hidden">
            {itens.map((a) => (
              <button key={a.id} type="button" onClick={() => setDetalheId(a.id)} className="w-full rounded-xl border bg-card p-4 text-left transition-colors hover:border-senatepi-500">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-1.5 truncate font-semibold"><User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {a.filiado.nomeCompleto}</p>
                  <Badge className={`${DESFECHO_COR[a.desfecho]} shrink-0`}>{DESFECHO_LABEL[a.desfecho]}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.descricao}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge className={CANAL_COR[a.canal]}>{CANAL_LABEL[a.canal]}</Badge>
                  {a.desfecho === 'ENCAMINHADO' && a.setor && <span className="text-amber-700 dark:text-amber-400">→ {SETOR_LABEL[a.setor]}</span>}
                  <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3" /> {formatDataHora(a.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden sm:block">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Filiado</th>
                    <th className="px-4 py-3 font-medium">Demanda</th>
                    <th className="px-4 py-3 font-medium">Canal</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Atendente</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((a) => (
                    <tr key={a.id} onClick={() => setDetalheId(a.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="font-medium">{a.filiado.nomeCompleto}</div>
                        <div className="text-xs text-muted-foreground">Matrícula {a.filiado.matricula}</div>
                      </td>
                      <td className="max-w-xs px-4 py-3"><span className="line-clamp-1 text-muted-foreground">{a.descricao}</span></td>
                      <td className="px-4 py-3"><Badge className={CANAL_COR[a.canal]}>{CANAL_LABEL[a.canal]}</Badge></td>
                      <td className="px-4 py-3">
                        <Badge className={DESFECHO_COR[a.desfecho]}>{DESFECHO_LABEL[a.desfecho]}</Badge>
                        {a.desfecho === 'ENCAMINHADO' && a.setor && <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">{SETOR_LABEL[a.setor]}</span>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDataHora(a.createdAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.atendente.nome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Paginação */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-sm text-muted-foreground">{data?.total ?? 0} atendimento(s) · página {data?.page ?? 1} de {totalPaginas}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPaginas || isFetching} onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}>Próxima <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}

      {/* Gavetas */}
      <NovoAtendimentoDrawer open={novo} onClose={() => setNovo(false)} onCriado={invalidar} />
      <AtendimentoDrawer atendimentoId={detalheId} open={!!detalheId} onClose={() => setDetalheId(null)} onMudou={invalidar} />
    </div>
  );
}
