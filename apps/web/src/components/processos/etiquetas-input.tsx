'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag, X, Plus, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn, normalizarTexto } from '@/lib/utils';
import { etiquetasDoAcervo } from '@/lib/partes';

/**
 * Campo de etiquetas internas do processo.
 *
 * AS SUGESTÕES SAEM DO ACERVO, e não de uma lista escrita no código.
 *
 * Havia seis fixas — "Urgente", "Acordo", "Aguardando Cliente", "Prioridade
 * Idoso", "Perícia realizada", "Acordo descumprido". Medido na produção em
 * 04/09/2026: entre os 83 processos etiquetados, essas seis somam DUAS
 * ocorrências. A equipe construiu outro vocabulário e ele é específico do
 * trabalho dela: o período da convenção ("CCT 2022/2024" em 26 processos,
 * "CCT 2018/2020" em 12) e o pedido ("INSALUBRIDADE" 14, "RETALIAÇÃO" 12).
 *
 * Sugerir o que já existe resolve duas coisas de uma vez. Acerta o vocabulário
 * de cada sindicato sem ninguém manter lista — e freia a proliferação de
 * quase-duplicatas, que já começou: convivem "INSALUBRIDADE" e "READAPTAÇÃO +
 * INSALUB.", e a segunda nunca vai ser encontrada por quem filtra pela
 * primeira.
 *
 * O TEXTO LIVRE CONTINUA. Etiqueta nova precisa poder nascer — foi assim que
 * "CCT 2024/2026" apareceu quando a convenção foi assinada. O que muda é que
 * digitar passa a FILTRAR o que existe antes de criar algo novo.
 */
/**
 * O PERÍODO DA CONVENÇÃO NÃO É UM PEDIDO — são dois eixos numa lista só.
 *
 * "CCT 2022/2024" responde SOB QUAL CONVENÇÃO; "INSALUBRIDADE" responde O QUE
 * SE PEDE. Na produção, os períodos somam 41 dos ~84 usos — metade do
 * vocabulário é de um eixo que a lista misturava com o outro. Separar as
 * sugestões em dois grupos não muda nada no banco e ensina o vocabulário a
 * quem chega.
 */
function ehPeriodoDeConvencao(e: string): boolean {
  return /^\s*(CCT|ACT)\b/i.test(e) || /\b\d{4}\s*[/-]\s*\d{4}\b/.test(e);
}

/**
 * ETIQUETA COMPOSTA É CONTAGEM ERRADA, e o acervo já tem três.
 *
 * "READAPTAÇÃO + INSALUB." é um processo que NÃO aparece quando alguém filtra
 * por INSALUBRIDADE — ou seja, a resposta para "quantas ações de insalubridade
 * temos?" já está errada hoje: diz 14 quando são 15. O mesmo vale para
 * "ADICIONAIS + GRATIFICAÇÃO" e "FÉRIAS, 13º E ADICIONAIS".
 *
 * A saída não é proibir — quem digita está descrevendo o processo direito, o
 * campo é que é estreito. É OFERECER a separação no momento em que dá para
 * fazer sem custo: duas etiquetas em vez de uma, e as duas contam.
 */
export function separarComposta(e: string): string[] {
  const partes = e
    .split(/\s*\+\s*|\s*,\s*|\s+E\s+(?=[A-ZÀ-Ü])/)
    .map((x) => x.trim().replace(/[.,;]+$/, ''))
    .filter((x) => x.length >= 3);
  return partes.length > 1 ? partes : [];
}

/**
 * UM GRUPO DE SUGESTÕES, com o peso de cada etiqueta à mostra.
 *
 * O NÚMERO É O QUE FALTAVA. Sem ele, "CCT 2022/2024" (26 processos) e
 * "SELETIVO SIMPLIFICADO" (1) parecem igualmente estabelecidas — e a segunda
 * quase sempre é variação de outra que alguém criou sem procurar antes. Com o
 * número à vista, escolher a que o acervo usa vira o caminho óbvio.
 */
