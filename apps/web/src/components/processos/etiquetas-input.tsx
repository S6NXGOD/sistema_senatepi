'use client';

import { useState } from 'react';
import { Tag, X, Plus, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ETIQUETAS_SUGERIDAS } from '@/lib/processos';

/**
 * Campo de etiquetas internas (Urgente, Fase de Execução, Coletiva…).
 * Texto livre com atalhos: o operador clica numa sugestão ou digita a sua.
 */
export function EtiquetasInput({
  valor,
  onChange,
  compacto,
  automaticas = [],
}: {
  valor: string[];
  onChange: (v: string[]) => void;
  compacto?: boolean;
  /**
   * Quais destas etiquetas o SISTEMA deduziu (raio ⚡).
   *
   * A marca existe para quem confere: sem ela, a pessoa abre o formulário com
   * etiquetas já marcadas e não sabe se foi ela quem marcou numa tentativa
   * anterior ou se o sistema decidiu sozinho — e é justamente a decisão
   * automática que merece uma segunda olhada antes de virar filtro do acervo.
   * Remover funciona igual: o raio não trava nada.
   */
  automaticas?: string[];
}) {
  const [texto, setTexto] = useState('');

  function adicionar(e: string) {
    const limpa = e.trim().slice(0, 40);
    if (!limpa || valor.includes(limpa) || valor.length >= 12) return;
    onChange([...valor, limpa]);
    setTexto('');
  }
  const remover = (e: string) => onChange(valor.filter((x) => x !== e));

  const disponiveis = ETIQUETAS_SUGERIDAS.filter((s) => !valor.includes(s));

  return (
    <div className="space-y-2">
      {/* Selecionadas */}
      {valor.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {valor.map((e) => (
            <span
              key={e}
              title={automaticas.includes(e) ? 'Sugerida pelo DataJud — confira e remova se não for o caso' : undefined}
              className={cn(
                'inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs font-medium',
                automaticas.includes(e)
                  ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:ring-emerald-800'
                  : 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
              )}
            >
              {automaticas.includes(e) && <Zap className="h-3 w-3 shrink-0 fill-current" />}
              {e}
              <button type="button" onClick={() => remover(e)} className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Digitar nova (Enter adiciona) */}
      <div className="relative">
        <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={valor.length >= 12 ? 'Limite de 12 etiquetas' : 'Digite e pressione Enter…'}
          value={texto}
          disabled={valor.length >= 12}
          onChange={(ev) => setTexto(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              adicionar(texto);
            }
          }}
        />
      </div>

      {/* Sugestões prontas */}
      {!compacto && disponiveis.length > 0 && valor.length < 12 && (
        <div className="flex flex-wrap gap-1.5">
          {disponiveis.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => adicionar(s)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5',
                'text-[11px] text-muted-foreground transition hover:border-senatepi-400 hover:text-foreground',
              )}
            >
              <Plus className="h-3 w-3" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
