'use client';

import { useRef } from 'react';
import { GripVertical, Star, X } from 'lucide-react';
import { BuscaSelect, type AcaoBusca, type ItemBusca } from '@/components/ui/busca-select';
import { cn } from '@/lib/utils';

/**
 * QUEM ESTÁ DE CADA LADO DO PROCESSO — uma lista, um campo, e nada mais.
 *
 * O QUE ISTO SUBSTITUI. O polo passivo do modal de importação tinha TRÊS
 * estados para uma coisa só: a lista de réus já acrescentados, o réu
 * "selecionado" (escolhido no cadastro, ainda fora da lista), e o réu "digitado"
 * (texto livre, também fora da lista). Somados ao botão "Acrescentar outro réu"
 * e ao aviso amarelo de duplicata, eram cinco blocos empilhados para responder
 * "contra quem é esta ação?".
 *
 * E o botão nem era necessário: o réu em edição já ia junto no envio. Quem
 * clicava nele via o nome saltar para a lista de cima e o campo esvaziar — e,
 * como o aviso de parecidos continuava na tela, clicava "usar esta" de novo e
 * acrescentava a MESMA empresa duas vezes, uma pelo cadastro e outra como
 * texto. Foi o que a tela do usuário mostrou.
 *
 * AQUI ESCOLHER JÁ É ACRESCENTAR. Não existe item "em edição": o que se escolhe
 * na lista entra na relação, e o campo fica pronto para o próximo. O caso comum
 * (uma parte só) continua sendo digitar e escolher — a diferença é que agora
 * ele fica VISÍVEL na relação, do mesmo jeito que o segundo e o terceiro.
 *
 * O PRIMEIRO É O PRINCIPAL, e dá para trocar sem apagar nada: é ele que aparece
 * no "Autor × Réu" da listagem e nos relatórios.
 */

export type TipoDeParte = 'FILIADO' | 'INSTITUCIONAL' | 'ORGANIZACAO' | 'AVULSA';

export interface ParteEditavel {
  tipo: TipoDeParte;
  /** Como a parte consta nos autos. É o que sobra se o cadastro for excluído. */
  nome: string;
  /** Linha de apoio: "Filiado · ***.123.***-**", "Empresa · 7 processos". */
  detalhe?: string | null;
  filiadoId?: string;
  parteExternaId?: string;
}

