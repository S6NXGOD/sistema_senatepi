'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Check, Loader2, Sparkles, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  aplicarVinculos, listarVinculosPendentes,
  type CasoSemFiliado, type DecisaoDeVinculo,
} from '@/lib/partes';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

/**
 * A FILA "SEM FILIADO", RESOLVIDA DE UMA SENTADA.
 *
 * Resolver um caso custava abrir o processo, achar a aba, procurar um nome que
 * a busca não encontrava e desistir — e foi assim que a fila chegou a 29. Aqui
 * os casos aparecem lado a lado, cada um já com o candidato ao lado do nome dos
 * autos, e a pessoa confirma em sequência.
 *
 * DUAS ESPÉCIES, DUAS RESPOSTAS. Medido na produção: 25 casos são pessoas que
 * precisam de vínculo e 5 são o próprio sindicato ou outra entidade no polo
 * ativo. Para os 5 não existe filiado dono — é ação institucional marcada como
 * individual por engano, e a resposta é mudar o tipo. Sem essa separação a fila
 * nunca zera, e fila que não zera é fila que se aprende a ignorar.
 *
 * NADA É AUTOMÁTICO. Cada linha marcada é uma escolha de quem lê: "ANGELA
 * MARIA" casa com quatro filiadas distintas nesta base, e vincular a errada
 * junta o processo de uma pessoa à ficha de outra.
 */
