'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Search, Star, X } from 'lucide-react';
import { listarAdvogadosDisponiveis, type AdvogadoDisponivel } from '@/lib/processos';
import { cn, normalizarTexto } from '@/lib/utils';

/**
 * Quem toca o processo — a equipe inteira num campo só.
 *
 * O QUE HAVIA ANTES
 * Dois controles separados: um `<select>` nativo para o responsável e, embaixo,
 * uma lista de caixinhas para "outros advogados". Quem preenchia precisava
 * entender que os dois falavam da mesma equipe, tomar cuidado para não marcar o
 * responsável duas vezes, e — no `<select>` — encontrar a pessoa rolando uma
 * lista sem busca. Com a equipe crescendo, isso só piora.
 *
 * AQUI é um campo só: as escolhas viram etiquetas visíveis, a lista abre com
 * busca, e a estrela diz quem responde pelo processo. A distinção que importa
 * (responsável × equipe) fica explícita em vez de morar em dois lugares.
 *
 * O RESPONSÁVEL NUNCA FICA INDEFINIDO por acidente: o primeiro marcado assume,
 * e tirar quem era responsável promove quem sobrou. Um processo com equipe e
 * sem responsável é um processo que não aparece em "Meus processos" de ninguém.
 */
export interface ValorSeletorAdvogados {
  /** Todos os advogados do processo, responsável incluído. */
  ids: string[];
  /** Quem responde pelo processo. Vazio só quando `ids` está vazio. */
  principal: string;
}

