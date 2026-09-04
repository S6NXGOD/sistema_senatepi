'use client';

import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { BarChart3, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ATALHOS, baixarCsvDaEquipe, carregarRelatorio, comoData, duracao,
  type Contagem, type Relatorio,
} from '@/lib/relatorios';
import { DESFECHO_LABEL } from '@/lib/agenda';
import { CANAL_LABEL, type CanalAtendimento } from '@/lib/atendimentos';
import { AREAS_JURIDICAS } from '@/lib/areas-juridicas';

/**
 * RELATÓRIOS — para cobrar o que ficou e mostrar o que foi feito.
 *
 * SEM RANKING, e a decisão é do serviço, não da tela: a lista vem em ordem
 * alfabética e inclui quem fechou zero. Zero pode ser férias, pode ser um mês
 * dentro de uma ação civil pública que não gera "atividade concluída" — é a
 * linha que pede conversa, não a que pede sumiço.
 *
 * O advogado vê a própria linha; quem coordena vê todas. A API é que recorta.
 */

const inputCls =
  'h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ' +
  'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring';

export default function RelatoriosPage() {
  const hoje = useMemo(() => new Date(), []);
  const [de, setDe] = useState(() => comoData(new Date(hoje.getTime() - 30 * 86_400_000)));
  const [ate, setAte] = useState(() => comoData(hoje));
  const [baixando, setBaixando] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['relatorio', de, ate],
    queryFn: () => carregarRelatorio(de, ate),
    placeholderData: keepPreviousData,
  });

  function aplicarAtalho(dias: number) {
    setDe(comoData(new Date(Date.now() - dias * 86_400_000)));
    setAte(comoData(new Date()));
  }

  async function baixar() {
    setBaixando(true);
    try {
      await baixarCsvDaEquipe(de, ate);
    } catch {
      toast.error('Não foi possível gerar o arquivo agora.');
    } finally {
      setBaixando(false);
    }
  }

  const pessoal = data?.escopo === 'PESSOAL';

  return (
    <div className="space-y-5 p-4 pb-24 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
          <BarChart3 className="h-5 w-5 text-brand-700 dark:text-brand-400" />
          Relatórios
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {pessoal
            ? 'Os seus números no período: o que você entregou e o que continua aberto.'
            : 'O que a equipe entregou no período e o que continua aberto. Sem posição e sem nota — os casos não são comparáveis entre si.'}
        </p>
      </header>

      {/* PERÍODO: atalhos primeiro, datas depois. Quem quer "o mês" clica uma
          vez; quem quer um intervalo específico digita. */}
      <Card className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap gap-1.5">
          {ATALHOS.map((a) => (
            <button
              key={a.dias}
              type="button"
              onClick={() => aplicarAtalho(a.dias)}
              className="rounded-full border px-3 py-1 text-xs font-medium transition hover:bg-muted"
            >
              Últimos {a.rotulo}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1 sm:flex-none">
            <span className="block text-xs font-medium text-muted-foreground">De</span>
            <input
              type="date"
              value={de}
              max={ate}
              onChange={(e) => setDe(e.target.value)}
              className={cn(inputCls, 'w-full sm:w-auto')}
            />
          </label>
          <label className="flex-1 space-y-1 sm:flex-none">
            <span className="block text-xs font-medium text-muted-foreground">Até</span>
            <input
              type="date"
              value={ate}
              min={de}
              onChange={(e) => setAte(e.target.value)}
              className={cn(inputCls, 'w-full sm:w-auto')}
            />
          </label>
          <Button variant="outline" onClick={baixar} disabled={baixando || !data}>
            {baixando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Baixar planilha</span>
          </Button>
          {isFetching && !isLoading && (
            <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </Card>

      {isLoading && (
        <p className="py-10 text-center text-sm text-muted-foreground">Somando o período…</p>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero titulo="Atividades concluídas" valor={data.atividades.concluidas} />
            <Numero
              titulo="Em aberto agora"
              valor={data.atividades.abertas}
              nota={data.atividades.atrasadas ? `${data.atividades.atrasadas} com prazo vencido` : undefined}
              alerta={data.atividades.atrasadas > 0}
            />
            <Numero titulo="Ações ajuizadas" valor={data.processos.distribuidos} />
            <Numero titulo="Atendimentos" valor={data.atendimentos.registrados} />
          </section>

          <Card className="overflow-hidden">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">
                {pessoal ? 'Os seus números' : 'Equipe'}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Em ordem alfabética. &quot;Concluídas&quot; conta quem fechou a atividade;
                &quot;em aberto&quot; e &quot;atrasadas&quot; contam quem é responsável por ela.
              </p>
            </div>
            {/* A tabela rola no celular em vez de espremer sete colunas. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Pessoa</th>
                    <th className="px-3 py-2 text-right font-medium">Concluídas</th>
                    <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                    <th className="px-3 py-2 text-right font-medium">Atrasadas</th>
                    <th className="px-4 py-2 text-right font-medium">Tempo mediano</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.equipe.map((l) => (
                    <tr key={l.usuarioId} className="hover:bg-muted/30">
                      <td className="px-4 py-2">{l.nome}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.concluidas}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.abertas}</td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          l.atrasadas > 0 && 'font-semibold text-amber-700 dark:text-amber-400',
                        )}
                      >
                        {l.atrasadas}
                      </td>
                      {/*
                        A BASE VAI JUNTO DA MEDIANA. "16 min" sobre duas
                        atividades e sobre quarenta são coisas diferentes, e o
                        número sozinho não distingue.
                      */}
                      <td className="px-4 py-2 text-right tabular-nums">
                        {duracao(l.medianaMinutos)}
                        {l.cronometradas > 0 && (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            ({l.cronometradas})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t px-4 py-2 text-[11px] leading-snug text-muted-foreground">
              O tempo mediano só considera atividades em que alguém usou o cronômetro — o número
              entre parênteses é quantas foram. Ele mede quanto tempo a atividade ficou aberta, e
              não o esforço que ela deu.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Lista
              titulo="Como as atividades terminaram"
              itens={data.atividades.porDesfecho}
              rotular={(r) => DESFECHO_LABEL[r] ?? r}
              vazio="Nenhuma atividade concluída no período."
            />
            <Lista
              titulo="Acervo ativo por área"
              itens={data.processos.porArea}
              rotular={(r) => AREAS_JURIDICAS.find((a) => a.slug === r)?.nome ?? r}
              vazio="Nenhum processo ativo."
            />
            <Lista
              titulo="Acervo ativo por tribunal"
              itens={data.processos.porTribunal}
              vazio="Nenhum processo ativo."
            />
          </div>

          {!pessoal && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Lista
                titulo="Atendimentos por canal"
                itens={data.atendimentos.porCanal}
                rotular={(r) => CANAL_LABEL[r as CanalAtendimento] ?? r}
                vazio="Nenhum atendimento no período."
              />
              <Lista
                titulo="Atendimentos por atendente"
                itens={data.atendimentos.porAtendente}
                vazio="Nenhum atendimento no período."
              />
            </div>
          )}

          <p className="text-[11px] leading-snug text-muted-foreground">
            Acervo hoje: {data.processos.ativos} processos ativos, {data.processos.encerrados}{' '}
            encerrados no período, {data.processos.cadastrados} cadastrados no sistema. Cadastrar
            não é ajuizar — o acervo antigo entrou de uma vez na migração.
          </p>
        </>
      )}
    </div>
  );
}

function Numero({
  titulo,
  valor,
  nota,
  alerta,
}: {
  titulo: string;
  valor: number;
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
      {nota && (
        <p
          className={cn(
            'mt-0.5 text-[11px]',
            alerta ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {nota}
        </p>
      )}
    </Card>
  );
}

/**
 * Uma distribuição, em barras proporcionais. Sem biblioteca de gráfico: são
 * poucas linhas, e um motor de gráfico traria eixo, grade e tooltip que
 * ninguém pediu.
 */
function Lista({
  titulo,
  itens,
  rotular,
  vazio,
}: {
  titulo: string;
  itens: Contagem[];
  rotular?: (r: string) => string;
  vazio: string;
}) {
  const maior = Math.max(...itens.map((i) => i.total), 1);
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {itens.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {itens.slice(0, 8).map((i) => (
            <li key={i.rotulo}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{rotular ? rotular(i.rotulo) : i.rotulo}</span>
                <span className="shrink-0 font-medium tabular-nums">{i.total}</span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${(i.total / maior) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
