'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ItemBusca {
  id: string;
  rotulo: string;
  /** Linha de apoio: CPF mascarado, CNPJ, cidade. */
  detalhe?: string | null;
  /** Marca visual à direita ("já no polo", "mesmo CNPJ"). */
  marca?: string | null;
}

/**
 * AÇÃO QUE MORA DENTRO DA LISTA — "Cadastrar «Fulano»", "usar como texto".
 *
 * ELA NÃO PODE FICAR EMBAIXO DO CAMPO. Era o que acontecia com o botão de
 * cadastrar filiado: o painel "Nenhum filiado encontrado" era desenhado no
 * fluxo normal, logo abaixo do input, e a lista de resultados — que é
 * `absolute` — passava POR CIMA dele. O botão existia, aparecia na tela, e
 * ficava atrás de uma caixa branca.
 *
 * Aqui a ação é uma opção da própria lista: sempre visível, alcançável por
 * ↓ e Enter como qualquer resultado, e some junto com ela.
 */
export interface AcaoBusca {
  /** Texto do item. Recebe o termo digitado para poder citá-lo. */
  rotulo: (termo: string) => React.ReactNode;
  aoEscolher: (termo: string) => void;
  icone?: React.ComponentType<{ className?: string }>;
  /** Só aparece quando há texto digitado (padrão) ou sempre. */
  exigeTermo?: boolean;
}

/**
 * BUSCA REMOTA COM TECLADO — o que o `<input>` + lista solta não fazia.
 *
 * O projeto já tem `Combobox`, mas ele recebe a lista pronta; aqui a lista vem
 * da API a cada tecla. O que se ganha em relação ao que existia:
 *
 *  1. TECLADO. Antes só dava para clicar: ↓ e ↑ não andavam pelos resultados e
 *     Enter não escolhia. Quem cadastra processo em série trabalha com as duas
 *     mãos no teclado, e tirar a mão para o mouse a cada parte é o atrito que
 *     faz a pessoa desistir e digitar texto livre.
 *  2. UM CAMPO, NÃO DOIS. A parte contrária tinha duas caixas empilhadas —
 *     "buscar cadastrado" e "ou digite o nome" — para UMA decisão. Aqui,
 *     digitar procura; se nada casa, a mesma tecla cria como texto livre
 *     (quando `permitirLivre`), e a diferença fica visível na opção.
 *  3. ESTADO HONESTO. "procurando", "nada encontrado" e "digite mais" são
 *     coisas diferentes e agora aparecem diferentes — antes, os três eram uma
 *     lista vazia.
 *
 * MOBILE: a lista é rolável com toque e os alvos têm 40px de altura; a caixa
 * não fecha ao rolar (só ao escolher ou ao tocar fora).
 */
