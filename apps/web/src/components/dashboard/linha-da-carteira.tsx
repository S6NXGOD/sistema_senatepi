import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIAS_PARA_PARADO } from '@/lib/dashboard';

/**
 * A CARTEIRA DO ADVOGADO EM UMA LINHA — 18/09/2026.
 *
 * O dono perguntou: "essa dashboard do advogado não está pouco organizada e
 * muito poluída? Não era feita para o advogado se situar e realizar ações
 * rápidas e definitivas?" — e pediu a carteira no TOPO.
 *
 * CONTRARIO A SEGUNDA PARTE, com todas as letras, e a primeira é o motivo.
 * Eram SEIS cartões de KPI em duas fileiras, mais uma segunda grade de quatro
 * cartões adiante: dez contadores num painel onde o trabalho real do dia é de
 * unidades (na produção de 18/09/2026, o sindicato INTEIRO tinha 5 atividades
 * atrasadas e 7 processos com prazo aberto). Pôr os seis no alto não organiza;
 * empurra o trabalho para baixo da dobra e é exatamente a poluição reclamada.
 *
 * Então a carteira sobe em IMPORTÂNCIA e desce em TAMANHO: vira uma linha de
 * 44px com os três números que NÃO têm data — o acervo, o que falta ajuizar e o
 * que está parado. Os outros três eram fatos de agenda ("atrasadas",
 * "urgentes", "minhas audiências") e já aparecem na fila de atividades, cada um
 * como selo da própria linha. Contar duas vezes a mesma coisa era o defeito:
 * "atrasada" chegou a aparecer em QUATRO superfícies ao mesmo tempo.
 *
 * Zero aparece, e é de propósito: "0 parados" é uma boa notícia que a pessoa
 * precisa poder ler. O que não pode é a linha mudar de forma todo dia.
 */
export interface NumeroDaCarteira {
  chave: string;
  valor: number;
  rotulo: string;
  href: string | null;
  /** Explicação para o `title` — o que exatamente foi contado. */
  detalhe: string;
}

export function segmentosDaCarteira(c: {
  meusProcessos: number;
  preProcessuais: number;
  semMovimentacao: number;
}): NumeroDaCarteira[] {
  const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);
  return [
    {
      chave: 'processos',
      valor: c.meusProcessos,
      rotulo: plural(c.meusProcessos, 'processo', 'processos'),
      href: '/processos?meus=1',
      detalhe: `${c.meusProcessos} ${plural(c.meusProcessos, 'processo vinculado', 'processos vinculados')} a você`,
    },
    {
      chave: 'aAjuizar',
      valor: c.preProcessuais,
      rotulo: 'a ajuizar',
      href: '/processos?preProcessuais=1',
      detalhe: `${c.preProcessuais} em fase pré-processual — ainda não distribuídos`,
    },
    {
      chave: 'parados',
      valor: c.semMovimentacao,
      /*
        SEM LINK, E ISSO É HONESTO: nenhuma lista do sistema recorta "sem
        andamento há N dias". Um link para `?meus=1` abriria a carteira inteira
        com outro número na tela — o defeito que a casa chama de "o número
        clicável tem de abrir o MESMO recorte que contou".
      */
      rotulo: plural(c.semMovimentacao, 'parado', 'parados'),
      href: null,
      detalhe: `${c.semMovimentacao} sem andamento novo há ${DIAS_PARA_PARADO} dias`,
    },
  ];
}

export function LinhaDaCarteira({
  carteira,
}: {
  carteira: { meusProcessos: number; preProcessuais: number; semMovimentacao: number };
}) {
  const segmentos = segmentosDaCarteira(carteira);

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-xl border bg-card px-3 py-2.5">
      <Briefcase
        className="mr-1 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="mr-1 text-xs font-medium text-muted-foreground">Minha carteira</span>
      {segmentos.map((s, i) => {
        const corpo = (
          <>
            <span className={cn('font-semibold tabular-nums', s.valor === 0 && 'text-muted-foreground')}>
              {s.valor.toLocaleString('pt-BR')}
            </span>{' '}
            <span className="text-muted-foreground">{s.rotulo}</span>
          </>
        );
        return (
          <span key={s.chave} className="flex items-center text-sm">
            {i > 0 && <span className="mx-1.5 text-muted-foreground/50" aria-hidden="true">·</span>}
            {s.href ? (
              <Link
                href={s.href}
                title={s.detalhe}
                aria-label={s.detalhe}
                className="rounded px-0.5 underline-offset-4 transition hover:underline"
              >
                {corpo}
              </Link>
            ) : (
              <span title={s.detalhe} aria-label={s.detalhe} className="px-0.5">
                {corpo}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
