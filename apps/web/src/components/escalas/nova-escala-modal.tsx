'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Plus, Loader2, Save, CalendarClock, CalendarPlus, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDataPura } from '@/lib/data-pura';
import { cn } from '@/lib/utils';
import { SeletorDePessoa } from './seletor-de-pessoa';
import {
  listarAdvogadosEscala, criarEscalas, EscalaItemInput, gerarDatasDaRepeticao, hojeBR, proximoDiaUtil,
  ultimoDiaDoMes, diaDaSemana, diaCurto, contar, mensagemDoErro, ehFimDeSemana,
  MAXIMO_DE_DATAS_POR_VEZ, DIAS_UTEIS,
} from '@/lib/escalas';

/**
 * O horário que a casa usa. Medido em 12/09/2026: os 25 plantões da produção
 * são 09:00–12:00. Era 08:00–17:00, e toda linha precisava ser corrigida.
 */
const HORA_INICIO_PADRAO = '09:00';
const HORA_FIM_PADRAO = '12:00';
const OBSERVACAO_MAX = 500;

type Modo = 'avulsas' | 'repetir';
interface Linha { chave: number; data: string; horaInicio: string; horaFim: string; observacao: string }

let sequencia = 0;
const novaLinha = (data: string, horaInicio = HORA_INICIO_PADRAO, horaFim = HORA_FIM_PADRAO): Linha => ({
  chave: ++sequencia, data, horaInicio, horaFim, observacao: '',
});

const rotuloDaData = (d: string) => formatDataPura(d, { weekday: 'short', day: '2-digit', month: '2-digit' });

/**
 * Cadastrar plantões: datas avulsas ou "repetir toda semana" com prévia.
 *
 * O formulário mora num filho que só existe com o modal aberto: fechar
 * desmonta, e abrir de novo começa do zero (sem saída animada, de propósito).
 */
export function NovaEscalaModal({
  open, onClose, onSalvo, dataPre,
}: {
  open: boolean;
  onClose: () => void;
  onSalvo: () => void;
  dataPre?: string | null;
}) {
  if (!open) return null;
  return <FormularioNovaEscala onClose={onClose} onSalvo={onSalvo} dataPre={dataPre ?? null} />;
}

