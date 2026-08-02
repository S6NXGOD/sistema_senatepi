'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { executarLote, previaLote } from '@/lib/duplicidade';

/**
 * Consolidação em lote da fatia SEM RISCO DE PERDA.
 *
 * Só entram aqui os grupos em que o cadastro descartado está completamente
 * vazio — nome e matrícula, nada mais. A fusão não copia nada porque não há
 * nada; e se por azar forem duas pessoas, o que se perde é um registro que
 * não continha informação alguma, com a matrícula preservada no histórico.
 *
 * Tudo que exige julgamento (empate, campos divergentes, os dois lados com
 * dados) fica FORA e continua na revisão um a um. Foi a linha escolhida de
 * propósito: automatizar o que não tem dúvida, não o que dá trabalho.
 */
export function LoteDuplicados() {
  const qc = useQueryClient();
  const [confirmacao, setConfirmacao] = useState('');
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });
  const [falhas, setFalhas] = useState<{ nome: string; motivo: string }[]>([]);
  const [concluido, setConcluido] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['duplicados-lote'],
    queryFn: previaLote,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const total = data?.total ?? 0;
  // Digitar o número é a trava. Um botão sozinho é clicado sem ler; escrever
  // "704" obriga a passar o olho no que está prestes a acontecer.
  const liberado = confirmacao.trim() === String(total) && total > 0;

  async function rodar() {
    setRodando(true);
    setFalhas([]);
    setProgresso({ feitos: 0, total });
    const acumuladas: { nome: string; motivo: string }[] = [];
    let feitos = 0;

    try {
      // Laço até acabar: cada volta é uma requisição curta, e o progresso na
      // tela é real, não uma barra decorativa.
      for (;;) {
        const r = await executarLote(25);
        feitos += r.fundidos;
        acumuladas.push(...r.falhas);
        setProgresso({ feitos, total });
        setFalhas([...acumuladas]);
        if (r.restantes === 0 || (r.fundidos === 0 && r.falhas.length === 0)) break;
      }
      setConcluido(feitos);
      toast.success(`${feitos} cadastro(s) duplicado(s) consolidado(s).`);
      qc.invalidateQueries({ queryKey: ['duplicados'] });
      qc.invalidateQueries({ queryKey: ['duplicados-lote'] });
      qc.invalidateQueries({ queryKey: ['duplicados-status'] });
      qc.invalidateQueries({ queryKey: ['filiados'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'O lote foi interrompido.');
    } finally {
      setRodando(false);
      setConfirmacao('');
    }
  }

  if (isLoading) return null;

  if (concluido !== null) {
    return (
      <Card className="border-senatepi-300 dark:border-senatepi-800">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-senatepi-700 dark:text-senatepi-400" />
          <div className="text-sm">
            <p className="font-semibold">{concluido} cadastro(s) consolidado(s).</p>
            {falhas.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {falhas.length} não puderam ser processados e continuam na lista para revisão manual.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (total === 0) return null;

  return (
    <Card className="border-senatepi-300 dark:border-senatepi-800">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2.5">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-senatepi-700 dark:text-senatepi-400" />
          <div className="min-w-0">
            <p className="font-semibold">
              {total.toLocaleString('pt-BR')} podem ser consolidados de uma vez
            </p>
            <p className="text-sm text-muted-foreground">
              Nesses, o cadastro removido tem <strong>apenas nome e matrícula</strong> — sem CPF,
              sem contato, sem endereço, sem local de trabalho. Não há nada para copiar, e nada
              a perder.
            </p>
          </div>
        </div>

        {data?.amostra && data.amostra.length > 0 && (
          <details className="rounded-lg border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer font-medium">
              Ver amostra dos {Math.min(25, total)} primeiros
            </summary>
            <ul className="mt-2 space-y-1">
              {data.amostra.map((i) => (
                <li key={i.descartarId} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{i.nome}</span>
                  <span className="text-muted-foreground">
                    mantém <span className="font-mono">{i.manterMatricula}</span>, remove{' '}
                    <span className="font-mono">{i.descartarMatricula}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {rodando ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consolidando {progresso.feitos} de {progresso.total}…
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-senatepi-700 transition-all dark:bg-senatepi-400"
                style={{ width: `${progresso.total ? (progresso.feitos / progresso.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Pode demorar. Não feche a aba — o que já foi consolidado está salvo.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Digite <strong>{total}</strong> para confirmar
              </label>
              <Input
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder={String(total)}
                className="w-32"
                inputMode="numeric"
              />
            </div>
            <Button disabled={!liberado} onClick={rodar}>
              Consolidar {total.toLocaleString('pt-BR')}
            </Button>
          </div>
        )}

        {falhas.length > 0 && !rodando && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {falhas.length} falharam e seguem na lista para revisão manual.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
