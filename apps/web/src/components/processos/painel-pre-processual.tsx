'use client';

import { FileCheck2, Check, ArrowRight, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { V } from '@/lib/vocabulario';

/**
 * O PAINEL DO CASO PRÉ-PROCESSUAL — o que falta, e o botão de ajuizar.
 *
 * O PROBLEMA QUE ELE RESOLVE. A ficha de um caso pré-processual é a ficha de um
 * processo com quase tudo vazio: número "—", tribunal "—", classe "—", grau "—",
 * um "Dossiê DataJud" dizendo "sem dados do CNJ" e um botão "Sincronizar" que
 * não tem o que sincronizar. Quem abre não vê um caso em andamento; vê um
 * cadastro quebrado. E a única forma de ajuizar era voltar para a LISTA e achar
 * o selo "Ajuizar" lá — a ação principal ficava na tela errada.
 *
 * O painel inverte isso: em vez de mostrar campos vazios, mostra O QUE FALTA,
 * com o caminho para preencher cada coisa e a ação que encerra a fase em
 * destaque.
 *
 * A HIERARQUIA É DELIBERADA. Só UM item tira o caso da fase pré-processual: o
 * número único. Os outros são enriquecimento — úteis, mas não bloqueiam. Se
 * todos aparecessem como "pendência" com o mesmo peso, o número se perderia no
 * meio e a lista viraria uma cobrança genérica que ninguém completa.
 */
export interface Pendencia {
  chave: string;
  rotulo: string;
  ajuda: string;
  feito: boolean;
  /** Leva ao lugar onde se resolve. Ausente = não há atalho direto. */
  ir?: () => void;
}

export function PainelPreProcessual({
  pendencias,
  podeEditar,
  onAjuizar,
}: {
  pendencias: Pendencia[];
  podeEditar: boolean;
  onAjuizar: () => void;
}) {
  const faltam = pendencias.filter((x) => !x.feito);

  return (
    <div className="mt-3 rounded-xl border border-violet-300 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/25">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-violet-700 dark:text-violet-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-900 dark:text-violet-300">
              Caso em fase pré-processual
            </p>
            {/*
              A explicação existe porque "pré-processual" some da lista padrão, e
              quem abre a ficha precisa saber que isso é intencional — senão
              conclui que o cadastro sumiu ou está com defeito.
            */}
            <p className="text-[11px] text-violet-900/75 dark:text-violet-200/70">
              Ainda não foi ajuizado, então não tem número, tribunal nem andamento do CNJ.
              Fica fora da lista padrão de processos, na aba <strong>Pré-processuais</strong>,
              até ser ajuizado.
            </p>
          </div>
        </div>
        {/*
          A AÇÃO PRINCIPAL FICA AQUI, no topo da ficha. Antes ela existia só
          como um selo na listagem — a pessoa abria o caso, lia tudo, e tinha de
          fechar e procurar na lista para dar o próximo passo.
        */}
        {podeEditar && (
          <Button size="sm" onClick={onAjuizar} className="shrink-0 bg-violet-700 hover:bg-violet-800">
            <FileCheck2 className="h-4 w-4" /> Ajuizar
          </Button>
        )}
      </div>

      <ul className="mt-2.5 grid gap-1 sm:grid-cols-2">
        {pendencias.map((x) => (
          <li key={x.chave}>
            <button
              type="button"
              onClick={x.ir}
              disabled={!x.ir || x.feito}
              className={cn(
                'flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition',
                x.feito
                  ? 'text-violet-900/50 dark:text-violet-200/40'
                  : 'text-violet-900 dark:text-violet-200',
                x.ir && !x.feito && 'hover:bg-violet-100 dark:hover:bg-violet-900/40',
              )}
              title={x.ajuda}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                  x.feito
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-violet-400 dark:border-violet-600',
                )}
              >
                {x.feito && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('font-medium', x.feito && 'line-through')}>{x.rotulo}</span>
                {!x.feito && <span className="block text-[11px] opacity-75">{x.ajuda}</span>}
              </span>
              {x.ir && !x.feito && <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />}
            </button>
          </li>
        ))}
      </ul>

      {/*
        O resumo no rodapé é o que responde "estou perto?". Sem ele a lista de
        itens vira uma parede de tarefas sem fim à vista — e a diferença entre
        "faltam duas" e "faltam seis" muda se a pessoa começa agora ou adia.
      */}
      <p className="mt-1.5 px-2 text-[11px] text-violet-900/70 dark:text-violet-200/60">
        {faltam.length === 0
          ? `Tudo preenchido. Falta só o número único para ajuizar — e o ${V.filiado} já pode ser avisado.`
          : `${faltam.length} informação${faltam.length === 1 ? '' : 'ões'} a completar. ` +
            'Nenhuma delas impede o ajuizamento — só o número único faz isso.'}
      </p>
    </div>
  );
}