export function BuscaSelect({
  onBuscar,
  onEscolher,
  onCriar,
  acoes,
  placeholder,
  minimo = 2,
  autoFocus,
  rodape,
  className,
}: {
  /** Devolve os candidatos para o termo. Chamada com atraso, já cancelada. */
  onBuscar: (termo: string) => Promise<ItemBusca[]>;
  onEscolher: (item: ItemBusca) => void;
  /** Quando existe, o termo digitado pode virar valor livre. */
  onCriar?: (texto: string) => void;
  /** Ações fixas no fim da lista — ver `AcaoBusca`. */
  acoes?: AcaoBusca[];
  placeholder?: string;
  /** Quantos caracteres antes de consultar a API. */
  minimo?: number;
  autoFocus?: boolean;
  /** Texto de ajuda abaixo do campo. */
  rodape?: React.ReactNode;
  className?: string;
}) {
  const [texto, setTexto] = useState('');
  const [itens, setItens] = useState<ItemBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const listaId = useId();

  /**
   * A LISTA SAI DA CAIXA QUE A CORTAVA.
   *
   * O modal de importação rola por dentro (`overflow-y-auto`), e um filho
   * `absolute` é recortado pela borda desse contêiner. Resultado, na tela do
   * usuário: os resultados apareciam pela metade e a última opção ficava
   * cortada rente ao rodapé do modal — justamente a opção de criar, que é a
   * que interessa quando a busca não achou nada.
   *
   * `position: fixed` num portal no `body` é o único jeito de escapar: não
   * existe `overflow` de ancestral que valha para quem não é descendente.
   * O preço é ter de MEDIR e reposicionar — o que o efeito abaixo faz.
   */
  const [caixaDaLista, setCaixaDaLista] = useState<{
    left: number; width: number; maxHeight: number;
    /** Um dos dois vem preenchido: `top` abre para baixo, `bottom` para cima. */
    top?: number; bottom?: number;
  } | null>(null);

  const medir = useCallback(() => {
    const el = caixa.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const folga = 8;
    const abaixo = window.innerHeight - r.bottom - folga;
    const acima = r.top - folga;
    // Abre para CIMA quando embaixo não cabem nem 160px e em cima cabe mais.
    const paraCima = abaixo < 160 && acima > abaixo;
    /*
      OS DOIS LADOS SAEM DAQUI, e não do render.

      Ler `getBoundingClientRect()` dentro do `style` obrigaria o React a medir
      o layout no meio da renderização — valor velho na primeira passada e
      recontagem a cada re-render. Aqui a medida é uma só, no efeito.
    */
    setCaixaDaLista({
      left: r.left,
      width: r.width,
      maxHeight: Math.max(140, Math.min(288, paraCima ? acima - 4 : abaixo)),
      ...(paraCima
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!aberto) { setCaixaDaLista(null); return; }
    medir();
    /*
      `true` na captura: a rolagem que importa é a do CONTÊINER do modal, e ela
      não borbulha até o `window`. Sem a fase de captura, a lista ficaria parada
      no ar enquanto o formulário rola por baixo.
    */
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    return () => {
      window.removeEventListener('scroll', medir, true);
      window.removeEventListener('resize', medir);
    };
  }, [aberto, medir]);

  const termo = texto.trim();
  const curto = termo.length > 0 && termo.length < minimo;
  const podeCriar = !!onCriar && termo.length > 0;

  useEffect(() => {
    if (termo.length < minimo) {
      setItens([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    /*
      CANCELAMENTO POR GERAÇÃO. Sem ele, a resposta de "sil" pode chegar depois
      da de "silva" e sobrescrever a lista com o resultado antigo — o clássico
      da busca por digitação, e o mais difícil de reproduzir depois.
    */
    let atual = true;
    const t = setTimeout(async () => {
      try {
        const r = await onBuscar(termo);
        if (atual) { setItens(r); setAtivo(0); }
      } catch {
        if (atual) setItens([]);
      } finally {
        if (atual) setBuscando(false);
      }
    }, 300);
    return () => { atual = false; clearTimeout(t); };
    // `onBuscar` costuma ser inline; incluí-la relançaria a busca a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo, minimo]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      // A lista está num portal: `caixa` não a contém mais, e sem esta segunda
      // verificação clicar numa opção fecharia a caixa antes do clique chegar.
      if (caixa.current?.contains(alvo) || lista.current?.contains(alvo)) return;
      setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  /** As ações que cabem agora — as que exigem termo só com algo digitado. */
  const acoesVisiveis = (acoes ?? []).filter((a) => (a.exigeTermo === false ? true : termo.length > 0));

  /** As opções na ordem em que o teclado anda: resultados, criar, ações. */
  type Opcao = ItemBusca | 'CRIAR' | { acao: AcaoBusca };
  const opcoes: Opcao[] = [
    ...itens,
    ...(podeCriar && !itens.some((i) => i.rotulo.toLowerCase() === termo.toLowerCase())
      ? (['CRIAR'] as const)
      : []),
    ...acoesVisiveis.map((acao) => ({ acao })),
  ];

  function escolher(op: Opcao) {
    if (op === 'CRIAR') onCriar?.(termo);
    else if (typeof op === 'object' && 'acao' in op) op.acao.aoEscolher(termo);
    else onEscolher(op as ItemBusca);
    setTexto('');
    setItens([]);
    setAberto(false);
  }

  return (
    <div ref={caixa} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={listaId}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          value={texto}
          placeholder={placeholder}
          onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAberto(true);
              setAtivo((i) => Math.min(i + 1, Math.max(opcoes.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAtivo((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              // Enter aqui NÃO envia o formulário: a tecla escolhe a opção.
              e.preventDefault();
              const op = opcoes[ativo];
              if (op) escolher(op);
            } else if (e.key === 'Escape') {
              setAberto(false);
            }
          }}
          className={cn(
            'h-11 w-full rounded-md border border-input bg-background pl-9 pr-9 text-base outline-none',
            'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring md:h-10 md:text-sm',
          )}
        />
        {buscando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {aberto &&
        !!caixaDaLista &&
        (curto || buscando || opcoes.length > 0 || (!!termo && !buscando)) &&
        typeof document !== 'undefined' &&
        createPortal(
        <ul
          ref={lista}
          id={listaId}
          role="listbox"
          style={{ position: 'fixed', ...caixaDaLista }}
          /*
            `z-[80]` fica acima dos modais do projeto (`z-50` no diálogo de
            importação, `z-[70]` nos que abrem por cima dele). Uma lista de
            autocomplete que aparece ATRÁS do formulário é o mesmo que não
            aparecer, e foi assim que o botão de cadastrar filiado sumiu antes.
          */
          className="z-[80] overflow-auto rounded-md border border-input bg-card shadow-lg"
        >
          {/* Os três estados que antes eram a mesma lista vazia. */}
          {curto && (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              Digite pelo menos {minimo} letras.
            </li>
          )}
          {!curto && buscando && opcoes.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">Procurando…</li>
          )}
          {!curto && !buscando && opcoes.length === 0 && !!termo && (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">Nada encontrado.</li>
          )}

          {opcoes.map((op, i) => {
            const selecionado = i === ativo;
            if (typeof op === 'object' && 'acao' in op) {
              const Icone = op.acao.icone;
              return (
                <li key={`acao-${i}`} role="option" aria-selected={selecionado}>
                  <button
                    type="button"
                    onMouseEnter={() => setAtivo(i)}
                    onClick={() => escolher(op)}
                    className={cn(
                      'flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-sm font-medium transition',
                      'text-brand-800 dark:text-brand-400',
                      selecionado ? 'bg-muted' : 'hover:bg-muted/60',
                    )}
                  >
                    {Icone && <Icone className="h-4 w-4 shrink-0" />}
                    <span className="min-w-0 truncate">{op.acao.rotulo(termo)}</span>
                  </button>
                </li>
              );
            }
            if (op === 'CRIAR') {
              return (
                <li key="criar" role="option" aria-selected={selecionado}>
                  <button
                    type="button"
                    onMouseEnter={() => setAtivo(i)}
                    onClick={() => escolher(op)}
                    className={cn(
                      'flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-sm transition',
                      selecionado ? 'bg-muted' : 'hover:bg-muted/60',
                    )}
                  >
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">
                      Usar <span className="font-medium">{termo}</span> como texto
                    </span>
                  </button>
                </li>
              );
            }
            const item = op as ItemBusca;
            return (
              <li key={item.id} role="option" aria-selected={selecionado}>
                <button
                  type="button"
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => escolher(op)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition',
                    selecionado ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.rotulo}</span>
                    {item.detalhe && (
                      <span className="block truncate text-xs text-muted-foreground">{item.detalhe}</span>
                    )}
                  </span>
                  {item.marca ? (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {item.marca}
                    </span>
                  ) : (
                    selecionado && <Check className="h-4 w-4 shrink-0 text-brand-700" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}

      {rodape}
    </div>
  );
}
