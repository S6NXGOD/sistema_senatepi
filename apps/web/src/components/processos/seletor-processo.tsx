'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Gavel, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listarProcessos, formatNPU, ehPreProcessual, type ProcessoLista } from '@/lib/processos';

/**
 * Escolha de processo com PRIORIDADE para o filiado da atividade.
 *
 * POR QUE NÃO É UM `<select>`
 * O `<select>` anterior listava só os processos do filiado e, quando não havia
 * nenhum — ou quando a atividade não tinha filiado vinculado —, ficava vazio
 * sem nenhum caminho de saída: a equipe via "Processo *" obrigatório e uma
 * lista sem opções. Também não havia como alcançar um processo que existe mas
 * está vinculado a outro filiado (ação plúrima, processo do cônjuge, processo
 * herdado com a parte cadastrada errada).
 *
 * COMO FUNCIONA
 *  - abre já mostrando os processos DO FILIADO, que é a resposta certa em quase
 *    todos os casos;
 *  - digitar busca em TODO o acervo (NPU, classe ou nome de parte), com o
 *    resultado separado em "Do filiado" e "Outros processos", para que ninguém
 *    vincule ao processo errado sem perceber;
 *  - sem filiado na atividade, vira busca pura em vez de um beco sem saída.
 */
export function SeletorProcesso({
  valor,
  onChange,
  filiadoId,
  filiadoNome,
  placeholder = 'Selecionar processo…',
  autoFocus,
}: {
  valor: string;
  onChange: (id: string) => void;
  /** Filiado da atividade — define quais processos vêm primeiro. */
  filiadoId?: string | null;
  filiadoNome?: string | null;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const caixa = useRef<HTMLDivElement>(null);

  // Debounce: cada tecla dispararia uma consulta ao acervo inteiro.
  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  // Fecha ao clicar fora — sem isto o painel fica sobre o resto do formulário.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  /** Processos do filiado. Carregados de uma vez — são poucos por pessoa. */
  const doFiliado = useQuery({
    queryKey: ['seletor-processo-filiado', filiadoId],
    queryFn: () => listarProcessos({ filiadoId: filiadoId!, pageSize: 50 }),
    enabled: !!filiadoId,
  });

  /** Busca no acervo inteiro — só quando há termo, para não varrer à toa. */
  const busca_ = useQuery({
    queryKey: ['seletor-processo-busca', buscaDeb],
    queryFn: () => listarProcessos({ busca: buscaDeb, pageSize: 20 }),
    enabled: aberto && buscaDeb.length >= 2,
  });

  const listaFiliado = doFiliado.data?.items ?? [];
  const idsDoFiliado = useMemo(() => new Set(listaFiliado.map((p) => p.id)), [listaFiliado]);

  /** Com termo digitado, filtra também os do filiado — a busca vale para os dois grupos. */
  const filiadoFiltrado = useMemo(() => {
    if (!buscaDeb) return listaFiliado;
    const t = buscaDeb.toLowerCase();
    const digitos = buscaDeb.replace(/\D/g, '');
    return listaFiliado.filter(
      (p) =>
        (digitos && p.numeroCNJ?.includes(digitos)) ||
        p.classeProcessual?.toLowerCase().includes(t) ||
        p.titulo?.toLowerCase().includes(t),
    );
  }, [listaFiliado, buscaDeb]);

  /** Resultados da busca que NÃO são do filiado — o segundo grupo. */
  const outros = (busca_.data?.items ?? []).filter((p) => !idsDoFiliado.has(p.id));

  /** O selecionado pode estar em qualquer um dos grupos (ou em nenhum ainda). */
  const selecionado =
    listaFiliado.find((p) => p.id === valor) ??
    (busca_.data?.items ?? []).find((p) => p.id === valor) ??
    null;

  const carregando = doFiliado.isLoading || busca_.isFetching;

  function escolher(p: ProcessoLista) {
    onChange(p.id);
    setAberto(false);
    setBusca('');
  }

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        autoFocus={autoFocus}
        className={cn(
          'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm md:h-10',
          !valor && 'text-muted-foreground',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Gavel className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="truncate">
            {selecionado ? <RotuloProcesso p={selecionado} /> : valor ? 'Processo selecionado' : placeholder}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {valor && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar seleção"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(''); } }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 opacity-60 transition', aberto && 'rotate-180')} />
        </span>
      </button>

      {aberto && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border bg-card shadow-lg">
          <div className="relative border-b">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              className="h-11 w-full bg-transparent pl-9 pr-8 text-sm outline-none"
              placeholder="Buscar por número, classe ou parte…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {carregando && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {/* Grupo 1 — do filiado da atividade. É a resposta esperada. */}
            {!!filiadoId && (
              <>
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {filiadoNome ? `Processos de ${primeiroNome(filiadoNome)}` : 'Processos do filiado'}
                </p>
                {doFiliado.isLoading ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Carregando…</p>
                ) : filiadoFiltrado.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    {buscaDeb
                      ? 'Nenhum processo deste filiado casa com a busca.'
                      : 'Este filiado ainda não tem processos cadastrados.'}
                  </p>
                ) : (
                  filiadoFiltrado.map((p) => (
                    <Opcao key={p.id} p={p} ativo={p.id === valor} onClick={() => escolher(p)} />
                  ))
                )}
              </>
            )}

            {/* Grupo 2 — o resto do acervo, só sob busca explícita. */}
            <p className="mt-1 border-t px-3 py-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {filiadoId ? 'Outros processos' : 'Todos os processos'}
            </p>
            {buscaDeb.length < 2 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Digite ao menos 2 caracteres para procurar em todo o acervo.
              </p>
            ) : busca_.isFetching ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Procurando…</p>
            ) : outros.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum outro processo encontrado.</p>
            ) : (
              outros.map((p) => (
                <Opcao key={p.id} p={p} ativo={p.id === valor} onClick={() => escolher(p)} foraDoFiliado />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Opcao({
  p, ativo, onClick, foraDoFiliado,
}: {
  p: ProcessoLista;
  ativo: boolean;
  onClick: () => void;
  /** Marca visualmente que o processo NÃO é do filiado da atividade. */
  foraDoFiliado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-muted/60',
        ativo && 'bg-brand-50 dark:bg-brand-900/20',
      )}
    >
      <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', ativo ? 'text-brand-700 dark:text-brand-400' : 'invisible')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium"><RotuloProcesso p={p} /></span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {[p.classeProcessual, p.tribunal].filter(Boolean).join(' · ') || 'Sem classe informada'}
          {/* Vincular ao processo de outra pessoa é erro caro e silencioso —
              o nome de quem consta como parte fica visível antes do clique. */}
          {foraDoFiliado && p.filiado ? ` · ${primeiroNome(p.filiado.nomeCompleto)}` : ''}
        </span>
      </span>
      {ehPreProcessual(p.statusInterno) && (
        <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          Pré-processual
        </span>
      )}
    </button>
  );
}

function RotuloProcesso({ p }: { p: ProcessoLista }) {
  return <>{p.numeroCNJ ? formatNPU(p.numeroCNJ) : p.titulo || 'Pré-processual sem número'}</>;
}

/** Primeiro nome + último sobrenome: cabe na linha e ainda identifica a pessoa. */
function primeiroNome(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return partes.length <= 2 ? nome : `${partes[0]} ${partes[partes.length - 1]}`;
}
