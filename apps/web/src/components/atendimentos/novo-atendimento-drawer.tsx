'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Search, Loader2, User, UserCog, Send, CheckCircle2, ArrowRight,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import {
  criarAtendimento, CanalAtendimento, DesfechoAtendimento, SetorAtendimento,
  CANAIS, CANAL_LABEL, SETORES, SETOR_LABEL,
} from '@/lib/atendimentos';
import { AtualizacaoCadastralModal } from '@/components/atendimentos/atualizacao-cadastral-modal';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base sm:h-10 sm:text-sm';

export function NovoAtendimentoDrawer({
  open, onClose, onCriado, filiadoPre,
}: {
  open: boolean;
  onClose: () => void;
  onCriado: () => void;
  filiadoPre?: { id: string; nomeCompleto: string } | null;
}) {
  const [filiadoId, setFiliadoId] = useState('');
  const [filiadoNome, setFiliadoNome] = useState('');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  const [canal, setCanal] = useState<CanalAtendimento>('PRESENCIAL');
  const [descricao, setDescricao] = useState('');
  const [desfecho, setDesfecho] = useState<DesfechoAtendimento>('RESOLVIDO_ATO');
  const [setor, setSetor] = useState<SetorAtendimento>('JURIDICO');
  const [responsavel, setResponsavel] = useState('');

  const [cadastral, setCadastral] = useState<any | null>(null);
  const [carregandoContato, setCarregandoContato] = useState(false);

  // Reseta ao abrir/fechar; aplica filiado pré-selecionado (ex.: vindo do perfil).
  useEffect(() => {
    if (open) {
      setFiliadoId(filiadoPre?.id ?? '');
      setFiliadoNome(filiadoPre?.nomeCompleto ?? '');
      setBusca(''); setResultados([]);
      setCanal('PRESENCIAL'); setDescricao('');
      setDesfecho('RESOLVIDO_ATO'); setSetor('JURIDICO'); setResponsavel('');
    }
  }, [open, filiadoPre]);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      try { setResultados(await buscarFiliados(termo)); } catch { setResultados([]); } finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  async function abrirCadastral() {
    if (!filiadoId) return;
    setCarregandoContato(true);
    try {
      const f = (await api.get(`/filiados/${filiadoId}`)).data;
      setCadastral(f);
    } catch {
      toast.error('Não foi possível carregar os dados do filiado.');
    } finally {
      setCarregandoContato(false);
    }
  }

  const criar = useMutation({
    mutationFn: () =>
      criarAtendimento({
        filiadoId,
        canal,
        descricao,
        desfecho,
        ...(desfecho === 'ENCAMINHADO' ? { setor, responsavel: responsavel.trim() || undefined } : {}),
      }),
    onSuccess: () => {
      toast.success('Atendimento registrado!');
      onCriado();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível registrar o atendimento.'),
  });

  function registrar() {
    if (!filiadoId) return toast.error('Selecione o filiado.');
    if (descricao.trim().length < 3) return toast.error('Descreva a demanda.');
    criar.mutate();
  }

  const DesfechoCard = ({ v, titulo, sub }: { v: DesfechoAtendimento; titulo: string; sub: string }) => (
    <button
      type="button"
      onClick={() => setDesfecho(v)}
      className={`flex-1 rounded-lg border p-3 text-left transition-colors ${
        desfecho === v ? 'border-senatepi-600 bg-senatepi-50 dark:bg-senatepi-900/20' : 'border-input hover:border-senatepi-500'
      }`}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        {v === 'RESOLVIDO_ATO' ? <CheckCircle2 className="h-4 w-4 text-senatepi-700 dark:text-senatepi-400" /> : <ArrowRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
        {titulo}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>
    </button>
  );

  return (
    <>
      <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-md">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="text-lg font-bold">Novo atendimento</h3>
            <p className="text-sm text-muted-foreground">Registre a demanda do filiado</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Filiado */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Filiado *</label>
            {filiadoId ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4 shrink-0 text-senatepi-700 dark:text-senatepi-400" />
                    <span className="truncate">{filiadoNome}</span>
                  </span>
                  {!filiadoPre && (
                    <button type="button" onClick={() => { setFiliadoId(''); setFiliadoNome(''); }} className="text-muted-foreground hover:text-foreground" aria-label="Trocar filiado"><X className="h-4 w-4" /></button>
                  )}
                </div>
                {/* Atualização cadastral (requisito: logo após selecionar o filiado) */}
                <Button variant="outline" size="sm" className="w-full" onClick={abrirCadastral} disabled={carregandoContato}>
                  {carregandoContato ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />} Atualização cadastral
                </Button>
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

          {/* Canal */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Canal de entrada *</label>
            <select className={inputCls} value={canal} onChange={(e) => setCanal(e.target.value as CanalAtendimento)}>
              {CANAIS.map((c) => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}
            </select>
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Descrição da demanda *</label>
            <textarea className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm" placeholder="O que o filiado precisa?" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>

          {/* Desfecho */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Desfecho *</label>
            <div className="flex gap-2">
              <DesfechoCard v="RESOLVIDO_ATO" titulo="Resolvido no ato" sub="Dúvida rápida — vira histórico" />
              <DesfechoCard v="ENCAMINHADO" titulo="Encaminhado" sub="Jurídico/outro setor assume" />
            </div>
          </div>

          {/* Encaminhamento */}
          {desfecho === 'ENCAMINHADO' && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900/40 dark:bg-amber-950/10 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Setor *</label>
                <select className={inputCls} value={setor} onChange={(e) => setSetor(e.target.value as SetorAtendimento)}>
                  {SETORES.map((s) => <option key={s} value={s}>{SETOR_LABEL[s]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Responsável (opcional)</label>
                <Input placeholder="Ex.: Dra. Maria (advogada)" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={criar.isPending}>Cancelar</Button>
          <Button onClick={registrar} disabled={criar.isPending || !filiadoId}>
            {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Registrar atendimento
          </Button>
        </div>
      </Sheet>

      {cadastral && (
        <AtualizacaoCadastralModal filiado={cadastral} onClose={() => setCadastral(null)} onSaved={() => { /* dados já persistem no back */ }} />
      )}
    </>
  );
}
