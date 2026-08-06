'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2, FilePlus2, Gavel, Link2, Loader2, Scale, X,
  Handshake, FileCheck2, AlertTriangle, UserX,
  PhoneCall, PhoneOff, ClipboardCheck, CalendarClock, CircleSlash, CalendarPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SeletorProcesso } from '@/components/processos/seletor-processo';
import {
  concluirCompromisso, listarResponsaveis, listarDesfechos,
  type Compromisso, type DesfechoOpcao,
} from '@/lib/agenda';

const inputCls = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm md:h-10';

/** Ícone por desfecho; o que não estiver aqui usa o genérico. */
const ICONE: Record<string, typeof CheckCircle2> = {
  DUVIDA_ESCLARECIDA: CheckCircle2,
  VINCULADO_PROCESSO: Link2,
  PROCESSO_CRIADO: FilePlus2,
  AUDIENCIA_ACORDO: Handshake,
  AUDIENCIA_SEM_ACORDO: Gavel,
  AUDIENCIA_INSTRUCAO: Gavel,
  PRAZO_CUMPRIDO: FileCheck2,
  PRAZO_PERDIDO: AlertTriangle,
  DILIGENCIA_INFRUTIFERA: AlertTriangle,
  DESPACHO_NAO_ATENDIDO: AlertTriangle,
  PERICIA_REALIZADA: CalendarClock,
  PERICIA_LAUDO_ENTREGUE: FileCheck2,
  CONTATO_CONFIRMADO: PhoneCall,
  CONTATO_NAO_COMPARECERA: UserX,
  CONTATO_SEM_SUCESSO: PhoneOff,
  ACOMPANHAMENTO_CUMPRIDO: ClipboardCheck,
  ACOMPANHAMENTO_PENDENTE: CalendarClock,
  ACOMPANHAMENTO_SEM_OBJETO: CircleSlash,
};

/** `<input type="date">` quer yyyy-mm-dd no fuso local, não em UTC. */
function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Concluir com DESFECHO — fecha o ciclo da demanda em vez de só sumir com o
 * card. É aqui que a consulta vira histórico ("dúvida esclarecida" + o que foi
 * orientado), se liga a um processo existente, ou abre um processo novo em
 * RASCUNHO para o advogado formalizar depois.
 */
