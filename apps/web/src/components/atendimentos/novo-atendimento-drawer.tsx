'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Search, Loader2, User, UserCog, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import { criarAtendimento, CanalAtendimento, CANAIS, CANAL_LABEL } from '@/lib/atendimentos';
import { AtualizacaoCadastralModal } from '@/components/atendimentos/atualizacao-cadastral-modal';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

/**
 * Novo Atendimento (triagem) — registra APENAS filiado + canal + descrição.
 * O desfecho (Resolvido no Ato / Encaminhado) é registrado depois, na listagem.
 */
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
  const [cadastral, setCadastral] = useState<any | null>(null);
  const [carregandoContato, setCarregandoContato] = useState(false);

  useEffect(() => {
    if (open) {
      setFiliadoId(filiadoPre?.id ?? '');
      setFiliadoNome(filiadoPre?.nomeCompleto ?? '');
      setBusca(''); setResultados([]);
      setCanal('PRESENCIAL'); setDescricao('');
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
    try { setCadastral((await api.get(`/filiados/${filiadoId}`)).data); }
    catch { toast.error('Não foi possível carregar os dados do filiado.'); }
    finally { setCarregandoContato(false); }
  }

  const criar = useMutation({
    mutationFn: () => criarAtendimento({ filiadoId, canal, descricao: descricao.trim() }),
    onSuccess: () => { toast.success('Atendimento registrado!'); onCriado(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível registrar o atendimento.'),
  });

  function registrar() {
    if (!filiadoId) return toast.error('Selecione o filiado.');
    if (descricao.trim().length < 3) return toast.error('Descreva a demanda.');
    criar.mutate();
  }

  if (!open) {
    return cadastral ? (
      <AtualizacaoCadastralModal filiado={cadastral} onClose={() => setCadastral(null)} onSaved={() => {}} />
    ) : null;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={criar.isPending ? undefined : onClose}>
        <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b p-5">
            <div>
              <h3 className="text-lg font-bold">Novo Atendimento</h3>
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
                  <Button variant="outline" size="sm" className="w-full" onClick={abrirCadastral} disabled={carregandoContato}>
                    {carregandoContato ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />} Atualização cadastral
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Selecionar filiado (nome ou CPF)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
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
              <label className="text-sm font-medium">Canal de Atendimento *</label>
              <select className={inputCls} value={canal} onChange={(e) => setCanal(e.target.value as CanalAtendimento)}>
                {CANAIS.map((c) => <option key={c} value={c}>{CANAL_LABEL[c]}</option>)}
              </select>
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Descrição / Demanda *</label>
              <textarea className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm" placeholder="Descreva o motivo do atendimento…" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
            <Button variant="outline" onClick={onClose} disabled={criar.isPending}>Cancelar</Button>
            <Button onClick={registrar} disabled={criar.isPending || !filiadoId}>
              {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Registrar
            </Button>
          </div>
        </div>
      </div>

      {cadastral && (
        <AtualizacaoCadastralModal filiado={cadastral} onClose={() => setCadastral(null)} onSaved={() => {}} />
      )}
    </>
  );
}
