'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ReceiptText, Plus, Search, Printer, Ban, ChevronLeft, ChevronRight, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo } from '@/lib/permissoes';
import { cn } from '@/lib/utils';
import {
  listarRecibos, type FiltroRecibos, type ReciboResumo,
  formatBRL, formatData, formatDocumento,
} from '@/lib/recibos';
import { FilaSemRecibo } from '@/components/recibos/fila-sem-recibo';
import { EmitirReciboModal, type OrigemDaEmissao } from '@/components/recibos/emitir-recibo-modal';
import { ReciboPrintModal } from '@/components/recibos/recibo-print-modal';
import { CancelarReciboModal } from '@/components/recibos/cancelar-recibo-modal';

const SITUACOES = [
  { valor: 'VALIDOS', rotulo: 'Válidos' },
  { valor: 'CANCELADOS', rotulo: 'Cancelados' },
  { valor: 'TODOS', rotulo: 'Todos' },
] as const;

/**
 * RECIBOS — o papel que o sindicato entrega quando recebe dinheiro.
 *
 * A TELA TEM DUAS ZONAS, nesta ordem (`senatepi-painel-quatro-zonas`: trabalho
 * antes de número):
 *
 *  1. OS PAGAMENTOS SEM RECIBO. É o problema real: ninguém esquece o recibo de
 *     quem está no balcão esperando — esquece-se do que caiu na conta e de quem
 *     pediu o papel três semanas depois. Com a fila vazia, o bloco vira UMA
 *     LINHA, e não um cartão vazio ocupando a primeira dobra.
 *  2. O ACERVO, com busca, recorte e os totais DO MESMO recorte.
 *
 * Não há "gerar PDF": o recibo é gravado quando se emite, e imprimir é
 * reabrir o que foi gravado. É por isso que a 2ª via sai idêntica à 1ª,
 * inclusive no número.
 */
