'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  X, Loader2, ShieldCheck, Snowflake, Fan, Ticket, CheckCircle2, FileDown,
  CalendarCheck2, CalendarX2, BedDouble,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FORMACAO_OPCOES, SUFIXO_COREN, ESTRUTURA_QUARTO, AVISO_LEGAL_RESERVA, LABEL_CLIMATIZACAO,
  Climatizacao, formatarDataHoraLote, mascaraCpf, mascaraTelefone, montarCoren,
  postReservaDireta, postSorteio, soDigitos,
} from '@/lib/colonia';
import { gerarComprovantePdf, montarTextoCompartilhamento, ComprovanteInfo } from '@/lib/colonia-comprovante';

export type TipoCheckout = 'AR' | 'VENTILADOR' | 'SORTEIO';

const schema = z.object({
  nomeCompleto: z.string().min(3, 'Informe o nome completo'),
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
  cidade: z.string().min(2, 'Informe a cidade'),
  estado: z.string().min(2, 'UF'),
  aceiteTermoNoShow: z.literal(true, { errorMap: () => ({ message: 'É necessário aceitar o termo' }) }),
  consentimentoLgpd: z.literal(true, { errorMap: () => ({ message: 'É necessário autorizar o uso dos dados' }) }),
});
type FormData = z.infer<typeof schema>;

const CABECALHO: Record<TipoCheckout, { titulo: string; icon: any; cor: string }> = {
  AR: { titulo: 'Reserva — Quarto com Ar-Condicionado', icon: Snowflake, cor: 'text-sky-600 dark:text-sky-400' },
  VENTILADOR: { titulo: 'Reserva — Quarto com Ventilador', icon: Fan, cor: 'text-senatepi-600 dark:text-senatepi-400' },
  SORTEIO: { titulo: 'Inscrição no Sorteio — Quarto com Ventilador', icon: Ticket, cor: 'text-amber-600 dark:text-amber-400' },
};

export interface LoteCheckout {
  id: string;
  numero: number;
  dataInicio: string;
  dataFim: string;
}

