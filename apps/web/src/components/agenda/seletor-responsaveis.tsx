'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Users } from 'lucide-react';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { cn } from '@/lib/utils';
import type { Responsavel } from '@/lib/agenda';

/**
 * DE QUEM É A AGENDA QUE ESTOU OLHANDO — de um, de dois, ou de todos.
 *
 * O `<select>` de antes respondia só "de UMA pessoa". A pergunta que a
 * coordenação faz é outra: "como estão o Murilo e a Shérad esta semana?" —
 * comparar duas carteiras exigia filtrar uma, anotar, filtrar a outra.
 *
 * ROSTO ANTES DO NOME. São nove advogados com "Dr."/"Dra." na frente; a lista
 * lida por texto obriga a ler a segunda palavra de cada linha. A foto resolve
 * antes disso — e todos os nove têm foto no cadastro.
 *
 * NO CELULAR o painel ocupa a largura toda e cada linha tem 44px, que é o alvo
 * de toque confortável; no desktop ele abre ancorado ao botão.
 */
export function SeletorResponsaveis({
  pessoas,
  selecionados,
  onChange,
  meuId,
}: {
  pessoas: Responsavel[];
  selecionados: string[];
  onChange: (ids: string[]) => void;
  /** Quem está logado — ganha "(você)" e vai para o topo da lista. */
  meuId?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  // Eu primeiro: é a linha que mais se clica, e procurar o próprio nome no meio
  // de nove é o tipo de atrito que faz a pessoa desistir do filtro.
  const ordenadas = [...pessoas].sort((a, b) => {
    if (a.id === meuId) return -1;
    if (b.id === meuId) return 1;
    return (a.nomeExibicao || a.nome).localeCompare(b.nomeExibicao || b.nome, 'pt-BR');
  });

  function alternar(id: string) {
    onChange(selecionados.includes(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id]);
  }

  const escolhidas = pessoas.filter((p) => selecionados.includes(p.id));
  const rotulo =
    escolhidas.length === 0
      ? 'Todos os responsáveis'
      : escolhidas.length === 1
        ? (escolhidas[0].nomeExibicao || escolhidas[0].nome)
        : `${escolhidas.length} pessoas`;

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="listbox"
        className={cn(
          'flex h-12 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:w-auto sm:text-sm',
          selecionados.length > 0 && 'border-brand-500 bg-brand-50 dark:bg-brand-900/20',
        )}
      >
        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">{rotulo}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition', aberto && 'rotate-180')} />
      </button>

      {aberto && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute left-0 z-30 mt-1 max-h-80 w-full min-w-[16rem] overflow-auto rounded-md border border-input bg-card shadow-lg sm:w-72"
        >
          {selecionados.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full border-b px-3 py-2.5 text-left text-xs font-medium text-brand-800 transition hover:bg-muted dark:text-brand-400"
            >
              Limpar — ver de todos
            </button>
          )}
          {ordenadas.map((p) => {
            const marcado = selecionados.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={marcado}
                onClick={() => alternar(p.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-muted/60',
                  marcado && 'bg-muted/40',
                )}
              >
                <AvatarPessoa nome={p.nomeExibicao || p.nome} url={p.avatarUrl} tamanho="xs" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.nomeExibicao || p.nome}
                  {p.id === meuId && <span className="text-muted-foreground"> (você)</span>}
                </span>
                {marcado && <Check className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
