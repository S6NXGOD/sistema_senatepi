'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { X, Loader2, AlertTriangle, UserPlus, Search, Snowflake, Fan } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  FORMACAO_OPCOES,
  FORMACAO_LABEL,
  SUFIXO_COREN,
  mascaraCpf,
  mascaraTelefone,
  montarCoren,
  soDigitos,
  alocarManual,
  buscarFiliados,
  FiliadoBusca,
  QuartoDisp,
} from '@/lib/colonia';

type QuartoPainel = QuartoDisp & { ocupado: boolean };

const schema = z.object({
  nomeCompleto: z.string().min(3, 'Informe o nome'),
  cpf: z.string().refine((v) => soDigitos(v).length === 11, 'CPF inválido'),
  telefone: z.string().refine((v) => [10, 11].includes(soDigitos(v).length), 'Telefone inválido'),
  coren: z.string().refine((v) => {
    const d = soDigitos(v);
    return d.length >= 1 && d.length <= 6;
  }, 'Informe o número do COREN (1 a 6 dígitos)'),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  formacao: z.enum(['ENFERMEIRO', 'TECNICO', 'AUXILIAR']),
  localTrabalho1: z.string().min(2, 'Informe o local de trabalho'),
  localTrabalho2: z.string().optional(),
  cidade: z.string().min(2, 'Cidade'),
  estado: z.string().min(2, 'UF'),
});
type FormData = z.infer<typeof schema>;

