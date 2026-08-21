'use client';

import { Copy, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOTIVO_SEMELHANCA_LABEL, TIPO_PARTE_LABEL, formatDocumento, type ParteParecida } from '@/lib/partes';

/**
 * "ISTO JÁ PODE ESTAR CADASTRADO" — um aviso só, em toda tela.
 *
 * POR QUE VIROU COMPONENTE. O formulário de partes do processo tinha o seu, a
 * consulta de CNPJ ganhou o dela, e as duas apareciam JUNTAS na mesma tela,
 * listando AS MESMAS organizações com títulos diferentes ("Já existe cadastro
 * com nome parecido" e "Pode ser que já exista no cadastro"). Duas caixas
 * amarelas empilhadas dizendo a mesma coisa não avisam em dobro: elas ensinam
 * a pessoa a pular caixa amarela.
 *
 * O TÍTULO MUDA COM A FORÇA DO INDÍCIO, e isso é o que separa aviso de ruído:
 * documento igual é FATO ("é a mesma organização"), nome parecido é SUSPEITA
 * ("pode ser"). Tratar os dois com o mesmo texto obrigaria a pessoa a abrir
 * cada item para descobrir qual era qual.
 *
 * Cada linha mostra QUANTOS PROCESSOS aquele cadastro já tem. É o número que
 * decide: reaproveitar um cadastro com 14 processos junta o histórico; criar
 * outro parte a conta em duas, e a pergunta "quantos processos temos contra
 * esta empresa" passa a ter duas respostas erradas.
 */
export function AvisoDuplicatas({
  candidatos,
  onUsar,
  className,
}: {
  candidatos: ParteParecida[];
  /** Aproveitar o cadastro existente em vez de criar outro. */
  onUsar: (p: ParteParecida) => void;
  className?: string;
}) {
  if (!candidatos.length) return null;

  const certeza = candidatos.some((c) => c.motivo === 'MESMO_DOCUMENTO');

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        certeza
          ? 'border-amber-400 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/25'
          : 'border-border bg-muted/40',
        className,
      )}
    >
      <div className="flex items-start gap-2 px-3 pb-1.5 pt-2.5">
        <Copy
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0',
            certeza ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        />
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold', certeza && 'text-amber-900 dark:text-amber-300')}>
            {certeza
              ? 'Este documento já está no cadastro'
              : `${candidatos.length} cadastro${candidatos.length === 1 ? '' : 's'} com nome parecido`}
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {certeza
              ? 'É a mesma organização. Aproveite o cadastro existente.'
              : 'Aproveitar mantém o histórico junto. Se for outra parte mesmo, siga preenchendo.'}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border/60 border-t border-border/60">
        {candidatos.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onUsar(c)}
              className="group flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-background/70"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{c.nome}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {TIPO_PARTE_LABEL[c.tipo]}
                  {c.documento ? ` · ${formatDocumento(c.documento)}` : ' · sem documento'}
                  {c._count ? ` · ${c._count.participacoes} processo${c._count.participacoes === 1 ? '' : 's'}` : ''}
                </span>
              </span>
              {/*
                O motivo fica como etiqueta, e não como texto corrido: numa lista
                de três é o que deixa comparar os indícios de relance, sem ler
                três frases quase iguais.
              */}
              <span className="hidden shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                {MOTIVO_SEMELHANCA_LABEL[c.motivo]}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-brand-800 dark:text-brand-400">
                usar
                <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
