'use client';

import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Search, Loader2, User, Gavel, Landmark, Scale } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buscarFiliados, FiliadoBusca } from '@/lib/colonia';
import { listarResponsaveis } from '@/lib/agenda';
import { importarProcesso, mascararNPU, ProcessoDetalhe } from '@/lib/processos';

const inputCls =
  'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

// Validação: NPU precisa ter exatamente 20 dígitos (o backend também valida).
const schema = z.object({
  numeroCNJ: z
    .string()
    .refine((v) => v.replace(/\D/g, '').length === 20, 'Informe os 20 dígitos do número do processo.'),
  tribunal: z.string().optional(),
  advogadoId: z.string().optional(),
  filiadoId: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

export function ImportarProcessoDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (p: ProcessoDetalhe) => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { numeroCNJ: '', tribunal: '', advogadoId: '', filiadoId: '' },
  });

  // Vínculo de filiado (combobox de busca assíncrona).
  const [filiadoNome, setFiliadoNome] = useState('');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  const advogados = useQuery({ queryKey: ['processos-advogados'], queryFn: listarResponsaveis, enabled: open });

  useEffect(() => {
    if (open) return;
    // Ao fechar, zera tudo.
    reset({ numeroCNJ: '', tribunal: '', advogadoId: '', filiadoId: '' });
    setFiliadoNome('');
    setBusca('');
    setResultados([]);
  }, [open, reset]);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        setResultados(await buscarFiliados(termo));
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const importar = useMutation({
    mutationFn: (data: FormData) =>
      importarProcesso({
        numeroCNJ: data.numeroCNJ.replace(/\D/g, ''),
        tribunal: data.tribunal?.trim() || undefined,
        filiadoId: data.filiadoId || undefined,
        advogadoId: data.advogadoId || undefined,
      }),
    onSuccess: (p) => {
      toast.success('Processo importado do DATAJUD.');
      onImported(p);
      onClose();
    },
    onError: (e: any) => {
      const status = e?.response?.status;
      const msg =
        e?.response?.data?.message ??
        (status === 409
          ? 'Este processo já foi importado.'
          : 'Não foi possível importar o processo.');
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    },
  });

  function selecionarFiliado(f: FiliadoBusca) {
    setValue('filiadoId', f.id);
    setFiliadoNome(f.nome);
    setBusca('');
    setResultados([]);
  }
  function limparFiliado() {
    setValue('filiadoId', '');
    setFiliadoNome('');
  }

  return (
    <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-md">
      <div className="flex items-center justify-between border-b p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
            <Gavel className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Importar processo</h3>
            <p className="text-sm text-muted-foreground">Consulta direta ao DATAJUD (CNJ)</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit((d) => importar.mutate(d))} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* NPU com máscara automática */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Número do Processo (NPU) *</label>
            <Controller
              control={control}
              name="numeroCNJ"
              render={({ field }) => (
                <Input
                  inputMode="numeric"
                  autoFocus
                  placeholder="0000000-00.0000.0.00.0000"
                  value={field.value}
                  onChange={(e) => field.onChange(mascararNPU(e.target.value))}
                  className="font-mono tracking-tight"
                />
              )}
            />
            {errors.numeroCNJ && <p className="text-xs text-red-600">{errors.numeroCNJ.message}</p>}
            <p className="text-[11px] text-muted-foreground">
              O tribunal é identificado automaticamente pelo número. Informe a sigla abaixo apenas se necessário.
            </p>
          </div>

          {/* Filiado (opcional) — busca assíncrona */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <User className="h-4 w-4 text-muted-foreground" /> Filiado vinculado (opcional)
            </label>
            {filiadoNome ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/40 px-3 py-2.5">
                <span className="truncate text-sm font-medium">{filiadoNome}</span>
                <button type="button" onClick={limparFiliado} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar por nome ou CPF…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                {buscando && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
                {resultados.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-card shadow-lg">
                    {resultados.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => selecionarFiliado(f)}
                          className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="font-medium">{f.nome}</span>
                          <span className="text-xs text-muted-foreground">{f.cpfMascarado}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Vincular o filiado permite revelar o CPF dele nas partes (máscara inteligente).
            </p>
          </div>

          {/* Advogado responsável (opcional) */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Scale className="h-4 w-4 text-muted-foreground" /> Advogado responsável (opcional)
            </label>
            <select className={inputCls} {...register('advogadoId')}>
              <option value="">Selecione…</option>
              {(advogados.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </div>

          {/* Tribunal (opcional) */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <Landmark className="h-4 w-4 text-muted-foreground" /> Tribunal (opcional)
            </label>
            <Input placeholder="Ex.: TJPI, TRF1, TRT22" className="uppercase" {...register('tribunal')} />
            <p className="text-[11px] text-muted-foreground">
              Só é necessário quando o tribunal não pode ser derivado do NPU (ex.: Justiça Eleitoral).
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={importar.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={importar.isPending}>
            {importar.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Buscando no Tribunal…
              </>
            ) : (
              <>
                <Gavel className="h-4 w-4" /> Importar processo
              </>
            )}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