function Grupo({
  titulo,
  itens,
  onEscolher,
}: {
  titulo?: string;
  itens: { etiqueta: string; processos: number }[];
  onEscolher: (e: string) => void;
}) {
  return (
    <div>
      {titulo && (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {itens.map((e) => (
          <button
            key={e.etiqueta}
            type="button"
            onClick={() => onEscolher(e.etiqueta)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
              'text-[11px] text-muted-foreground transition hover:border-brand-400 hover:text-foreground',
            )}
          >
            {e.etiqueta}
            <span className="text-[10px] tabular-nums text-muted-foreground/70">{e.processos}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

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

  const { data: doAcervo = [] } = useQuery({
    queryKey: ['etiquetas-do-acervo'],
    queryFn: etiquetasDoAcervo,
    staleTime: 5 * 60_000,
  });

  function adicionar(e: string) {
    const limpa = e.trim().slice(0, 40);
    if (!limpa || valor.includes(limpa) || valor.length >= 12) return;
    onChange([...valor, limpa]);
    setTexto('');
  }
  const remover = (e: string) => onChange(valor.filter((x) => x !== e));

  /**
   * DIGITAR FILTRA O QUE EXISTE antes de criar algo novo — é aqui que a
   * duplicata é evitada. Sem termo, mostra as mais usadas; a comparação ignora
   * acento e caixa, porque "insalubridade" e "INSALUBRIDADE" são a mesma coisa
   * para quem digita e coisas diferentes para o banco.
   */
  const sugestoes = useMemo(() => {
    const termo = normalizarTexto(texto.trim());
    const candidatas = doAcervo.filter((e) => !valor.includes(e.etiqueta));
    const filtradas = termo
      ? candidatas.filter((e) => normalizarTexto(e.etiqueta).includes(termo))
      : candidatas;
    return {
      convencao: filtradas.filter((e) => ehPeriodoDeConvencao(e.etiqueta)).slice(0, 6),
      pedido: filtradas.filter((e) => !ehPeriodoDeConvencao(e.etiqueta)).slice(0, 10),
    };
  }, [doAcervo, valor, texto]);

  const todasSugeridas = [...sugestoes.convencao, ...sugestoes.pedido];

  /** O que foi digitado já existe no acervo? Se não, criar é a única saída. */
  const exata = doAcervo.some((e) => normalizarTexto(e.etiqueta) === normalizarTexto(texto.trim()));

  /**
   * O QUE FOI DIGITADO SÃO DUAS ETIQUETAS?
   *
   * Só oferece quando as partes ainda não estão na lista — e só quando a
   * composta NÃO existe no acervo, porque escolher uma que já está lá é uma
   * decisão consciente de manter a mesma grafia dos colegas.
   */
  const partesDaComposta = useMemo(() => {
    const t = texto.trim();
    if (!t || exata) return [];
    return separarComposta(t).filter((x) => !valor.includes(x));
  }, [texto, exata, valor]);

  /** Põe várias de uma vez — respeitando o teto de 12. */
  function adicionarVarias(novas: string[]) {
    const limpas = novas
      .map((x) => x.trim().slice(0, 40))
      .filter((x) => x && !valor.includes(x));
    if (!limpas.length) return;
    onChange([...valor, ...limpas].slice(0, 12));
    setTexto('');
  }

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
                  : 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400',
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

      {/* Digitar filtra o que existe; Enter cria o que não existe. */}
      <div className="relative">
        <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={
            valor.length >= 12 ? 'Limite de 12 etiquetas' : 'Procurar ou criar etiqueta…'
          }
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

      {/*
        A OFERTA DE SEPARAR vem ANTES das sugestões, porque é sobre o que a
        pessoa acabou de escrever — e some assim que ela decide.
      */}
      {partesDaComposta.length > 1 && valor.length < 12 && (
        <div className="rounded-md border border-dashed border-brand-400/70 bg-brand-50/50 px-2.5 py-2 dark:bg-brand-900/10">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Parece que são <strong className="text-foreground">{partesDaComposta.length} pedidos</strong>.
            Separados, cada um conta no acervo e aparece no filtro do outro.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => adicionarVarias(partesDaComposta)}
              className="inline-flex items-center gap-1 rounded-full bg-brand-800 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-brand-900"
            >
              <Plus className="h-3 w-3" /> Separar em {partesDaComposta.map((x) => `“${x}”`).join(' + ')}
            </button>
            <button
              type="button"
              onClick={() => adicionar(texto)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              manter como uma só
            </button>
          </div>
        </div>
      )}

      {valor.length < 12 && (todasSugeridas.length > 0 || texto.trim()) && (
        <div className="space-y-1.5">
          {/*
            DOIS GRUPOS, DOIS EIXOS. Período de convenção e pedido respondem
            perguntas diferentes e são metade e metade do acervo; numa fita
            única de bolinhas, a pessoa lia oito nomes para achar o que queria.
          */}
          {sugestoes.convencao.length > 0 && (
            <Grupo titulo="Convenção" itens={sugestoes.convencao} onEscolher={adicionar} />
          )}
          {sugestoes.pedido.length > 0 && (
            <Grupo
              titulo={sugestoes.convencao.length > 0 ? 'Pedido' : undefined}
              itens={sugestoes.pedido}
              onEscolher={adicionar}
            />
          )}

          {/*
            CRIAR É EXPLÍCITO, e a diferença de traço diz isso: sugestão tem
            borda cheia (já existe no acervo), criação tem borda tracejada. Sem
            a distinção, quem digita "INSALUBRIDADE " com um espaço a mais cria
            uma etiqueta nova achando que escolheu a que já existia.
          */}
          {!!texto.trim() && !exata && !valor.includes(texto.trim()) && partesDaComposta.length < 2 && (
            <button
              type="button"
              onClick={() => adicionar(texto)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand-400 px-2 py-0.5 text-[11px] font-medium text-brand-800 transition hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/20"
            >
              <Plus className="h-3 w-3" /> criar &quot;{texto.trim().slice(0, 24)}&quot;
            </button>
          )}
        </div>
      )}

      {/*
        A CONTAGEM DIZ SE A ETIQUETA É DO ACERVO OU INVENÇÃO DO DIA. Uma
        etiqueta usada uma vez só quase sempre é erro de digitação de outra —
        na produção há doze assim, contra "CCT 2022/2024" com vinte e seis.
      */}
      {!compacto && !texto.trim() && doAcervo.length > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Sugestões vêm do que o acervo já usa — o número é em quantos processos
          cada uma está. Digite para procurar entre as {doAcervo.length}.
        </p>
      )}
    </div>
  );
}
