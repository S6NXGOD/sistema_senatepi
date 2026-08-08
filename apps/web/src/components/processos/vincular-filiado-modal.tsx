'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Search, Loader2, UserPlus, UserCheck, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import { atualizarProcesso } from '@/lib/processos';

type Modo = 'buscar' | 'criar';

/** Só dígitos, no máximo 11. */
const soDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 11);
/** 000.000.000-00 progressivo. */
function mascaraCpf(v: string): string {
  const d = soDigitos(v);
  let out = d.slice(0, 3);
  if (d.length > 3) out += '.' + d.slice(3, 6);
  if (d.length > 6) out += '.' + d.slice(6, 9);
  if (d.length > 9) out += '-' + d.slice(9, 11);
  return out;
}

/**
 * Resolve o vínculo do processo com um filiado SEM sair da tela: busca um
 * cadastro existente ou cria um novo com o mínimo necessário (nome, CPF e
 * nascimento — os únicos campos obrigatórios da API) e já vincula.
 */
export function VincularFiliadoModal({
  open, processoId, onClose, onVinculado, nomeSugerido,
}: {
  open: boolean;
  processoId: string;
  onClose: () => void;
  onVinculado: () => void;
  /** Nome vindo das partes do processo, quando houver — poupa digitação. */
  nomeSugerido?: string | null;
}) {
  const [modo, setModo] = useState<Modo>('buscar');

  // --- buscar ---
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  // --- criar ---
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [telefone, setTelefone] = useState('');

  useEffect(() => {
    if (!open) return;
    setModo('buscar');
    setBusca(nomeSugerido ?? '');
    setResultados([]);
    setNome(nomeSugerido ?? '');
    setCpf(''); setNascimento(''); setTelefone('');
  }, [open, nomeSugerido]);

  useEffect(() => {
    const termo = busca.trim();
    if (modo !== 'buscar' || termo.length < 2) { setResultados([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      try { setResultados(await buscarFiliados(termo)); }
      catch { setResultados([]); }
      finally { setBuscando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca, modo]);

  const vincular = useMutation({
    mutationFn: (filiadoId: string) => atualizarProcesso(processoId, { filiadoId }),
    onSuccess: () => { toast.success('Filiado vinculado ao processo.'); onVinculado(); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível vincular.'),
  });

  const criarEVincular = useMutation({
    mutationFn: async () => {
      const novo = (
        await api.post('/filiados', {
          nomeCompleto: nome.trim(),
          cpf: soDigitos(cpf),
          dataNascimento: nascimento,
          ...(telefone.trim() ? { telefonePrincipal: telefone.trim() } : {}),
        })
      ).data as { id: string };
      await atualizarProcesso(processoId, { filiadoId: novo.id });
      return novo;
    },
    onSuccess: () => { toast.success('Filiado cadastrado e vinculado.'); onVinculado(); onClose(); },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível cadastrar o filiado.');
    },
  });

  if (!open) return null;

  const podeCriar = nome.trim().length >= 3 && soDigitos(cpf).length === 11 && !!nascimento;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h3 className="font-semibold">Vincular filiado</h3>
            <p className="text-xs text-muted-foreground">O vínculo é opcional — pode ser feito depois.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Alternância entre buscar e cadastrar */}
        <div className="flex gap-1 border-b p-3">
          {([
            { k: 'buscar' as const, label: 'Buscar existente', icon: UserCheck },
            { k: 'criar' as const, label: 'Cadastrar novo', icon: UserPlus },
          ]).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.k}
                type="button"
                onClick={() => setModo(t.k)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition',
                  modo === t.k ? 'bg-brand-800 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {modo === 'buscar' ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  autoFocus
                  placeholder="Nome ou CPF do filiado…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>

              {busca.trim().length >= 2 && !buscando && resultados.length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="text-sm text-muted-foreground">Nenhum filiado encontrado.</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => { setNome(busca); setModo('criar'); }}>
                    <UserPlus className="h-4 w-4" /> Cadastrar "{busca.trim().slice(0, 24)}"
                  </Button>
                </div>
              )}

              {resultados.length > 0 && (
                <ul className="divide-y overflow-hidden rounded-lg border">
                  {resultados.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => vincular.mutate(f.id)}
                        disabled={vincular.isPending}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition hover:bg-muted disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{f.nome}</span>
                          <span className="block text-xs text-muted-foreground">{f.cpfMascarado}</span>
                        </span>
                        {vincular.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-brand-700" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Nome completo *</label>
                <Input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Maria Souza Lima" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">CPF *</label>
                  <Input value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))} inputMode="numeric" placeholder="000.000.000-00" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nascimento *</label>
                  <Input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Telefone</label>
                <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(86) 90000-0000" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Cadastro mínimo — os demais dados podem ser completados depois na ficha do filiado.
              </p>
            </>
          )}
        </div>

        {modo === 'criar' && (
          <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
            <Button variant="outline" onClick={onClose} disabled={criarEVincular.isPending}>Cancelar</Button>
            <Button onClick={() => criarEVincular.mutate()} disabled={!podeCriar || criarEVincular.isPending}>
              {criarEVincular.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Cadastrar e vincular
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
