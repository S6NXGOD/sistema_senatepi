'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, IdCard, Loader2 } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Button } from '@/components/ui/button';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { ErroPortal, baixarMinhaCarteirinha, buscarCarteirinha } from '@/lib/portal-filiado';
import { formatDataPura } from '@/lib/data-pura';
import { tenant } from '@/tenant.config';

export default function MinhaCarteirinhaPage() {
  const [baixando, setBaixando] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['portal-filiado', 'carteirinha'],
    queryFn: buscarCarteirinha,
  });

  async function baixar() {
    setBaixando(true);
    try {
      await baixarMinhaCarteirinha();
    } catch (err) {
      toast.error((err as ErroPortal).message);
    } finally {
      setBaixando(false);
    }
  }

  const iniciais = (nome: string) => {
    const particulas = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
    const partes = nome
      .trim()
      .split(/\s+/)
      .filter((p) => p && !particulas.has(p.toLowerCase()));
    if (!partes.length) return '?';
    return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
  };

  return (
    <CascaDoPortal>
      <h1 className="mb-4 text-lg font-bold">Carteirinha</h1>

      {isLoading || !data ? (
        <Carregando texto="Carregando…">
          <EsqueletoLinhas quantidade={2} altura={120} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : !data.emitida ? (
        /*
          NÃO EMITIDA NÃO É ERRO. 173 ativos estão neste estado, e o portal não
          pode fazer o filiado achar que o sistema falhou — nem oferecer um botão
          que ele não tem permissão de usar. Diz o que é e para onde ir.
        */
        <div className="rounded-2xl border bg-card p-6 text-center">
          <IdCard className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">Sua carteirinha ainda não foi emitida.</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-snug text-muted-foreground">
            Peça na secretaria do {tenant.sigla}. Assim que ela emitir, o arquivo aparece aqui para
            você baixar quando quiser.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/*
            A PRÉVIA NA TELA É UMA LEMBRANÇA DO CARTÃO, não uma segunda versão
            dele. O documento de verdade é o PDF, gerado pelo MESMO código que a
            secretaria usa — desenhar o cartão de novo em HTML criaria duas
            fontes que divergem na primeira mudança de arte.
          */}
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="flex">
              <div className="min-w-0 flex-1 p-5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-400">
                  Carteira de associado
                </p>
                <p className="mt-2 text-[10px] uppercase text-muted-foreground">Nome</p>
                <p className="truncate text-sm font-bold">{data.nomeCompleto}</p>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {data.categoria && (
                    <Campo rotulo="Categoria" valor={data.categoriaOutro || data.categoria} />
                  )}
                  <Campo rotulo="Matrícula" valor={data.matricula} />
                  <Campo
                    rotulo="Válida até"
                    valor={data.validaAte ? formatDataPura(data.validaAte) : 'Indeterminada'}
                  />
                  {data.dataFiliacao && (
                    <Campo rotulo="Filiado(a) desde" valor={formatDataPura(data.dataFiliacao)} />
                  )}
                </dl>
              </div>
              <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-2 bg-brand-700 p-3 dark:bg-brand-800">
                <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-white text-2xl font-bold text-brand-700">
                  {iniciais(data.nomeCompleto)}
                </span>
                <span className="text-center text-[9px] font-bold uppercase leading-tight text-white">
                  {tenant.sigla}
                </span>
              </div>
            </div>
            <div className="border-t px-5 py-2 text-[10px] text-muted-foreground">
              Nº {data.numero}
              {data.emitidaEm && ` · emitida em ${formatDataPura(data.emitidaEm)}`}
            </div>
          </div>

          <Button onClick={baixar} disabled={baixando} className="w-full">
            {baixando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" /> Baixar em PDF (frente e verso)
              </>
            )}
          </Button>

          <p className="text-center text-[11px] leading-snug text-muted-foreground">
            O PDF tem as duas faces e é o mesmo que a secretaria imprime. Guarde no celular ou
            imprima — vale mediante documento oficial com foto.
          </p>
        </div>
      )}
    </CascaDoPortal>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase text-muted-foreground">{rotulo}</dt>
      <dd className="truncate font-semibold">{valor}</dd>
    </div>
  );
}
