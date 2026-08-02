'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, FileText, Loader2, LogOut, MapPin, Plus, Receipt, ShieldCheck, Upload,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePortalEmpresa } from '@/components/portal-empresa/portal-guard';
import { NovaDeclaracaoWizard } from '@/components/portal-empresa/nova-declaracao-wizard';
import { GuiaContribuicao } from '@/components/portal-empresa/guia-contribuicao';
import { RetomarGuiaModal } from '@/components/portal-empresa/retomar-guia-modal';
import { toast } from 'sonner';
import {
  buscarDados, listarContribuicoes, abrirDocumento, mascaraCnpj, formatarReais,
  STATUS_CONTRIBUICAO, type Contribuicao,
} from '@/lib/portal-empresa';

/** Dashboard da empresa: identificação + histórico de guias. */
export default function PortalEmpresaHome() {
  const { empresa, sair } = usePortalEmpresa();
  const [novaAberta, setNovaAberta] = useState(false);
  const [retomar, setRetomar] = useState<Contribuicao | null>(null);

  // Os dados exibidos vêm do SERVIDOR, não do localStorage.
  const { data, isLoading } = useQuery({
    queryKey: ['portal-empresa', 'dados'],
    queryFn: buscarDados,
  });

  const { data: contribuicoes, isLoading: carregandoGuias } = useQuery({
    queryKey: ['portal-empresa', 'contribuicoes'],
    queryFn: listarContribuicoes,
  });

  return (
    <>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Logo orientation="horizontal" variant="auto" className="h-8" />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="truncate text-sm font-semibold">
                {empresa?.nomeFantasia || empresa?.razaoSocial}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {empresa ? mascaraCnpj(empresa.cnpj) : ''}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={sair}>
              <LogOut className="h-4 w-4" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {/* Identificação */}
        <div className="rounded-2xl border bg-card p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-senatepi-800 dark:text-senatepi-400">
            <ShieldCheck className="h-4 w-4" /> Acesso confirmado
          </p>
          {isLoading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando seu cadastro…
            </p>
          ) : (
            <>
              <h1 className="mt-2 text-xl font-bold">{data?.razaoSocial}</h1>
              {data?.nomeFantasia && (
                <p className="text-sm text-muted-foreground">{data.nomeFantasia}</p>
              )}
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                CNPJ {data ? mascaraCnpj(data.cnpj) : ''}
              </p>
              {(data?.logradouro || data?.cidade) && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {[data.logradouro, data.bairro, data.cidade && `${data.cidade}${data.uf ? ` / ${data.uf}` : ''}`]
                    .filter(Boolean)
                    .join(' — ')}
                </p>
              )}
            </>
          )}
        </div>

        {/* Guia de uso — a empresa entra aqui uma vez por mês. */}
        <GuiaContribuicao />

        {/* Contribuições */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Receipt className="h-5 w-5" /> Contribuição patronal
              </h2>
              <p className="text-xs text-muted-foreground">
                Histórico das guias declaradas pela sua empresa.
              </p>
            </div>
            <Button onClick={() => setNovaAberta(true)}>
              <Plus className="h-4 w-4" /> Nova declaração
            </Button>
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card">
            {carregandoGuias && (
              <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando guias…
              </p>
            )}

            {!carregandoGuias && contribuicoes?.length === 0 && (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <Receipt className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">Nenhuma declaração ainda</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Clique em “Nova declaração” para informar a competência, pagar o PIX e enviar os
                  documentos.
                </p>
              </div>
            )}

            <ul className="divide-y">
              {contribuicoes?.map((c) => {
                const s = STATUS_CONTRIBUICAO[c.status];
                const pendente = c.status === 'AGUARDANDO' || c.status === 'REJEITADA';
                // Em análise com um documento só: dá para completar o que falta
                // enquanto o sindicato não decidiu.
                const incompleta =
                  c.status === 'EM_ANALISE' && (!c.temComprovante || !c.temRelacao);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold capitalize">{c.competencia}</p>
                      <p className="text-xs text-muted-foreground">
                        {incompleta
                          ? `Recebemos ${c.temComprovante ? 'o comprovante' : 'a relação'}. Falta ${c.temComprovante ? 'a relação de trabalhadores' : 'o comprovante do PIX'}.`
                          : s.descricao}
                      </p>
                      {/* O motivo escrito pelo sindicato é o que orienta a correção. */}
                      {c.status === 'REJEITADA' && c.motivoRejeicao && (
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span><strong>Motivo:</strong> {c.motivoRejeicao}</span>
                        </p>
                      )}
                    </div>

                    <p className="text-sm font-bold">{formatarReais(c.valorDeclarado)}</p>
                    <Badge className={s.classe}>{s.label}</Badge>

                    <div className="flex w-full gap-2 sm:w-auto">
                      {(pendente || incompleta) && (
                        <Button
                          size="sm"
                          variant={incompleta ? 'default' : 'outline'}
                          onClick={() => setRetomar(c)}
                        >
                          <Upload className="h-4 w-4" />
                          {c.status === 'REJEITADA'
                            ? 'Reenviar'
                            : incompleta
                              ? `Enviar ${c.temComprovante ? 'a relação' : 'o comprovante'}`
                              : 'Continuar'}
                        </Button>
                      )}
                      {c.temRelacao && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            abrirDocumento(c.id, 'relacao').catch(() =>
                              toast.error('Não foi possível abrir o documento.'),
                            )
                          }
                        >
                          <FileText className="h-3.5 w-3.5" /> Relação
                        </Button>
                      )}
                      {c.temComprovante && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            abrirDocumento(c.id, 'comprovante').catch(() =>
                              toast.error('Não foi possível abrir o documento.'),
                            )
                          }
                        >
                          <Receipt className="h-3.5 w-3.5" /> Comprovante
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>

      <NovaDeclaracaoWizard open={novaAberta} onClose={() => setNovaAberta(false)} />
      <RetomarGuiaModal contribuicao={retomar} onClose={() => setRetomar(null)} />
    </>
  );
}
