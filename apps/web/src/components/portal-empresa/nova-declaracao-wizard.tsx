'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, ArrowRight, ArrowLeft, Copy, Check, QrCode, Upload, FileText,
  ShieldCheck, CheckCircle2, ScrollText, CalendarDays,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  gerarContribuicao, anexarDocumentos, mascaraMoeda, moedaParaNumero, formatarReais,
  type DadosPix, type ErroPortal,
} from '@/lib/portal-empresa';
import { tenant } from '@/tenant.config';

type Passo = 1 | 2 | 3 | 4;

const PASSOS = [
  { n: 1, titulo: 'Competência' },
  { n: 2, titulo: 'Pagamento' },
  { n: 3, titulo: 'Documentos' },
] as const;

/** Competência máxima = mês corrente (não existe folha de mês que não fechou). */
function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function NovaDeclaracaoWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [passo, setPasso] = useState<Passo>(1);

  // Passo 1
  const [mes, setMes] = useState('');
  const [valor, setValor] = useState('');
  const [gerando, setGerando] = useState(false);

  // Passo 2
  const [pix, setPix] = useState<DadosPix | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Passo 3
  const [comprovante, setComprovante] = useState<File | null>(null);
  const [relacao, setRelacao] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  function fechar() {
    setPasso(1); setMes(''); setValor(''); setPix(null); setCopiado(false);
    setComprovante(null); setRelacao(null);
    onClose();
  }

  // ------------------------------------------------------------------ passo 1

  async function gerar() {
    if (!mes) return toast.error('Informe o mês de referência.');
    if (mes > mesAtual()) return toast.error('A competência não pode ser um mês futuro.');
    const numero = moedaParaNumero(valor);
    if (!numero || numero <= 0) return toast.error('Informe o valor a repassar.');

    setGerando(true);
    try {
      const r = await gerarContribuicao(mes, numero);
      setPix(r.pix);
      setPasso(2);
      void qc.invalidateQueries({ queryKey: ['portal-empresa', 'contribuicoes'] });
    } catch (e) {
      toast.error((e as ErroPortal).message);
    } finally {
      setGerando(false);
    }
  }

  async function copiar() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.copiaECola);
      setCopiado(true);
      toast.success('Código PIX copiado.');
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error('Não foi possível copiar — selecione o texto manualmente.');
    }
  }

  // ------------------------------------------------------------------ passo 3

  async function enviar() {
    if (!pix) return;
    // Um documento já basta para enviar — o outro pode vir depois.
    if (!comprovante && !relacao) {
      return toast.error('Anexe ao menos um dos dois documentos.');
    }
    if (relacao && relacao.type !== 'application/pdf') {
      return toast.error('A relação de trabalhadores precisa ser um arquivo PDF.');
    }

    setEnviando(true);
    try {
      await anexarDocumentos(pix.contribuicaoId, comprovante, relacao);
      void qc.invalidateQueries({ queryKey: ['portal-empresa', 'contribuicoes'] });
      setPasso(4);
    } catch (e) {
      toast.error((e as ErroPortal).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={passo === 2 || passo === 3 ? undefined : fechar}
    >
      <div
        className="my-8 w-full max-w-lg rounded-2xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b p-5">
          <div>
            <h3 className="font-semibold">Nova declaração</h3>
            <p className="text-xs text-muted-foreground">Contribuição patronal</p>
          </div>
          <button type="button" onClick={fechar} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {passo < 4 && (
          <div className="flex items-center gap-2 border-b px-5 py-3">
            {PASSOS.map((p, i) => (
              <div key={p.n} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    passo >= p.n
                      ? 'bg-brand-800 text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {passo > p.n ? <Check className="h-3.5 w-3.5" /> : p.n}
                </span>
                <span className={`hidden text-xs sm:block ${passo === p.n ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {p.titulo}
                </span>
                {i < PASSOS.length - 1 && <span className="h-px flex-1 bg-border" />}
              </div>
            ))}
          </div>
        )}

        {/* ================================================== PASSO 1 */}
        {passo === 1 && (
          <div className="space-y-4 p-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mês de referência</label>
              <Input
                type="month"
                max={mesAtual()}
                value={mes}
                onChange={(e) => setMes(e.target.value)}
                className="h-12 text-base md:h-11"
              />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Competência da folha de pagamento.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Valor a repassar para o sindicato</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                <Input
                  inputMode="numeric"
                  placeholder="0,00"
                  value={valor}
                  onChange={(e) => setValor(mascaraMoeda(e.target.value))}
                  className="h-12 pl-10 text-base md:h-11"
                />
              </div>
            </div>

            <Button className="h-12 w-full md:h-11" onClick={gerar} disabled={gerando}>
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Gerar guia PIX
            </Button>
          </div>
        )}

        {/* ================================================== PASSO 2 */}
        {passo === 2 && pix && (
          <div className="space-y-4 p-5">
            <div className="rounded-xl border bg-muted/30 p-4 text-center">
              <p className="text-xs text-muted-foreground">Valor a pagar</p>
              <p className="text-2xl font-bold">{formatarReais(pix.valor)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">para {pix.recebedor}</p>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pix.qrDataUrl}
                alt="QR Code do PIX"
                className="mx-auto mt-4 h-56 w-56 rounded-lg bg-white p-2"
              />
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <QrCode className="h-3.5 w-3.5" /> Aponte a câmera do app do seu banco.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">PIX Copia e Cola</label>
              <div className="flex items-center gap-2 rounded-lg border bg-card p-2">
                <input
                  readOnly
                  value={pix.copiaECola}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[11px] outline-none"
                />
                <Button size="sm" variant={copiado ? 'outline' : 'default'} onClick={copiar}>
                  {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiado ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Identificador: <span className="font-mono">{pix.identificador}</span>
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={fechar}>
                Pagar depois
              </Button>
              <Button className="flex-1" onClick={() => setPasso(3)}>
                Já paguei <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              A guia fica salva no seu histórico — você pode voltar e enviar os documentos depois.
            </p>
          </div>
        )}

        {/* ================================================== PASSO 3 */}
        {passo === 3 && (
          <div className="space-y-4 p-5">
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Anexe o que já tiver em mãos — <strong>não precisa ser os dois de uma vez</strong>.
              O que faltar pode ser enviado depois, pelo histórico.
            </p>

            <Arquivo
              rotulo="Comprovante do PIX"
              dica="PDF ou imagem do comprovante."
              accept="application/pdf,image/*"
              arquivo={comprovante}
              onEscolher={setComprovante}
            />
            <Arquivo
              rotulo="Relação de trabalhadores"
              dica="Somente PDF (folha de pagamento / relação nominal)."
              accept="application/pdf"
              arquivo={relacao}
              onEscolher={setRelacao}
            />

            <AvisoLgpd />

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPasso(2)} disabled={enviando}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button className="flex-1" onClick={enviar} disabled={enviando}>
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Enviar para análise
              </Button>
            </div>
          </div>
        )}

        {/* ================================================== CONCLUSÃO */}
        {passo === 4 && (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-brand-600" />
            <h4 className="text-lg font-bold">Declaração enviada!</h4>
            <p className="max-w-xs text-sm text-muted-foreground">
              Seus documentos foram recebidos e estão <strong>em análise</strong> pelo {tenant.sigla}.
              Acompanhe a situação pelo histórico.
            </p>
            <Button className="mt-2 w-full" onClick={fechar}>Voltar ao portal</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Aviso legal exibido SEMPRE que a relação de trabalhadores for enviada —
 * na declaração nova e no reenvio. O documento carrega dados pessoais de
 * terceiros, então a base e a finalidade do tratamento ficam à vista.
 */
export function AvisoLgpd() {
  return (
    <div className="rounded-xl border border-brand-400/50 bg-brand-50/50 p-4 dark:bg-brand-900/10">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-800 dark:text-brand-400">
        <ScrollText className="h-4 w-4" /> Aviso legal — proteção de dados
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        O envio da relação de trabalhadores obedece às diretrizes da{' '}
        <strong>
          Lei Geral de Proteção de Dados Pessoais (LGPD), Lei nº 13.709, de 14 de agosto de 2018
        </strong>{' '}
        (Fonte: Diário Oficial da União). Os dados pessoais constantes do documento serão tratados
        exclusivamente para conferência e homologação da contribuição patronal, com acesso restrito
        à equipe do {tenant.sigla} e armazenamento em ambiente controlado.
      </p>
    </div>
  );
}

export function Arquivo({
  rotulo, dica, accept, arquivo, onEscolher,
}: {
  rotulo: string;
  dica: string;
  accept: string;
  arquivo: File | null;
  onEscolher: (f: File | null) => void;
}) {
  const id = `arq-${rotulo.replace(/\s/g, '-').toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">{rotulo}</label>
        {arquivo && (
          <button
            type="button"
            onClick={() => onEscolher(null)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            remover
          </button>
        )}
      </div>
      <input
        id={id}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onEscolher(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => document.getElementById(id)?.click()}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed p-4 text-left transition hover:border-brand-400 hover:bg-muted/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {arquivo ? <FileText className="h-5 w-5 text-brand-800 dark:text-brand-400" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {arquivo ? arquivo.name : 'Selecionar arquivo'}
          </span>
          <span className="block text-xs text-muted-foreground">
            {arquivo ? `${(arquivo.size / 1024 / 1024).toFixed(2)} MB` : dica}
          </span>
        </span>
        {arquivo && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
      </button>
    </div>
  );
}
