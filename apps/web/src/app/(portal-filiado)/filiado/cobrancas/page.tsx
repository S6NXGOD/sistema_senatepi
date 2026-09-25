'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Paperclip,
  QrCode,
  Receipt,
  Upload,
} from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Button } from '@/components/ui/button';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import {
  ErroPortal,
  buscarMinhasCobrancas,
  buscarPixDaParcela,
  enviarComprovante,
  type MinhaParcela,
} from '@/lib/portal-filiado';
import { diasDesdeDataPura, formatDataPura } from '@/lib/data-pura';
import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** O rótulo que a pessoa entende, não o enum do banco. */
const ROTULO_DA_PARCELA: Record<string, string> = {
  PAGO: 'Paga',
  PENDENTE: 'Em aberto',
  ATRASADO: 'Vencida',
  CANCELADO: 'Cancelada',
};

export default function MinhasCobrancasPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'cobrancas'],
    queryFn: buscarMinhasCobrancas,
  });

  return (
    <CascaDoPortal>
      <h1 className="mb-1 text-lg font-bold">Minhas cobranças</h1>
      <p className="mb-4 text-xs leading-snug text-muted-foreground">
        Pague pelo PIX e mande o comprovante por aqui — a secretaria confere e dá baixa.
      </p>

      {isLoading ? (
        <Carregando texto="Carregando…">
          <EsqueletoLinhas quantidade={2} altura={140} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : !data?.length ? (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <Receipt className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">Você não tem cobrança registrada.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((c) => (
            <section key={c.id} className="overflow-hidden rounded-2xl border bg-card">
              <header className="border-b px-5 py-3">
                <p className="text-sm font-semibold">{c.descricao || c.tipo}</p>
                <p className="text-xs text-muted-foreground">
                  {c.parcelas.length === 1 ? 'Parcela única' : `${c.parcelas.length} parcelas`} ·{' '}
                  {MOEDA.format(c.valorTotal)}
                </p>
              </header>

              <ul className="divide-y">
                {c.parcelas.map((p) => (
                  <LinhaDaParcela key={p.id} parcela={p} />
                ))}
              </ul>
            </section>
          ))}

          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            Dúvida sobre valores ou acerto de parcelas? Fale com a secretaria do {tenant.sigla}.
          </p>
        </div>
      )}
    </CascaDoPortal>
  );
}

function LinhaDaParcela({ parcela: p }: { parcela: MinhaParcela }) {
  const [aberta, setAberta] = useState(false);
  const paga = p.status === 'PAGO';
  const cancelada = p.status === 'CANCELADO';
  /*
    `diasDesdeDataPura` e não uma comparação de datas: comparar "24/09/2026" com
    "25/09/2026" como TEXTO não ordena (o dia vem antes do ano), e comparar
    `Date` cru erra por um dia porque a coluna é data pura em meia-noite UTC.
    > 0 significa que o dia do vencimento já passou — vencer HOJE não é vencida.
  */
  const vencida = !paga && !cancelada && (diasDesdeDataPura(p.dataVencimento) ?? 0) > 0;

  return (
    <li>
      <div className="flex items-center gap-3 px-5 py-3">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            paga
              ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300'
              : vencida
                ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {paga ? <CheckCircle2 className="h-4 w-4" /> : p.numero}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{MOEDA.format(p.valor)}</p>
          <p className="text-[11px] text-muted-foreground">
            Vence em {formatDataPura(p.dataVencimento)}
            {paga && p.dataPagamento && ` · paga em ${formatDataPura(p.dataPagamento)}`}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 text-[11px] font-semibold',
            paga
              ? 'text-brand-700 dark:text-brand-400'
              : vencida
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-muted-foreground',
          )}
        >
          {vencida ? 'Vencida' : (ROTULO_DA_PARCELA[p.status] ?? p.status)}
        </span>
      </div>

      {/*
        O QUE ESTÁ EM ABERTO GANHA UM BOTÃO; o resto não. Uma parcela paga não
        precisa de PIX, e uma cancelada muito menos — oferecer pagamento nas
        três faria a pessoa pagar o que não deve.
      */}
      {!paga && !cancelada && (
        <div className="px-5 pb-3">
          {p.comprovante ? (
            /*
              JÁ MANDOU: o estado importa mais que o botão. Sem esta linha a
              pessoa manda de novo no dia seguinte, sem saber se o primeiro
              chegou — e a secretaria recebe três fotos da mesma parcela.
            */
            <div className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2 text-xs dark:border-brand-900/70 dark:bg-brand-900/20">
              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-400" />
              <p className="leading-snug text-brand-900 dark:text-brand-200">
                <strong>Comprovante enviado</strong> em{' '}
                {new Date(p.comprovante.enviadoEm).toLocaleDateString('pt-BR')}. A secretaria dá a
                baixa depois de conferir.{' '}
                <button
                  type="button"
                  onClick={() => setAberta((v) => !v)}
                  className="font-semibold underline"
                >
                  {aberta ? 'Fechar' : 'Enviar outro'}
                </button>
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setAberta((v) => !v)}
            >
              <QrCode className="h-3.5 w-3.5" /> {aberta ? 'Fechar' : 'Pagar esta parcela'}
            </Button>
          )}

          {aberta && <PainelDePagamento parcela={p} />}
        </div>
      )}
    </li>
  );
}

