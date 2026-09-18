import { Briefcase, FileCheck2, Hourglass, CalendarClock } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/widgets';
import { DIAS_PARA_PARADO, linkDosPrazosDaSemana } from '@/lib/dashboard';

/**
 * MINHA CARTEIRA — o acervo do advogado, em quatro números.
 *
 * DUAS CORREÇÕES DE ROTA, NO MESMO DIA (18/09/2026).
 *
 * Eram SEIS cartões numa grade de duas fileiras, mais uma segunda grade com
 * quatro números da casa: dez contadores num painel onde o trabalho do dia é de
 * unidades. Encolhi para uma LINHA de texto com três números — e o dono foi
 * direto ao ponto:
 *
 *   "A carteira principalmente, acho importante ela ser mostrada, a dashboard
 *    tem que ter dados, bonita ao usuário, animada, com dados importantes para
 *    cada role."
 *
 * Ele tem razão, e o erro foi meu: painel sem número nenhum deixa de ser painel.
 * O que estava errado não era MOSTRAR a carteira — era mostrá-la em dez cartões
 * repetindo o que a fila logo abaixo já diz.
 *
 * ENTÃO SÃO QUATRO, e a escolha tem uma regra: aqui só entra o que fala do
 * ACERVO, nunca o que a fila de atividades já mostra linha a linha. "Atrasadas"
 * e "Urgentes" saíram por isso — eram a mesma coisa contada duas vezes, e
 * "atrasada" chegou a aparecer em QUATRO superfícies ao mesmo tempo. Prazos da
 * semana fica, porque responde outra pergunta: a fila mostra HOJE, este mostra
 * a SEMANA.
 *
 * "Parados" não tem link, e é honesto: nenhuma lista do sistema recorta "sem
 * andamento há N dias", e mandar para a carteira inteira abriria outro número.
 */
export interface NumeroDaCarteira {
  chave: string;
  valor: number;
  rotulo: string;
  sub: string;
  href: string | null;
}

export function numerosDaCarteira(
  c: { meusProcessos: number; preProcessuais: number; semMovimentacao: number },
  prazosNaSemana: number,
): NumeroDaCarteira[] {
  return [
    {
      chave: 'processos',
      valor: c.meusProcessos,
      rotulo: 'Meus processos',
      sub: 'vinculados a mim',
      href: '/processos?meus=1',
    },
    {
      chave: 'prazos',
      valor: prazosNaSemana,
      rotulo: 'Prazos',
      sub: 'próximos 7 dias',
      href: linkDosPrazosDaSemana('PESSOAL'),
    },
    {
      chave: 'aAjuizar',
      valor: c.preProcessuais,
      rotulo: 'A ajuizar',
      sub: 'fase pré-processual',
      href: '/processos?preProcessuais=1',
    },
    {
      chave: 'parados',
      valor: c.semMovimentacao,
      rotulo: 'Parados',
      sub: `sem andamento há ${DIAS_PARA_PARADO} dias`,
      href: null,
    },
  ];
}

const ICONE: Record<string, typeof Briefcase> = {
  processos: Briefcase,
  prazos: CalendarClock,
  aAjuizar: FileCheck2,
  parados: Hourglass,
};

const COR: Record<string, string> = {
  processos: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400',
  prazos: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  aAjuizar: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  parados: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export function LinhaDaCarteira({
  carteira,
  prazosNaSemana,
}: {
  carteira: { meusProcessos: number; preProcessuais: number; semMovimentacao: number };
  prazosNaSemana: number;
}) {
  const numeros = numerosDaCarteira(carteira, prazosNaSemana);

  /*
    DUAS COLUNAS NO TELEFONE, QUATRO NO COMPUTADOR. Seis cartões em duas colunas
    custavam 364px medidos num aparelho de 375px — mais da metade da dobra útil.
    Quatro em duas fileiras custam ~200px, e a fila de trabalho continua visível
    sem rolar.
  */
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {numeros.map((n, i) => (
        <div key={n.chave} className="animate-surgir" style={{ animationDelay: `${i * 40}ms` }}>
          <KpiCard
            label={n.rotulo}
            valor={n.valor}
            sub={n.sub}
            icon={ICONE[n.chave]}
            cor={COR[n.chave]}
            href={n.href ?? undefined}
            destaque
          />
        </div>
      ))}
    </div>
  );
}
