'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Search, Loader2, User, Save, CalendarClock, MapPin, Gavel, AlertTriangle, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvisoDeChoque } from '@/components/agenda/aviso-de-choque';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import { SeletorProcesso } from '@/components/processos/seletor-processo';
import {
  criarCompromisso, atualizarCompromisso, listarResponsaveis,
  Compromisso, TipoCompromisso, formatData,
} from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { V } from '@/lib/vocabulario';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

function splitLocal(iso?: string | null) {
  if (!iso) return { data: '', hora: '' };
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return { data: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hora: `${p(d.getHours())}:${p(d.getMinutes())}` };
}
function combinar(data: string, hora: string): string | null {
  if (!data) return null;
  const dt = new Date(`${data}T${hora || '00:00'}`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function CompromissoFormModal({
  open, onClose, onSalvo, editar, pre,
}: {
  open: boolean;
  onClose: () => void;
  onSalvo: () => void;
  editar?: Compromisso | null;
  pre?: { filiadoId?: string; filiadoNome?: string; atendimentoId?: string } | null;
}) {
  const { user } = useAuth();
  const ehEdicao = !!editar;

  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoCompromisso>('AUDIENCIA');
  const [responsavelId, setResponsavelId] = useState('');
  const [inicioData, setInicioData] = useState('');
  const [inicioHora, setInicioHora] = useState('');
  const [fimData, setFimData] = useState('');
  const [fimHora, setFimHora] = useState('');
  const [local, setLocal] = useState('');
  const [descricao, setDescricao] = useState('');
  const [obsInternas, setObsInternas] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [urgenteMotivo, setUrgenteMotivo] = useState('');
  /** Participantes ALEM do responsavel - ver `equipe.util.ts` na API. */
  const [participantes, setParticipantes] = useState<string[]>([]);
  const [filiadoId, setFiliadoId] = useState('');
  const [filiadoNome, setFiliadoNome] = useState('');
  const [processoId, setProcessoId] = useState('');
  const [atendimentoId, setAtendimentoId] = useState('');

  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  const { tipos } = useTiposEvento();
  const responsaveis = useQuery({ queryKey: ['compromissos-responsaveis'], queryFn: listarResponsaveis, enabled: open });

  useEffect(() => {
    if (!open) return;
    if (editar) {
      const i = splitLocal(editar.inicio);
      const f = splitLocal(editar.fim);
      setTitulo(editar.titulo); setTipo(editar.tipo); setResponsavelId(editar.responsavel.id);
      setInicioData(i.data); setInicioHora(i.hora); setFimData(f.data); setFimHora(f.hora);
      setLocal(editar.local ?? ''); setDescricao(editar.descricao ?? '');
      setObsInternas(''); setUrgente(editar.urgente);
      setUrgenteMotivo(editar.urgenteMotivo ?? '');
      setParticipantes(
        (editar.equipe ?? []).filter((e) => !e.principal).map((e) => e.usuario.id),
      );
      setFiliadoId(editar.filiado?.id ?? ''); setFiliadoNome(editar.filiado?.nomeCompleto ?? '');
      setProcessoId(editar.processo?.id ?? ''); setAtendimentoId(editar.atendimentoId ?? '');
    } else {
      const agora = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      setTitulo(''); setTipo('AUDIENCIA'); setResponsavelId(user?.id ?? '');
      setInicioData(`${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`);
      setInicioHora(`${p(agora.getHours())}:00`);
      setFimData(''); setFimHora('');
      setLocal(''); setDescricao(''); setObsInternas(''); setUrgente(false);
      setFiliadoId(pre?.filiadoId ?? ''); setFiliadoNome(pre?.filiadoNome ?? '');
      setProcessoId(''); setAtendimentoId(pre?.atendimentoId ?? '');
    }
    setBusca(''); setResultados([]);
  }, [open, editar, pre, user]);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      try { setResultados(await buscarFiliados(termo)); } catch { setResultados([]); } finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const salvar = useMutation({
    mutationFn: () => {
      const inicio = combinar(inicioData, inicioHora)!;
      const fim = fimData ? combinar(fimData, fimHora || inicioHora)! : new Date(new Date(inicio).getTime() + 3600_000).toISOString();
      const dto = {
        titulo: titulo.trim(), tipo, inicio, fim,
        local: local.trim() || undefined,
        descricao: descricao.trim() || undefined,
        observacoesInternas: obsInternas.trim() || undefined,
        urgente,
        urgenteMotivo: urgente ? urgenteMotivo.trim() || undefined : undefined,
        responsavelId,
        responsaveisIds: participantes,
        filiadoId: filiadoId || undefined,
        processoId: processoId || undefined,
        atendimentoId: atendimentoId || undefined,
      };
      return ehEdicao ? atualizarCompromisso(editar!.id, dto) : criarCompromisso(dto);
    },
    onSuccess: () => {
      toast.success(ehEdicao ? 'Evento atualizado.' : 'Evento criado na agenda.');
      onSalvo();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível salvar o evento.'),
  });

  function submeter() {
    if (titulo.trim().length < 2) return toast.error('Informe o título.');
    if (!responsavelId) return toast.error('Selecione o responsável.');
    // A API recusa urgencia sem motivo; barrar aqui evita a viagem e devolve o
    // foco ao campo certo, em vez de um toast generico vindo do servidor.
    if (urgente && !urgenteMotivo.trim()) {
      return toast.error('Diga por que é urgente — sem motivo, a marca não pode ser revista depois.');
    }
    const inicio = combinar(inicioData, inicioHora);
    if (!inicio) return toast.error('Informe a data e hora de início.');
    if (fimData) {
      const fim = combinar(fimData, fimHora || inicioHora);
      if (fim && new Date(fim) < new Date(inicio)) return toast.error('O fim não pode ser antes do início.');
    }
    salvar.mutate();
  }

  const remarcaAviso = ehEdicao && editar && !editar.dataOriginal && combinar(inicioData, inicioHora) !== editar.inicio;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvar.isPending ? undefined : onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
              <CalendarClock className="h-5 w-5 text-brand-800 dark:text-brand-400" />
            </div>
            <h3 className="text-lg font-bold">{ehEdicao ? 'Editar Evento' : 'Novo Evento na Agenda'}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Título */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Título *</label>
            <Input placeholder="Ex: Audiência inaugural — João Silva x Município" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus />
          </div>

          {/* Tipo + Responsável */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tipo *</label>
              <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoCompromisso)}>
                {tipos.map((t) => <option key={t.id} value={t.slug}>{t.nome}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium"><Users className="h-4 w-4 text-muted-foreground" /> Responsável *</label>
              <select className={inputCls} value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
                <option value="">Selecione…</option>
                {(responsaveis.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">
                Quem <strong>responde</strong> pela atividade. Só ele conclui.
              </p>
            </div>
          </div>

          {/*
            EQUIPE — o segundo advogado da audiência, quem protocola o prazo,
            o estagiário que acompanha a diligência.

            Separado do responsável de propósito: se todos forem responsáveis,
            ninguém é, e a cobrança deixa de ter destinatário. Quem está aqui vê
            a atividade na própria agenda e conta na carga de trabalho.
          */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Users className="h-4 w-4 text-muted-foreground" /> Também atuam nesta atividade
            </label>
            <div className="flex flex-wrap gap-1.5 rounded-lg border p-2">
              {(responsaveis.data ?? [])
                .filter((r) => r.id !== responsavelId)
                .map((r) => {
                  const dentro = participantes.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={dentro}
                      onClick={() =>
                        setParticipantes((ps) =>
                          dentro ? ps.filter((i) => i !== r.id) : [...ps, r.id],
                        )
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        dentro
                          ? 'border-brand-600 bg-brand-50 font-medium text-brand-800 dark:bg-brand-900/30 dark:text-brand-300'
                          : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {r.nome}
                    </button>
                  );
                })}
              {(responsaveis.data ?? []).filter((r) => r.id !== responsavelId).length === 0 && (
                <span className="px-1 py-0.5 text-xs text-muted-foreground">
                  Não há outros colaboradores para incluir.
                </span>
              )}
            </div>
            {participantes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {participantes.length === 1 ? '1 participante' : `${participantes.length} participantes`}
                {' '}veem esta atividade na própria agenda.
              </p>
            )}
          </div>

          {/* Data e Hora */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Data e Hora</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Início *</p>
                <div className="flex gap-2">
                  <Input type="date" value={inicioData} onChange={(e) => setInicioData(e.target.value)} />
                  <Input type="time" value={inicioHora} onChange={(e) => setInicioHora(e.target.value)} className="w-28" />
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Fim (opcional)</p>
                <div className="flex gap-2">
                  <Input type="date" value={fimData} onChange={(e) => setFimData(e.target.value)} />
                  <Input type="time" value={fimHora} onChange={(e) => setFimHora(e.target.value)} className="w-28" />
                </div>
              </div>
            </div>
            {/*
              CHOQUE DE HORÁRIO — logo abaixo das datas, que é onde a decisão
              está sendo tomada. Avisa enquanto se preenche; descobrir depois de
              salvar significaria voltar, apagar e refazer.
            */}
            <AvisoDeChoque
              responsavelId={responsavelId}
              inicio={combinar(inicioData, inicioHora)}
              fim={
                fimData
                  ? combinar(fimData, fimHora || inicioHora)
                  : /*
                      Sem fim informado, o back assume uma hora — o aviso tem de
                      assumir a MESMA coisa, senão ele confere um intervalo que
                      não é o que vai ser gravado.
                    */
                    (() => {
                      const i = combinar(inicioData, inicioHora);
                      return i ? new Date(new Date(i).getTime() + 3600_000).toISOString() : null;
                    })()
              }
              ignorarId={editar?.id}
            />

            {remarcaAviso && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
                Alterar a data registra uma <strong>remarcação</strong> e trava a data original ({formatData(editar!.inicio)}) para auditoria.
              </p>
            )}
          </div>

          {/* Local */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium"><MapPin className="h-4 w-4 text-muted-foreground" /> Local</label>
            <Input placeholder="Ex: 1ª Vara do Trabalho de Teresina" value={local} onChange={(e) => setLocal(e.target.value)} />
          </div>

          {/* Filiado vinculado */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium"><User className="h-4 w-4 text-muted-foreground" /> {V.Filiado} / Pessoa Vinculada</label>
            {filiadoNome ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2.5">
                <span className="truncate text-sm font-medium">{filiadoNome}</span>
                <button type="button" onClick={() => { setFiliadoId(''); setFiliadoNome(''); setProcessoId(''); }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder={`Selecionar ${V.filiado}…`} value={busca} onChange={(e) => setBusca(e.target.value)} />
                {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
                {resultados.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-card shadow-lg">
                    {resultados.map((f) => (
                      <li key={f.id}>
                        <button type="button" onClick={() => { setFiliadoId(f.id); setFiliadoNome(f.nome); setBusca(''); setResultados([]); }} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted">
                          <span className="font-medium">{f.nome}</span>
                          <span className="text-xs text-muted-foreground">{f.cpfMascarado}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Processo vinculado */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium"><Gavel className="h-4 w-4 text-muted-foreground" /> Processo Vinculado</label>
            {/* Mesmo seletor da conclusão: os processos do filiado escolhido
                vêm primeiro, e a busca alcança o acervo inteiro. O `<select>`
                anterior listava no máximo 50 e não tinha como procurar. */}
            <SeletorProcesso
              valor={processoId}
              onChange={setProcessoId}
              filiadoId={filiadoId || undefined}
              filiadoNome={filiadoNome || undefined}
            />
          </div>

          {/* Descrição + Obs internas */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Descrição</label>
            <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm" placeholder="Detalhes sobre o evento…" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          {!ehEdicao && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Observações Internas <span className="font-normal text-muted-foreground">(não visíveis ao {V.filiado})</span></label>
              <textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm" placeholder="Notas para uso interno da equipe jurídica…" value={obsInternas} onChange={(e) => setObsInternas(e.target.value)} />
            </div>
          )}

          {/*
            URGENTE — e POR QUÊ.

            O motivo aparece só depois de ligar a chave, e é obrigatório. Não é
            burocracia: urgência sem justificativa não se revisa, ninguém
            desmarca, e em poucos meses metade da fila está urgente — que é o
            mesmo que nada estar. O campo é a diferença entre um selo decorativo
            e uma fila de trabalho que dá para auditar.
          */}
          <div className={cn('rounded-lg border transition-colors', urgente && 'border-red-300 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20')}>
            <button
              type="button"
              onClick={() => setUrgente((v) => !v)}
              className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-muted/40"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className={cn('h-4 w-4', urgente ? 'text-red-600' : 'text-muted-foreground')} /> Marcar como Urgente
              </span>
              <span className={cn('relative h-6 w-11 rounded-full transition-colors', urgente ? 'bg-red-600' : 'bg-muted')}>
                <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', urgente ? 'left-[22px]' : 'left-0.5')} />
              </span>
            </button>
            {urgente && (
              <div className="space-y-1 border-t border-red-200 p-3 dark:border-red-900/50">
                <label className="text-xs font-medium text-red-900 dark:text-red-300">
                  Por que é urgente? *
                </label>
                <Input
                  autoFocus
                  maxLength={300}
                  value={urgenteMotivo}
                  onChange={(e) => setUrgenteMotivo(e.target.value)}
                  placeholder="Ex.: prazo fatal na sexta; filiado em risco de demissão"
                />
                <p className="text-[11px] text-red-800/80 dark:text-red-400/80">
                  Aparece no selo e permite revisar a fila depois.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={submeter} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {ehEdicao ? 'Salvar' : 'Criar Evento'}
          </Button>
        </div>
      </div>
    </div>
  );
}
