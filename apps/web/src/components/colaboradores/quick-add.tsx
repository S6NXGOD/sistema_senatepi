'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CampoQuick {
  name: string;
  label: string;
  placeholder?: string;
  mask?: (v: string) => string;
}

/**
 * Botão "+" ao lado de um select para cadastro rápido de um domínio
 * (Departamento, Cargo, Empresa…). Ao criar, seleciona o novo registro.
 */
export function QuickAdd({
  label,
  campos,
  onCriar,
  onCriado,
}: {
  label: string;
  campos: CampoQuick[];
  onCriar: (valores: Record<string, string>) => Promise<{ id: string }>;
  onCriado: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.name, ''])),
  );

  const preenchido = campos.every((c) => (valores[c.name] ?? '').trim().length > 0);

  function abrir() {
    setValores(Object.fromEntries(campos.map((c) => [c.name, ''])));
    setAberto(true);
  }

  async function salvar() {
    setSalvando(true);
    try {
      const criado = await onCriar(valores);
      toast.success(`${label} adicionado(a).`);
      onCriado(criado.id);
      setAberto(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="icon" title={`Novo(a) ${label}`} onClick={abrir}>
        <Plus className="h-4 w-4" />
      </Button>

      {aberto && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={salvando ? undefined : () => setAberto(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-5">
              <h3 className="font-semibold">Novo(a) {label.toLowerCase()}</h3>
              <Button variant="ghost" size="icon" onClick={() => setAberto(false)} disabled={salvando}><X className="h-4 w-4" /></Button>
            </div>
            <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); if (preenchido) salvar(); }}>
              {campos.map((c) => (
                <div key={c.name} className="space-y-1.5">
                  <label className="text-sm font-medium">{c.label}</label>
                  <Input
                    placeholder={c.placeholder}
                    value={valores[c.name] ?? ''}
                    onChange={(e) => setValores((v) => ({ ...v, [c.name]: c.mask ? c.mask(e.target.value) : e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setAberto(false)} disabled={salvando}>Cancelar</Button>
                <Button type="submit" disabled={salvando || !preenchido}>
                  {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