/** Nome comparável: sem acento, sem pontuação, sem caixa. */
export function normalizarNome(n: string): string {
  return n
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * A CHAVE QUE IMPEDE A MESMA PARTE DUAS VEZES.
 *
 * Inclui o NOME NORMALIZADO junto do id, e não só o id: a empresa escolhida no
 * cadastro e a mesma empresa digitada à mão têm ids diferentes (uma não tem
 * nenhum) e são a mesma pessoa jurídica. Comparar só por id deixava as duas
 * entrarem — que é exatamente a duplicata que o aviso amarelo tentava evitar
 * três blocos abaixo.
 */
export function chaveDaParte(p: ParteEditavel): string {
  return `${p.tipo === 'INSTITUCIONAL' ? 'INST' : ''}${normalizarNome(p.nome)}`;
}

export function jaEstaNaLista(lista: ParteEditavel[], p: ParteEditavel): boolean {
  const chave = chaveDaParte(p);
  return lista.some(
    (x) =>
      chaveDaParte(x) === chave ||
      (!!p.filiadoId && x.filiadoId === p.filiadoId) ||
      (!!p.parteExternaId && x.parteExternaId === p.parteExternaId),
  );
}

const TOM_DO_TIPO: Record<TipoDeParte, string> = {
  FILIADO: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300',
  INSTITUCIONAL: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300',
  ORGANIZACAO: 'bg-muted text-muted-foreground',
  AVULSA: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
};

export function EditorDePartes({
  partes,
  onChange,
  buscar,
  acoes,
  placeholder,
  rotuloPrincipal,
  rotuloSecundario,
  permitirTextoLivre,
  ajuda,
  extraDaLinha,
  vazio,
}: {
  partes: ParteEditavel[];
  onChange: (p: ParteEditavel[]) => void;
  /** Procura no cadastro certo e já devolve as partes prontas para entrar. */
  buscar: (termo: string) => Promise<ParteEditavel[]>;
  acoes?: AcaoBusca[];
  placeholder: string;
  rotuloPrincipal: string;
  rotuloSecundario: string;
  /** Digitar um nome que não está no cadastro vira parte sem vínculo. */
  permitirTextoLivre?: boolean;
  ajuda?: React.ReactNode;
  /** Ação extra na linha — o recadastramento do filiado, por exemplo. */
  extraDaLinha?: (p: ParteEditavel, indice: number) => React.ReactNode;
  /** Frase quando a relação está vazia. Pede, não constata. */
  vazio?: string;
}) {
  /**
   * O ÚLTIMO RESULTADO DA BUSCA, para reencontrar o item escolhido.
   *
   * `useRef`, e não um `Map` solto no corpo: um render do componente PAI entre
   * a busca e o clique jogaria fora o mapa, e escolher na lista deixaria de
   * fazer qualquer coisa — a falha silenciosa mais irritante que existe num
   * autocomplete, porque parece que o clique não pegou.
   */
  const cache = useRef(new Map<string, ParteEditavel>()).current;

  function acrescentar(p: ParteEditavel) {
    if (jaEstaNaLista(partes, p)) return;
    onChange([...partes, p]);
  }
  function remover(i: number) {
    onChange(partes.filter((_, j) => j !== i));
  }
  /** Promove sem reordenar o resto — a relação continua reconhecível. */
  function tornarPrincipal(i: number) {
    if (i === 0) return;
    const copia = [...partes];
    const [alvo] = copia.splice(i, 1);
    onChange([alvo, ...copia]);
  }

  return (
    <div className="space-y-2">
      {partes.length > 0 ? (
        <ul className="space-y-1">
          {partes.map((p, i) => (
            <li
              key={`${p.filiadoId ?? p.parteExternaId ?? normalizarNome(p.nome)}-${i}`}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2',
                i === 0 ? 'border-input bg-muted/50' : 'border-dashed bg-background',
              )}
            >
              <GripVertical className="hidden h-4 w-4 shrink-0 text-muted-foreground/50 sm:block" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.nome}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', TOM_DO_TIPO[p.tipo])}
                  >
                    {i === 0 ? rotuloPrincipal : `${rotuloSecundario} ${i}`}
                  </span>
                  {p.detalhe && <span className="truncate">{p.detalhe}</span>}
                </span>
              </span>
              {extraDaLinha?.(p, i)}
              {/*
                TROCAR O PRINCIPAL sem desmontar a relação. Antes a única saída
                era remover todos e recomeçar na ordem certa — e quem descobre
                o réu principal depois de listar três acaba deixando errado.
              */}
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => tornarPrincipal(i)}
                  title={`Tornar ${rotuloPrincipal.toLowerCase()}`}
                  aria-label={`Tornar ${p.nome} ${rotuloPrincipal.toLowerCase()}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-7 sm:w-7"
                >
                  <Star className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => remover(i)}
                aria-label={`Remover ${p.nome}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-7 sm:w-7"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        vazio && (
          <p className="rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            {vazio}
          </p>
        )
      )}

      <BuscaSelect
        placeholder={partes.length ? 'Acrescentar outra…' : placeholder}
        acoes={acoes}
        onBuscar={async (termo) => {
          const achados = await buscar(termo);
          cache.clear();
          return achados.map((p, i) => {
            const id = `${i}:${p.filiadoId ?? p.parteExternaId ?? normalizarNome(p.nome)}`;
            cache.set(id, p);
            return {
              id,
              rotulo: p.nome,
              detalhe: p.detalhe ?? undefined,
              marca: jaEstaNaLista(partes, p) ? 'já na lista' : undefined,
            } satisfies ItemBusca;
          });
        }}
        onEscolher={(item) => {
          const p = cache.get(item.id);
          if (p) acrescentar(p);
        }}
        onCriar={
          permitirTextoLivre
            ? (texto) => {
                const nome = texto.trim();
                if (nome) acrescentar({ tipo: 'AVULSA', nome, detalhe: 'Sem cadastro' });
              }
            : undefined
        }
      />

      {ajuda && <p className="text-[11px] leading-snug text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
