'use client';

import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { BarChart3, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ASSUNTO_LABEL, ATALHOS, baixarCsvDaEquipe, carregarRelatorio, comoData, duracao,
  type Contagem, type Relatorio,
} from '@/lib/relatorios';
import { DESFECHO_LABEL, listarTiposEvento, rotuloTipo } from '@/lib/agenda';
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
  /**
   * ESPELHO DE UMA PESSOA — para conversar com ela, não para publicar um pódio.
   * A lista continua alfabética e completa; isto é um recorte que se escolhe,
   * não uma ordenação que se impõe.
   */
  const [foco, setFoco] = useState('');

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['relatorio', de, ate, foco],
    queryFn: () => carregarRelatorio(de, ate, foco || undefined),
    placeholderData: keepPreviousData,
  });

  /* O tipo de atividade é cadastrável: o nome vem do catálogo, não de um mapa. */
  const { data: tiposEvento } = useQuery({
    queryKey: ['tipos-evento'],
    queryFn: () => listarTiposEvento(true),
    staleTime: 300_000,
  });

  function aplicarAtalho(dias: number) {
    setDe(comoData(new Date(Date.now() - dias * 86_400_000)));
    setAte(comoData(new Date()));
  }

  async function baixar() {
    setBaixando(true);
    try {
      await baixarCsvDaEquipe(de, ate, foco || undefined);
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
            : data?.focoUsuario
              ? `Os números de ${data.focoUsuario.nome} no período.`
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
          {/*
            O SELETOR SÓ EXISTE PARA QUEM VÊ A EQUIPE. Para o advogado o
            relatório já é o dele — mostrar um seletor de pessoas que a API
            ignora seria prometer o espelho do colega.
          */}
          {!pessoal && (data?.equipe.length ?? 0) > 1 && (
            <label className="flex-1 space-y-1 sm:flex-none">
              <span className="block text-xs font-medium text-muted-foreground">Pessoa</span>
              <select
                value={foco}
                onChange={(e) => setFoco(e.target.value)}
                className={cn(inputCls, 'w-full sm:w-56')}
              >
                <option value="">Toda a equipe</option>
                {data?.equipe.map((l) => (
                  <option key={l.usuarioId} value={l.usuarioId}>{l.nome}</option>
                ))}
              </select>
            </label>
          )}
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

      {/*
        NÚMERO ERRADO É PIOR QUE NÚMERO NENHUM — e um relatório que falhou e
        mostra os cartões zerados afirma que a equipe não entregou nada.
      */}
      {isError && (
        <Card className="p-2">
          <FalhaAoCarregar erro={error} oQue="o relatório" onTentarDeNovo={() => refetch()} />
        </Card>
      )}

      {data && !isError && (
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

          {/*
            QUE TIPO DE TRABALHO FOI FEITO.

            "Concluiu 15" não diz se foram quinze audiências ou quinze
            telefonemas, e a diferença é o dia inteiro de alguém. A divisão
            entre robô e gente vem junto: parte do que a equipe fecha nasceu de
            uma varredura automática, e contar as duas coisas como se fossem a
            mesma entrega distorce a leitura.
          */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Lista
              titulo="Tipo de atividade concluída"
              itens={data.atividades.porTipo}
              rotular={(r) => rotuloTipo(r, tiposEvento)}
              vazio="Nenhuma atividade concluída no período."
              nota={
                data.atividades.concluidas > 0
                  ? `${data.atividades.automaticas} nasceram de robô, ${data.atividades.manuais} de pessoas.`
                  : undefined
              }
            />
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

          {/*
            POR QUE O FILIADO PROCUROU — a pergunta que a diretoria faz.

            O campo é NOVO e opcional: os registros anteriores a ele e os que
            ficaram em branco entram como "não informado", à vista. Sem esse
            número, três atendimentos classificados virariam "100% progressão
            de nível" numa base de centenas.
          */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Lista
              titulo="Por que procuraram o sindicato"
              itens={data.atendimentos.porAssunto}
              rotular={(r) => ASSUNTO_LABEL[r] ?? r}
              vazio="Nenhum atendimento classificado no período."
              nota={
                data.atendimentos.assuntoNaoInformado > 0
                  ? `${data.atendimentos.assuntoNaoInformado} atendimento(s) sem assunto informado.`
                  : undefined
              }
            />
            <Lista
              titulo="Atendimentos por setor"
              itens={data.atendimentos.porSetor}
              vazio="Nenhum atendimento no período."
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
  nota,
}: {
  titulo: string;
  itens: Contagem[];
  rotular?: (r: string) => string;
  vazio: string;
  /** Ressalva que o número sozinho esconderia (base, não informados). */
  nota?: string;
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
      {nota && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{nota}</p>}
    </Card>
  );
}
