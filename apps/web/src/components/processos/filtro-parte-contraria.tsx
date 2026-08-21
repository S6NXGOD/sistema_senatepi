'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X, Landmark, Building2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listarPartesExternas, formatDocumento, type ParteExterna } from '@/lib/partes';

/**
 * FILTRAR POR PARTE CONTRÁRIA — e por que não bastava a busca livre.
 *
 * A busca livre JÁ procura no nome das partes: digitar "prontocare" acha os
 * processos em que alguém escreveu "prontocare" na parte. O problema é que o
 * nome da parte é SNAPSHOT do que consta nos autos, e nos autos ele vem escrito
 * de um jeito diferente a cada processo — "PRONTOCARE", "Pronto Care LTDA",
 * "PRONTOCARE CLINICA E ATENDIMENTOS". A busca por texto acha uma grafia e
 * perde as outras, em silêncio.
 *
 * Este filtro pergunta outra coisa: quais processos estão LIGADOS AO CADASTRO
 * daquela organização. Pega todas as grafias de uma vez, porque a ligação é por
 * id — é a pergunta "quantos processos temos contra esta empresa", que é a
 * razão de o cadastro de organizações existir.
 *
 * A busca livre continua onde está, e agora o placeholder diz que ela cobre
 * partes: a maioria das buscas é de quem tem o nome na cabeça e quer o
 * resultado agora, e obrigar essa pessoa a escolher no autocomplete seria
 * trocar dois segundos por cinco.
 */
export function FiltroParteContraria({
  valor,
  onChange,
  className,
}: {
  /** A organização escolhida, ou nulo. */
  valor: ParteExterna | null;
  onChange: (p: ParteExterna | null) => void;
  className?: string;
}) {
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<ParteExterna[]>([]);
  const [buscando, setBuscando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora — sem isto a lista fica pairando sobre a tabela.
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) { setItens([]); return; }
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        const r = await listarPartesExternas({ busca: t, pageSize: 8 });
        setItens(r.items);
      } catch {
        setItens([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [termo]);

  if (valor) {
    return (
      <div
        className={cn(
          'flex h-10 items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-2.5',
          'text-sm dark:border-brand-800 dark:bg-brand-900/30',
          className,
        )}
      >
        {valor.tipo === 'ORGAO_PUBLICO'
          ? <Landmark className="h-3.5 w-3.5 shrink-0 text-brand-800 dark:text-brand-400" />
          : <Building2 className="h-3.5 w-3.5 shrink-0 text-brand-800 dark:text-brand-400" />}
        <span className="min-w-0 flex-1 truncate font-medium" title={valor.nome}>
          {valor.nomeFantasia || valor.nome}
        </span>
        <button
          type="button"
          onClick={() => { onChange(null); setTermo(''); }}
          title="Limpar o filtro de parte"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={caixa} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        className="h-10 w-full rounded-md border border-input bg-background pl-8 pr-8 text-base sm:text-sm"
        placeholder="Filtrar por parte…"
        value={termo}
        onChange={(e) => { setTermo(e.target.value); setAberto(true); }}
        onFocus={() => setAberto(true)}
      />
      {buscando && (
        <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {aberto && termo.trim().length >= 2 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full min-w-[16rem] overflow-y-auto rounded-lg border bg-card shadow-lg">
          {itens.length === 0 && !buscando ? (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              Nenhuma organização com esse nome no cadastro.
              {/* Explica a diferença no momento em que ela importa: a pessoa
                  procurou aqui e não achou, e o caminho certo é a busca livre. */}
              <span className="mt-0.5 block">
                Se a parte não está cadastrada, use a busca ao lado — ela procura
                no nome escrito dentro de cada processo.
              </span>
            </li>
          ) : (
            itens.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => { onChange(p); setAberto(false); setTermo(''); }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-muted/60"
                >
                  {p.tipo === 'ORGAO_PUBLICO'
                    ? <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    : <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.nome}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {p.documento ? formatDocumento(p.documento) : 'sem documento'}
                      {p.cidade ? ` · ${p.cidade}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
