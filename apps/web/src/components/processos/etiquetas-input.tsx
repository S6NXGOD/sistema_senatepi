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
  itens: { etiqueta: string; processos: number; noReu?: number }[];
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
            {/*
              O NÚMERO CONTRA ESTE RÉU, quando há réu. É o que transforma
              "existe no acervo" em "é disto que costumam ser as ações contra
              esta empresa" — e continua sendo o operador quem decide.
            */}
            {e.noReu ? (
              <span className="rounded bg-brand-100 px-1 text-[10px] font-semibold tabular-nums text-brand-900 dark:bg-brand-900/40 dark:text-brand-300">
                {e.noReu} neste réu
              </span>
            ) : (
              <span className="text-[10px] tabular-nums text-muted-foreground/70">{e.processos}</span>
            )}
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
  parteExternaId,
}: {
  valor: string[];
  onChange: (v: string[]) => void;
  compacto?: boolean;
  /**
   * O RÉU PRINCIPAL, quando já escolhido — as etiquetas que o acervo usa
   * contra ELE sobem para o topo, marcadas.
   *
   * É a única automação que os dados sustentam, e sustentam pela METADE: entre
   * os oito réus com 3+ processos etiquetados, a dominante cobre 70%+ em
   * quatro (UNIMED: `RETALIAÇÃO` em 7 de 7; FMS/THE: 33%). Por isso ORDENA e
   * não marca — etiqueta errada que parece deliberada é pior que etiqueta
   * ausente, porque vira filtro e vira relatório.
   */
  parteExternaId?: string;
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
  /**
   * A LISTA COMEÇA FECHADA.
   *
   * Dezenove etiquetas viravam doze bolinhas em dois grupos mais duas linhas de
   * explicação — tudo isso Á MOSTRA antes de a pessoa fazer qualquer coisa,
   * num modal que já rola. Etiqueta é campo OPCIONAL: ela não pode ocupar mais
   * espaço que o número do processo.
   *
   * Abre ao focar o campo, ao digitar, ou no botão — e some ao escolher.
   */
  const [aberto, setAberto] = useState(false);
  /** "Ver todas" solta o teto de sugestões por grupo. */
  const [verTodas, setVerTodas] = useState(false);

  const { data: doAcervo = [] } = useQuery({
    queryKey: ['etiquetas-do-acervo', parteExternaId ?? ''],
    queryFn: () => etiquetasDoAcervo(parteExternaId),
    staleTime: 5 * 60_000,
  });

  function adicionar(e: string) {
    const limpa = e.trim().slice(0, 40);
    if (!limpa || valor.includes(limpa) || valor.length >= 12) return;
    onChange([...valor, limpa]);
    setTexto('');
    // Fecha ao escolher: quem marcou uma etiqueta em geral acabou ali, e a
    // lista aberta por baixo empurra o resto do formulário para longe.
    setAberto(false);
    setVerTodas(false);
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

    /*
      O QUE JÁ SE USOU CONTRA ESTE RÉU vem primeiro. Sem réu escolhido, `noReu`
      é indefinido em todas e a ordem por frequência do acervo se mantém.
    */
    const porRelevancia = [...filtradas].sort(
      (a, b) => (b.noReu ?? 0) - (a.noReu ?? 0) || b.processos - a.processos,
    );

    /*
      SEM TERMO, TRÊS DE CADA — e "ver todas" para o resto. Mostrar dezesseis
      bolinhas para escolher uma é pedir que a pessoa leia dezesseis nomes; com
      algo digitado o corte sobe, porque aí a lista já está filtrada pelo que
      ela quer.
    */
    const teto = texto.trim() || verTodas ? 12 : 3;
    return {
      convencao: porRelevancia.filter((e) => ehPeriodoDeConvencao(e.etiqueta)).slice(0, teto),
      pedido: porRelevancia.filter((e) => !ehPeriodoDeConvencao(e.etiqueta)).slice(0, teto),
      total: filtradas.length,
    };
  }, [doAcervo, valor, texto, verTodas]);

  const todasSugeridas = [...sugestoes.convencao, ...sugestoes.pedido];
  const escondidas = sugestoes.total - todasSugeridas.length;

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
    setAberto(false);
    setVerTodas(false);
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
          onFocus={() => setAberto(true)}
          onChange={(ev) => { setTexto(ev.target.value); setAberto(true); }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              adicionar(texto);
            }
            if (ev.key === 'Escape') { setAberto(false); setVerTodas(false); }
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

      {valor.length < 12 && aberto && (todasSugeridas.length > 0 || texto.trim()) && (
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

          {/* O resto do acervo, para quem procura algo que não está no topo. */}
          {escondidas > 0 && !verTodas && (
            <button
              type="button"
              onClick={() => setVerTodas(true)}
              className="text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-400"
            >
              ver as outras {escondidas}
            </button>
          )}
        </div>
      )}

      {/*
        UMA LINHA SÓ, E SÓ COM A LISTA FECHADA.

        Eram duas linhas de explicação permanentes sob doze bolinhas, num campo
        OPCIONAL de um modal que já rola. Aberta a lista, o próprio número em
        cada etiqueta já diz o que a explicação dizia.
      */}
      {!compacto && !aberto && doAcervo.length > 0 && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="text-[11px] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
        >
          {parteExternaId && doAcervo.some((e) => e.noReu)
            ? `Ver as ${doAcervo.length} do acervo — as usadas contra este réu vêm primeiro`
            : `Ver as ${doAcervo.length} etiquetas que o acervo já usa`}
        </button>
      )}
    </div>
  );
}