export function ConcluirModal({
  compromisso, open, onClose, onConcluido, onNaoCompareceu,
}: {
  compromisso: Compromisso | null;
  open: boolean;
  onClose: () => void;
  onConcluido: (rascunho: { id: string; titulo: string | null } | null) => void;
  /** Leva ao cancelamento com "não compareceu" pré-selecionado. */
  onNaoCompareceu?: () => void;
}) {
  const [desfecho, setDesfecho] = useState<string>('');
  const [obs, setObs] = useState('');
  const [processoId, setProcessoId] = useState('');
  // Campos do rascunho
  const [titulo, setTitulo] = useState('');
  const [assunto, setAssunto] = useState('');
  const [advogadoId, setAdvogadoId] = useState('');
  // Campos da atividade de seguimento (desfechos com pendência declarada)
  const [criarSeg, setCriarSeg] = useState(true);
  const [segTitulo, setSegTitulo] = useState('');
  const [segResponsavelId, setSegResponsavelId] = useState('');
  const [segData, setSegData] = useState('');

  // As opções vêm do TIPO da atividade: audiência oferece "houve acordo",
  // prazo oferece "prazo perdido". Quem sabe disso é a API.
  const opcoes = useQuery({
    queryKey: ['desfechos-tipo', compromisso?.tipo],
    queryFn: () => listarDesfechos(compromisso!.tipo),
    enabled: open && !!compromisso,
  });
  const lista: DesfechoOpcao[] = opcoes.data ?? [];
  const escolhido = lista.find((o) => o.slug === desfecho);

  // Primeira opção do tipo = a esperada; pré-seleciona quando a lista chega.
  useEffect(() => {
    if (lista.length && !lista.some((o) => o.slug === desfecho)) setDesfecho(lista[0].slug);
  }, [lista, desfecho]);

  useEffect(() => {
    if (!open || !compromisso) return;
    setDesfecho('');
    setObs('');
    setProcessoId(compromisso.processo?.id ?? '');
    setTitulo(compromisso.titulo);
    setAssunto('');
    setAdvogadoId(compromisso.responsavel.id);
  }, [open, compromisso]);

  // Cada desfecho traz o seu próprio seguimento sugerido (tipo, título, prazo).
  // Repõe os padrões a cada troca de desfecho para não carregar o título de um
  // encaminhamento para dentro de uma cobrança de laudo.
  const spec = escolhido?.acao === 'CRIAR_ATIVIDADE' ? escolhido.seguimento : undefined;
  useEffect(() => {
    if (!spec || !compromisso) return;
    const data = new Date();
    data.setDate(data.getDate() + spec.emDias);
    setCriarSeg(true);
    setSegTitulo(spec.titulo);
    setSegResponsavelId(compromisso.responsavel.id);
    setSegData(diaLocal(data));
  }, [spec, compromisso]);

  const advogados = useQuery({
    queryKey: ['compromissos-responsaveis'],
    queryFn: listarResponsaveis,
    enabled: open && (escolhido?.acao === 'CRIAR_PROCESSO' || escolhido?.acao === 'CRIAR_ATIVIDADE'),
  });

  const salvar = useMutation({
    mutationFn: () =>
      concluirCompromisso(compromisso!.id, {
        desfecho,
        desfechoObs: obs.trim() || undefined,
        ...(escolhido?.acao === 'VINCULAR_PROCESSO' ? { processoId } : {}),
        ...(escolhido?.acao === 'CRIAR_PROCESSO'
          ? {
              novoProcesso: {
                titulo: titulo.trim() || undefined,
                assunto: assunto.trim() || undefined,
                advogadoId: advogadoId || undefined,
                observacao: obs.trim() || undefined,
              },
            }
          : {}),
        ...(spec
          ? {
              criarSeguimento: criarSeg,
              ...(criarSeg
                ? {
                    seguimento: {
                      titulo: segTitulo.trim() || undefined,
                      responsavelId: segResponsavelId || undefined,
                      // Offset explícito: sem ele o servidor interpretaria a
                      // data no fuso DELE e a tarefa cairia no dia anterior.
                      inicio: segData ? `${segData}T09:00:00-03:00` : undefined,
                    },
                  }
                : {}),
            }
          : {}),
      }),
    onSuccess: (resp) => {
      toast.success(
        resp.rascunhoCriado
          ? 'Atividade concluída e processo aberto em rascunho.'
          : resp.seguimentoCriado
            ? `Atividade concluída. Seguimento agendado: "${resp.seguimentoCriado.titulo}".`
            : 'Atividade concluída.',
      );
      onConcluido(resp.rascunhoCriado);
      onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível concluir.');
    },
  });

  const exigeObs = !!escolhido?.exigeObs;
  const valido = useMemo(() => {
    if (!escolhido) return false;
    if (exigeObs && obs.trim().length < 3) return false;
    if (escolhido.acao === 'VINCULAR_PROCESSO' && !processoId) return false;
    if (spec && criarSeg && (!segTitulo.trim() || !segData)) return false;
    return true;
  }, [escolhido, exigeObs, obs, processoId, spec, criarSeg, segTitulo, segData]);

  if (!open || !compromisso) return null;

  const semFiliado = !compromisso.filiado;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={salvar.isPending ? undefined : onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30">
              <CheckCircle2 className="h-4.5 w-4.5 text-emerald-700 dark:text-emerald-400" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold">Concluir atividade</h3>
              <p className="truncate text-xs text-muted-foreground">{compromisso.titulo}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {compromisso.filiado && (
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Filiado: </span>
              <strong>{compromisso.filiado.nomeCompleto}</strong>
            </div>
          )}

          {/* Escolha do desfecho */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">O que aconteceu? *</label>
            {opcoes.isLoading && (
              <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando opções…
              </p>
            )}
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {lista.map((o) => {
                const Icon = ICONE[o.slug] ?? Scale;
                const ativo = desfecho === o.slug;
                return (
                  <button
                    key={o.slug}
                    type="button"
                    onClick={() => setDesfecho(o.slug)}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border p-2.5 text-left transition',
                      ativo
                        ? o.alerta
                          ? 'border-red-400 bg-red-50 dark:bg-red-950/20'
                          : 'border-senatepi-500 bg-senatepi-50 dark:bg-senatepi-900/20'
                        : 'hover:bg-muted/50',
                    )}
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        o.alerta
                          ? 'text-red-600 dark:text-red-400'
                          : ativo
                            ? 'text-senatepi-700 dark:text-senatepi-400'
                            : 'text-muted-foreground',
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">
                        {o.ajuda}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* "Não compareceu" saiu daqui: quem não veio não realizou a
                atividade. O caminho certo é cancelar, informando o motivo. */}
            {onNaoCompareceu && (
              <button
                type="button"
                onClick={() => { onClose(); onNaoCompareceu(); }}
                className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed p-2.5 text-left text-muted-foreground transition hover:bg-muted/50"
              >
                <UserX className="h-4 w-4 shrink-0" />
                <span className="text-xs">
                  <strong className="font-medium">O filiado não compareceu?</strong> Então a
                  atividade não aconteceu — cancele informando o motivo.
                </span>
              </button>
            )}
          </div>

          {/* Vincular a processo existente */}
          {escolhido?.acao === 'VINCULAR_PROCESSO' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Processo *</label>
              <SeletorProcesso
                valor={processoId}
                onChange={setProcessoId}
                filiadoId={compromisso.filiado?.id}
                filiadoNome={compromisso.filiado?.nomeCompleto}
              />
              {semFiliado ? (
                // Antes esta situação era um beco sem saída: sem filiado, a lista
                // ficava vazia e o desfecho, impossível de concluir. Agora a busca
                // continua disponível — o aviso só explica por que não há
                // sugestão pronta.
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Esta atividade não tem filiado vinculado, então não há processos sugeridos —
                  use a busca acima para encontrar o processo.
                </p>
              ) : (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Os processos do filiado aparecem primeiro. Digite para procurar em todo o
                  acervo, ou use <strong>Virou processo novo</strong> se ele ainda não existe.
                </p>
              )}
            </div>
          )}

          {/* Rascunho de processo novo */}
          {escolhido?.acao === 'CRIAR_PROCESSO' && (
            <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/40 dark:bg-violet-950/10">
              <p className="text-xs text-violet-900 dark:text-violet-300">
                O processo será criado em <strong>rascunho</strong>, sem número. Ele aparece no módulo
                de Processos para o advogado formalizar quando quiser — informando o NPU e puxando do
                DataJud, ou preenchendo à mão.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Identificação do rascunho</label>
                <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Ação de adicional de insalubridade" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Assunto <span className="opacity-70">(opcional)</span>
                </label>
                <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Ex.: Insalubridade / Adicional" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Advogado responsável</label>
                <select className={inputCls} value={advogadoId} onChange={(e) => setAdvogadoId(e.target.value)}>
                  {(advogados.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>
                  ))}
                </select>
              </div>
              {compromisso.filiado && (
                <p className="text-[11px] text-muted-foreground">
                  <strong>{compromisso.filiado.nomeCompleto}</strong> entra como autor do processo.
                </p>
              )}
            </div>
          )}

          {/* Atividade de seguimento — a pendência que este desfecho declara */}
          {spec && (
            <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/10">
              <div className="flex items-start gap-2">
                <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700 dark:text-indigo-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
                    {spec.obrigatorio ? 'Este desfecho gera uma tarefa' : 'Gerar tarefa de acompanhamento?'}
                  </p>
                  <p className="text-[11px] leading-snug text-indigo-800/80 dark:text-indigo-300/80">
                    {spec.obrigatorio
                      ? 'A pendência precisa de dono e data — sem isso ela vira só um texto que ninguém relê.'
                      : 'Desmarque se não sobrou nada a acompanhar.'}
                  </p>
                </div>
                {!spec.obrigatorio && (
                  <input
                    type="checkbox"
                    checked={criarSeg}
                    onChange={(e) => setCriarSeg(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
                    aria-label="Criar atividade de acompanhamento"
                  />
                )}
              </div>

              {criarSeg && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">O que precisa ser feito *</label>
                    <Input
                      value={segTitulo}
                      onChange={(e) => setSegTitulo(e.target.value)}
                      placeholder="Ex.: Cobrar laudo pericial"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Para quando *</label>
                      <input
                        type="date"
                        className={inputCls}
                        value={segData}
                        onChange={(e) => setSegData(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Responsável</label>
                      <select
                        className={inputCls}
                        value={segResponsavelId}
                        onChange={(e) => setSegResponsavelId(e.target.value)}
                      >
                        {(advogados.data ?? []).map((a) => (
                          <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    A tarefa herda o filiado e o processo desta atividade.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Comentário */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {desfecho === 'DUVIDA_ESCLARECIDA'
                ? 'O que foi orientado ao filiado?'
                : desfecho === 'PROCESSO_CRIADO'
                  ? 'Observação inicial do processo'
                  : 'Observação'}
              {exigeObs ? ' *' : <span className="font-normal text-muted-foreground"> (opcional)</span>}
            </label>
            <textarea
              className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder={
                desfecho === 'DUVIDA_ESCLARECIDA'
                  ? 'Descreva a orientação dada — é o que vai constar no histórico do filiado.'
                  : desfecho === 'PROCESSO_CRIADO'
                    ? 'O que foi combinado. Vira o primeiro andamento interno do processo.'
                    : 'Anote o que for relevante…'
              }
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
            {escolhido?.acao === 'CRIAR_PROCESSO' && (
              <p className="text-[11px] text-muted-foreground">
                Este texto é gravado como o primeiro andamento interno do processo.
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !valido}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {desfecho === 'PROCESSO_CRIADO' ? 'Concluir e criar rascunho' : 'Concluir'}
          </Button>
        </div>
      </div>
    </div>
  );
}
