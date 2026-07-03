'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Ticket, Eye, EyeOff, X, Trophy, ShieldCheck, Sparkles, Medal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FORMACAO_LABEL, formatarDataHoraLote, mascaraCpf,
  mascararNomeLgpd, mascararCpfLgpd, mascararCorenLgpd,
  InscritoSorteio, ResultadoSorteio,
} from '@/lib/colonia';

type Fase = 'pre' | 'processando' | 'resultado';

const SUSPENSE_MS = 3600; // duração mínima do suspense (bom para gravação)

/**
 * Modal do Sorteio Auditável do Quarto 6.
 * - Mascaramento LGPD por padrão (Modo Apresentação) com toggle p/ Modo Interno.
 * - 3 estados: pré-sorteio, suspense e resultado com selo de auditoria (hash).
 */
export function DrawModal({
  lote,
  inscritos,
  onRealizar,
  onClose,
  onSucesso,
}: {
  lote: { numero: number; dataInicio: string; dataFim: string };
  inscritos: InscritoSorteio[];
  onRealizar: () => Promise<ResultadoSorteio>;
  onClose: () => void;
  onSucesso?: () => void;
}) {
  const [fase, setFase] = useState<Fase>('pre');
  const [apresentacao, setApresentacao] = useState(true); // dados ofuscados por padrão
  const [resultado, setResultado] = useState<ResultadoSorteio | null>(null);
  const [dataHora, setDataHora] = useState<string>('');
  const [flashIdx, setFlashIdx] = useState(0);

  // Suspense: nomes (mascarados) passando rapidamente.
  useEffect(() => {
    if (fase !== 'processando' || inscritos.length === 0) return;
    const id = setInterval(() => setFlashIdx((i) => (i + 1) % inscritos.length), 85);
    return () => clearInterval(id);
  }, [fase, inscritos.length]);

  const nome = (n: string) => (apresentacao ? mascararNomeLgpd(n) : n);
  const cpf = (c: string) => (apresentacao ? mascararCpfLgpd(c) : mascaraCpf(c));
  const coren = (c: string | null) => (apresentacao ? mascararCorenLgpd(c) : c ?? '—');

  async function realizar() {
    if (fase !== 'pre') return;
    setFase('processando');
    const inicio = Date.now();
    try {
      const res = await onRealizar();
      const restante = Math.max(0, SUSPENSE_MS - (Date.now() - inicio));
      window.setTimeout(() => {
        setResultado(res);
        setDataHora(new Date().toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }));
        setFase('resultado');
        onSucesso?.();
      }, restante);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível realizar o sorteio.');
      setFase('pre');
    }
  }

  const podeFechar = fase !== 'processando';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => podeFechar && onClose()}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-100 p-2 dark:bg-amber-900/30">
              <Ticket className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold leading-tight">Sorteio Auditável — Quarto 6 (Ventilador)</h3>
              <p className="text-xs text-muted-foreground">
                Lote {lote.numero} · {formatarDataHoraLote(lote.dataInicio)} → {formatarDataHoraLote(lote.dataFim)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost" size="icon"
              onClick={() => setApresentacao((v) => !v)}
              title={apresentacao ? 'Mostrar dados (Modo Interno)' : 'Ocultar dados (Modo Apresentação)'}
              aria-label="Alternar mascaramento LGPD"
            >
              {apresentacao ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} disabled={!podeFechar}><X className="h-4 w-4" /></Button>
          </div>
        </div>

        {/* Faixa do modo atual */}
        <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-2">
          <Badge className={apresentacao
            ? 'bg-senatepi-50 text-senatepi-900 dark:bg-senatepi-900/30 dark:text-senatepi-400'
            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}>
            {apresentacao ? 'Modo Apresentação · LGPD' : 'Modo Interno · dados visíveis'}
          </Badge>
          <span className="text-xs text-muted-foreground">{inscritos.length} inscrito(s)</span>
        </div>

        {/* Corpo por fase */}
        <div className="flex-1 overflow-y-auto">
          {/* ---- Estado 1: pré-sorteio ---- */}
          {fase === 'pre' && (
            <div className="p-5">
              <div className="space-y-2">
                {inscritos.map((i, idx) => (
                  <div key={i.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{idx + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{nome(i.nomeCompleto)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {cpf(i.cpf)} · {FORMACAO_LABEL[i.formacao]}{i.coren ? ` · ${coren(i.coren)}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {inscritos.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">Nenhum inscrito na fila deste lote.</p>
                )}
              </div>
              <Button
                onClick={realizar}
                disabled={inscritos.length === 0}
                className="mt-5 h-12 w-full bg-amber-500 text-base font-semibold text-white shadow hover:bg-amber-600"
              >
                <Sparkles className="h-5 w-5" /> Realizar Sorteio
              </Button>
            </div>
          )}

          {/* ---- Estado 2: processando / suspense ---- */}
          {fase === 'processando' && (
            <div className="flex flex-col items-center justify-center gap-6 px-6 py-16 text-center">
              <div className="relative flex h-24 w-24 items-center justify-center">
                <motion.span
                  className="absolute inset-0 rounded-full border-4 border-amber-500/25 border-t-amber-500"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                />
                <motion.div
                  animate={{ scale: [1, 1.12, 1] }}
                  transition={{ repeat: Infinity, duration: 0.9 }}
                >
                  <Ticket className="h-9 w-9 text-amber-500" />
                </motion.div>
              </div>

              <div className="flex h-8 items-center">
                <motion.p
                  key={flashIdx}
                  initial={{ opacity: 0.2, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.1 }}
                  className="text-lg font-bold tracking-tight text-foreground"
                >
                  {inscritos.length ? mascararNomeLgpd(inscritos[flashIdx].nomeCompleto) : '...'}
                </motion.p>
              </div>

              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-senatepi-600 dark:text-senatepi-400" />
                Processando sorteio seguro...
              </div>
            </div>
          )}

          {/* ---- Estado 3: resultado auditável ---- */}
          {fase === 'resultado' && resultado && (
            <div className="space-y-4 p-5">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                className="rounded-xl border-2 border-senatepi-600 bg-senatepi-50 p-4 dark:bg-senatepi-900/20"
              >
                <div className="flex items-center gap-2 text-senatepi-800 dark:text-senatepi-400">
                  <Trophy className="h-5 w-5" />
                  <span className="text-xs font-bold uppercase tracking-wide">Contemplado(a)</span>
                </div>
                <p className="mt-1.5 text-xl font-bold">{nome(resultado.vencedor.nomeCompleto)}</p>
                <p className="text-sm text-muted-foreground">
                  {cpf(resultado.vencedor.cpf)} · {FORMACAO_LABEL[resultado.vencedor.formacao]}
                  {resultado.vencedor.coren ? ` · ${coren(resultado.vencedor.coren)}` : ''}
                </p>
              </motion.div>

              {resultado.suplentes.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                    <Medal className="h-4 w-4" /> Fila de suplentes
                  </p>
                  <ol className="max-h-[32vh] space-y-1.5 overflow-y-auto">
                    {resultado.suplentes.map((s) => (
                      <li key={`${s.cpf}-${s.posicao}`} className="flex items-center gap-3 rounded-md border p-2.5 text-sm">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{s.posicao}</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{nome(s.nomeCompleto)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{cpf(s.cpf)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Selo de auditoria */}
              <div className="rounded-lg border border-dashed border-senatepi-600/50 bg-muted/40 p-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-senatepi-800 dark:text-senatepi-400">
                  <ShieldCheck className="h-4 w-4" /> Selo de Auditoria
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <p><span className="text-muted-foreground">Data/hora do sorteio:</span> <strong>{dataHora}</strong></p>
                  <p className="break-all">
                    <span className="text-muted-foreground">Hash de registro:</span>{' '}
                    <span className="font-mono text-[11px]">{resultado.vencedor.reservaId}</span>
                  </p>
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={onClose}>Concluir</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