export function SeletorAdvogados({
  valor,
  onChange,
  placeholder = 'Buscar advogado…',
  vazioLabel = 'Nenhum advogado selecionado',
}: {
  valor: ValorSeletorAdvogados;
  onChange: (valor: ValorSeletorAdvogados) => void;
  placeholder?: string;
  vazioLabel?: string;
}) {
  /**
   * SÓ ADVOGADOS. A lista vinha da Agenda (`listarResponsaveis`), que devolve
   * todo usuário ativo — triagem e coordenação inclusive. Faz sentido lá, onde
   * qualquer um responde por uma tarefa; aqui não: advogado do processo é quem
   * tem capacidade postulatória, e oferecer a recepção neste campo é convidar
   * ao erro de cadastro.
   */
  const { data: equipe = [], isLoading } = useQuery({
    queryKey: ['processos-advogados-disponiveis'],
    queryFn: listarAdvogadosDisponiveis,
  });

  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const caixa = useRef<HTMLDivElement>(null);

  /** Clique fora e Esc fecham — sem isso a lista fica presa aberta sobre o form. */
  useEffect(() => {
    if (!aberto) return;
    const foraDaCaixa = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Só fecha a LISTA — o modal que a contém continua aberto, senão o Esc
      // fecharia o formulário inteiro junto e o preenchimento se perderia.
      e.stopPropagation();
      setAberto(false);
    };
    document.addEventListener('mousedown', foraDaCaixa);
    document.addEventListener('keydown', aoTeclar, true);
    return () => {
      document.removeEventListener('mousedown', foraDaCaixa);
      document.removeEventListener('keydown', aoTeclar, true);
    };
  }, [aberto]);

  const porId = useMemo(() => new Map(equipe.map((a) => [a.id, a])), [equipe]);

  const filtrados = useMemo(() => {
    const termo = normalizarTexto(busca);
    if (!termo) return equipe;
    return equipe.filter((a) =>
      normalizarTexto(`${a.nome} ${a.nomeExibicao ?? ''} ${a.role ?? ''}`).includes(termo),
    );
  }, [equipe, busca]);

  function alternar(id: string) {
    const marcado = valor.ids.includes(id);
    const ids = marcado ? valor.ids.filter((x) => x !== id) : [...valor.ids, id];
    // Regra do responsável, num lugar só: sai da equipe → promove quem sobrou;
    // entra o primeiro de todos → ele assume.
    const principal = ids.includes(valor.principal) ? valor.principal : (ids[0] ?? '');
    onChange({ ids, principal });
  }

  function definirPrincipal(id: string) {
    const ids = valor.ids.includes(id) ? valor.ids : [...valor.ids, id];
    onChange({ ids, principal: id });
  }

  const nomeDe = (a: AdvogadoDisponivel) => a.nomeExibicao || a.nome;

  return (
    <div className="relative" ref={caixa}>
      {/* CAIXA DE ETIQUETAS — clicar em qualquer lugar dela abre a lista. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setAberto((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberto((v) => !v); }
        }}
        className={cn(
          'flex min-h-[3rem] w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm transition md:min-h-[2.5rem]',
          aberto && 'border-senatepi-500 ring-1 ring-senatepi-500/30',
        )}
      >
        {valor.ids.length === 0 ? (
          <span className="px-1 text-muted-foreground">{vazioLabel}</span>
        ) : (
          valor.ids.map((id) => {
            const a = porId.get(id);
            // Vínculo com alguém que não está mais na lista (perfil mudou, ou
            // usuário inativado). Mostrar em vez de sumir: sumir esconderia um
            // vínculo que continua gravado e seria salvo de novo sem ninguém ver.
            if (!a) {
              return (
                <span
                  key={id}
                  title="Este usuário não tem mais perfil de advogado — remova ou ajuste o perfil dele em Usuários e Perfis."
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 py-0.5 pl-2 pr-1.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                >
                  vínculo fora da lista
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); alternar(id); }}
                    className="shrink-0 rounded-full p-0.5 opacity-70 transition hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            }
            const ehPrincipal = valor.principal === id;
            return (
              <span
                key={id}
                className={cn(
                  'inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-1 pr-1.5 text-xs font-medium',
                  ehPrincipal
                    ? 'bg-senatepi-800 text-white'
                    : 'bg-muted text-foreground',
                )}
                title={ehPrincipal ? `${nomeDe(a)} — responsável pelo processo` : nomeDe(a)}
              >
                {a.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    ehPrincipal ? 'bg-white/20 text-white' : 'bg-senatepi-400 text-senatepi-900',
                  )}>
                    {nomeDe(a).charAt(0)}
                  </span>
                )}
                <span className="truncate">{nomeDe(a)}</span>
                {ehPrincipal && <Star className="h-3 w-3 shrink-0 fill-current" />}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); alternar(id); }}
                  title="Remover do processo"
                  className="shrink-0 rounded-full p-0.5 opacity-70 transition hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })
        )}
        <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
      </div>

      {/* LISTA */}
      {aberto && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-input bg-card shadow-lg">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              // Enter aqui é "filtrar", nunca "enviar o formulário".
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
              placeholder={placeholder}
              className="h-9 w-full rounded border border-input bg-background pl-8 pr-2 text-sm outline-none focus:border-senatepi-500"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filtrados.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum advogado encontrado.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto p-1">
              {filtrados.map((a) => {
                const marcado = valor.ids.includes(a.id);
                const ehPrincipal = valor.principal === a.id;
                return (
                  <li key={a.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => alternar(a.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                    >
                      <span className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        marcado ? 'border-senatepi-800 bg-senatepi-800 text-white' : 'border-input',
                      )}>
                        {marcado && <Check className="h-3 w-3" />}
                      </span>
                      {a.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-senatepi-400 text-xs font-bold text-senatepi-900">
                          {nomeDe(a).charAt(0)}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{nomeDe(a)}</span>
                        {(a.oab || a.role) && (
                          <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                            {a.oab ? `OAB ${a.oab}${a.oabUf ? `/${a.oabUf}` : ''}` : a.role}
                          </span>
                        )}
                      </span>
                    </button>
                    {/* A estrela sozinha já marca E promove: quem clica aqui
                        quer aquela pessoa como responsável, marcada ou não. */}
                    <button
                      type="button"
                      onClick={() => definirPrincipal(a.id)}
                      title="Definir como responsável pelo processo"
                      className={cn(
                        'mr-1 shrink-0 rounded p-1.5 transition',
                        ehPrincipal ? 'text-amber-500' : 'text-muted-foreground/50 hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Star className={cn('h-4 w-4', ehPrincipal && 'fill-current')} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <Star className="mr-1 inline h-3 w-3 text-amber-500" />
            A estrela marca o <strong className="font-semibold text-foreground">responsável</strong> —
            é ele que aparece na lista e em “Meus processos”.
          </p>
        </div>
      )}
    </div>
  );
}
