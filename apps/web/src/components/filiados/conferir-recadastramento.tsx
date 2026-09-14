'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  conferirRecadastramento, listarRecadastramentos, type Recadastramento,
} from '@/lib/filiados';
import { recadastramentosAConferir, valorDaAlteracao } from '@/lib/recadastro';
import { validadeCurta } from '@/lib/envio-recadastro';

/** Quantas alterações aparecem antes do "ver as outras". */
const VISIVEIS = 8;

function mensagemDeErro(e: unknown, padrao: string): string {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  return typeof msg === 'string' && msg.trim() ? msg : padrao;
}

/**
 * O QUE O FILIADO MANDOU PELO LINK, PARA ALGUÉM CONFERIR.
 *
 * A página pública promete que os dados "serão conferidos pela equipe", e o
 * recadastramento online nasce PENDENTE para isso. Até aqui nenhuma tela
 * mostrava essas pendências — mandar mais links só produziria mais dado que
 * ninguém olhou.
 *
 * É ESTADO: o bloco existe enquanto houver o que conferir e some quando não
 * houver. Não aparece enquanto a lista carrega (na maioria das fichas ele não
 * existe, e um esqueleto que some seria um salto à toa); o erro aparece, porque
 * erro que vira "nada a conferir" esconde justamente a pendência.
 *
 * "Conferido" não desfaz nem corrige nada: o cadastro já foi gravado quando o
 * filiado enviou. Para corrigir, a pessoa usa Editar e depois marca.
 */
export function ConferirRecadastramento({
  filiadoId,
  podeConferir,
}: {
  filiadoId: string;
  podeConferir: boolean;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['recadastramentos', filiadoId],
    queryFn: () => listarRecadastramentos(filiadoId),
  });

  if (isLoading) return null;

  if (isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
        <span>Não foi possível ver se há atualização feita pelo filiado esperando conferência.</span>
        <Button variant="outline" className="h-11 md:h-11" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Tentar de novo
        </Button>
      </div>
    );
  }

  const pendentes = recadastramentosAConferir(data);
  if (pendentes.length === 0) return null;

  return (
    <div className="space-y-3">
      {pendentes.map((r) => (
        <UmaConferencia key={r.id} filiadoId={filiadoId} recadastramento={r} podeConferir={podeConferir} />
      ))}
    </div>
  );
}

function UmaConferencia({
  filiadoId,
  recadastramento: r,
  podeConferir,
}: {
  filiadoId: string;
  recadastramento: Recadastramento;
  podeConferir: boolean;
}) {
  const qc = useQueryClient();
  const [verTudo, setVerTudo] = useState(false);
  const alteracoes = r.alteracoes ?? [];
  const mostradas = verTudo ? alteracoes : alteracoes.slice(0, VISIVEIS);
  const escondidas = alteracoes.length - mostradas.length;
  const tituloId = `conferir-${r.id}`;
  /*
    14/09/2026: o link pode confirmar um dado só. Se ele preencheu o CPF ou a
    data de nascimento que estavam vazios, esse valor vira o que o próximo
    link pede, e ninguém o provou. Uma linha, no topo, antes do de-para.

    A frase vem PRONTA da API (`avisoDaConfirmacao`), e não é recalculada aqui:
    uma segunda cópia da regra na tela divergiria da primeira. Ausente (API
    anterior) ou nula: nada a avisar.
  */
  const avisoUmFator = r.avisoDaConfirmacao?.trim() || null;

  const conferir = useMutation({
    mutationFn: () => conferirRecadastramento(r.id),
    onSuccess: () => {
      toast.success('Marcado como conferido.');
      void qc.invalidateQueries({ queryKey: ['recadastramentos', filiadoId] });
      void qc.invalidateQueries({ queryKey: ['filiado', filiadoId] });
    },
    onError: (e) => toast.error(mensagemDeErro(e, 'Não foi possível marcar como conferido.')),
  });

  return (
    <section
      aria-labelledby={tituloId}
      className="rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-900/10 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={tituloId} className="font-semibold text-amber-950 dark:text-amber-100">
            Atualização feita pelo próprio filiado
          </h3>
          <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
            Chegou pelo link em {validadeCurta(r.createdAt)} e aguarda conferência.
          </p>
        </div>
      </div>

      {avisoUmFator && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-card px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span>{avisoUmFator}</span>
        </p>
      )}

      {alteracoes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {r.alteracoes
            ? 'O filiado enviou o cadastro sem mudar nenhum dado.'
            : 'Esta versão do sistema não trouxe a lista do que mudou. Confira os dados abaixo.'}
        </p>
      ) : (
        <dl className="mt-3 divide-y divide-amber-200/70 rounded-lg border border-amber-200/70 bg-card dark:divide-amber-900/40 dark:border-amber-900/40">
          {mostradas.map((a) => (
            <div key={a.campo} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:pt-0.5">
                {a.rotulo}
              </dt>
              <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className="break-words text-muted-foreground line-through decoration-muted-foreground/50">
                  <span className="sr-only">De </span>
                  {valorDaAlteracao(a.de)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
                <span className="break-words font-medium">
                  <span className="sr-only">para </span>
                  {valorDaAlteracao(a.para)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {escondidas > 0 && (
        <button
          type="button"
          onClick={() => setVerTudo(true)}
          className="mt-1 min-h-11 text-sm font-medium text-brand-800 underline-offset-4 hover:underline dark:text-brand-400"
        >
          Ver as outras {escondidas} alterações
        </button>
      )}

      {podeConferir ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Confira o que parecer estranho com o filiado ou com os documentos. Para corrigir, use
            Editar; depois marque como conferido.
          </p>
          <Button
            className="h-11 shrink-0 md:h-11"
            disabled={conferir.isPending}
            onClick={() => conferir.mutate()}
          >
            {conferir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Conferido
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          A conferência fica com quem edita o cadastro dos filiados.
        </p>
      )}
    </section>
  );
}