export function CheckoutModal({
  slug,
  campanha,
  lote,
  tipo,
  quarto,
  onClose,
  onReservado,
}: {
  slug: string;
  campanha: string;
  lote: LoteCheckout;
  tipo: TipoCheckout;
  quarto?: { id: string; numero: number; climatizacao: Climatizacao };
  onClose: () => void;
  onReservado: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<ComprovanteInfo | null>(null);
  const {
    register, control, watch, handleSubmit, formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { formacao: 'ENFERMEIRO' },
  });
  const formacaoAtual = watch('formacao');

  const cab = CABECALHO[tipo];
  const Icon = cab.icon;

  async function onSubmit(d: FormData) {
    setEnviando(true);
    try {
      const payload = {
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
        aceiteTermoNoShow: true,
        consentimentoLgpd: true,
      };
      const res = tipo === 'SORTEIO'
        ? await postSorteio({ ...payload, slug, loteId: lote.id })
        : await postReservaDireta({ ...payload, slug, loteId: lote.id, quartoId: quarto!.id });

      setSucesso({
        protocolo: (res as any)?.id ?? '—',
        tipo,
        campanha,
        nome: payload.nomeCompleto,
        cpf: payload.cpf,
        loteNumero: lote.numero,
        dataInicio: lote.dataInicio,
        dataFim: lote.dataFim,
        quartoNumero: tipo === 'SORTEIO' ? undefined : quarto?.numero,
        climatizacao: tipo === 'SORTEIO' ? undefined : quarto?.climatizacao,
      });
      onReservado();
    } catch (e: any) {
      const msg = e?.response?.status === 429
        ? 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.'
        : e?.response?.data?.message ?? 'Não foi possível concluir. Tente novamente.';
      toast.error(msg);
    } finally {
      setEnviando(false);
    }
  }

  function compartilharWhatsApp() {
    if (!sucesso) return;
    const link = typeof window !== 'undefined' ? `${window.location.origin}/colonia/${slug}` : undefined;
    const texto = montarTextoCompartilhamento(sucesso, link);
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer');
  }

  const Campo = ({ label, erro, children }: { label: string; erro?: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {erro && <p className="text-xs text-red-500">{erro}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {sucesso ? (
          <SucessoView
            info={sucesso}
            onBaixarPdf={() => {
              gerarComprovantePdf(sucesso).catch(() => toast.error('Não foi possível gerar o comprovante.'));
            }}
            onCompartilhar={compartilharWhatsApp}
            onFechar={onClose}
          />
        ) : (
          <>
            <div className="flex items-start justify-between border-b p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-muted p-2">
                  <Icon className={`h-6 w-6 ${cab.cor}`} />
                </div>
                <div>
                  <h3 className="font-semibold leading-tight">{cab.titulo}</h3>
                  <p className="text-xs text-muted-foreground">Lote {lote.numero}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* Resumo do lote/quarto + estrutura (visível em todos os quartos) */}
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  <span className="flex items-center gap-1.5"><CalendarCheck2 className="h-4 w-4 text-senatepi-600 dark:text-senatepi-400" /> {formatarDataHoraLote(lote.dataInicio)}</span>
                  <span className="flex items-center gap-1.5"><CalendarX2 className="h-4 w-4 text-senatepi-600 dark:text-senatepi-400" /> {formatarDataHoraLote(lote.dataFim)}</span>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <BedDouble className="mt-0.5 h-4 w-4 shrink-0" /> {ESTRUTURA_QUARTO}
                </p>
              </div>

              <Campo label="Nome completo *" erro={errors.nomeCompleto?.message}>
                <Input {...register('nomeCompleto')} placeholder="Seu nome" />
              </Campo>

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
                <Campo label="Formação *" erro={errors.formacao?.message}>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...register('formacao')}>
                    {FORMACAO_OPCOES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </Campo>
                <Campo label="Número do COREN *" erro={errors.coren?.message}>
                  <div className="flex items-stretch">
                    <Controller name="coren" control={control} render={({ field }) => (
                      <Input inputMode="numeric" placeholder="123456" className="rounded-r-none"
                        value={field.value ?? ''} onChange={(e) => field.onChange(soDigitos(e.target.value).slice(0, 6))} />
                    )} />
                    <span className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-sm font-medium text-muted-foreground">
                      -{SUFIXO_COREN[formacaoAtual]}
                    </span>
                  </div>
                </Campo>
              </div>

              <Campo label="E-mail" erro={errors.email?.message}>
                <Input type="email" {...register('email')} placeholder="seu@email.com" />
              </Campo>

              <Campo label="Local de trabalho 1 *" erro={errors.localTrabalho1?.message}>
                <Input {...register('localTrabalho1')} placeholder="Instituição / Empresa" />
              </Campo>
              <Campo label="Local de trabalho 2 (opcional)">
                <Input {...register('localTrabalho2')} placeholder="Instituição / Empresa" />
              </Campo>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Campo label="Cidade *" erro={errors.cidade?.message}>
                    <Input {...register('cidade')} placeholder="Cidade" />
                  </Campo>
                </div>
                <Campo label="UF *" erro={errors.estado?.message}>
                  <Input maxLength={2} {...register('estado')} placeholder="PI" />
                </Campo>
              </div>

              {/* Termo de Responsabilidade (Código Civil - Lei 10.406/2002) */}
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/20">
                <label className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                  <input type="checkbox" className="mt-0.5 accent-amber-600" {...register('aceiteTermoNoShow')} />
                  <span><strong>Estou ciente das regras de penalidade por no-show</strong> (não comparecimento), assumindo responsabilidade nos termos do Código Civil.</span>
                </label>
                {errors.aceiteTermoNoShow && <p className="text-xs text-red-600">{errors.aceiteTermoNoShow.message}</p>}
                <label className="flex items-start gap-2 text-xs text-amber-900/90 dark:text-amber-200/90">
                  <input type="checkbox" className="mt-0.5 accent-amber-600" {...register('consentimentoLgpd')} />
                  <span>Autorizo o tratamento dos meus dados para fins desta reserva, conforme a LGPD (Lei 13.709/2018).</span>
                </label>
                {errors.consentimentoLgpd && <p className="text-xs text-red-600">{errors.consentimentoLgpd.message}</p>}
              </div>

              <Button type="submit" className="w-full" disabled={enviando}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {tipo === 'SORTEIO' ? 'Confirmar inscrição no sorteio' : 'Confirmar reserva'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela de sucesso — Reserva Confirmada
// ---------------------------------------------------------------------------

function SucessoView({
  info, onBaixarPdf, onCompartilhar, onFechar,
}: {
  info: ComprovanteInfo;
  onBaixarPdf: () => void;
  onCompartilhar: () => void;
  onFechar: () => void;
}) {
  const sorteio = info.tipo === 'SORTEIO';
  return (
    <div className="flex flex-col overflow-hidden">
      {/* Faixa de sucesso */}
      <div className="flex items-center justify-between border-b bg-senatepi-800 p-5 text-white">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-7 w-7" />
          <div>
            <h3 className="font-bold leading-tight">{sorteio ? 'Inscrição Confirmada!' : 'Reserva Confirmada!'}</h3>
            <p className="text-xs text-white/85">Protocolo {info.protocolo}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/15" onClick={onFechar}><X className="h-4 w-4" /></Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {/* Detalhes */}
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Lote</span>
            <span className="font-semibold">Lote {info.loteNumero}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarCheck2 className="h-4 w-4" /> Check-in</span>
            <span className="text-right font-medium">{formatarDataHoraLote(info.dataInicio)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarX2 className="h-4 w-4" /> Check-out</span>
            <span className="text-right font-medium">{formatarDataHoraLote(info.dataFim)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <span className="text-muted-foreground">Quarto</span>
            <span className="text-right font-semibold">
              {sorteio || !info.climatizacao
                ? 'Quarto 6 (Ventilador) — por sorteio'
                : `Quarto ${info.quartoNumero} — ${LABEL_CLIMATIZACAO[info.climatizacao]}`}
            </span>
          </div>
          <p className="flex items-start gap-1.5 border-t pt-2 text-xs text-muted-foreground">
            <BedDouble className="mt-0.5 h-4 w-4 shrink-0" /> {ESTRUTURA_QUARTO}
          </p>
        </div>

        {/* Aviso legal obrigatório em destaque */}
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">Atenção</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">{AVISO_LEGAL_RESERVA}</p>
        </div>

        {/* Ações */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="outline" onClick={onBaixarPdf}>
            <FileDown className="h-4 w-4" /> Baixar Comprovante (PDF)
          </Button>
          <Button className="bg-[#25D366] text-white hover:bg-[#20bd5a]" onClick={onCompartilhar}>
            <WhatsAppGlyph className="h-4 w-4" /> Compartilhar no WhatsApp
          </Button>
        </div>
        <Button variant="ghost" className="w-full" onClick={onFechar}>Concluir</Button>
      </div>
    </div>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
