'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ReceiptText, Plus, Search, Printer, Ban, ChevronLeft, ChevronRight, Loader2,
  ArrowDownLeft, ArrowUpRight, SlidersHorizontal, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { nivelEfetivo } from '@/lib/permissoes';
import { cn } from '@/lib/utils';
import {
  listarRecibos, type FiltroRecibos, type ReciboResumo, type TipoRecibo,
  formatBRL, formatData, formatDocumento,
} from '@/lib/recibos';
import { FilaSemRecibo } from '@/components/recibos/fila-sem-recibo';
import { EmitirReciboModal, type OrigemDaEmissao } from '@/components/recibos/emitir-recibo-modal';
import { ReciboPrintModal } from '@/components/recibos/recibo-print-modal';
import { CancelarReciboModal } from '@/components/recibos/cancelar-recibo-modal';

const SITUACOES = [
  { valor: 'VALIDOS', rotulo: 'Válidos' },
  { valor: 'CANCELADOS', rotulo: 'Cancelados' },
  { valor: 'TODOS', rotulo: 'Todos' },
] as const;

/**
 * RECIBOS — o papel que o sindicato entrega quando recebe dinheiro.
 *
 * A TELA TEM DUAS ZONAS, nesta ordem (`senatepi-painel-quatro-zonas`: trabalho
 * antes de número):
 *
 *  1. OS PAGAMENTOS SEM RECIBO. É o problema real: ninguém esquece o recibo de
 *     quem está no balcão esperando — esquece-se do que caiu na conta e de quem
 *     pediu o papel três semanas depois. Com a fila vazia, o bloco vira UMA
 *     LINHA, e não um cartão vazio ocupando a primeira dobra.
 *  2. O ACERVO, com busca, recorte e os totais DO MESMO recorte.
 *
 * Não há "gerar PDF": o recibo é gravado quando se emite, e imprimir é
 * reabrir o que foi gravado. É por isso que a 2ª via sai idêntica à 1ª,
 * inclusive no número.
 */
