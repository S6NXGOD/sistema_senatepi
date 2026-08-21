'use client';

import { useEffect, useState } from 'react';
import { FileCheck2, ChevronDown, Scale, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { chaveLocal } from '@/lib/armazenamento';

/**
 * A BARRA DO CASO PRÉ-PROCESSUAL — o que falta, e o botão de ajuizar.
 *
 * O PROBLEMA QUE ELA RESOLVE. A ficha de um caso pré-processual é a ficha de um
 * processo com quase tudo vazio: número "—", tribunal "—", classe "—". Quem
 * abre não vê um caso em andamento; vê um cadastro quebrado. E a ação que
 * encerra a fase morava só na LISTA, num selo pequeno — a pessoa lia a ficha
 * inteira e tinha de fechar e voltar para dar o próximo passo.
 *
 * POR QUE ELA ENCOLHEU. A primeira versão listava os SEIS itens, feitos e não
 * feitos, em duas colunas, com explicação em cada um: um terço do modal, e
 * metade desse espaço gasto com o que JÁ ESTÁ PRONTO. Item concluído com
 * tarjinha em cima é troféu — informa uma vez e atrapalha nas outras cinquenta.
 *
 * Então a barra virou UMA LINHA que diz o essencial: em que fase está, o que
 * falta (pelo nome, sem precisar abrir) e o botão. A lista completa, com os
 * atalhos para resolver cada item e os já feitos, fica atrás do disclosure — e
 * a escolha de abrir ou fechar é lembrada NA SESSÃO, como o dossiê do DataJud:
 * é preferência de trabalho ("hoje estou completando cadastro"), não
 * configuração permanente.
 *
 * A HIERARQUIA CONTINUA SENDO O PONTO. Só UM item tira o caso da fase: o
 * número único. Os outros são enriquecimento, e a barra diz isso com todas as
 * letras — se todos aparecessem com o mesmo peso, o número se perderia no meio.
 */
export interface Pendencia {
  chave: string;
  rotulo: string;
  ajuda: string;
  feito: boolean;
  /** Leva ao lugar onde se resolve. Ausente = não há atalho direto. */
  ir?: () => void;
}

const CHAVE_ABERTO = chaveLocal('pre-processual', 'detalhado');

export function PainelPreProcessual({
  pendencias,
  podeEditar,
  onAjuizar,
}: {
  pendencias: Pendencia[];
  podeEditar: boolean;
  onAjuizar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAberto(window.sessionStorage.getItem(CHAVE_ABERTO) === 'sim');
  }, []);
  function alternar() {
    setAberto((v) => {
      try { window.sessionStorage.setItem(CHAVE_ABERTO, v ? 'nao' : 'sim'); } catch { /* sessão indisponível */ }
      return !v;
    });
  }

  const faltam = pendencias.filter((x) => !x.feito);

  return (
    <div className="mt-3 rounded-lg border border-violet-300 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/20">
      {/* A LINHA — tudo que importa no dia a dia cabe aqui. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
        <Scale className="h-4 w-4 shrink-0 text-violet-700 dark:text-violet-400" />
        <span className="text-[13px] font-semibold text-violet-900 dark:text-violet-300">
          Fase pré-processual
        </span>

        {/*
          O QUE FALTA, PELO NOME, na própria linha. Sem isto o disclosure seria
          obrigatório para descobrir qualquer coisa — e um disclosure que precisa
          ser aberto toda vez não economizou espaço, só escondeu informação.
        */}
        {faltam.length > 0 ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-violet-900/70 dark:text-violet-200/60">
            falta{faltam.length === 1 ? '' : 'm'}: {faltam.map((x) => x.rotulo.toLowerCase()).join(', ')}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-violet-900/70 dark:text-violet-200/60">
            tudo preenchido — falta só o número único
          </span>
        )}

        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-violet-800 transition hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/40"
        >
          {aberto ? 'menos' : 'detalhes'}
          <ChevronDown className={cn('h-3 w-3 transition-transform', aberto && 'rotate-180')} />
        </button>

        {podeEditar && (
          <Button size="sm" onClick={onAjuizar} className="h-7 shrink-0 bg-violet-700 px-2.5 text-xs hover:bg-violet-800">
            <FileCheck2 className="h-3.5 w-3.5" /> Ajuizar
          </Button>
        )}
      </div>

      {aberto && (
        <div className="border-t border-violet-200 px-3 py-2 dark:border-violet-900">
          <p className="mb-1.5 text-[11px] leading-snug text-violet-900/75 dark:text-violet-200/65">
            Ainda não foi ajuizado, então não tem número, tribunal nem andamento do CNJ. Fica fora da
            lista padrão de processos, na aba <strong>Pré-processuais</strong>, até ser ajuizado.
            Nenhum item abaixo impede o ajuizamento — só o número único faz isso.
          </p>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {[...faltam, ...pendencias.filter((x) => x.feito)].map((x) => (
              <li key={x.chave}>
                <button
                  type="button"
                  onClick={x.ir}
                  disabled={!x.ir || x.feito}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[12px] transition',
                    x.feito
                      ? 'text-violet-900/40 dark:text-violet-200/30'
                      : 'text-violet-900 dark:text-violet-200',
                    x.ir && !x.feito && 'hover:bg-violet-100 dark:hover:bg-violet-900/40',
                  )}
                  title={x.ajuda}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      x.feito ? 'bg-emerald-500' : 'bg-violet-400 dark:bg-violet-600',
                    )}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', x.feito && 'line-through')}>
                    {x.rotulo}
                  </span>
                  {x.ir && !x.feito && <ArrowRight className="h-3 w-3 shrink-0 opacity-50" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
