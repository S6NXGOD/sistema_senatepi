'use client';

import { useState } from 'react';
import { GitMerge, Loader2, X, ArrowRight, AlertTriangle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  listarPartesExternas, mesclarOrganizacoes, formatDocumento, TIPO_PARTE_LABEL,
  type ParteExterna,
} from '@/lib/partes';

/**
 * MESCLAR DUAS ORGANIZAÇÕES.
 *
 * A operação apaga um cadastro e move processos, vínculos de emprego e o dossiê
 * patronal para o outro. Não tem desfazer na tela — o retrato do que sumiu fica
 * na auditoria. Três decisões de desenho vêm daí:
 *
 * 1. A ORGANIZAÇÃO QUE FICA É A QUE ESTÁ ABERTA, e isso é dito com todas as
 *    letras. A pergunta "qual das duas sobrevive?" com dois campos iguais lado
 *    a lado é onde alguém inverte sem perceber, e inverter aqui apaga o
 *    cadastro certo.
 *
 * 2. A SETA É O DESENHO. "Duplicada → fica" lido da esquerda para a direita, na
 *    mesma direção da leitura, com a que some à esquerda. Nenhum texto explica
 *    isso tão rápido quanto a seta.
 *
 * 3. A CONFIRMAÇÃO EXIGE VER O NOME. O botão só libera depois que uma
 *    duplicada foi escolhida, e o resumo repete os dois nomes por extenso.
 *
 * As recusas (institucional, dossiê patronal dos dois lados, documentos
 * divergentes) vêm da API com mensagem pronta — a tela não as duplica, porque
 * regra escrita em dois lugares vira duas regras diferentes em três meses.
 */
export function MesclarModal({
  fica,
  sugerida,
  onFechar,
  onMesclado,
}: {
  /** A organização que PERMANECE. */
  fica: ParteExterna;
  /**
   * Duplicada já escolhida pela fila de limpeza. Vem preenchida, mas dá para
   * trocar: a varredura sugere pelo peso do cadastro, e quem conhece o caso
   * pode discordar — a sugestão não pode virar decisão automática.
   */
  sugerida?: ParteExterna;
  onFechar: () => void;
  onMesclado: () => void | Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ParteExterna[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [dup, setDup] = useState<ParteExterna | null>(sugerida ?? null);
  const [mesclando, setMesclando] = useState(false);

  async function procurar() {
    if (busca.trim().length < 2) return;
    setBuscando(true);
    try {
      const r = await listarPartesExternas({ busca: busca.trim(), pageSize: 20 });
      // A que fica nunca pode aparecer como candidata a ser absorvida por si.
      setResultados(r.items.filter((p) => p.id !== fica.id));
    } catch {
      toast.error('Não foi possível buscar organizações.');
    } finally {
      setBuscando(false);
    }
  }

  async function mesclar() {
    if (!dup || mesclando) return;
    setMesclando(true);
    try {
      const r = await mesclarOrganizacoes(fica.id, dup.id);
      const partes = [
        r.processosRepontados && `${r.processosRepontados} processo(s) transferido(s)`,
        r.participacoesAbsorvidas && `${r.participacoesAbsorvidas} participação(ões) absorvida(s)`,
        r.vinculosMovidos && `${r.vinculosMovidos} vínculo(s) de trabalho`,
        r.dossiePatronalMovido && 'dossiê patronal',
      ].filter(Boolean);
      toast.success(`"${r.removida.nome}" foi mesclada.`, {
        description: partes.length ? partes.join(' · ') : 'Nada havia vinculado à duplicada.',
      });
      await onMesclado();
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      // As recusas da API são longas de propósito: explicam o que fazer antes.
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível mesclar.', { duration: 9000 });
    } finally {
      setMesclando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-xl">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
                <GitMerge className="h-4.5 w-4.5 text-brand-800 dark:text-brand-400" />
              </span>
              <div>
                <h3 className="text-base font-bold">Mesclar organização duplicada</h3>
                <p className="text-xs text-muted-foreground">
                  Escolha a que deve SUMIR. Tudo que estiver nela passa para esta.
                </p>
              </div>
            </div>
            <button type="button" onClick={onFechar} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Quem fica — fixo e evidente, para ninguém inverter. */}
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
              Permanece
            </p>
            <p className="truncate text-sm font-medium">{fica.nome}</p>
            <p className="text-[11px] text-muted-foreground">
              {TIPO_PARTE_LABEL[fica.tipo]}
              {fica.documento ? ` · ${formatDocumento(fica.documento)}` : ' · sem documento'}
            </p>
          </div>

          {/* Quem some */}
          {!dup ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Qual organização é a duplicada?</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Buscar por nome, sigla ou documento…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); procurar(); } }}
                />
                <Button type="button" variant="outline" onClick={procurar} disabled={buscando}>
                  {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {!!resultados.length && (
                <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                  {resultados.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setDup(p)}
                        className="flex w-full items-center justify-between gap-2 p-2.5 text-left transition hover:bg-muted/50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{p.nome}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {TIPO_PARTE_LABEL[p.tipo]}
                            {p.documento ? ` · ${formatDocumento(p.documento)}` : ''}
                            {p.cidade ? ` · ${p.cidade}` : ''}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-400">
                      Será apagada
                    </p>
                    <p className="truncate text-sm font-medium">{dup.nome}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {TIPO_PARTE_LABEL[dup.tipo]}
                      {dup.documento ? ` · ${formatDocumento(dup.documento)}` : ' · sem documento'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDup(null)}
                    className="shrink-0 text-xs font-semibold underline-offset-2 hover:underline"
                  >
                    trocar
                  </button>
                </div>
              </div>

              <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 p-2.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Processos, vínculos de trabalho e o dossiê patronal de{' '}
                  <strong className="font-semibold">{dup.nome}</strong> passam para{' '}
                  <strong className="font-semibold">{fica.nome}</strong>, e o cadastro duplicado é
                  apagado. Campos em branco na que fica são completados com os da outra — os
                  preenchidos NÃO são sobrescritos. Não há desfazer nesta tela.
                </span>
              </p>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button
              onClick={mesclar}
              disabled={!dup || mesclando}
              className={cn(dup && 'bg-red-600 hover:bg-red-700')}
            >
              {mesclando && <Loader2 className="h-4 w-4 animate-spin" />}
              <GitMerge className="h-4 w-4" /> Mesclar e apagar a duplicada
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
