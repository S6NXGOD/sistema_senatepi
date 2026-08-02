'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2, Search, Building2, ChevronLeft, ChevronRight, Clock, ShieldCheck,
  Ban, Landmark, FileSearch,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AuditoriaContribuicaoModal } from './auditoria-contribuicao-modal';
import {
  listarContribuicoesAdmin, formatarReais, mascaraCnpj, STATUS_ADMIN,
  type ContribuicaoAdmin, type StatusContribuicao,
} from '@/lib/contribuicoes-patronais';

const PAGE_SIZE = 20;

const FILTROS: Array<{ valor: StatusContribuicao | ''; rotulo: string }> = [
  { valor: 'EM_ANALISE', rotulo: 'Em análise' },
  { valor: '', rotulo: 'Todas' },
  { valor: 'AGUARDANDO', rotulo: 'Aguardando envio' },
  { valor: 'HOMOLOGADA', rotulo: 'Homologadas' },
  { valor: 'REJEITADA', rotulo: 'Rejeitadas' },
];

/**
 * Aba "Empresas" da tela de Cobranças: fila de conferência das contribuições
 * patronais. Abre já filtrada por EM_ANALISE — é o que exige ação da equipe.
 */
export function ContribuicoesPatronaisTab() {
  const [status, setStatus] = useState<StatusContribuicao | ''>('EM_ANALISE');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [page, setPage] = useState(1);
  const [auditando, setAuditando] = useState<ContribuicaoAdmin | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setBuscaDeb(busca.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [busca]);
  useEffect(() => { setPage(1); }, [status]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['contribuicoes-patronais', status, buscaDeb, page],
    queryFn: () =>
      listarContribuicoesAdmin({
        status: status || undefined,
        busca: buscaDeb || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const linhas = data?.data ?? [];
  const resumo = data?.resumo;

  return (
    <div className="space-y-4">
      {/* Cartões-resumo — também servem de filtro: é onde a pessoa clica quando
          quer saber para onde foi a guia que acabou de decidir. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumo Icon={Clock} rotulo="Em análise" valor={resumo?.emAnalise ?? 0}
          sub="Aguardando conferência" cor="text-amber-600 dark:text-amber-400" bg="bg-amber-100 dark:bg-amber-900/30"
          ativo={status === 'EM_ANALISE'} onClick={() => setStatus('EM_ANALISE')} />
        <Resumo Icon={FileSearch} rotulo="Aguardando envio" valor={resumo?.aguardando ?? 0}
          sub="Guia gerada, sem documentos" cor="text-muted-foreground" bg="bg-muted"
          ativo={status === 'AGUARDANDO'} onClick={() => setStatus('AGUARDANDO')} />
        <Resumo Icon={ShieldCheck} rotulo="Homologadas" valor={resumo?.homologadas ?? 0}
          sub={formatarReais(resumo?.totalHomologado ?? 0)} cor="text-senatepi-700 dark:text-senatepi-400" bg="bg-senatepi-50 dark:bg-senatepi-900/30"
          ativo={status === 'HOMOLOGADA'} onClick={() => setStatus('HOMOLOGADA')} />
        <Resumo Icon={Ban} rotulo="Rejeitadas" valor={resumo?.rejeitadas ?? 0}
          sub="Aguardando correção" cor="text-red-600 dark:text-red-400" bg="bg-red-100 dark:bg-red-900/30"
          ativo={status === 'REJEITADA'} onClick={() => setStatus('REJEITADA')} />
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar empresa (razão social, fantasia, CNPJ)…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.rotulo}
              type="button"
              onClick={() => setStatus(f.valor)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                status === f.valor
                  ? 'border-senatepi-800 bg-senatepi-800 text-white'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" />
            </div>
          ) : linhas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground">
              <Building2 className="h-8 w-8 opacity-40" />
              <p className="text-sm">
                {status === 'EM_ANALISE'
                  ? 'Nenhuma contribuição aguardando conferência.'
                  : 'Nenhuma contribuição encontrada com esses filtros.'}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Empresa</th>
                      <th className="px-4 py-3 font-medium">Competência</th>
                      <th className="px-4 py-3 text-right font-medium">Valor</th>
                      <th className="px-4 py-3 font-medium">Situação</th>
                      <th className="px-4 py-3 font-medium">Enviado em</th>
                      <th className="px-4 py-3 text-right font-medium">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((c) => (
                      <Linha key={c.id} c={c} onAuditar={() => setAuditando(c)} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="divide-y md:hidden">
                {linhas.map((c) => {
                  const s = STATUS_ADMIN[c.status];
                  const auditavel = c.status === 'EM_ANALISE';
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setAuditando(c)}
                      className="w-full space-y-1.5 p-4 text-left transition hover:bg-muted/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">
                          {c.empresa.razaoSocial}
                        </p>
                        <Badge className={s.classe}>{s.label}</Badge>
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {mascaraCnpj(c.empresa.cnpj)}
                      </p>
                      <p className="text-xs">
                        <span className="capitalize">{c.competencia}</span> ·{' '}
                        <strong>{formatarReais(c.valorDeclarado)}</strong>
                      </p>
                      {auditavel && (
                        <p className="text-[11px] font-medium text-senatepi-800 dark:text-senatepi-400">
                          Toque para auditar
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Paginação */}
      {data && data.totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {data.total} contribuição(ões) · página {data.page} de {data.totalPaginas}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPaginas || isFetching}
              onClick={() => setPage((p) => p + 1)}>
              Próxima <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <AuditoriaContribuicaoModal
        contribuicao={auditando}
        onClose={() => setAuditando(null)}
        // Sem isto a linha decidida sumia da tela (deixa de casar com o filtro
        // "Em análise") e não havia pista de para onde ela tinha ido.
        onDecidido={(destino) => setStatus(destino)}
      />
    </div>
  );
}

function Linha({ c, onAuditar }: { c: ContribuicaoAdmin; onAuditar: () => void }) {
  const s = STATUS_ADMIN[c.status];
  const auditavel = c.status === 'EM_ANALISE';

  return (
    <tr
      onClick={onAuditar}
      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
    >
      <td className="px-4 py-3">
        <p className="font-medium">{c.empresa.razaoSocial}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{mascaraCnpj(c.empresa.cnpj)}</p>
      </td>
      <td className="px-4 py-3 capitalize">{c.competencia}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums">
        {formatarReais(c.valorDeclarado)}
      </td>
      <td className="px-4 py-3">
        <Badge className={s.classe}>{s.label}</Badge>
        {c.status === 'HOMOLOGADA' && (
          <span
            className="ml-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground"
            title={c.movimentacaoId ? 'Entrada lançada no caixa' : 'Sem lançamento no caixa'}
          >
            <Landmark className="h-3 w-3" />
            {c.movimentacaoId ? 'no caixa' : 'sem lançamento'}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {c.enviadoEm ? new Date(c.enviadoEm).toLocaleString('pt-BR') : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          size="sm"
          variant={auditavel ? 'default' : 'outline'}
          onClick={(e) => { e.stopPropagation(); onAuditar(); }}
        >
          <FileSearch className="h-4 w-4" /> {auditavel ? 'Auditar' : 'Ver'}
        </Button>
      </td>
    </tr>
  );
}

function Resumo({ Icon, rotulo, valor, sub, cor, bg, ativo, onClick }: {
  Icon: React.ElementType;
  rotulo: string;
  valor: number;
  sub?: string;
  cor?: string;
  bg?: string;
  ativo?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer transition ${ativo ? 'ring-2 ring-senatepi-800' : 'hover:bg-muted/40'}`}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg ?? 'bg-muted'}`}>
          <Icon className={`h-5 w-5 ${cor ?? ''}`} />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
          <p className={`text-xl font-bold tabular-nums ${cor ?? ''}`}>{valor}</p>
          {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
