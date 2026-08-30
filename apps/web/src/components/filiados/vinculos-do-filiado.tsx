'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CreditCard,
  Gavel,
  Headset,
  Loader2,
  Users,
  Wallet,
} from 'lucide-react';

import { vinculosDoFiliado } from '@/lib/filiados';
import { V } from '@/lib/vocabulario';
import { cn } from '@/lib/utils';

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * O QUE FICA PARA TRÁS QUANDO ALGUÉM SAI.
 *
 * A desfiliação era decidida às cegas: o modal pedia motivo e mês de corte, e
 * pronto. Só que o cadastro do filiado é o centro de meia dúzia de módulos, e
 * nenhum deles aparecia na hora de confirmar — dívida em aberto, processo em
 * andamento, dependentes que perdem acesso junto, atividade marcada na agenda
 * de um advogado, triagem esperando resposta. Quem confirmava não tinha como
 * saber, e descobriria depois, por acaso.
 *
 * NÃO BLOQUEIA NADA, e a distinção é o ponto. Sair do sindicato é direito do
 * associado; recusar a saída porque há uma parcela aberta transformaria a
 * mensalidade em algema. O painel MOSTRA — para a secretaria cobrar o que é
 * devido, avisar o advogado do caso em curso e explicar aos dependentes antes,
 * em vez de descobrir semanas depois.
 *
 * SILENCIOSO QUANDO NÃO HÁ NADA. Um bloco dizendo "0 pendências, 0 processos,
 * 0 dependentes" empurra o botão de confirmar para fora da tela no celular e
 * ensina a pessoa a rolar sem ler. Só aparece o que existe — e, quando não
 * existe nada, uma única linha discreta confirmando isso, que é informação
 * diferente de silêncio.
 */
export function VinculosDoFiliado({ filiadoId }: { filiadoId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['filiado-vinculos', filiadoId],
    queryFn: () => vinculosDoFiliado(filiadoId),
    // A tela é um modal de decisão: os números não podem vir de um cache de
    // outra sessão, e a consulta é barata (sete contagens numa transação).
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Verificando o que está vinculado a este cadastro…
      </p>
    );
  }

  /*
   * FALHAR CALADO SERIA PIOR QUE NÃO TER O PAINEL: a pessoa veria a ausência de
   * avisos como "não há nada pendente" e confirmaria. O aviso diz que não sabe.
   */
  if (isError || !data) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
        Não foi possível verificar pendências deste cadastro. Confira o dossiê
        antes de confirmar a saída.
      </p>
    );
  }

  const itens = [
    data.parcelasAbertas > 0 && {
      chave: 'financeiro',
      Icone: Wallet,
      grave: true,
      texto: `${data.parcelasAbertas} parcela${data.parcelasAbertas > 1 ? 's' : ''} em aberto`,
      detalhe: `${BRL(data.valorAberto)} — a saída não cancela o que já é devido.`,
    },
    data.processos > 0 && {
      chave: 'processos',
      Icone: Gavel,
      grave: true,
      texto: `${data.processos} processo${data.processos > 1 ? 's' : ''} em andamento`,
      detalhe: 'Combine com o advogado responsável antes de registrar a saída.',
    },
    data.dependentes > 0 && {
      chave: 'dependentes',
      Icone: Users,
      grave: false,
      texto: `${data.dependentes} dependente${data.dependentes > 1 ? 's' : ''}`,
      detalhe: 'Perdem o acesso junto com o titular, no mesmo instante.',
    },
    data.atividadesAbertas > 0 && {
      chave: 'agenda',
      Icone: CalendarClock,
      grave: false,
      texto: `${data.atividadesAbertas} atividade${data.atividadesAbertas > 1 ? 's' : ''} na agenda`,
      detalhe: 'Continuam marcadas — cancele ou conclua o que não faz mais sentido.',
    },
    data.atendimentosAbertos > 0 && {
      chave: 'atendimentos',
      Icone: Headset,
      grave: false,
      texto: `${data.atendimentosAbertos} atendimento${data.atendimentosAbertos > 1 ? 's' : ''} sem desfecho`,
      detalhe: 'Alguém ainda espera resposta.',
    },
    data.carteirinhas > 0 && {
      chave: 'carteirinha',
      Icone: CreditCard,
      grave: false,
      texto: 'Carteirinha emitida',
      detalhe: 'Deixa de validar na hora — a pessoa pode não saber disso.',
    },
  ].filter(Boolean) as {
    chave: string;
    Icone: typeof Wallet;
    grave: boolean;
    texto: string;
    detalhe: string;
  }[];

  if (!itens.length) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Nada pendente neste cadastro — sem dívida, processo, dependente ou
        atividade em aberto.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        O que fica pendente com a saída
      </p>
      <ul className="space-y-1.5">
        {itens.map(({ chave, Icone, grave, texto, detalhe }) => (
          <li key={chave} className="flex gap-2">
            <Icone
              className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0',
                grave ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400',
              )}
            />
            {/* `min-w-0` + quebra: nomes e valores não podem virar reticências
                num aviso que existe justamente para ser lido. */}
            <span className="min-w-0 text-xs leading-snug">
              <span className={cn('font-medium', grave && 'text-red-700 dark:text-red-300')}>
                {texto}
              </span>
              <span className="block text-muted-foreground">{detalhe}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="pt-0.5 text-[11px] text-muted-foreground">
        Nada disso impede a saída — {V.filiado} tem direito de sair. É para você
        resolver antes, e não descobrir depois.
      </p>
    </div>
  );
}
