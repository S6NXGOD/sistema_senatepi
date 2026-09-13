'use client';

import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Apuracao } from '@/lib/eventos';

/** Percentual (0–100) → escala da barra (0–1). Valor estranho vira barra vazia. */
function proporcao(percentual: number): number {
  const p = Number(percentual);
  if (!Number.isFinite(p)) return 0;
  return Math.min(Math.max(p / 100, 0), 1);
}

/**
 * Resultado de uma pauta encerrada.
 *
 * A mesa encerrava a votação e não via o que tinha sido decidido — a tela
 * mostrava apenas "1 voto(s)". Quem preside precisa anunciar o resultado em
 * voz alta no momento seguinte ao encerramento; ir procurar no dossiê para
 * isso não é aceitável.
 */
export function ResultadoPauta({ apuracao, compacto = false }: { apuracao: Apuracao; compacto?: boolean }) {
  const semQuorum = apuracao.quorumMinimo != null && !apuracao.quorumAtingido;

  return (
    <div className="space-y-2">
      {apuracao.resultado.map((r) => {
        const vencedora = apuracao.vencedora?.opcaoId === r.opcaoId;
        return (
          <div key={r.opcaoId} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className={cn(vencedora && 'font-semibold')}>{r.rotulo}</span>
              <span className="tabular-nums text-muted-foreground">
                {r.votos} {r.votos === 1 ? 'voto' : 'votos'} · {r.percentual}%
              </span>
            </div>
            {/*
              A BARRA ANDA POR TRANSFORM, NÃO POR LARGURA. A tela revalida a
              cada 3 s; transição de `width` refazia o layout a cada voto. A
              largura fica fixa em 100% e a escala diz a proporção — e só se
              move quando o percentual muda de fato.
            */}
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={cn(
                  'h-full w-full origin-left transition-transform duration-dado ease-entrada',
                  vencedora ? 'bg-brand-700 dark:bg-brand-400' : 'bg-muted-foreground/30',
                )}
                style={{ transform: `scaleX(${proporcao(r.percentual)})` }}
              />
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
        <span className="text-muted-foreground">
          {apuracao.totalVotantes} de {apuracao.presentes} presentes votaram
        </span>

        {apuracao.empate ? (
          <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
            <TriangleAlert className="h-3.5 w-3.5" /> EMPATE
          </span>
        ) : apuracao.vencedora ? (
          <span className="flex items-center gap-1 font-semibold text-brand-800 dark:text-brand-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> {apuracao.vencedora.rotulo}
          </span>
        ) : null}

        {/* Deliberação sem o quórum exigido é nula. Se aconteceu, o documento
            precisa dizer, e a tela também — não é detalhe de rodapé. */}
        {semQuorum && (
          <span className="flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-400">
            <TriangleAlert className="h-3.5 w-3.5" />
            Quórum mínimo ({apuracao.quorumMinimo}) NÃO atingido
          </span>
        )}
      </div>

      {!compacto && apuracao.modo === 'SECRETA' && (
        <p className="text-xs text-muted-foreground">
          Votação secreta: fica registrado quem votou, nunca em quê — nem para a diretoria.
        </p>
      )}
    </div>
  );
}
