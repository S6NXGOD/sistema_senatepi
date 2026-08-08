'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Award, Download, FileText, Gavel, Loader2, TriangleAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ResultadoPauta } from './resultado-pauta';
import { ListaPresenca } from './lista-presenca';
import {
  baixarCertificado, baixarDossie, encerrarAssembleia, listarCertificados,
  obterResumo, previaEncerramento,
} from '@/lib/eventos';

/**
 * Botão de encerrar — com a prévia do que vai acontecer.
 *
 * A confirmação é específica de propósito. "Tem certeza?" não ajuda ninguém a
 * decidir; "há uma votação aberta com 12 de 30 votos e quórum mínimo de 20"
 * ajuda, e é a diferença entre encerrar consciente e anular a assembleia.
 */
export function BotaoEncerrar({ eventoId, onEncerrado }: { eventoId: string; onEncerrado: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [executando, setExecutando] = useState(false);

  const { data: previa } = useQuery({
    queryKey: ['evento-previa-encerramento', eventoId],
    queryFn: () => previaEncerramento(eventoId),
    enabled: aberto,
  });

  async function confirmar() {
    setExecutando(true);
    try {
      const r = await encerrarAssembleia(eventoId);
      if (r.jaEstava) {
        toast.info('Esta assembleia já estava encerrada.');
      } else if (r.erroDossie) {
        // O encerramento vale mesmo sem o PDF: a assembleia acabou de fato, e o
        // documento pode ser reemitido. Perder o encerramento por causa do
        // dossiê seria trocar o essencial pelo acessório.
        toast.warning(`Assembleia encerrada, mas o dossiê falhou: ${r.erroDossie}. Reemita pelo botão.`);
      } else {
        toast.success('Assembleia encerrada e dossiê emitido.');
      }
      setAberto(false);
      onEncerrado();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível encerrar.');
    } finally {
      setExecutando(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setAberto(true)}>
        <Gavel className="h-4 w-4" /> Encerrar assembleia
      </Button>

      <ConfirmDialog
        open={aberto}
        variant="destructive"
        title="Encerrar a assembleia?"
        confirmLabel="Encerrar e emitir dossiê"
        loading={executando}
        onConfirm={confirmar}
        onClose={() => (executando ? null : setAberto(false))}
        description={
          !previa ? (
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Conferindo…</span>
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                Encerra as votações abertas, fecha o check-in e emite o dossiê com
                quórum, deliberações e lista de presença.
              </p>

              {previa.alertas.length > 0 && (
                <ul className="space-y-1.5 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
                  {previa.alertas.map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-200">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              )}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Presentes</dt>
                <dd className="text-right font-medium">{previa.presentes}</dd>
                <dt className="text-muted-foreground">Votações abertas</dt>
                <dd className="text-right font-medium">{previa.pautasAbertas.length}</dd>
                <dt className="text-muted-foreground">Já encerradas</dt>
                <dd className="text-right font-medium">{previa.pautasEncerradas}</dd>
                {previa.pautasNaoVotadas > 0 && (
                  <>
                    <dt className="text-muted-foreground">Nunca votadas</dt>
                    <dd className="text-right font-medium">{previa.pautasNaoVotadas}</dd>
                  </>
                )}
              </dl>
            </div>
          )
        }
      />
    </>
  );
}

/**
 * O que a assembleia produziu — a resposta para "e aí?".
 *
 * Aparece no lugar dos controles ao vivo depois do encerramento: quórum,
 * horários, o que foi decidido em cada pauta, e os documentos.
 */
export function ResumoEncerramento({ eventoId }: { eventoId: string }) {
  const qc = useQueryClient();
  const [baixando, setBaixando] = useState(false);

  const { data: resumo, isLoading } = useQuery({
    queryKey: ['evento-resumo', eventoId],
    queryFn: () => obterResumo(eventoId),
  });

  const { data: certificados } = useQuery({
    queryKey: ['evento-certificados', eventoId],
    queryFn: () => listarCertificados(eventoId),
  });

  if (isLoading || !resumo) {
    return (
      <Card><CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando o resumo…
      </CardContent></Card>
    );
  }

  const hora = (v: string | null) =>
    v ? new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="space-y-4">
      <Card className="border-brand-300 dark:border-brand-800">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-400">
              Assembleia encerrada
            </p>
            <p className="text-sm text-muted-foreground">
              {new Date(resumo.evento.dataInicio).toLocaleDateString('pt-BR', { dateStyle: 'long' })}
              {' · '}{hora(resumo.evento.dataInicio)} às {hora(resumo.evento.dataFim ?? null)}
              {' · '}<strong className="text-foreground">{resumo.presentes}</strong> presente(s)
            </p>
            {resumo.primeiraPresenca && (
              <p className="text-xs text-muted-foreground">
                Primeiro registro às {hora(resumo.primeiraPresenca)}; último às {hora(resumo.ultimaPresenca)}.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={baixando}
              onClick={async () => {
                setBaixando(true);
                try {
                  await baixarDossie(eventoId);
                } catch {
                  toast.error('Não foi possível abrir o dossiê.');
                } finally {
                  setBaixando(false);
                }
              }}
            >
              {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Dossiê da assembleia
            </Button>
            {!resumo.dossieEmitido && (
              <span className="self-center text-xs text-amber-700 dark:text-amber-400">
                Ainda não emitido — será gerado ao abrir.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {resumo.deliberacoes.length > 0 && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <h3 className="font-semibold">O que foi decidido</h3>
            {resumo.deliberacoes.map((d) => (
              <div key={d.pautaId} className="space-y-2 border-t pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{d.titulo}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                    {d.modo === 'SECRETA' ? 'secreta' : 'nominal'}
                  </span>
                </div>
                <ResultadoPauta apuracao={d} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <ListaPresenca eventoId={eventoId} />

      {certificados?.habilitado && certificados.participantes.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <Award className="h-4 w-4 text-brand-800 dark:text-brand-400" />
              Certificados
              {certificados.cargaHoraria && (
                <span className="text-sm font-normal text-muted-foreground">
                  · {certificados.cargaHoraria}h
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              O código de verificação impresso pode ser conferido por qualquer pessoa,
              sem login.
            </p>
            <ul className="divide-y">
              {certificados.participantes.map((p) => (
                <li key={p.presencaId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.nome}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{p.codigo}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => baixarCertificado(eventoId, p.presencaId, p.nome)}
                  >
                    <Download className="h-4 w-4" /> Certificado
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {resumo.sorteios.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-5">
            <h3 className="font-semibold">Sorteios</h3>
            {resumo.sorteios.map((s) => (
              <div key={s.id} className="border-t pt-2 first:border-0 first:pt-0">
                <p className="text-sm font-medium">{s.titulo}</p>
                <p className="text-sm text-muted-foreground">
                  {s.resultado?.map((g) => g.nome).join(', ')}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