function FormularioNovaEscala({
  onClose, onSalvo, dataPre,
}: {
  onClose: () => void;
  onSalvo: () => void;
  dataPre: string | null;
}) {
  const [inicio] = useState(() => dataPre ?? hojeBR());
  const [advogadoId, setAdvogadoId] = useState('');
  const [modo, setModo] = useState<Modo>('avulsas');
  const [linhas, setLinhas] = useState<Linha[]>(() => [novaLinha(inicio)]);

  // Repetição
  const [dias, setDias] = useState<number[]>(() => (ehFimDeSemana(inicio) ? [] : [diaDaSemana(inicio)]));
  const [de, setDe] = useState(inicio);
  const [ate, setAte] = useState(() => ultimoDiaDoMes(inicio));
  const [horaInicio, setHoraInicio] = useState(HORA_INICIO_PADRAO);
  const [horaFim, setHoraFim] = useState(HORA_FIM_PADRAO);
  const [observacao, setObservacao] = useState('');
  const [desmarcadas, setDesmarcadas] = useState<string[]>([]);

  const [erro, setErro] = useState<string | null>(null);

  const advogados = useQuery({ queryKey: ['escalas-advogados'], queryFn: listarAdvogadosEscala });

  const geradas = useMemo(() => gerarDatasDaRepeticao({ diasDaSemana: dias, de, ate }), [dias, de, ate]);
  const marcadas = useMemo(() => geradas.filter((d) => !desmarcadas.includes(d)), [geradas, desmarcadas]);

  const itens: EscalaItemInput[] = useMemo(
    () =>
      modo === 'repetir'
        ? marcadas.map((data) => ({ data, horaInicio, horaFim, observacao: observacao.trim() || undefined }))
        : linhas
            .filter((l) => l.data)
            .map((l) => ({
              data: l.data, horaInicio: l.horaInicio, horaFim: l.horaFim, observacao: l.observacao.trim() || undefined,
            })),
    [modo, marcadas, horaInicio, horaFim, observacao, linhas],
  );
  const qtd = itens.length;
  const passouDoLimite = qtd > MAXIMO_DE_DATAS_POR_VEZ;

  const salvar = useMutation({
    mutationFn: (lote: EscalaItemInput[]) => criarEscalas(advogadoId, lote),
    onSuccess: (r) => {
      toast.success(`${contar(r.criadas, 'plantão cadastrado', 'plantões cadastrados')}.`);
      onSalvo();
      onClose();
    },
    // A frase da API fica NO MODAL: "Em 15/09 a Dra. X já está de plantão
    // 09:00–12:00." precisa estar à vista enquanto a pessoa corrige a data.
    onError: (e) => setErro(mensagemDoErro(e, 'Não foi possível salvar. Tente de novo.')),
  });

  const limparErro = () => setErro(null);
  const setLinha = (chave: number, campo: keyof Omit<Linha, 'chave'>, valor: string) => {
    limparErro();
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  };
  // Propõe o próximo dia útil com o mesmo horário da linha anterior. Copiar a
  // MESMA data (como era) só servia para gerar duplicata.
  const addLinha = () => {
    limparErro();
    setLinhas((ls) => {
      const ultima = ls[ls.length - 1];
      return [...ls, novaLinha(proximoDiaUtil(ultima?.data || inicio), ultima?.horaInicio, ultima?.horaFim)];
    });
  };
  const remLinha = (chave: number) => setLinhas((ls) => (ls.length > 1 ? ls.filter((l) => l.chave !== chave) : ls));

  const alternarDia = (v: number) => {
    limparErro();
    setDias((ds) => (ds.includes(v) ? ds.filter((x) => x !== v) : [...ds, v].sort((a, b) => a - b)));
  };
  const alternarData = (d: string) => {
    limparErro();
    setDesmarcadas((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]));
  };
  const mudarDe = (v: string) => {
    limparErro();
    setDe(v);
    if (v && ate && ate < v) setAte(ultimoDiaDoMes(v));
  };

  function problemaDoPedido(): string | null {
    if (!advogadoId) return 'Escolha quem vai ficar de plantão.';
    if (modo === 'repetir') {
      if (dias.length === 0) return 'Escolha ao menos um dia da semana.';
      if (!de || !ate || de > ate) return 'O período precisa começar antes de terminar.';
      if (!horaInicio || !horaFim || horaFim <= horaInicio) return 'A hora de fim deve ser depois da de início.';
      if (qtd === 0) {
        return geradas.length ? 'Todas as datas foram desmarcadas.' : 'Nenhum dia do período cai nos dias escolhidos.';
      }
    } else {
      if (qtd === 0) return 'Informe ao menos uma data.';
      const ruim = linhas.find((l) => l.data && (!l.horaInicio || !l.horaFim || l.horaFim <= l.horaInicio));
      if (ruim) return `Em ${diaCurto(ruim.data)}, a hora de fim deve ser depois da de início.`;
    }
    if (passouDoLimite) {
      return `São ${qtd} datas; o máximo por vez é ${MAXIMO_DE_DATAS_POR_VEZ}. Encurte o período ou cadastre em duas vezes.`;
    }
    return null;
  }

  function submeter() {
    const problema = problemaDoPedido();
    if (problema) return setErro(problema);
    setErro(null);
    salvar.mutate(itens);
  }

  const botaoModo = (valor: Modo, rotulo: string, Icone: typeof Repeat) => (
    <button
      type="button"
      aria-pressed={modo === valor}
      onClick={() => { limparErro(); setModo(valor); }}
      className={cn(
        'flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors md:min-h-[36px]',
        modo === valor ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <Icone className="h-4 w-4" /> {rotulo}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nova-escala-titulo"
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <CalendarClock className="h-5 w-5 text-brand-800 dark:text-brand-400" />
            </div>
            <div className="min-w-0">
              <h3 id="nova-escala-titulo" className="text-lg font-bold">Cadastrar plantões</h3>
              <p className="text-sm text-muted-foreground">Escolha a pessoa e os dias. Dá para repetir toda semana.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvar.isPending}
            aria-label="Fechar"
            className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Pessoa */}
          <div className="space-y-1.5">
            <label htmlFor="nova-escala-pessoa" className="text-sm font-medium">Quem fica de plantão *</label>
            <SeletorDePessoa
              id="nova-escala-pessoa"
              value={advogadoId}
              onChange={(v) => { limparErro(); setAdvogadoId(v); }}
              pessoas={advogados.data ?? []}
              carregando={advogados.isLoading}
              placeholder="Escolher pessoa…"
            />
            {advogados.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Não deu para carregar a equipe. Feche e abra de novo.
              </p>
            )}
          </div>

          {/* Modo */}
          <div role="group" aria-label="Como cadastrar" className="flex rounded-lg border border-input bg-background p-1">
            {botaoModo('avulsas', 'Datas avulsas', CalendarPlus)}
            {botaoModo('repetir', 'Repetir toda semana', Repeat)}
          </div>

          {modo === 'avulsas' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Datas e horários</span>
                <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={addLinha}>
                  <Plus className="h-4 w-4" /> Adicionar data
                </Button>
              </div>

              <div className="hidden grid-cols-[1fr_auto_auto_1fr_auto] items-center gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
                <span>Data *</span><span>Início *</span><span>Fim *</span><span>Observação</span><span />
              </div>

              {linhas.map((l) => (
                <div
                  key={l.chave}
                  className="grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_auto_auto_1fr_auto] sm:border-0 sm:p-0"
                >
                  <Input type="date" aria-label="Data" value={l.data} onChange={(e) => setLinha(l.chave, 'data', e.target.value)} className="col-span-2 sm:col-span-1" />
                  <Input type="time" aria-label="Início" value={l.horaInicio} onChange={(e) => setLinha(l.chave, 'horaInicio', e.target.value)} className="w-full sm:w-24" />
                  <Input type="time" aria-label="Fim" value={l.horaFim} onChange={(e) => setLinha(l.chave, 'horaFim', e.target.value)} className="w-full sm:w-24" />
                  <Input placeholder="Observação (opcional)" maxLength={OBSERVACAO_MAX} value={l.observacao} onChange={(e) => setLinha(l.chave, 'observacao', e.target.value)} className="col-span-2 sm:col-span-1" />
                  <button
                    type="button"
                    onClick={() => remLinha(l.chave)}
                    disabled={linhas.length === 1}
                    aria-label={l.data ? `Remover ${diaCurto(l.data)}` : 'Remover data'}
                    className="col-span-2 flex h-11 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/30 sm:col-span-1 sm:h-10 sm:w-10"
                  >
                    <X className="h-4 w-4" /><span className="sm:hidden">Remover</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Nos dias *</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {DIAS_UTEIS.map((d) => {
                    const ativo = dias.includes(d.valor);
                    return (
                      <button
                        key={d.valor}
                        type="button"
                        aria-pressed={ativo}
                        aria-label={d.longo}
                        onClick={() => alternarDia(d.valor)}
                        className={cn(
                          'h-11 rounded-md border text-sm font-medium transition-colors md:h-10',
                          ativo ? 'border-brand-800 bg-brand-800 text-white' : 'border-input hover:bg-muted',
                        )}
                      >
                        {d.curto}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="rep-inicio" className="text-sm font-medium">Início *</label>
                  <Input id="rep-inicio" type="time" value={horaInicio} onChange={(e) => { limparErro(); setHoraInicio(e.target.value); }} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="rep-fim" className="text-sm font-medium">Fim *</label>
                  <Input id="rep-fim" type="time" value={horaFim} onChange={(e) => { limparErro(); setHoraFim(e.target.value); }} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="rep-de" className="text-sm font-medium">De *</label>
                  <Input id="rep-de" type="date" value={de} onChange={(e) => mudarDe(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="rep-ate" className="text-sm font-medium">Até *</label>
                  <Input id="rep-ate" type="date" min={de || undefined} value={ate} onChange={(e) => { limparErro(); setAte(e.target.value); }} />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="rep-obs" className="text-sm font-medium">Observação</label>
                <Input id="rep-obs" placeholder="Opcional, vale para todas as datas" maxLength={OBSERVACAO_MAX} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
              </div>

              {/* Prévia: o que vai ser gravado é exatamente esta lista. */}
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold">Datas que vão ser cadastradas</span>
                  {geradas.length > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {marcadas.length} de {geradas.length}
                    </span>
                  )}
                </div>
                {geradas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {dias.length === 0 ? 'Escolha os dias da semana para ver as datas.' : 'Nenhum dia do período cai nos dias escolhidos.'}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">Desmarque os feriados e os dias sem plantão.</p>
                    <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                      {geradas.map((d) => {
                        const marcada = !desmarcadas.includes(d);
                        return (
                          <label
                            key={d}
                            className={cn(
                              'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 text-sm md:min-h-[40px]',
                              marcada ? 'border-input' : 'border-dashed text-muted-foreground',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() => alternarData(d)}
                              className="h-4 w-4 shrink-0 accent-brand-700"
                            />
                            <span className={cn('tabular-nums', !marcada && 'line-through')}>{rotuloDaData(d)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}
                {passouDoLimite && (
                  <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                    São {qtd} datas; o máximo por vez é {MAXIMO_DE_DATAS_POR_VEZ}. Encurte o período ou cadastre em duas vezes.
                  </p>
                )}
              </div>
            </div>
          )}

          {erro && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {erro}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button className="flex-1 sm:flex-none" onClick={submeter} disabled={salvar.isPending || qtd === 0}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar {contar(qtd, 'plantão', 'plantões')}
          </Button>
        </div>
      </div>
    </div>
  );
}
