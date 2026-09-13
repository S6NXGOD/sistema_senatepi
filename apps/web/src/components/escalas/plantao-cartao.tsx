'use client';

import { ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDataPura } from '@/lib/data-pura';
import { CorAdvogado, Escala, faixaDoPlantao, nomeDeExibicao } from '@/lib/escalas';

export interface AcoesDoPlantao {
  /** EDITAR em escalas: corrige e troca. */
  podeEditar: boolean;
  /** Só o Administrador apaga (regra global). */
  podeExcluir: boolean;
  onEditar: (e: Escala) => void;
  onTrocar: (e: Escala) => void;
  onExcluir: (e: Escala) => void;
}

/**
 * Um plantão com o que dá para fazer com ele. O mesmo bloco serve ao popover do
 * calendário (computador, `compacto`) e à folha do dia (celular, botões de 48 px).
 */
export function PlantaoCartao({
  escala,
  cor,
  acoes,
  compacto = false,
  mostrarDia = false,
}: {
  escala: Escala;
  cor?: CorAdvogado;
  acoes: AcoesDoPlantao;
  compacto?: boolean;
  mostrarDia?: boolean;
}) {
  const tamanho = compacto ? 'sm' : 'default';
  return (
    <div>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', cor?.dot ?? 'bg-slate-500')} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{nomeDeExibicao(escala.advogado)}</p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {mostrarDia && (
              <>{formatDataPura(escala.data, { weekday: 'short', day: '2-digit', month: '2-digit' })} · </>
            )}
            {faixaDoPlantao(escala)}
          </p>
          {escala.observacao && (
            <p className="mt-1 break-words text-sm text-muted-foreground">{escala.observacao}</p>
          )}
        </div>
      </div>

      {(acoes.podeEditar || acoes.podeExcluir) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {acoes.podeEditar && (
            <>
              <Button variant="outline" size={tamanho} className="flex-1" onClick={() => acoes.onEditar(escala)}>
                <Pencil className="h-4 w-4" /> Editar
              </Button>
              <Button variant="outline" size={tamanho} className="flex-1" onClick={() => acoes.onTrocar(escala)}>
                <ArrowLeftRight className="h-4 w-4" /> Trocar com…
              </Button>
            </>
          )}
          {acoes.podeExcluir && (
            <Button
              variant="outline"
              size={tamanho}
              className={cn(
                'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30',
                acoes.podeEditar ? 'flex-none' : 'flex-1',
              )}
              onClick={() => acoes.onExcluir(escala)}
            >
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