/** O PIX e o envio do comprovante — só monta quando a pessoa abre. */
function PainelDePagamento({ parcela: p }: { parcela: MinhaParcela }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copiado, setCopiado] = useState(false);

  const { data: pix, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'pix', p.id],
    queryFn: () => buscarPixDaParcela(p.id),
    retry: false,
  });

  const enviar = useMutation({
    mutationFn: (arquivo: File) => enviarComprovante(p.id, arquivo),
    onSuccess: () => {
      toast.success('Comprovante enviado. A secretaria vai conferir.');
      qc.invalidateQueries({ queryKey: ['portal-filiado', 'cobrancas'] });
      qc.invalidateQueries({ queryKey: ['portal-filiado', 'resumo'] });
    },
    onError: (e) => toast.error((e as ErroPortal).message),
  });

  async function copiar() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.copiaECola);
      setCopiado(true);
      toast.success('Código PIX copiado. Cole no aplicativo do seu banco.');
    } catch {
      // Sem permissão de área de transferência (acontece em http): o código
      // continua na tela, selecionável.
      toast.error('Selecione o código na tela para copiar.');
    }
  }

  return (
    <div className="mt-2 rounded-xl border bg-muted/30 p-3">
      {isLoading ? (
        <p className="py-4 text-center text-xs text-muted-foreground">Gerando o PIX…</p>
      ) : !pix ? (
        <p className="py-2 text-xs leading-snug text-muted-foreground">
          O PIX não está disponível agora. Fale com a secretaria do {tenant.sigla} para receber os
          dados de pagamento.
        </p>
      ) : (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pague {MOEDA.format(pix.valor)} com PIX
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element -- data URL do QR vindo da API */}
          <img
            src={pix.qrDataUrl}
            alt="QR Code do PIX desta parcela"
            className="mx-auto mt-2 h-40 w-40 rounded-lg bg-white p-1"
          />

          {/*
            O CÓDIGO EM TEXTO É O CAMINHO DO CELULAR. Quem está no telefone não
            consegue escanear o QR da própria tela — copia e cola no app do
            banco. O QR serve para quem paga de outro aparelho.
          */}
          <p className="mt-2 break-all rounded-lg border bg-card p-2 font-mono text-[10px] leading-snug">
            {pix.copiaECola}
          </p>
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={copiar}>
            {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiado ? 'Código copiado' : 'Copiar código PIX'}
          </Button>
        </>
      )}

      <div className="mt-3 border-t pt-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Já pagou? Mande o comprovante — foto ou PDF, até 10 MB.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) enviar.mutate(arquivo);
            // Limpa para o mesmo arquivo poder ser escolhido de novo depois de
            // um erro — senão o `change` não dispara e a tela parece travada.
            e.target.value = '';
          }}
        />
        <Button
          size="sm"
          className="mt-2 w-full"
          disabled={enviar.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {enviar.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando…
            </>
          ) : (
            <>
              <Upload className="h-3.5 w-3.5" /> Enviar comprovante
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
