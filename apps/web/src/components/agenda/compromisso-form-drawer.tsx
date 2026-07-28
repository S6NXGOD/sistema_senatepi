'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Search, Loader2, User, Save, Link2 } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import { listarAtendimentos, CANAL_LABEL, DESFECHO_LABEL } from '@/lib/atendimentos';
import {
  criarCompromisso, atualizarCompromisso, listarResponsaveis,
  Compromisso, TipoCompromisso, StatusCompromisso, TIPOS, TIPO_LABEL,
  STATUS_ORDEM, STATUS_LABEL, paraInputLocal, formatData,
} from '@/lib/agenda';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

function maisUmaHora(base: Date, horas: number) {
  return paraInputLocal(new Date(base.getTime() + horas * 3600_000).toISOString());
}

export function CompromissoFormDrawer({
  open, onClose, onSalvo, editar, filiadoPre,
}: {
  open: boolean;
  onClose: () => void;
  onSalvo: () => void;
  editar?: Compromisso | null;
  filiadoPre?: { id: string; nomeCompleto: string; atendimentoId?: string } | null;
}) {
  const { user } = useAuth();
  const ehEdicao = !!editar;

  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<TipoCompromisso>('AUDIENCIA');
  const [status, setStatus] = useState<StatusCompromisso>('PENDENTE');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [descricao, setDescricao] = useState('');
  const [responsavelId, setResponsavelId] = useState('');
  const [filiadoId, setFiliadoId] = useState('');
  const [filiadoNome, setFiliadoNome] = useState('');
  const [atendimentoId, setAtendimentoId] = useState('');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  const responsaveis = useQuery({ queryKey: ['compromissos-responsaveis'], queryFn: listarResponsaveis, enabled: open });

  // Atendimentos do filiado selecionado (para vincular a triagem de origem).
  const atendimentos = useQuery({
    queryKey: ['atendimentos-filiado-link', filiadoNome, filiadoId],
    queryFn: async () => (await listarAtendimentos({ busca: filiadoNome, pageSize: 50 })).items.filter((a) => a.filiado.id === filiadoId),
    enabled: open && !!filiadoId && !!filiadoNome,
  });

  useEffect(() => {
    if (!open) return;
    const agora = new Date();
    if (editar) {
      setTitulo(editar.titulo); setTipo(editar.tipo); setStatus(editar.status);
      setInicio(paraInputLocal(editar.inicio)); setFim(paraInputLocal(editar.fim));
      setDescricao(editar.descricao ?? '');
      setResponsavelId(editar.responsavel.id);
      setFiliadoId(editar.filiado?.id ?? ''); setFiliadoNome(editar.filiado?.nomeCompleto ?? '');
      setAtendimentoId(editar.atendimentoId ?? '');
    } else {
      setTitulo(''); setTipo('AUDIENCIA'); setStatus('PENDENTE');
      setInicio(paraInputLocal(agora.toISOString())); setFim(maisUmaHora(agora, 1));
      setDescricao(''); setResponsavelId(user?.id ?? '');
      setFiliadoId(filiadoPre?.id ?? ''); setFiliadoNome(filiadoPre?.nomeCompleto ?? '');
      setAtendimentoId(filiadoPre?.atendimentoId ?? '');
    }
    setBusca(''); setResultados([]);
  }, [open, editar, filiadoPre, user]);

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
      const dto = {
        titulo: titulo.trim(),
        tipo,
        status,
        inicio: new Date(inicio).toISOString(),
        fim: new Date(fim).toISOString(),
        descricao: descricao.trim() || undefined,
        responsavelId,
        filiadoId: filiadoId || undefined,
        atendimentoId: atendimentoId || undefined,
      };
      return ehEdicao ? atualizarCompromisso(editar!.id, dto) : criarCompromisso(dto);
    },
    onSuccess: () => {
      toast.success(ehEdicao ? 'Compromisso atualizado.' : 'Compromisso criado.');
      onSalvo();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível salvar.'),
  });

  function submeter() {
    if (titulo.trim().length < 2) return toast.error('Informe um título.');
    if (!responsavelId) return toast.error('Selecione o responsável.');
    if (!inicio || !fim) return toast.error('Informe início e fim.');
    if (new Date(fim) < new Date(inicio)) return toast.error('O fim não pode ser antes do início.');
    salvar.mutate();
  }

  const remarcaAviso = ehEdicao && inicio && paraInputLocal(editar!.inicio) !== inicio && !editar!.dataOriginal;

  return (
    <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-md">
      <div className="flex items-center justify-between border-b p-5">
        <div>
          <h3 className="text-lg font-bold">{ehEdicao ? 'Editar compromisso' : 'Novo compromisso'}</h3>
          <p className="text-sm text-muted-foreground">Agenda e prazos</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Título *</label>
          <Input placeholder="Ex.: Audiência trabalhista — 2ª Vara" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tipo *</label>
            <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoCompromisso)}>
              {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Status</label>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as StatusCompromisso)}>
              {STATUS_ORDEM.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Início *</label>
            <Input type="datetime-local" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Fim *</label>
            <Input type="datetime-local" value={fim} onChange={(e) => setFim(e.target.value)} />
          </div>
        </div>
        {remarcaAviso && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
            Alterar a data registra uma <strong>remarcação</strong> e trava a data original ({formatData(editar!.inicio)}) para auditoria.
          </p>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Responsável *</label>
          <select className={inputCls} value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
            <option value="">Selecione…</option>
            {(responsaveis.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        </div>

        {/* Filiado (opcional) */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Filiado (opcional)</label>
          {filiadoId ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><User className="h-4 w-4 shrink-0 text-senatepi-700 dark:text-senatepi-400" /><span className="truncate">{filiadoNome}</span></span>
              {!filiadoPre && <button type="button" onClick={() => { setFiliadoId(''); setFiliadoNome(''); setAtendimentoId(''); }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar por nome ou CPF…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>
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

        {/* Vínculo com atendimento/triagem */}
        {filiadoId && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium"><Link2 className="h-4 w-4 text-muted-foreground" /> Vincular a um atendimento (triagem)</label>
            <select className={inputCls} value={atendimentoId} onChange={(e) => setAtendimentoId(e.target.value)} disabled={atendimentos.isLoading}>
              <option value="">Sem vínculo</option>
              {(atendimentos.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>{new Date(a.createdAt).toLocaleDateString('pt-BR')} · {CANAL_LABEL[a.canal]} · {DESFECHO_LABEL[a.desfecho]}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Descrição (opcional)</label>
          <textarea className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
        <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
        <Button onClick={submeter} disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {ehEdicao ? 'Salvar' : 'Criar compromisso'}
        </Button>
      </div>
    </Sheet>
  );
}
