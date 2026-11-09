'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { contar } from '@/lib/plural';

/** No servidor não existe layout; no navegador, contar antes da pintura. */
const useEfeitoAntesDaPintura = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** O que cada aviso declara na moldura externa — ver `AlertBar`. */
export type TomDoAviso = 'critico' | 'atencao' | 'info';

/**
 * O QUADRO DE AVISOS — um só, com uma linha por aviso (07/11/2026).
 *
 * O PEDIDO: *"Estou achando a dashboard muito poluída de avisos. A dashboard deve
 * ter a melhor UI e apresentação possível."* No print, entre a saudação e o
 * primeiro número havia cinco caixas empilhadas — duas âmbar, duas cinza e um
 * cartão roxo —, cada uma com moldura, fundo e cor próprios. Era a tela inteira
 * gritando, e nenhum aviso se destacava porque todos se destacavam.
 *
 * COMO FICOU: uma moldura só, e dentro dela cada aviso é uma LINHA, separada da
 * seguinte por um fio. A cor saiu do fundo e foi para uma faixa de 3px na borda
 * esquerda — âmbar quando pede alguém, rosa quando algo quebrou, nada quando é
 * só para saber. É o mesmo código de cor do resto do sistema, gastando um
 * décimo da tinta.
 *
 * POR QUE ASSIM, E NÃO REESCREVENDO CADA AVISO. São oito blocos com regra
 * própria e anos de ajuste fino (o que aparece, para quem, quando some). Eles
 * só precisaram dizer o que são — `data-aviso="atencao" | "critico" | "info"` na
 * moldura externa — e este quadro cuida do visual. Quem cria um aviso novo
 * precisa lembrar de uma coisa só: o atributo.
 *
 * SOME SOZINHO: todo aviso já se esconde quando não tem o que dizer, e o quadro
 * se esconde quando nenhum desenhou nada (`:has`). Em dia tranquilo não sobra
 * uma moldura vazia dizendo "nenhum aviso".
 *
 * ── RECOLHIDO POR PADRÃO (09/11/2026) ─────────────────────────────────────────
 *
 * O dono, dois dias depois do quadro: *"Ainda estou achando poluído a dashboard,
 * quero que possamos recolher esses avisos e por padrão ele venha recolhido."*
 * Uma moldura só resolveu o barulho de cinco caixas, mas não o TAMANHO: com seis
 * avisos o quadro ainda ocupava meia tela entre os números e a agenda.
 *
 * Recolhido, ele é UMA LINHA: o sino, "Avisos" e uma pílula por tom — "1 com
 * falha", "3 pedem atenção", "2 informativos". É o que se precisa para decidir
 * se vale abrir agora, e só isso. Um clique (a linha inteira é o botão) mostra
 * os avisos no lugar.
 *
 * TRÊS DECISÕES QUE NÃO SÃO ÓBVIAS:
 *
 *  1. A CONTAGEM LÊ A TELA, NÃO OS DADOS. Cada aviso tem a própria regra de
 *     aparecer (permissão, perfil, janela de troca, consulta própria) — repetir
 *     essas regras aqui seria uma segunda implementação de cada uma, e a
 *     primeira a divergir faria o quadro anunciar aviso que não está lá. Então
 *     ele conta o que de fato desenhou: as molduras `data-aviso`, observadas
 *     enquanto as consultas de cada bloco chegam.
 *
 *  2. RECOLHER NÃO DESMONTA. Os avisos continuam montados e escondidos: é assim
 *     que a contagem existe com o quadro fechado, que a caixa de propostas e a
 *     fila do Diário seguem buscando, e que o "Ver quais" aberto lá dentro
 *     continua aberto quando se volta a ele.
 *
 *  3. NÃO SE LEMBRA DE ESTAR ABERTO. Cada visita ao painel começa recolhida, que
 *     é o que "por padrão" pediu. Guardar o último estado faria o quadro abrir
 *     sozinho para sempre depois do primeiro clique — e a tela voltaria a ser a
 *     que motivou o pedido. A revalidação de 60s não fecha nada: o quadro não é
 *     desmontado por ela.
 */
