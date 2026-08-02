'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn, normalizarTexto } from '@/lib/utils';

export interface OpcaoCombobox {
  valor: string;
  rotulo: string;
  /** Texto de apoio à direita (ex.: a sigla da UF). */
  detalhe?: string;
}

interface Props {
  value: string;
  onChange: (valor: string) => void;
  opcoes: OpcaoCombobox[];
  placeholder?: string;
  /** Mensagem quando a lista está vazia por falta de pré-requisito. */
  aviso?: string;
  /**
   * Aceita texto fora da lista. Ligado na CIDADE: a lista vem do IBGE e, se a
   * chamada falhar, digitar à mão precisa continuar possível. Desligado na UF,
   * que é uma lista fechada de 27.
   */
  permitirLivre?: boolean;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
}

/**
 * Combobox com filtro que ignora acento e navegação por teclado.
 *
 * POR QUE NÃO `<input list>` + `<datalist>`
 * Era o que existia antes, e falhava em três frentes:
 *
 *   1. O Chrome ignora `autoComplete="off"` em campos que ele reconhece como
 *      endereço e mostra o PRÓPRIO menu de autofill por cima — aquele com
 *      "Gerenciar endereços..." no rodapé. A lista de municípios ficava
 *      escondida atrás de uma lista do navegador.
 *   2. `datalist` não tem estilo: ignora o tema, ignora o modo escuro e é
 *      desenhado diferente em cada navegador.
 *   3. O filtro do `datalist` é por PREFIXO e sensível a acento — digitar
 *      "sao" não achava "São Raimundo".
 *
 * Para escapar da heurística de autofill do Chrome, o input não se chama
 * "cidade" nem "estado": recebe um `name` aleatório por instância. O Chrome
 * decide o que preencher olhando nome, id e rótulo do campo; sem um nome
 * reconhecível, ele não oferece nada.
 */
export function Combobox({
  value, onChange, opcoes, placeholder, aviso,
  permitirLivre = false, disabled, id, 'aria-invalid': invalido,
}: Props) {
  const reactId = useId();
  const [aberto, setAberto] = useState(false);
  /**
   * NULO = a lista está aberta mas a pessoa ainda não digitou nada; o campo
   * segue mostrando o que já estava escolhido.
   *
   * Sem essa distinção, focar o campo (inclusive só passando de Tab) apagava
   * visualmente a cidade já preenchida, e parecia que o dado tinha se perdido.
   */
  const [filtro, setFiltro] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(0);
  const caixaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  // Nome imprevisível: é o que impede o autofill de endereço do Chrome de
  // sequestrar o campo. Fixo por instância para não remontar o input.
  const nomeAntiAutofill = useMemo(() => `c-${Math.random().toString(36).slice(2, 10)}`, []);

  const selecionada = opcoes.find((o) => o.valor === value);
  const rotuloAtual = selecionada?.rotulo ?? value ?? '';
  /** Só troca para o texto digitado depois que a pessoa de fato digita algo. */
  const textoVisivel = filtro !== null ? filtro : rotuloAtual;

  const filtradas = useMemo(() => {
    const alvo = normalizarTexto(filtro ?? '');
    if (!alvo) return opcoes;
    // `includes` e não `startsWith`: procurar "raimundo" tem de achar
    // "São Raimundo Nonato".
    return opcoes.filter(
      (o) => normalizarTexto(o.rotulo).includes(alvo) || normalizarTexto(o.detalhe).includes(alvo),
    );
  }, [opcoes, filtro]);

  useEffect(() => { setAtivo(0); }, [filtro, aberto]);

  // Clique fora fecha e consolida o valor.
  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) fechar();
    }
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  });

  // Mantém a opção destacada visível ao navegar pelas setas.
  useEffect(() => {
    if (!aberto || !listaRef.current) return;
    listaRef.current.querySelector<HTMLLIElement>(`[data-i="${ativo}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [ativo, aberto]);

  function abrir() {
    if (disabled) return;
    setFiltro(null);
    setAberto(true);
  }

  /**
   * Fecha decidindo o que fica no campo.
   *
   * Sem `permitirLivre`, texto que não corresponde a nenhuma opção é
   * DESCARTADO em vez de virar valor. Deixar "Piaui" digitado num campo de UF
   * que só aceita sigla produziria um cadastro que o servidor recusa — o erro
   * apareceria lá na frente, sem relação visível com o que foi digitado.
   */
  function fechar() {
    const digitado = filtro?.trim() ?? '';
    if (permitirLivre && digitado && !opcoes.some((o) => o.rotulo === digitado)) {
      onChange(digitado);
    }
    setAberto(false);
    setFiltro(null);
  }

  function escolher(opcao: OpcaoCombobox) {
    onChange(opcao.valor);
    setAberto(false);
    setFiltro(null);
    inputRef.current?.focus();
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter dentro do combobox NUNCA chega ao formulário: aqui ele escolhe a
    // opção, e deixar propagar submeteria o cadastro inteiro no meio do
    // preenchimento.
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (aberto && filtradas[ativo]) escolher(filtradas[ativo]);
      else if (aberto) fechar();
      else abrir();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!aberto) return abrir();
      setAtivo((i) => Math.min(i + 1, filtradas.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) return abrir();
      setAtivo((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Escape') {
      // Descarta o que foi digitado e devolve o valor anterior — Escape
      // desfaz, não confirma.
      e.preventDefault();
      e.stopPropagation();
      setAberto(false);
      setFiltro(null);
      return;
    }
    if (e.key === 'Tab') {
      fechar();
    }
  }

  return (
    <div className="relative" ref={caixaRef}>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={nomeAntiAutofill}
          autoComplete="off"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={`${reactId}-lista`}
          aria-autocomplete="list"
          aria-invalid={invalido}
          disabled={disabled}
          placeholder={placeholder}
          value={textoVisivel}
          onFocus={abrir}
          onChange={(e) => { if (!aberto) setAberto(true); setFiltro(e.target.value); }}
          onKeyDown={aoTeclar}
          className={cn(
            'flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-base',
            'ring-offset-background placeholder:text-muted-foreground md:h-10 md:text-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            invalido && 'border-red-500',
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={aberto ? 'Fechar lista' : 'Abrir lista'}
          disabled={disabled}
          onClick={() => (aberto ? fechar() : (inputRef.current?.focus(), abrir()))}
          className="absolute right-0 top-0 flex h-full w-9 items-center justify-center text-muted-foreground disabled:opacity-50"
        >
          {aberto ? <Search className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {aberto && (
        <ul
          ref={listaRef}
          id={`${reactId}-lista`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-input bg-background py-1 shadow-lg"
        >
          {opcoes.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {aviso ?? 'Nenhuma opção disponível.'}
            </li>
          )}
          {opcoes.length > 0 && filtradas.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              Nada encontrado para “{filtro}”.
              {permitirLivre && ' Pode digitar assim mesmo.'}
            </li>
          )}
          {filtradas.map((o, i) => (
            <li key={o.valor} data-i={i} role="option" aria-selected={o.valor === value}>
              <button
                type="button"
                // mousedown em vez de click: o blur do input dispara antes do
                // click e fecharia a lista, engolindo a escolha.
                onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
                onMouseEnter={() => setAtivo(i)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                  i === ativo && 'bg-muted',
                  o.valor === value && 'font-semibold',
                )}
              >
                <span className="truncate">{o.rotulo}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {o.detalhe && <span className="text-xs text-muted-foreground">{o.detalhe}</span>}
                  {o.valor === value && <Check className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
