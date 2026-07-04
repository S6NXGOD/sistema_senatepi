'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Loader2, UserCog, ExternalLink, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mascararCpf } from '@/lib/utils';
import { compararFiliado, sincronizarFiliado, CampoDiff } from '@/lib/colonia';

/**
 * Fluxo de "Atualizar cadastro": compara os dados da Colônia com o cadastro do
 * filiado, deixa a diretoria ESCOLHER quais campos atualizar (o resto é mantido),
 * mostra o ANTES → DEPOIS e só aplica após a confirmação. Bottom sheet no mobile.
 */
export function SyncFiliadoModal({
  tipo,
  id,
  onClose,
  onConcluido,
}: {
  tipo: 'reserva' | 'inscricao';
  id: string;
  onClose: () => void;
  onConcluido: () => void;
}) {
  const [etapa, setEtapa] = useState<'selecionar' | 'confirmar'>('selecionar');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [aplicando, setAplicando] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['comparar-filiado', tipo, id],
    queryFn: () => compararFiliado(tipo, id),
    retry: false,
  });

  // Já sincronizado? Então o modal é apenas de CONSULTA (read-only).
  const jaSincronizado = !!data?.sincronizadoEm;

  // Pré-seleciona apenas os campos que DIFEREM do cadastro atual.
  useEffect(() => {
    if (data && !data.sincronizadoEm)
      setSelecionados(new Set(data.campos.filter((c) => c.diferente).map((c) => c.campo)));
  }, [data]);

  const toggle = (campo: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(campo)) n.delete(campo);
      else n.add(campo);
      return n;
    });

  const camposSelecionados = data?.campos.filter((c) => selecionados.has(c.campo)) ?? [];

  async function aplicar() {
    setAplicando(true);
    try {
      const r = await sincronizarFiliado(tipo, id, [...selecionados]);
      toast.success(`Cadastro de ${r.nome} atualizado (${r.alterados.length} campo(s)).`);
      onConcluido();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível atualizar o cadastro.');
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={aplicando ? undefined : onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-muted p-2"><UserCog className="h-6 w-6 text-senatepi-800 dark:text-senatepi-400" /></div>
            <div className="min-w-0">
              <h3 className="font-semibold leading-tight">Atualizar cadastro do filiado</h3>
              {data && (
                <p className="truncate text-xs text-muted-foreground">
                  {data.filiadoNome} · {mascararCpf(data.cpf)} · {data.matricula}
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={aplicando}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {isLoading && (
            <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
          )}
          {error && (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
              {(error as any)?.response?.data?.message ?? 'Não foi possível comparar com o cadastro.'}
            </p>
          )}

          {data && (
            <>
              <a
                href={`/filiados/${data.filiadoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-senatepi-800 underline dark:text-senatepi-400"
              >
                Ver cadastro atual completo <ExternalLink className="h-3.5 w-3.5" />
              </a>

              {jaSincronizado ? (
                /* Consulta: o que já foi atualizado a partir deste registro. */
                <>
                  <div className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Cadastro já atualizado em{' '}
                      <strong>{new Date(data.sincronizadoEm!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</strong>.
                      Este registro não pode ser sincronizado novamente.
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Alterações aplicadas:</p>
                  <div className="space-y-2">
                    {(data.sincronizacao ?? []).map((s) => (
                      <div key={s.campo} className="rounded-lg border p-3 text-sm">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground line-through">{s.de || '— (vazio)'}</span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                          <span className="font-semibold text-green-700 dark:text-green-300">{s.para}</span>
                        </div>
                      </div>
                    ))}
                    {(!data.sincronizacao || data.sincronizacao.length === 0) && (
                      <p className="text-sm text-muted-foreground">Nenhum detalhe registrado.</p>
                    )}
                  </div>
                </>
              ) : etapa === 'selecionar' ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Marque os campos que deseja <strong>atualizar</strong>. Os desmarcados permanecem como estão.
                  </p>
                  <div className="space-y-2">
                    {data.campos.map((c) => (
                      <CampoLinha key={c.campo} c={c} checked={selecionados.has(c.campo)} onToggle={() => toggle(c.campo)} />
                    ))}
                    {data.campos.length === 0 && (
                      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                        A Colônia não trouxe dados novos para este cadastro.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Confirme as alterações (<strong>antes → depois</strong>). Apenas o que está abaixo será atualizado.
                  </p>
                  <div className="space-y-2">
                    {camposSelecionados.map((c) => (
                      <div key={c.campo} className="rounded-lg border p-3 text-sm">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground line-through">{c.atual || '— (vazio)'}</span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-senatepi-600 dark:text-senatepi-400" />
                          <span className="font-semibold text-senatepi-800 dark:text-senatepi-300">{c.novo}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {data && jaSincronizado && (
          <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </div>
        )}
        {data && !jaSincronizado && data.campos.length > 0 && (
          <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
            {etapa === 'selecionar' ? (
              <Button disabled={selecionados.size === 0} onClick={() => setEtapa('confirmar')}>
                Confirmar seleção ({selecionados.size}) <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEtapa('selecionar')} disabled={aplicando}>
                  <ArrowLeft className="h-4 w-4" /> Voltar
                </Button>
                <Button onClick={aplicar} disabled={aplicando}>
                  {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Aplicar alterações
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CampoLinha({ c, checked, onToggle }: { c: CampoDiff; checked: boolean; onToggle: () => void }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
        checked ? 'border-senatepi-600 bg-senatepi-50/60 dark:bg-senatepi-900/20' : 'hover:bg-muted',
      )}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 h-4 w-4 shrink-0 accent-senatepi-800" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{c.label}</span>
          {!c.diferente && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">sem alteração</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{c.atual || '— (vazio)'}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-medium">{c.novo}</span>
        </div>
      </div>
    </label>
  );
}