export function AlocarManualModal({
  loteId,
  loteNumero,
  quartos,
  onClose,
  onSuccess,
}: {
  loteId: string;
  loteNumero: number;
  quartos: QuartoPainel[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<FiliadoBusca[]>([]);
  const [buscando, setBuscando] = useState(false);

  const quartosOrdenados = useMemo(() => [...quartos].sort((a, b) => a.numero - b.numero), [quartos]);
  const [quartoId, setQuartoId] = useState<string>(() => {
    const livre = [...quartos].sort((a, b) => a.numero - b.numero).find((q) => !q.ocupado);
    return livre?.id ?? '';
  });
  const quartoSel = quartos.find((q) => q.id === quartoId);
  const isQ6 = quartoSel?.numero === 6;

  const { register, control, watch, setValue, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { formacao: 'ENFERMEIRO' },
  });
  const formacaoAtual = watch('formacao');

  // Autocomplete do cadastro legado de Filiados (Nome + CPF), com debounce.
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

  // Preenche o formulário com o PERFIL COMPLETO trazido do cadastro legado.
  function selecionarFiliado(f: FiliadoBusca) {
    setValue('nomeCompleto', f.nome, { shouldValidate: true });
    setValue('cpf', mascaraCpf(f.cpf), { shouldValidate: true });
    if (f.formacao) setValue('formacao', f.formacao, { shouldValidate: true });
    if (f.corenNumero) setValue('coren', f.corenNumero, { shouldValidate: true });
    if (f.email) setValue('email', f.email, { shouldValidate: true });
    if (f.telefone) setValue('telefone', mascaraTelefone(f.telefone), { shouldValidate: true });
    if (f.localTrabalho1) setValue('localTrabalho1', f.localTrabalho1, { shouldValidate: true });
    if (f.localTrabalho2) setValue('localTrabalho2', f.localTrabalho2, { shouldValidate: true });
    if (f.cidade) setValue('cidade', f.cidade, { shouldValidate: true });
    if (f.estado) setValue('estado', f.estado, { shouldValidate: true });
    setBusca('');
    setResultados([]);
  }

  async function onSubmit(d: FormData) {
    if (!quartoId) {
      toast.error('Selecione um quarto para a alocação.');
      return;
    }
    setEnviando(true);
    try {
      await alocarManual({
        loteId,
        quartoId,
        nomeCompleto: d.nomeCompleto,
        cpf: soDigitos(d.cpf),
        telefone: d.telefone,
        coren: montarCoren(d.coren, d.formacao),
        email: d.email || undefined,
        formacao: d.formacao,
        localTrabalho1: d.localTrabalho1,
        localTrabalho2: d.localTrabalho2 || undefined,
        cidade: d.cidade,
        estado: d.estado.toUpperCase(),
        // Ato administrativo: a diretoria assume a responsabilidade pelo aceite.
        aceiteTermoNoShow: true,
        consentimentoLgpd: true,
      });
      toast.success(`Alocação manual realizada (Quarto ${quartoSel?.numero}).`);
      onSuccess();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível alocar.');
    } finally {
      setEnviando(false);
    }
  }

  const Campo = ({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-muted p-2"><UserPlus className="h-6 w-6 text-senatepi-800 dark:text-senatepi-400" /></div>
            <div>
              <h3 className="font-semibold leading-tight">Alocação manual (diretoria)</h3>
              <p className="text-xs text-muted-foreground">Lote {loteNumero}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Seletor de quarto (Q1–Q6) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Quarto de destino *</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {quartosOrdenados.map((q) => {
                const ar = q.climatizacao === 'AR_CONDICIONADO';
                const ativo = q.id === quartoId;
                return (
                  <button
                    key={q.id}
                    type="button"
                    disabled={q.ocupado}
                    onClick={() => setQuartoId(q.id)}
                    title={q.ocupado ? 'Ocupado' : ar ? 'Ar-condicionado' : 'Ventilador'}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors',
                      q.ocupado
                        ? 'cursor-not-allowed border-input opacity-40'
                        : ativo
                          ? 'border-senatepi-600 bg-senatepi-50 dark:bg-senatepi-900/30'
                          : 'border-input hover:border-senatepi-600',
                    )}
                  >
                    {ar
                      ? <Snowflake className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                      : <Fan className="h-4 w-4 text-senatepi-600 dark:text-senatepi-400" />}
                    <span className="font-bold">Q{q.numero}</span>
                    <span className="text-[9px] text-muted-foreground">{q.ocupado ? 'ocupado' : ar ? 'Ar' : 'Vent.'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Aviso apenas para o Quarto 6 (bloqueia o sorteio público) */}
          {isQ6 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span><strong>Aviso:</strong> alocar no Quarto 6 bloqueia/encerra o Sorteio público deste lote.</span>
            </div>
          )}

          {/* Autocomplete: cadastro legado de Filiados (Nome + CPF) */}
          <div className="relative space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Buscar filiado (opcional)</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Nome ou CPF do filiado…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {resultados.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-input bg-card shadow-lg">
                {resultados.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => selecionarFiliado(f)} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted">
                      <span className="font-medium">{f.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {f.cpfMascarado}
                        {f.formacao ? ` · ${FORMACAO_LABEL[f.formacao]}` : ''}
                        {f.localTrabalho1 ? ` · ${f.localTrabalho1}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Campo label="Nome completo *" erro={errors.nomeCompleto?.message}><Input {...register('nomeCompleto')} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="CPF *" erro={errors.cpf?.message}>
              <Controller name="cpf" control={control} render={({ field }) => (
                <Input inputMode="numeric" placeholder="000.000.000-00" value={field.value ?? ''} onChange={(e) => field.onChange(mascaraCpf(e.target.value))} />
              )} />
            </Campo>
            <Campo label="Telefone *" erro={errors.telefone?.message}>
              <Controller name="telefone" control={control} render={({ field }) => (
                <Input inputMode="numeric" placeholder="(86) 90000-0000" value={field.value ?? ''} onChange={(e) => field.onChange(mascaraTelefone(e.target.value))} />
              )} />
            </Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Formação *">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register('formacao')}>
                {FORMACAO_OPCOES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Campo>
            <Campo label="Número do COREN *" erro={errors.coren?.message}>
              <div className="flex items-stretch">
                <Controller name="coren" control={control} render={({ field }) => (
                  <Input inputMode="numeric" placeholder="123456" className="rounded-r-none" value={field.value ?? ''} onChange={(e) => field.onChange(soDigitos(e.target.value).slice(0, 6))} />
                )} />
                <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                  -{SUFIXO_COREN[formacaoAtual]}
                </span>
              </div>
            </Campo>
          </div>
          <Campo label="E-mail" erro={errors.email?.message}><Input type="email" {...register('email')} /></Campo>
          <Campo label="Local de trabalho 1 *" erro={errors.localTrabalho1?.message}><Input {...register('localTrabalho1')} /></Campo>
          <Campo label="Local de trabalho 2 (opcional)"><Input {...register('localTrabalho2')} /></Campo>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Campo label="Cidade *" erro={errors.cidade?.message}><Input {...register('cidade')} /></Campo></div>
            <Campo label="UF *" erro={errors.estado?.message}><Input maxLength={2} {...register('estado')} /></Campo>
          </div>

          <Button type="submit" className="w-full" disabled={enviando || !quartoId}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {quartoSel ? `Confirmar alocação no Quarto ${quartoSel.numero}` : 'Confirmar alocação'}
          </Button>
        </form>
      </div>
    </div>
  );
}