export function ResolverVinculosPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  /** processoId -> filiadoId escolhido, ou o marcador de institucional. */
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const INSTITUCIONAL = '@institucional';

  const { data: casos = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['vinculos-pendentes'],
    queryFn: listarVinculosPendentes,
    enabled: open,
  });

  const pessoas = useMemo(() => casos.filter((c) => c.especie === 'PESSOA'), [casos]);
  const entidades = useMemo(() => casos.filter((c) => c.especie === 'ENTIDADE'), [casos]);
  const marcados = Object.keys(escolhas).length;

  const aplicar = useMutation({
    mutationFn: () => {
      const decisoes: DecisaoDeVinculo[] = casos
        .filter((c) => escolhas[c.processoId])
        .map((c) =>
          escolhas[c.processoId] === INSTITUCIONAL
            ? { processoId: c.processoId, marcarInstitucional: true }
            : { parteId: c.parteId as string, filiadoId: escolhas[c.processoId] },
        );
      return aplicarVinculos(decisoes);
    },
    onSuccess: (r) => {
      setEscolhas({});
      qc.invalidateQueries({ queryKey: ['vinculos-pendentes'] });
      qc.invalidateQueries({ queryKey: ['processos'] });
      qc.invalidateQueries({ queryKey: ['processos-contagem'] });
      if (r.falhas.length) {
        toast.warning(
          `${r.aplicadas} resolvido(s). ${r.falhas.length} não passou: ${r.falhas[0].motivo}`,
        );
      } else {
        toast.success(`${r.aplicadas} processo(s) resolvido(s).`);
      }
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível aplicar as decisões.'),
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={aplicar.isPending ? undefined : onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="min-w-0">
            <h3 className="text-base font-bold">Resolver vínculos</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Confirme quem é cada parte. Nada é gravado antes de você aplicar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {isLoading && (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Procurando candidatos no cadastro…
            </p>
          )}

          {/*
            FALHAR NÃO É "NÃO TEM NADA" — e confundir os dois escondeu um bug
            por um dia inteiro.

            A rota deste painel estava sendo engolida por `/processos/:id` e
            respondia "processo não encontrado". A tela lia o erro como lista
            vazia e escrevia "Nenhum processo pendente de vínculo" ao lado de um
            contador dizendo 29. Quem visse aquilo concluiria que a fila tinha
            zerado sozinha.
          */}
          {isError && (
            <div className="space-y-3 py-10 text-center">
              <p className="text-sm font-medium">Não foi possível carregar a fila.</p>
              <p className="mx-auto max-w-sm text-xs leading-snug text-muted-foreground">
                {(error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                  'A lista existe — foi a consulta que falhou. Tente de novo; se insistir, avise a administração.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Tentar de novo
              </Button>
            </div>
          )}

          {!isLoading && !isError && casos.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhum processo pendente de vínculo.
            </p>
          )}

          {pessoas.length > 0 && (
            <section className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <UserRound className="h-3.5 w-3.5" /> Pessoas ({pessoas.length})
              </h4>
              {pessoas.map((c) => (
                <LinhaPessoa
                  key={c.processoId}
                  caso={c}
                  escolhido={escolhas[c.processoId] ?? null}
                  onEscolher={(filiadoId) =>
                    setEscolhas((e) => {
                      const novo = { ...e };
                      if (!filiadoId || novo[c.processoId] === filiadoId) delete novo[c.processoId];
                      else novo[c.processoId] = filiadoId;
                      return novo;
                    })
                  }
                />
              ))}
            </section>
          )}

          {entidades.length > 0 && (
            <section className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" /> Sem {V.filiado} dono ({entidades.length})
              </h4>
              {/*
                A LEITURA PODE ERRAR, e a tela diz como sair.

                A espécie sai do NOME, e nome de entidade se confunde com
                sobrenome de gente — "Câmara" é sobrenome brasileiro comum. Hoje
                não há nenhum caso assim nesta base (conferido nos 7.291
                filiados e nas 128 partes ativas), mas a base cresce. Em vez de
                afinar a expressão para sempre, a tela avisa que a classificação
                é palpite e aponta o caminho certo.
              */}
              <p className="text-[11px] leading-snug text-muted-foreground">
                No polo ativo está o próprio {tenant.sigla}, outra entidade ou uma empresa. Não há
                {' '}{V.filiado} a vincular — são ações institucionais marcadas como individuais.
                Se algum destes for uma pessoa, abra o processo e vincule por lá.
              </p>
              {entidades.map((c) => (
                <button
                  key={c.processoId}
                  type="button"
                  onClick={() =>
                    setEscolhas((e) => {
                      const novo = { ...e };
                      if (novo[c.processoId]) delete novo[c.processoId];
                      else novo[c.processoId] = INSTITUCIONAL;
                      return novo;
                    })
                  }
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition',
                    escolhas[c.processoId]
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      escolhas[c.processoId] ? 'border-brand-700 bg-brand-700 text-white' : 'border-input',
                    )}
                  >
                    {escolhas[c.processoId] && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.nomeNosAutos ?? '(polo ativo vazio)'}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {c.numeroCNJ ?? 'sem número'}
                      {c.adversario ? ` · contra ${c.adversario}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-brand-800 dark:text-brand-400">
                    marcar institucional
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">
            {marcados === 0
              ? 'Selecione ao menos um.'
              : `${marcados} de ${casos.length} marcado(s).`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={aplicar.isPending}>
              Fechar
            </Button>
            <Button onClick={() => aplicar.mutate()} disabled={marcados === 0 || aplicar.isPending}>
              {aplicar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Aplicar {marcados > 0 ? marcados : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Um caso de pessoa. Os candidatos aparecem como opções; clicar de novo
 * desmarca — desistir tem de ser tão fácil quanto escolher.
 */
function LinhaPessoa({
  caso, escolhido, onEscolher,
}: {
  caso: CasoSemFiliado;
  escolhido: string | null;
  onEscolher: (filiadoId: string | null) => void;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition',
        escolhido && 'border-brand-500 bg-brand-50/50 dark:bg-brand-900/10',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{caso.nomeNosAutos ?? '—'}</p>
        <p className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {caso.numeroCNJ ?? 'sem número'}
        </p>
      </div>
      {caso.adversario && (
        <p className="truncate text-[11px] text-muted-foreground">contra {caso.adversario}</p>
      )}

      {caso.candidatos.length === 0 ? (
        /*
          NENHUM CANDIDATO NÃO É ERRO. Doze dos casos medidos são assim: o nome
          dos autos não corresponde a ninguém no cadastro, e a resposta exige
          pesquisa de gente — não há palpite honesto a oferecer aqui.
        */
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          Nenhum cadastro parecido. Abra o processo para procurar ou cadastrar.
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {caso.candidatos.map((c) => {
            const ativo = escolhido === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onEscolher(ativo ? null : c.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                    ativo
                      ? 'border-brand-700 bg-brand-700 text-white'
                      : 'hover:bg-muted',
                  )}
                >
                  {c.confianca === 'CERTEZA' ? (
                    <Sparkles className="h-3 w-3 shrink-0" />
                  ) : ativo ? (
                    <Check className="h-3 w-3 shrink-0" />
                  ) : null}
                  <span className="max-w-[16rem] truncate">{c.nome}</span>
                  {c.confianca === 'CERTEZA' && (
                    <span className={cn('text-[10px] uppercase', ativo ? 'opacity-80' : 'text-brand-800 dark:text-brand-400')}>
                      mesmo CPF
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {caso.candidatos.length > 1 && (
        <p className="mt-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          Mais de um cadastro com nome parecido — confira antes de marcar.
        </p>
      )}
    </div>
  );
}