export default function RecibosPage() {
  const { user } = useAuth();
  const podeEmitir = nivelEfetivo(user?.role, user?.permissoes, 'recibos') === 'EDITAR';

  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<FiltroRecibos['situacao']>('VALIDOS');
  /** `undefined` é "os dois lados" — o padrão, porque o acervo é um só. */
  const [lado, setLado] = useState<TipoRecibo | undefined>(undefined);
  const [exercicio, setExercicio] = useState<number | ''>('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [page, setPage] = useState(1);
  /*
    OS FILTROS DE SEGUNDA LINHA FICAM FECHADOS (13/10/2026).

    "Não ficaria muito poluído?" — e ficava: a 400px eram SEIS fileiras de
    controle (busca, ano, situação, lado, período, totais) antes do primeiro
    recibo, numa tela cujo trabalho principal é PROCURAR um recibo para
    reimprimir. A busca responde a isso sozinha.

    O resto — ano, situação, lado, período — é de quem fecha prestação de
    contas, não do balcão, e some atrás de um botão. NUNCA EM SILÊNCIO: com
    qualquer filtro ligado o botão fica aceso e diz quantos são, porque lista
    recortada que se apresenta como inteira é pior que lista nenhuma.
  */
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const [emitindo, setEmitindo] = useState<OrigemDaEmissao | null>(null);
  const [imprimindo, setImprimindo] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<ReciboResumo | null>(null);

  /*
    O FILTRO É A CHAVE DA CONSULTA — um objeto só, usado nos dois lugares
    (`senatepi-memo-e-chave-da-consulta`). Montar a `queryKey` à mão, campo a
    campo, é como se esquece de um: a tela troca o recorte e a lista fica a
    mesma, servida do cache.
  */
  const filtro = useMemo<FiltroRecibos>(
    () => ({
      busca: busca.trim() || undefined,
      situacao,
      tipo: lado,
      exercicio: exercicio === '' ? undefined : exercicio,
      de: de || undefined,
      ate: ate || undefined,
      page,
      pageSize: 20,
    }),
    [busca, situacao, lado, exercicio, de, ate, page],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['recibos', filtro],
    queryFn: () => listarRecibos(filtro),
  });

  const trocarFiltro = (fn: () => void) => { fn(); setPage(1); };

  /** Quantos filtros estão fora do padrão — é o que o botão mostra. */
  const filtrosLigados =
    (situacao !== 'VALIDOS' ? 1 : 0) + (lado ? 1 : 0) + (exercicio !== '' ? 1 : 0) + (de ? 1 : 0) + (ate ? 1 : 0);
  const limparFiltros = () =>
    trocarFiltro(() => {
      setSituacao('VALIDOS');
      setLado(undefined);
      setExercicio('');
      setDe('');
      setAte('');
    });

  /*
    SEM ACERVO, SEM BARRA. Com zero recibos emitidos, uma barra de busca e seis
    filtros acima de "nenhum recibo emitido ainda" é ferramenta para mexer em
    coisa que não existe — foi exatamente o que a tela mostrava no print.
  */
  const acervoVazio = !!data && data.total === 0 && !busca.trim() && filtrosLigados === 0;
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
            <ReceiptText className="h-5 w-5 text-brand-800 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Recibos</h2>
            <p className="text-sm text-muted-foreground">
              O papel do dinheiro que entra e do que sai — numerado, guardado e
              reimprimível.
            </p>
          </div>
        </div>
        {/*
          DOIS BOTÕES, e não um com escolha escondida dentro. São dois
          documentos diferentes — quem vai dar baixa numa taxa e quem acabou de
          pagar o eletricista chegam na tela com intenções distintas, e o
          caminho de cada um tem de estar visível antes do clique. O diálogo
          ainda deixa trocar, para quem clicar no errado.
        */}
        {podeEmitir && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEmitindo({ tipo: 'AVULSO', lado: 'ENTRADA' })}>
              <Plus className="h-4 w-4" /> Recebemos
            </Button>
            <Button variant="outline" onClick={() => setEmitindo({ tipo: 'AVULSO', lado: 'SAIDA' })}>
              <ArrowUpRight className="h-4 w-4" /> Pagamos alguém
            </Button>
          </div>
        )}
      </div>

      {/* ZONA 1 — o trabalho */}
      <FilaSemRecibo
        podeEmitir={podeEmitir}
        onEmitir={(p) => setEmitindo({ tipo: 'PAGAMENTO', pagamento: p })}
      />

      {/* ZONA 2 — o acervo */}
      <div className="rounded-2xl border bg-card">
        {!acervoVazio && (
          <div className="space-y-3 border-b p-4">
            {/*
              A BUSCA É A FERRAMENTA PRINCIPAL e fica sozinha na primeira
              linha: o pedido mais comum do balcão é "me dá a 2ª via do recibo
              da fulana", e nome, CPF ou número resolvem os três.
            */}
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => trocarFiltro(() => setBusca(e.target.value))}
                  placeholder="Nome, CPF ou número do recibo"
                  className="pl-9"
                  aria-label="Procurar recibo"
                />
              </div>
              <Button
                variant={filtrosLigados ? 'default' : 'outline'}
                onClick={() => setFiltrosAbertos((v) => !v)}
                aria-expanded={filtrosAbertos}
                /*
                  O NOME ACESSÍVEL VAI SEMPRE. A palavra some abaixo de `sm` e
                  sobra o ícone — sem isto o botão fica SEM NOME nenhum no
                  celular, que é justamente onde ele mais importa. Mesmo
                  descuido que a conferência pegou nos botões de imprimir e
                  cancelar desta tela, em 06/10.
                */
                aria-label={filtrosLigados ? `Filtrar (${filtrosLigados} ativo${filtrosLigados > 1 ? 's' : ''})` : 'Filtrar'}
                title="Ano, situação, lado e período"
                className="shrink-0"
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Filtrar</span>
                {filtrosLigados > 0 && (
                  <span className="rounded-full bg-white/25 px-1.5 text-xs font-bold tabular-nums">
                    {filtrosLigados}
                  </span>
                )}
              </Button>
            </div>

            {filtrosAbertos && (
              <div className="space-y-2 rounded-xl bg-muted/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg border bg-background p-0.5">
                    {SITUACOES.map((s) => (
                      <button
                        key={s.valor}
                        type="button"
                        onClick={() => trocarFiltro(() => setSituacao(s.valor))}
                        aria-pressed={situacao === s.valor}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-medium transition',
                          situacao === s.valor
                            ? 'bg-brand-800 text-white'
                            : 'text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {s.rotulo}
                      </button>
                    ))}
                  </div>
                  {/* O lado: os dois juntos é o padrão, e é o acervo inteiro. */}
                  <div className="flex rounded-lg border bg-background p-0.5">
                    {([undefined, 'ENTRADA', 'SAIDA'] as const).map((op) => (
                      <button
                        key={op ?? 'todos'}
                        type="button"
                        onClick={() => trocarFiltro(() => setLado(op))}
                        aria-pressed={lado === op}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-medium transition',
                          lado === op ? 'bg-brand-800 text-white' : 'text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {op === undefined ? 'Os dois' : op === 'ENTRADA' ? 'Recebidos' : 'Pagos'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <select
                    value={exercicio}
                    onChange={(e) => trocarFiltro(() => setExercicio(e.target.value ? Number(e.target.value) : ''))}
                    aria-label="Exercício"
                    className="h-9 rounded-lg border bg-background px-2 text-xs"
                  >
                    <option value="">Todos os anos</option>
                    {(data?.exercicios ?? []).map((ex) => (
                      <option key={ex} value={ex}>{ex}</option>
                    ))}
                  </select>
                  <span className="hidden sm:inline">Recebido de</span>
                  <input
                    type="date"
                    value={de}
                    onChange={(e) => trocarFiltro(() => setDe(e.target.value))}
                    aria-label="Recebido a partir de"
                    className="h-9 rounded-lg border bg-background px-2 text-xs"
                  />
                  <span>até</span>
                  <input
                    type="date"
                    value={ate}
                    onChange={(e) => trocarFiltro(() => setAte(e.target.value))}
                    aria-label="Recebido até"
                    className="h-9 rounded-lg border bg-background px-2 text-xs"
                  />
                  {filtrosLigados > 0 && (
                    <button
                      type="button"
                      onClick={limparFiltros}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 font-medium text-foreground underline underline-offset-2"
                    >
                      <X className="h-3.5 w-3.5" /> Limpar
                    </button>
                  )}
                </div>
              </div>
            )}

            {/*
              OS DOIS LADOS SÃO SOMADOS SEPARADOS, e nunca um no outro. Juntar o
              que entrou com o que saiu num total só não é número nenhum, e
              subtrair também não: isto é um acervo de DOCUMENTOS, não o saldo
              do caixa — quem quer saldo olha o financeiro.
            */}
            {data && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1">
                  <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <strong className="tabular-nums">{data.resumo.recebido.quantidade}</strong>{' '}
                  recebido{data.resumo.recebido.quantidade === 1 ? '' : 's'}
                  {' · '}
                  <strong className="tabular-nums">{formatBRL(data.resumo.recebido.valor)}</strong>
                </span>
                <span className="inline-flex items-center gap-1">
                  <ArrowUpRight className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400" />
                  <strong className="tabular-nums">{data.resumo.pago.quantidade}</strong>{' '}
                  pago{data.resumo.pago.quantidade === 1 ? '' : 's'}
                  {' · '}
                  <strong className="tabular-nums">{formatBRL(data.resumo.pago.valor)}</strong>
                </span>
                {/*
                  O NÚMERO LEVA AO RECORTE (`senatepi-link-leva-o-recorte`):
                  clicar em "2 cancelados" abre JUSTAMENTE esses dois, com o
                  mesmo período e a mesma busca — e abre o painel de filtros,
                  para a pessoa ver de onde veio o recorte.
                */}
                {data.resumo.cancelados > 0 && (
                  <button
                    type="button"
                    onClick={() => { trocarFiltro(() => setSituacao('CANCELADOS')); setFiltrosAbertos(true); }}
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {data.resumo.cancelados} cancelado{data.resumo.cancelados > 1 ? 's' : ''}
                  </button>
                )}
              </p>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-brand-800" />
          </div>
        ) : !data?.itens.length ? (
          /*
            DUAS MENSAGENS DIFERENTES, porque são duas situações diferentes:
            "não achei no recorte" pede para afrouxar o filtro; "ainda não há
            nenhum" pede para emitir o primeiro — e aí a tela diz COMO.
          */
          <div className="px-4 py-16 text-center">
            {acervoVazio ? (
              <>
                <ReceiptText className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium">Nenhum recibo emitido ainda.</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Todo valor que entra ou sai do caixa pode virar um recibo numerado.
                  Comece pelos pagamentos que já estão lançados, ali em cima, ou emita um avulso.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Nenhum recibo neste recorte.</p>
                {filtrosLigados > 0 && (
                  <button
                    type="button"
                    onClick={limparFiltros}
                    className="mt-2 text-sm font-medium underline underline-offset-2"
                  >
                    Limpar os filtros
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {/* CELULAR — cartões. A tabela de 7 colunas não cabe em 400px. */}
            <ul className="divide-y md:hidden">
              {data.itens.map((r) => (
                <li key={r.id} className="p-4">
                  <LinhaDeRecibo
                    r={r}
                    podeEditar={podeEmitir}
                    onImprimir={() => setImprimindo(r.id)}
                    onCancelar={() => setCancelando(r)}
                  />
                </li>
              ))}
            </ul>

            {/* DESKTOP — tabela */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Nº</th>
                    <th className="px-4 py-2 font-medium" />
                    <th className="px-4 py-2 font-medium">Recebido</th>
                    {/*
                      O CABEÇALHO É NEUTRO porque a coluna é das duas
                      direções: "Quem pagou" acima da linha do
                      eletricista diria que foi ele quem pagou. A seta
                      da coluna anterior resolve qual é qual.
                    */}
                    <th className="px-4 py-2 font-medium">Pagou / recebeu</th>
                    <th className="px-4 py-2 font-medium">Referente a</th>
                    <th className="px-4 py-2 font-medium">Forma</th>
                    <th className="px-4 py-2 text-right font-medium">Valor</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.itens.map((r) => (
                    <tr key={r.id} className={cn(r.cancelado && 'bg-muted/40')}>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold tabular-nums">
                        {r.codigo}
                        {r.cancelado && <SeloCancelado />}
                      </td>
                      <td className="px-2 py-3"><SetaDoLado tipo={r.tipo} /></td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                        {formatData(r.recebidoEm)}
                      </td>
                      <td className="px-4 py-3">
                        <p className={cn('font-medium', r.cancelado && 'line-through opacity-60')}>
                          {r.contraparteNome}
                        </p>
                        {r.contraparteDocumento && (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {formatDocumento(r.contraparteDocumento)}
                          </p>
                        )}
                      </td>
                      <td className="max-w-[22rem] px-4 py-3 text-muted-foreground">{r.referente}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{r.formaPagamento}</td>
                      <td className={cn(
                        'whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums',
                        r.cancelado && 'line-through opacity-60',
                      )}>
                        {formatBRL(r.valor)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Acoes
                          r={r}
                          podeEditar={podeEmitir}
                          onImprimir={() => setImprimindo(r.id)}
                          onCancelar={() => setCancelando(r)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  Página {data.page} de {totalPaginas} · {data.total} no total
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={data.page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" /> Anterior
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={data.page >= totalPaginas}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Próxima <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {emitindo && (
        <EmitirReciboModal
          origem={emitindo}
          onClose={() => setEmitindo(null)}
          onEmitido={(id) => { setEmitindo(null); setImprimindo(id); }}
        />
      )}
      {imprimindo && (
        <ReciboPrintModal reciboId={imprimindo} onClose={() => setImprimindo(null)} />
      )}
      {cancelando && (
        <CancelarReciboModal recibo={cancelando} onClose={() => setCancelando(null)} />
      )}
    </div>
  );
}

/**
 * DE QUE LADO — uma seta, e não uma palavra.
 *
 * A direção precisa ser lida de relance numa lista onde tudo o mais é texto, e
 * "Recebido"/"Pago" escrito em toda linha empata com o nome de quem pagou pela
 * atenção. A seta carrega o sentido; o `title` e o `aria-label` carregam a
 * palavra para quem usa leitor de tela (`senatepi-cor-e-o-que-pede-alguem`: o
 * ícone vem antes da cor, e cor nenhuma sozinha diz coisa alguma).
 */
function SetaDoLado({ tipo }: { tipo: TipoRecibo }) {
  const entrou = tipo === 'ENTRADA';
  const Icone = entrou ? ArrowDownLeft : ArrowUpRight;
  const texto = entrou ? 'Recebido pelo sindicato' : 'Pago pelo sindicato';
  return (
    <Icone
      className={cn(
        'h-4 w-4 shrink-0',
        entrou ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-700 dark:text-sky-400',
      )}
      aria-label={texto}
      role="img"
    >
      <title>{texto}</title>
    </Icone>
  );
}

/**
 * O SELO DE CANCELADO — ícone antes da cor (`senatepi-cor-e-o-que-pede-alguem`).
 * Vermelho sozinho seria lido como erro do sistema; a palavra e a tarja dizem
 * que foi alguém que cancelou.
 */
function SeloCancelado() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
      <Ban className="h-3 w-3" /> Cancelado
    </span>
  );
}

function LinhaDeRecibo({
  r, podeEditar, onImprimir, onCancelar,
}: {
  r: ReciboResumo;
  /** EDITAR no módulo — aqui ele governa o cancelar, não o emitir. */
  podeEditar: boolean;
  onImprimir: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-xs font-semibold tabular-nums text-muted-foreground">
            <SetaDoLado tipo={r.tipo} />
            {r.codigo}
            <span className="font-normal">· {formatData(r.recebidoEm)}</span>
            {r.cancelado && <SeloCancelado />}
          </p>
          <p className={cn('truncate font-medium', r.cancelado && 'line-through opacity-60')}>
            {r.contraparteNome}
          </p>
        </div>
        <p className={cn(
          'whitespace-nowrap font-semibold tabular-nums',
          r.cancelado && 'line-through opacity-60',
        )}>
          {formatBRL(r.valor)}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{r.referente}</p>
      {r.cancelado && r.canceladoMotivo && (
        <p className="text-xs text-rose-700 dark:text-rose-300">Motivo: {r.canceladoMotivo}</p>
      )}
      <div className="flex gap-2 pt-1">
        <Acoes r={r} podeEditar={podeEditar} onImprimir={onImprimir} onCancelar={onCancelar} />
      </div>
    </div>
  );
}

function Acoes({
  r, podeEditar, onImprimir, onCancelar,
}: {
  r: ReciboResumo;
  podeEditar: boolean;
  onImprimir: () => void;
  onCancelar: () => void;
}) {
  /*
    O NOME ACESSÍVEL VAI SEMPRE, e a conferência de tela pegou a falta.

    No desktop a palavra some (`md:hidden`) e sobra o ícone — o que deixava os
    dois botões SEM NOME nenhum para leitor de tela e para quem navega por
    teclado. O `aria-label` não depende do tamanho da janela, e cita o número:
    com seis linhas na tela, "Imprimir" seis vezes não diz qual é qual.
  */
  return (
    <>
      <Button
        variant="outline" size="sm" onClick={onImprimir}
        aria-label={`Imprimir o recibo ${r.codigo}`}
        title={`Imprimir o recibo ${r.codigo} (2ª via, mesmo número)`}
      >
        <Printer className="h-4 w-4" />
        <span className="md:hidden">Imprimir</span>
      </Button>
      {podeEditar && !r.cancelado && (
        <Button
          variant="ghost" size="sm"
          onClick={onCancelar}
          aria-label={`Cancelar o recibo ${r.codigo}`}
          title={`Cancelar o recibo ${r.codigo}`}
          className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
        >
          <Ban className="h-4 w-4" />
          <span className="md:hidden">Cancelar</span>
        </Button>
      )}
    </>
  );
}
