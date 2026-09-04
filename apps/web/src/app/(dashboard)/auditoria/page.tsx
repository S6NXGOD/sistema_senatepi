'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, Search, ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ACAO_LABEL, ACAO_TOM, baixarCsvAuditoria, listarAuditoria, opcoesAuditoria,
  rotuloDaEntidade, type AcaoAuditoria, type RegistroAuditoria,
} from '@/lib/auditoria';

/**
 * AUDITORIA — quem fez o quê, e quando.
 *
 * A página dizia "em construção" enquanto o log já guardava 2.903 atos. As três
 * perguntas que um sindicato faz aqui são "quem apagou este processo?", "quem
 * mudou a situação desta filiada?" e "quem entrou no fim de semana?" — todas
 * precisam de PERÍODO e de BUSCA POR TEXTO, que era o que faltava.
 *
 * SÓ LEITURA, e sem botão nenhum de alterar. Registro que a própria aplicação
 * sabe editar não prova coisa alguma.
 *
 * MOBILE-FIRST: no celular cada ato é um cartão empilhado; a tabela de sete
 * colunas só aparece onde cabe. O detalhe técnico (id do alvo, IP, navegador,
 * metadados) fica dobrado — é o que se abre em UMA linha, quando se está
 * investigando aquela.
 */

const inputCls =
  'h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ' +
  'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring';

const dia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function AuditoriaPage() {
  const hoje = useMemo(() => new Date(), []);
  const [de, setDe] = useState(() => dia(new Date(hoje.getTime() - 30 * 86_400_000)));
  const [ate, setAte] = useState(() => dia(hoje));
  const [acao, setAcao] = useState('');
  const [userId, setUserId] = useState('');
  const [entidade, setEntidade] = useState('');
  const [termo, setTermo] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [baixando, setBaixando] = useState(false);

  const filtros = { de, ate, acao, userId, entidade, q, page };

  const { data: opcoes } = useQuery({ queryKey: ['auditoria-opcoes'], queryFn: opcoesAuditoria });
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['auditoria', filtros],
    queryFn: () => listarAuditoria(filtros),
    placeholderData: keepPreviousData,
  });

  function aplicarBusca() {
    setQ(termo.trim());
    setPage(1);
  }

  function limpar() {
    setAcao(''); setUserId(''); setEntidade(''); setTermo(''); setQ(''); setPage(1);
  }

  async function baixar() {
    setBaixando(true);
    try {
      await baixarCsvAuditoria(filtros);
    } catch {
      toast.error('Não foi possível gerar o arquivo agora.');
    } finally {
      setBaixando(false);
    }
  }

  const temFiltro = !!(acao || userId || entidade || q);

  return (
    <div className="space-y-4 p-4 pb-24 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
          <ShieldCheck className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          Auditoria
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Tudo que foi criado, alterado e excluído no sistema, com autor e horário. O registro é
          somente leitura — nem a administração altera o que já foi gravado.
        </p>
      </header>

      <Card className="space-y-3 p-3 md:p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Procurar na descrição, no id do alvo ou no IP…"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && aplicarBusca()}
            />
          </div>
          <Button variant="outline" onClick={aplicarBusca}>Procurar</Button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">De</span>
            <input type="date" value={de} max={ate} onChange={(e) => { setDe(e.target.value); setPage(1); }} className={cn(inputCls, 'w-full')} />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">Até</span>
            <input type="date" value={ate} min={de} onChange={(e) => { setAte(e.target.value); setPage(1); }} className={cn(inputCls, 'w-full')} />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">Ação</span>
            <select value={acao} onChange={(e) => { setAcao(e.target.value); setPage(1); }} className={cn(inputCls, 'w-full')}>
              <option value="">Todas</option>
              {(opcoes?.acoes ?? []).map((a) => (
                <option key={a} value={a}>{ACAO_LABEL[a as AcaoAuditoria] ?? a}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">Quem</span>
            <select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} className={cn(inputCls, 'w-full')}>
              <option value="">Todos</option>
              {(opcoes?.usuarios ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-medium text-muted-foreground">Onde</span>
            <select value={entidade} onChange={(e) => { setEntidade(e.target.value); setPage(1); }} className={cn(inputCls, 'w-full')}>
              <option value="">Tudo</option>
              {(opcoes?.entidades ?? []).map((e) => (
                <option key={e} value={e}>{rotuloDaEntidade(e)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Carregando…' : `${data?.total ?? 0} registro(s) no período`}
            {isFetching && !isLoading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
          </p>
          <div className="flex gap-2">
            {temFiltro && (
              <Button variant="ghost" size="sm" onClick={limpar}>Limpar filtros</Button>
            )}
            <Button variant="outline" size="sm" onClick={baixar} disabled={baixando || !data?.total}>
              {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">Baixar CSV</span>
            </Button>
          </div>
        </div>
      </Card>

      {!isLoading && data?.data.length === 0 && (
        <Card className="py-16 text-center text-sm text-muted-foreground">
          Nenhum registro com estes filtros.
        </Card>
      )}

      <ul className="space-y-1.5">
        {(data?.data ?? []).map((r) => (
          <LinhaAuditoria key={r.id} r={r} />
        ))}
      </ul>

      {(data?.totalPages ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {data?.page} de {data?.totalPages}
          </span>
          <Button
            variant="outline" size="sm"
            disabled={page >= (data?.totalPages ?? 1)}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Um ato. O que a pessoa lê primeiro é "quem fez o quê"; o técnico (id, IP,
 * navegador, metadados) abre sob demanda — numa lista de 40 linhas, mostrar
 * isso sempre seria transformar auditoria em despejo de log.
 */
function LinhaAuditoria({ r }: { r: RegistroAuditoria }) {
  const [aberto, setAberto] = useState(false);
  const quando = new Date(r.createdAt);
  const metadados = r.metadata && Object.keys(r.metadata as object).length > 0 ? r.metadata : null;
  const temDetalhe = !!(r.entidadeId || r.ip || r.userAgent || metadados);

  return (
    <li className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 p-3">
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
            ACAO_TOM[r.acao] ?? 'bg-muted text-foreground',
          )}
        >
          {ACAO_LABEL[r.acao] ?? r.acao}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">
            {r.descricao || `${ACAO_LABEL[r.acao] ?? r.acao} em ${rotuloDaEntidade(r.entidade)}`}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {r.user?.nomeExibicao || r.user?.nome || 'Sistema'}
            </span>
            {' · '}
            {quando.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            {r.entidade && ` · ${rotuloDaEntidade(r.entidade)}`}
          </p>
        </div>
        {temDetalhe && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="shrink-0 text-muted-foreground transition hover:text-foreground"
            aria-label={aberto ? 'Fechar detalhes' : 'Ver detalhes'}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} />
          </button>
        )}
      </div>

      {aberto && temDetalhe && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t bg-muted/30 px-3 py-2 text-[11px] sm:grid-cols-2">
          {r.entidadeId && <Detalhe rotulo="Id do alvo" valor={r.entidadeId} />}
          {r.ip && <Detalhe rotulo="IP" valor={r.ip} />}
          {r.userAgent && <Detalhe rotulo="Navegador" valor={r.userAgent} />}
          {metadados && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Dados</dt>
              <dd>
                <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[10px] leading-snug">
                  {JSON.stringify(metadados, null, 2)}
                </pre>
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

function Detalhe({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="truncate font-mono" title={valor}>{valor}</dd>
    </div>
  );
}