export function PainelDeAvisos({ children }: { children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [tons, setTons] = useState<TomDoAviso[]>([]);
  const corpo = useRef<HTMLDivElement>(null);
  const idDoCorpo = useId();

  useEfeitoAntesDaPintura(() => {
    const raiz = corpo.current;
    if (!raiz) return;
    const recontar = () => {
      const agora = tonsNaTela(raiz);
      setTons((antes) => (mesmosTons(antes, agora) ? antes : agora));
    };
    recontar();
    /*
      Os blocos chegam em tempos diferentes: a caixa de propostas e a fila do
      Diário têm consulta própria e desenham depois do resto. Sem observar, o
      resumo ficaria com a contagem do primeiro quadro pintado.
    */
    const observador = new MutationObserver(recontar);
    observador.observe(raiz, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-aviso'],
    });
    return () => observador.disconnect();
  }, []);

  const pilulas = resumoDosAvisos(tons);

  return (
    <section
      aria-label="Avisos"
      className={cn(
        'overflow-hidden rounded-xl border bg-card shadow-sm',
        '[&:not(:has([data-aviso]))]:hidden',
      )}
    >
      <h2>
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={idDoCorpo}
          onClick={() => setAberto((v) => !v)}
          className={cn(
            'flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors sm:min-h-0',
            'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <Bell className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-sm font-semibold">Avisos</span>
            {pilulas.map((p) => (
              <span
                key={p.tom}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px]',
                  p.tom === 'info' ? 'text-muted-foreground' : 'font-medium text-foreground',
                )}
              >
                {/* A mesma cor da faixa de 3px que o aviso tem lá dentro. */}
                {p.tom !== 'info' && (
                  <span
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      p.tom === 'critico' ? 'bg-rose-500' : 'bg-amber-400',
                    )}
                  />
                )}
                {p.texto}
              </span>
            ))}
          </span>
          {/*
            O CHEVRON TROCA, NÃO GIRA — `lib/movimento.ts` proíbe rotação. E a
            palavra some no telefone: lá a linha inteira já é o alvo do toque, e
            o espaço vai para as pílulas.
          */}
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
            <span className="hidden sm:inline">{aberto ? 'Recolher' : 'Mostrar'}</span>
            {aberto ? (
              <ChevronUp className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden />
            )}
          </span>
        </button>
      </h2>
      {/*
        `hidden`, e não desmontar — ver a decisão 2 acima. A entrada é a de
        inserção da casa (`surgir`): roda quando o corpo passa a ser desenhado,
        nunca numa revalidação.
      */}
      <div
        id={idDoCorpo}
        ref={corpo}
        hidden={!aberto}
        className={cn(AVISOS_EM_LINHA, 'animate-surgir')}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * O RESUMO DO QUADRO RECOLHIDO — uma pílula por tom, do mais grave ao mais leve.
 *
 * Só aparece o tom que existe: "0 com falha" seria o sistema avisando que não
 * tem o que avisar. E a ordem é a da gravidade, não a da tela: quem bate o olho
 * na linha precisa ver primeiro se algo quebrou.
 */
export function resumoDosAvisos(
  tons: readonly TomDoAviso[],
): { tom: TomDoAviso; texto: string }[] {
  const quantos = (tom: TomDoAviso) => tons.filter((t) => t === tom).length;
  const criticos = quantos('critico');
  const atencao = quantos('atencao');
  const info = quantos('info');
  return [
    criticos > 0 && { tom: 'critico' as const, texto: contar(criticos, 'com falha', 'com falha') },
    atencao > 0 && { tom: 'atencao' as const, texto: contar(atencao, 'pede atenção', 'pedem atenção') },
    info > 0 && { tom: 'info' as const, texto: contar(info, 'informativo', 'informativos') },
  ].filter(Boolean) as { tom: TomDoAviso; texto: string }[];
}

/**
 * Os avisos que desenharam alguma coisa, com o tom de cada um.
 *
 * Conta a moldura de FORA: um `data-aviso` dentro de outro é pedaço do mesmo
 * aviso, não um segundo. Tom desconhecido vale como `info` — o resumo nunca
 * inventa urgência que o aviso não declarou.
 */
function tonsNaTela(raiz: HTMLElement): TomDoAviso[] {
  const tons: TomDoAviso[] = [];
  raiz.querySelectorAll<HTMLElement>('[data-aviso]').forEach((el) => {
    const deFora = el.parentElement?.closest('[data-aviso]');
    if (deFora && raiz.contains(deFora)) return;
    const tom = el.getAttribute('data-aviso');
    tons.push(tom === 'critico' || tom === 'atencao' ? tom : 'info');
  });
  return tons;
}

function mesmosTons(a: readonly TomDoAviso[], b: readonly TomDoAviso[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * Cada aviso deixa de ser caixa e vira linha. `!` porque as molduras de cada
 * aviso são classes do próprio componente, e aqui é o quadro que manda.
 */
export const AVISOS_EM_LINHA = cn(
  '[&_[data-aviso]]:!rounded-none',
  '[&_[data-aviso]]:!border-x-0 [&_[data-aviso]]:!border-b-0 [&_[data-aviso]]:!border-t',
  '[&_[data-aviso]]:!border-border',
  '[&_[data-aviso]]:!bg-transparent',
  // A cor vai para a borda esquerda, e o texto volta ao tom normal da tela.
  '[&_[data-aviso=atencao]]:!shadow-[inset_3px_0_0_0_rgb(251,191,36)]',
  '[&_[data-aviso=critico]]:!shadow-[inset_3px_0_0_0_rgb(244,63,94)]',
  '[&_[data-aviso=info]]:!shadow-none',
  '[&_[data-aviso=atencao]]:!text-foreground',
  '[&_[data-aviso=critico]]:!text-foreground',
);
