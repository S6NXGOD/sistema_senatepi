'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Lock, MessageSquareText, Scale } from 'lucide-react';
import { CascaDoPortal } from '@/components/portal-filiado/casca';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import {
  buscarMeuProcesso,
  type AndamentoTraduzido,
  type RecadoDoSindicato,
} from '@/lib/portal-filiado';
import { formatData } from '@/lib/processos';
import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function MeuProcessoPage() {
  const { id } = useParams<{ id: string }>();
  const [verTudo, setVerTudo] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal-filiado', 'processo', id],
    queryFn: () => buscarMeuProcesso(id),
    retry: false,
  });

  /*
    POR PADRÃO, SÓ O QUE SIGNIFICA ALGUMA COISA.

    Medido em 20.590 movimentações: "Expedição de documento" (3.071),
    "Conclusão" (2.919), "Remessa" (338), "Recebimento" (168) — quase um terço
    do total é a máquina do tribunal andando. Numa lista de trinta itens no
    celular, isso soterra a audiência.

    NADA É ESCONDIDO: o botão diz quantas faltam e traz todas com um toque.
  */
  const todos = data?.movimentacoes ?? [];
  const relevantes = todos.filter((m) => m.peso !== 'TRAMITE');
  const mostrados = verTudo ? todos : relevantes;
  const ocultos = todos.length - relevantes.length;

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
          {/* ---- O que está acontecendo, em uma frase ---- */}
          {data.agora && (
            <section className="rounded-2xl border border-brand-200 bg-brand-50/70 p-5 dark:border-brand-900/70 dark:bg-brand-900/20">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-300">
                Onde está agora
              </p>
              <p className="mt-1 text-base font-bold leading-snug text-brand-900 dark:text-brand-100">
                {data.agora.titulo}
              </p>
              {data.agora.explica && (
                <p className="mt-1 text-xs leading-snug text-brand-900/80 dark:text-brand-200/80">
                  {data.agora.explica}
                </p>
              )}
              <p className="mt-2 text-[11px] text-brand-900/70 dark:text-brand-200/70">
                Desde {formatData(data.agora.em)}
              </p>
            </section>
          )}

          {/* ---- Os recados do sindicato ---- */}
          {data.recados.length > 0 && (
            <section className="space-y-2">
              {data.recados.map((r) => (
                <Recado key={r.id} recado={r} />
              ))}
            </section>
          )}

          {/* ---- A identificação do processo ---- */}
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
              <Campo rotulo="Tipo de ação" valor={data.classeProcessual} />
              <Campo rotulo="Assunto" valor={data.assuntoPrincipal} />
              <Campo rotulo="Onde tramita" valor={data.orgaoJulgador ?? data.tribunal} />
              <Campo
                rotulo="Entrou na Justiça em"
                valor={data.dataDistribuicao ? formatData(data.dataDistribuicao) : null}
              />
              <Campo
                rotulo="Valor da causa"
                valor={data.valorCausa ? MOEDA.format(data.valorCausa) : null}
              />
            </dl>

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

          {/* ---- A linha do tempo ---- */}
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-bold">O que já aconteceu</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Em português. Dúvida sobre o que significa? Fale com o {tenant.sigla}.
            </p>

            {!mostrados.length ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Ainda não há movimentação registrada.
              </p>
            ) : (
              <ol className="mt-4 space-y-4 border-l pl-4">
                {mostrados.map((m) => (
                  <Andamento key={m.id} andamento={m} />
                ))}
              </ol>
            )}

            {/*
              O BOTÃO DIZ QUANTAS FALTAM. "Ver mais" sem número faz a pessoa
              tocar para descobrir se vale a pena; com o número ela decide antes.
            */}
            {ocultos > 0 && (
              <button
                type="button"
                onClick={() => setVerTudo((v) => !v)}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', verTudo && 'rotate-180')} />
                {verTudo
                  ? 'Mostrar só o que importa'
                  : `Ver também ${ocultos} ${ocultos === 1 ? 'passo interno' : 'passos internos'} do tribunal`}
              </button>
            )}
          </section>
        </div>
      )}
    </CascaDoPortal>
  );
}

/**
 * O RECADO DO SINDICATO — a única coisa nesta tela escrita por uma PESSOA.
 *
 * Por isso ele fica no topo, acima até da identificação do processo: tudo o
 * mais é estado; isto é alguém falando com quem está lendo.
 */
function Recado({ recado: r }: { recado: RecadoDoSindicato }) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-4',
        r.novo
          ? 'border-amber-300 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-900/20'
          : 'border-muted bg-muted/40',
      )}
    >
      <div className="flex items-center gap-2">
        <MessageSquareText
          className={cn(
            'h-4 w-4 shrink-0',
            r.novo ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        />
        <p className="text-xs font-semibold">
          Recado do {tenant.sigla}
          {r.novo && (
            <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-800 dark:text-amber-100">
              novo
            </span>
          )}
        </p>
      </div>
      {/* `whitespace-pre-line`: o advogado escreve em parágrafos, e eles ficam. */}
      <p className="mt-2 whitespace-pre-line text-sm leading-snug">{r.texto}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {r.autorNome} · {formatData(r.createdAt)}
      </p>
    </div>
  );
}

function Andamento({ andamento: m }: { andamento: AndamentoTraduzido }) {
  const marco = m.peso === 'MARCO';
  return (
    <li className="relative">
      {/*
        A BOLINHA CHEIA É O MARCO. O destaque de subconjunto se faz com ordem e
        cor, e não com um segundo bloco — a audiência não ganha uma caixa
        própria, ganha um ponto mais forte na mesma coluna.
      */}
      <span
        className={cn(
          'absolute rounded-full',
          marco
            ? '-left-[23px] top-1 h-2.5 w-2.5 bg-brand-600 ring-2 ring-brand-100 dark:bg-brand-500 dark:ring-brand-900'
            : '-left-[21px] top-1.5 h-2 w-2 bg-muted-foreground/40',
        )}
      />
      <p className="text-[11px] font-semibold text-muted-foreground">
        {formatData(m.dataMovimento)}
      </p>
      <p className={cn('mt-0.5 text-xs leading-snug', marco && 'font-semibold')}>{m.titulo}</p>
      {m.explica && (
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{m.explica}</p>
      )}
      {/*
        O TEXTO DO TRIBUNAL FICA À VISTA quando foi traduzido: é o que o
        advogado lê no sistema do TRT e o que a pessoa vai repetir ao telefone.
        Esconder faria a tradução virar uma segunda verdade.
      */}
      {m.traduzido && (
        <p className="mt-0.5 text-[10px] text-muted-foreground/70">
          No tribunal: {m.original}
          {m.orgaoJulgador ? ` · ${m.orgaoJulgador}` : ''}
        </p>
      )}
      {!m.traduzido && m.orgaoJulgador && (
        <p className="mt-0.5 text-[10px] text-muted-foreground/70">{m.orgaoJulgador}</p>
      )}
    </li>
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
