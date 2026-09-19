import { Newspaper } from 'lucide-react';
import { SectionCard } from '@/components/dashboard/widgets';
import { PROVIDENCIA_LABEL } from '@/lib/djen';
import type { ResumoDashboard } from '@/lib/dashboard';
import { cn } from '@/lib/utils';

/**
 * O RITMO DO DIÁRIO — o único gráfico do painel de quem trabalha com processo.
 *
 * "Não há mais gráficos e informações que deveriam aparecer para os advogados?"
 * — o dono, 18/09/2026. A conta do mesmo dia deu razão a ele: a Triagem tinha
 * QUATRO gráficos (canal, 14 dias, crescimento, quadro associativo) e o
 * advogado, ZERO. Os quatro falam de atendimento e filiação; nenhum é trabalho
 * dele.
 *
 * POR QUE O DIÁRIO E NÃO O DATAJUD: medido na produção nos acervos dos nove
 * advogados, o DataJud entregou 0 movimentações em 7 dias — ele atrasa 62 dias
 * na mediana — enquanto o DJEN entregou 19 atos para um deles e 26 para a casa.
 * Um gráfico da fonte lenta seria uma linha reta no chão.
 *
 * E ELE NÃO PEDE NADA. Este é bloco de LEITURA, na zona do "onde eu estou" —
 * o que pede trabalho é "Suas publicações", logo acima, com botão por linha.
 * Por isso nenhum número daqui é clicável: a única janela que a tela de
 * Publicações oferece é 7/30/90 dias, e nenhuma é a janela de 8 semanas que
 * estas barras contam. Número que abre uma lista com outro total é o defeito
 * que o Panorama já cometeu (contava 184 e abria 143).
 */

/** Rótulo curto do eixo: "4/8" é a semana que começou em 04/08. */
export function rotuloDaSemana(semana: string): string {
  const [, mes, dia] = semana.split('-');
  return `${Number(dia)}/${Number(mes)}`;
}

/**
 * A ALTURA DA BARRA, em porcentagem do pico.
 *
 * Semana zerada fica com um traço de 6% em vez de nada: uma coluna invisível
 * lê-se como "não medimos", e o que houve foi recesso. Sem pico (tudo zero)
 * todas ficam no traço — e ninguém divide por zero.
 */
export function alturaDaBarra(total: number, pico: number): number {
  if (pico <= 0 || total <= 0) return 6;
  return Math.max(6, Math.round((total / pico) * 100));
}

export function MovimentoNoDiario({ mov }: { mov: NonNullable<ResumoDashboard['movimentoNoDiario']> }) {
  /* Sem ato nenhum em oito semanas não há ritmo para mostrar. Some — e a
     faixa do DJEN, que é quem sabe dizer POR QUE está calado, continua. */
  if (mov.total === 0) return null;

  const pessoal = mov.escopo === 'PESSOAL';
  const ultima = mov.semanas.length - 1;

  return (
    <SectionCard
      title={pessoal ? 'Seu movimento no Diário' : 'O movimento no Diário'}
      icon={Newspaper}
      actionHref="/publicacoes"
      actionLabel="Abrir o Diário"
    >
      {/*
        A LARGURA TEM TETO. Quando os dois blocos vizinhos estão vazios (o
        advogado sem adversário recorrente, o DataJud sem andamento), a grade
        vira uma coluna só e o cartão ocupava 1.136px: oito barras de 130px de
        largura por 64 de altura, deitadas, com o número da providência a um
        palmo do rótulo. O gráfico não fica melhor por ser maior.
      */}
      <div className="max-w-2xl px-2 pt-1">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{mov.total}</span>{' '}
          <span className="text-muted-foreground">
            {mov.total === 1 ? 'publicação' : 'publicações'} em 8 semanas
            {pessoal ? ' nos seus processos' : ''}
          </span>
        </p>

        {/*
          AS BARRAS. Oito semanas é o que cabe no telefone sem apertar: 400px
          menos as bordas dá ~44px por coluna, e o rótulo "14/9" ocupa 28px.
          A semana corrente vem em tom cheio; as passadas, em tom de fundo —
          é a diferença entre "o que está acontecendo" e "o que aconteceu",
          e ela se faz com COR, sem precisar de um segundo bloco.
        */}
        <div className="mt-3 flex items-end gap-1" role="img"
          aria-label={`Publicações por semana: ${mov.semanas
            .map((s) => `${rotuloDaSemana(s.semana)} ${s.total}`)
            .join(', ')}`}
        >
          {mov.semanas.map((s, i) => (
            <div key={s.semana} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {s.total > 0 ? s.total : ''}
              </span>
              {/*
                A CAIXA DE ALTURA FIXA EXISTE PARA A PORCENTAGEM TER CONTRA O QUE
                RESOLVER. Sem ela — medido no navegador, com o cartão inteiro
                desenhado e nenhum erro no console — as oito barras saíram com
                ZERO pixel: `height: 62%` dentro de um pai de altura automática
                é 62% de nada. O cartão parecia certo no código e era uma linha
                de números soltos na tela.
              */}
              <div className="flex h-16 w-full items-end sm:h-20">
                <span
                  className={cn(
                    'block w-full rounded-t transition-all duration-500',
                    i === ultima
                      ? 'bg-brand-600 dark:bg-brand-500'
                      : 'bg-brand-200 dark:bg-brand-900',
                  )}
                  style={{ height: `${alturaDaBarra(s.total, mov.pico)}%` }}
                  title={`Semana de ${rotuloDaSemana(s.semana)}: ${s.total}`}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1">
          {mov.semanas.map((s, i) => (
            <span
              key={s.semana}
              className={cn(
                'flex-1 text-center text-[10px] tabular-nums',
                i === ultima ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {/* No telefone só a primeira e a última têm espaço; no meio,
                  o número em cima da barra já diz o que interessa. */}
              <span className={cn(i !== 0 && i !== ultima && 'hidden sm:inline')}>
                {rotuloDaSemana(s.semana)}
              </span>
            </span>
          ))}
        </div>

        {mov.providencias.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              O que esses atos pediram
            </p>
            <ul className="space-y-1">
              {mov.providencias.map((p) => (
                <li key={p.chave} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {PROVIDENCIA_LABEL[p.chave] ?? p.chave}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.total}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
