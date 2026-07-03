'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, QrCode as QrIcon, Upload, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatarData } from '@/lib/utils';
import { QrCodeDialog } from '@/components/qrcode-dialog';

interface Dependente {
  id: string;
  tipo: 'CONJUGE' | 'FILHO';
  nome: string;
  cpf?: string | null;
  dataNascimento: string;
  idade: number;
  validoParaEvento: boolean;
  fotoUrl?: string | null;
}

export function DependentesSection({
  filiadoId,
  dependentes,
}: {
  filiadoId: string;
  dependentes: Dependente[];
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [qrId, setQrId] = useState<string | null>(null);
  const fotoRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [form, setForm] = useState({ tipo: 'FILHO', nome: '', cpf: '', dataNascimento: '' });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['filiado', filiadoId] });

  const criar = useMutation({
    mutationFn: async () => api.post(`/filiados/${filiadoId}/dependentes`, form),
    onSuccess: () => {
      toast.success('Dependente incluído');
      setForm({ tipo: 'FILHO', nome: '', cpf: '', dataNascimento: '' });
      setAberto(false);
      invalidar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao incluir'),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => api.delete(`/dependentes/${id}`),
    onSuccess: () => { toast.success('Dependente removido'); invalidar(); },
  });

  const enviarFoto = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append('foto', file);
      return api.post(`/dependentes/${id}/foto`, fd);
    },
    onSuccess: () => { toast.success('Foto atualizada'); invalidar(); },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Dependentes</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAberto((v) => !v)}>
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {aberto && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={form.tipo}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
            >
              <option value="CONJUGE">Cônjuge</option>
              <option value="FILHO">Filho(a)</option>
            </select>
            <Input placeholder="Nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            <Input placeholder="CPF" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))} />
            <Input type="date" value={form.dataNascimento} onChange={(e) => setForm((f) => ({ ...f, dataNascimento: e.target.value }))} />
            <Button onClick={() => criar.mutate()} disabled={!form.nome || !form.dataNascimento || criar.isPending}>
              {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </div>
        )}

        {dependentes.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum dependente cadastrado</p>
        )}

        {dependentes.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              {d.fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.fotoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-senatepi-50 text-xs font-semibold text-senatepi-800">{d.nome.charAt(0)}</div>
              )}
              <div>
                <p className="text-sm font-medium">{d.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {d.tipo === 'CONJUGE' ? 'Cônjuge' : 'Filho(a)'} · {d.idade} anos · nasc. {formatarData(d.dataNascimento)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={d.validoParaEvento ? 'bg-senatepi-50 text-senatepi-800' : 'bg-red-100 text-red-700'}>
                {d.validoParaEvento ? 'Válido p/ eventos' : 'Inválido p/ eventos'}
              </Badge>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={(el) => { fotoRefs.current[d.id] = el; }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) enviarFoto.mutate({ id: d.id, file });
                  e.target.value = '';
                }}
              />
              <Button variant="ghost" size="icon" title="Foto" onClick={() => fotoRefs.current[d.id]?.click()}><Upload className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="QR Code" onClick={() => setQrId(d.id)}><QrIcon className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" title="Remover" onClick={() => remover.mutate(d.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Filhos são válidos para eventos somente até 18 anos (cálculo automático).</p>
      </CardContent>

      {qrId && (
        <QrCodeDialog endpoint={`/dependentes/${qrId}/qrcode`} titulo="QR Code do dependente" onClose={() => setQrId(null)} />
      )}
    </Card>
  );
}
