'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, Scale } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { buscarMeuProcesso } from '@/lib/portal-filiado';
import { formatData } from '@/lib/processos';
import { tenant } from '@/tenant.config';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function MeuProcessoPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal-filiado', 'processo', id],
    queryFn: () => buscarMeuProcesso(id),
    retry: false,
  });

  return (
    <CascaDoPortal>
      <Link
        href="/filiado/processos"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Meus processos
      </Link>

      {isLoading ? (
        <Carregando texto="Carregando…">
          <EsqueletoLinhas quantidade={4} altura={72} className="divide-y-0 space-y-3" />
        </Carregando>
      ) : isError || !data ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm">
          <p className="font-semibold">Processo não encontrado.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ou ele não é seu, ou saiu do acervo do sindicato.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {data.situacao}
              </span>
              {data.segredoJustica && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> Segredo de justiça
                </span>
              )}
            </div>
            <h1 className="mt-2 break-all font-mono text-base font-bold leading-snug">
              {data.identificacao}
            </h1>

            <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <Campo rotulo="Classe" valor={data.classeProcessual} />
              <Campo rotulo="Assunto" valor={data.assuntoPrincipal} />
              <Campo rotulo="Órgão julgador" valor={data.orgaoJulgador} />
              <Campo rotulo="Tribunal" valor={data.tribunal} />
              <Campo
                rotulo="Distribuído em"
                valor={data.dataDistribuicao ? formatData(data.dataDistribuicao) : null}
              />
              <Campo
                rotulo="Valor da causa"
                valor={data.valorCausa ? MOEDA.format(data.valorCausa) : null}
              />
            </dl>

            {/*
              QUEM CUIDA DO CASO é a informação que a pessoa liga para pedir.
              O nome do advogado é do SINDICATO e sai; nada das outras partes
              do processo aparece aqui — em ação coletiva elas são outros
              filiados.
            */}
            {data.advogadoResponsavel && (
              <p className="mt-4 flex items-center gap-2 border-t pt-4 text-xs">
                <Scale className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
                <span>
                  <span className="text-muted-foreground">Acompanhado por </span>
                  <span className="font-semibold">{data.advogadoResponsavel}</span>
                  <span className="text-muted-foreground"> — {tenant.sigla}</span>
                </span>
              </p>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-bold">Movimentações do tribunal</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              O que consta nos autos, como o tribunal publicou. Dúvida sobre o que significa? Fale
              com o {tenant.sigla}.
            </p>

            {!data.movimentacoes.length ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Ainda não há movimentação registrada.
              </p>
            ) : (
              /*
                LINHA DO TEMPO, do mais novo para o mais antigo. A borda à
                esquerda faz o olho descer a coluna sem precisar de marcador em
                cada item — e cabe em 320px de largura.
              */
              <ol className="mt-4 space-y-4 border-l pl-4">
                {data.movimentacoes.map((m) => (
                  <li key={m.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-600 dark:bg-brand-500" />
                    <p className="text-[11px] font-semibold text-muted-foreground">
                      {formatData(m.dataMovimento)}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug">{m.descricao}</p>
                    {m.orgaoJulgador && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{m.orgaoJulgador}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </CascaDoPortal>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 font-medium leading-snug">{valor}</dd>
    </div>
  );
}
