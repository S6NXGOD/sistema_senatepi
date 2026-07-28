'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, X, UserCog, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { atualizarContatoFiliado, ContatoFiliado } from '@/lib/atendimentos';

interface FiliadoContato extends ContatoFiliado {
  id: string;
  nomeCompleto: string;
}

function Campo({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/**
 * Modal rápido de atualização de CONTATO do filiado — abre por cima do fluxo
 * atual (novo atendimento ou gaveta) sem tirar o atendente do contexto.
 */
export function AtualizacaoCadastralModal({
  filiado, onClose, onSaved,
}: { filiado: FiliadoContato; onClose: () => void; onSaved?: () => void }) {
  const [form, setForm] = useState<ContatoFiliado>({
    telefonePrincipal: filiado.telefonePrincipal ?? '',
    telefoneSecundario: filiado.telefoneSecundario ?? '',
    email: filiado.email ?? '',
    cep: filiado.cep ?? '',
    endereco: filiado.endereco ?? '',
    numero: filiado.numero ?? '',
    complemento: filiado.complemento ?? '',
    bairro: filiado.bairro ?? '',
    cidade: filiado.cidade ?? '',
    estado: filiado.estado ?? '',
  });
  const set = (k: keyof ContatoFiliado, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const salvar = useMutation({
    mutationFn: () => {
      // Envia só os campos de contato (o back rejeita props extras — whitelist).
      const dto: ContatoFiliado = {};
      for (const [k, v] of Object.entries(form)) {
        (dto as Record<string, string | null>)[k] = (v as string).trim() || null;
      }
      return atualizarContatoFiliado(filiado.id, dto);
    },
    onSuccess: () => {
      toast.success('Dados de contato atualizados!', { description: filiado.nomeCompleto });
      onSaved?.();
      onClose();
    },
    onError: (e: any) => toast.error('Não foi possível salvar', { description: e?.response?.data?.message ?? 'Tente novamente.' }),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvar.isPending ? undefined : onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-senatepi-50 p-2 dark:bg-senatepi-900/30"><UserCog className="h-6 w-6 text-senatepi-700 dark:text-senatepi-400" /></div>
            <div>
              <h3 className="font-semibold leading-tight">Atualização cadastral</h3>
              <p className="text-xs text-muted-foreground">{filiado.nomeCompleto}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={salvar.isPending} className="text-muted-foreground hover:text-foreground disabled:opacity-50"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo label="Telefone principal"><Input inputMode="tel" value={form.telefonePrincipal ?? ''} onChange={(e) => set('telefonePrincipal', e.target.value)} /></Campo>
            <Campo label="Telefone secundário"><Input inputMode="tel" value={form.telefoneSecundario ?? ''} onChange={(e) => set('telefoneSecundario', e.target.value)} /></Campo>
          </div>
          <Campo label="E-mail"><Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Campo>

          <p className="pt-1 text-sm font-semibold text-muted-foreground">Endereço</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Campo label="CEP" className="col-span-2"><Input inputMode="numeric" value={form.cep ?? ''} onChange={(e) => set('cep', e.target.value)} /></Campo>
            <Campo label="Logradouro" className="col-span-4"><Input value={form.endereco ?? ''} onChange={(e) => set('endereco', e.target.value)} /></Campo>
            <Campo label="Número" className="col-span-2"><Input value={form.numero ?? ''} onChange={(e) => set('numero', e.target.value)} /></Campo>
            <Campo label="Complemento" className="col-span-4"><Input value={form.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} /></Campo>
            <Campo label="Bairro" className="col-span-3"><Input value={form.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} /></Campo>
            <Campo label="Cidade" className="col-span-2"><Input value={form.cidade ?? ''} onChange={(e) => set('cidade', e.target.value)} /></Campo>
            <Campo label="UF" className="col-span-1"><Input maxLength={2} value={form.estado ?? ''} onChange={(e) => set('estado', e.target.value.toUpperCase())} /></Campo>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar contato
          </Button>
        </div>
      </div>
    </div>
  );
}