export default function RecibosPage() {
  const { user } = useAuth();
  const podeEmitir = nivelEfetivo(user?.role, user?.permissoes, 'recibos') === 'EDITAR';

  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<FiltroRecibos['situacao']>('VALIDOS');
  const [exercicio, setExercicio] = useState<number | ''>('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [page, setPage] = useState(1);

  const [emitindo, setEmitindo] = useState<OrigemDaEmissao | null>(null);
  const [imprimindo, setImprimindo] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<ReciboResumo | null>(null);

  /*
    O FILTRO É A CHAVE DA CONSULTA — um objeto só, usado nos dois lugares
    (`senatepi-memo-e-chave-da-consulta`). Montar a `queryKey` à mão, campo a
    campo, é como se esquece de um: a tela troca o recorte e a lista fica a
    mesma, servida do cache.
  */
  const filtro = useMemo<FiltroRecibos>(
    () => ({
      busca: busca.trim() || undefined,
      situacao,
      exercicio: exercicio === '' ? undefined : exercicio,
      de: de || undefined,
      ate: ate || undefined,
      page,
      pageSize: 20,
    }),
    [busca, situacao, exercicio, de, ate, page],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['recibos', filtro],
    queryFn: () => listarRecibos(filtro),
  });

  const trocarFiltro = (fn: () => void) => { fn(); setPage(1); };
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <ReceiptText className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Recibos</h2>
            <p className="text-sm text-muted-foreground">
              O comprovante de quem pagou — numerado, guardado e reimprimível.
            </p>
          </div>
        </div>
        {podeEmitir && (
          <Button onClick={() => setEmitindo({ tipo: 'AVULSO' })}>
            <Plus className="h-4 w-4" /> Emitir recibo
          </Button>
        )}
      </div>

      {/* ZONA 1 — o trabalho */}
      <FilaSemRecibo
        podeEmitir={podeEmitir}
        onEmitir={(p) => setEmitindo({ tipo: 'PAGAMENTO', pagamento: p })}
      />

      {/* ZONA 2 — o acervo */}
      <div className="rounded-2xl border bg-card">
        <div className="space-y-3 border-b p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => trocarFiltro(() => setBusca(e.target.value))}
                placeholder="Nome de quem pagou, CPF ou o número do recibo"
                className="pl-9"
                aria-label="Procurar recibo"
              />
            </div>
            <select
              value={exercicio}
              onChange={(e) => trocarFiltro(() => setExercicio(e.target.value ? Number(e.target.value) : ''))}
              aria-label="Exercício"
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">Todos os anos</option>
              {(data?.exercicios ?? []).map((ex) => (
                <option key={ex} value={ex}>{ex}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Situação: pastilhas, e não um select — são três e a escolhida tem de se ver. */}
            <div className="flex rounded-lg border p-0.5">
              {SITUACOES.map((s) => (
                <button
                  key={s.valor}
                  type="button"
                  onClick={() => trocarFiltro(() => setSituacao(s.valor))}
                  aria-pressed={situacao === s.valor}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition',
                    situacao === s.valor
                      ? 'bg-brand-800 text-white'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {s.rotulo}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="hidden sm:inline">Recebido de</span>
              <input
                type="date"
                value={de}
                onChange={(e) => trocarFiltro(() => setDe(e.target.value))}
                aria-label="Recebido a partir de"
                className="h-9 rounded-lg border bg-background px-2 text-xs"
              />
              <span>até</span>
              <input
                type="date"
                value={ate}
                onChange={(e) => trocarFiltro(() => setAte(e.target.value))}
                aria-label="Recebido até"
                className="h-9 rounded-lg border bg-background px-2 text-xs"
              />
            </div>
          </div>

          {/*
            O NÚMERO É DO MESMO RECORTE DA LISTA (`senatepi-link-leva-o-recorte`).
            Somar tudo e listar uma página seria mostrar um total que as linhas
            abaixo não explicam.
          */}
          {data && (
            <p className="text-sm">
              <strong className="tabular-nums">{data.resumo.quantidadeValida}</strong>{' '}
              {data.resumo.quantidadeValida === 1 ? 'recibo válido' : 'recibos válidos'}
              {' · '}
              <strong className="tabular-nums">{formatBRL(data.resumo.valorValido)}</strong>
              {/*
                O NÚMERO LEVA AO RECORTE (`senatepi-link-leva-o-recorte`): clicar
                em "2 cancelados" abre JUSTAMENTE esses dois, com o mesmo
                período e a mesma busca. Número sem destino obriga a procurar.
              */}
              {data.resumo.cancelados > 0 && (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => trocarFiltro(() => setSituacao('CANCELADOS'))}
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {data.resumo.cancelados} cancelado{data.resumo.cancelados > 1 ? 's' : ''}
                  </button>
                  <span className="text-muted-foreground"> (fora do total)</span>
                </>
              )}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-brand-800" />
          </div>
        ) : !data?.itens.length ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            {busca || de || ate || exercicio
              ? 'Nenhum recibo neste recorte.'
              : 'Nenhum recibo emitido ainda.'}
          </p>
        ) : (
          <>
            {/* CELULAR — cartões. A tabela de 7 colunas não cabe em 400px. */}
            <ul className="divide-y md:hidden">
              {data.itens.map((r) => (
                <li key={r.id} className="p-4">
                  <LinhaDeRecibo
                    r={r}
                    podeEditar={podeEmitir}
                    onImprimir={() => setImprimindo(r.id)}
                    onCancelar={() => setCancelando(r)}
                  />
                </li>
              ))}
            </ul>

            {/* DESKTOP — tabela */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Nº</th>
                    <th className="px-4 py-2 font-medium">Recebido</th>
                    <th className="px-4 py-2 font-medium">Quem pagou</th>
                    <th className="px-4 py-2 font-medium">Referente a</th>
                    <th className="px-4 py-2 font-medium">Forma</th>
                    <th className="px-4 py-2 text-right font-medium">Valor</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.itens.map((r) => (
                    <tr key={r.id} className={cn(r.cancelado && 'bg-muted/40')}>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">
                        {r.codigo}
                        {r.cancelado && <SeloCancelado />}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {formatData(r.recebidoEm)}
                      </td>
                      <td className="px-4 py-3">
                        <p className={cn('font-medium', r.cancelado && 'line-through opacity-60')}>
                          {r.pagadorNome}
                        </p>
                        {r.pagadorDocumento && (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {formatDocumento(r.pagadorDocumento)}
                          </p>
                        )}
                      </td>
                      <td className="max-w-[22rem] px-4 py-3 text-muted-foreground">{r.referente}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{r.formaPagamento}</td>
                      <td className={cn(
                        'whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums',
                        r.cancelado && 'line-through opacity-60',
                      )}>
                        {formatBRL(r.valor)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Acoes
                          r={r}
                          podeEditar={podeEmitir}
                          onImprimir={() => setImprimindo(r.id)}
                          onCancelar={() => setCancelando(r)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Página {data.page} de {totalPaginas} · {data.total} no total
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={data.page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" /> Anterior
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={data.page >= totalPaginas}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Próxima <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {emitindo && (
        <EmitirReciboModal
          origem={emitindo}
          onClose={() => setEmitindo(null)}
          onEmitido={(id) => { setEmitindo(null); setImprimindo(id); }}
        />
      )}
      {imprimindo && (
        <ReciboPrintModal reciboId={imprimindo} onClose={() => setImprimindo(null)} />
      )}
      {cancelando && (
        <CancelarReciboModal recibo={cancelando} onClose={() => setCancelando(null)} />
      )}
    </div>
  );
}

/**
 * O SELO DE CANCELADO — ícone antes da cor (`senatepi-cor-e-o-que-pede-alguem`).
 * Vermelho sozinho seria lido como erro do sistema; a palavra e a tarja dizem
 * que foi alguém que cancelou.
 */
function SeloCancelado() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
      <Ban className="h-3 w-3" /> Cancelado
    </span>
  );
}

function LinhaDeRecibo({
  r, podeEditar, onImprimir, onCancelar,
}: {
  r: ReciboResumo;
  /** EDITAR no módulo — aqui ele governa o cancelar, não o emitir. */
  podeEditar: boolean;
  onImprimir: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold tabular-nums text-muted-foreground">
            {r.codigo}
            <span className="font-normal">· {formatData(r.recebidoEm)}</span>
            {r.cancelado && <SeloCancelado />}
          </p>
          <p className={cn('truncate font-medium', r.cancelado && 'line-through opacity-60')}>
            {r.pagadorNome}
          </p>
        </div>
        <p className={cn(
          'whitespace-nowrap font-semibold tabular-nums',
          r.cancelado && 'line-through opacity-60',
        )}>
          {formatBRL(r.valor)}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{r.referente}</p>
      {r.cancelado && r.canceladoMotivo && (
        <p className="text-xs text-rose-700 dark:text-rose-300">Motivo: {r.canceladoMotivo}</p>
      )}
      <div className="flex gap-2 pt-1">
        <Acoes r={r} podeEditar={podeEditar} onImprimir={onImprimir} onCancelar={onCancelar} />
      </div>
    </div>
  );
}

function Acoes({
  r, podeEditar, onImprimir, onCancelar,
}: {
  r: ReciboResumo;
  podeEditar: boolean;
  onImprimir: () => void;
  onCancelar: () => void;
}) {
  /*
    O NOME ACESSÍVEL VAI SEMPRE, e a conferência de tela pegou a falta.

    No desktop a palavra some (`md:hidden`) e sobra o ícone — o que deixava os
    dois botões SEM NOME nenhum para leitor de tela e para quem navega por
    teclado. O `aria-label` não depende do tamanho da janela, e cita o número:
    com seis linhas na tela, "Imprimir" seis vezes não diz qual é qual.
  */
  return (
    <>
      <Button
        variant="outline" size="sm" onClick={onImprimir}
        aria-label={`Imprimir o recibo ${r.codigo}`}
        title={`Imprimir o recibo ${r.codigo} (2ª via, mesmo número)`}
      >
        <Printer className="h-4 w-4" />
        <span className="md:hidden">Imprimir</span>
      </Button>
      {podeEditar && !r.cancelado && (
        <Button
          variant="ghost" size="sm"
          onClick={onCancelar}
          aria-label={`Cancelar o recibo ${r.codigo}`}
          title={`Cancelar o recibo ${r.codigo}`}
          className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
        >
          <Ban className="h-4 w-4" />
          <span className="md:hidden">Cancelar</span>
        </Button>
      )}
    </>
  );
}
