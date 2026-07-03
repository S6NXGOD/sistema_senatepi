'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImportacaoLinha } from '@/lib/importacao';
import { SITUACOES, SITUACAO_LABEL } from '@/lib/filiados';

/** Modal para corrigir uma linha da prévia de importação e revalidá-la. */
export function EditarLinhaDialog({
  importacaoId,
  linha,
  onClose,
  onSaved,
}: {
  importacaoId: string;
  linha: ImportacaoLinha;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nomeCompleto: linha.nome ?? '',
    cpf: linha.cpf ?? '',
    matricula: linha.matricula ?? '',
    telefonePrincipal: linha.telefone ?? '',
    email: (linha.dados?.email as string) ?? '',
    empresa: linha.empresa ?? '',
    situacao: linha.situacao ?? 'ATIVO',
  });

  const salvar = useMutation({
    mutationFn: async () => api.patch(`/importacoes/${importacaoId}/linhas/${linha.id}`, form),
    onSuccess: () => {
      toast.success('Linha revalidada');
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao salvar'),
  });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const Campo = ({ label, k }: { label: string; k: keyof typeof form }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input value={form[k]} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Corrigir linha {linha.linha}</h3>
            <p className="text-xs text-muted-foreground">Ajuste e salve para revalidar automaticamente</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Campo label="Nome completo" k="nomeCompleto" /></div>
          <Campo label="CPF" k="cpf" />
          <Campo label="Matrícula" k="matricula" />
          <Campo label="Telefone" k="telefonePrincipal" />
          <Campo label="E-mail" k="email" />
          <Campo label="Empresa" k="empresa" />
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Situação</label>
            <select className="h-12 w-full rounded-md border border-input md:h-10 bg-background px-3 text-base md:text-sm" value={form.situacao} onChange={(e) => set('situacao', e.target.value)}>
              {SITUACOES.map((s) => <option key={s} value={s}>{SITUACAO_LABEL[s]}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar e revalidar
          </Button>
        </div>
      </div>
    </div>
  );
}
