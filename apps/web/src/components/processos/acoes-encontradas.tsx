'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Radar, Scale, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatNPU,
  ignorarSugestao,
  listarSugestoesDeProcesso,
  type SugestaoDeProcesso,
} from '@/lib/processos';

/**
 * AÇÕES QUE O DIÁRIO REVELOU E O ACERVO NÃO CONHECE.
 *
 * A varredura do DJEN consulta por OAB, e o CNJ devolve a carteira INTEIRA de
 * cada advogado. Tudo que não casava com um processo cadastrado era descartado
 * na ingestão — decisão correta de privacidade: a causa particular de quem
 * trabalha aqui não é assunto do sindicato.
 *
 * Só que junto ia o caso NOVO do próprio sindicato: ação recém-distribuída em
 * que um dos nossos já está no polo, ainda sem cadastro. O Diário anunciava e o
 * sistema jogava fora. Agora, quando o sindicato figura entre os destinatários,
 * ela chega aqui.
 *
 * DUAS SAÍDAS, E SÓ DUAS: cadastrar (abre o diálogo com o número já preenchido)
 * ou dizer que não é para acompanhar. Fila sem saída é fila que ninguém olha.
 */
const POLO_ROTULO: Record<SugestaoDeProcesso['nossoPolo'], { texto: string; classe: string }> = {
  ATIVO: {
    texto: 'Movemos a ação',
    classe: 'bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-200',
  },
  PASSIVO: {
    texto: 'Movem contra nós',
    classe: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200',
  },
  /*
    AMBOS NÃO É ERRO DE LEITURA. Em recurso o sindicato figura como recorrente E
    recorrido, e o tribunal lista os dois — 11% dos casos medidos no acervo.
    Escolher um lado aqui seria um chute com cara de fato.
  */
  AMBOS: {
    texto: 'Nos dois polos',
    classe: 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200',
  },
  INDEFINIDO: {
    texto: 'Polo não informado',
    classe: 'bg-muted text-muted-foreground',
  },
};

export function AcoesEncontradas({
  podeCadastrar,
  onCadastrar,
}: {
  /** Quem só lê o acervo vê a fila, mas não decide — a API cobra o mesmo. */
  podeCadastrar?: boolean;
  onCadastrar: (numeroCNJ: string) => void;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(true);
  const [ignorando, setIgnorando] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['processos', 'sugestoes'],
    queryFn: listarSugestoesDeProcesso,
    staleTime: 60_000,
  });

  const ignorar = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo?: string }) => ignorarSugestao(id, motivo),
    onSuccess: () => {
      toast.success('Ação marcada como "não é para acompanhar".');
      qc.invalidateQueries({ queryKey: ['processos', 'sugestoes'] });
      qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
      setIgnorando(null);
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível ignorar agora.'),
  });

  const itens = q.data ?? [];
  // Sem nada na fila o bloco não existe — nem como moldura vazia.
  if (!itens.length) return null;

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <Radar className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <span className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
          <strong className="font-semibold">
            {itens.length === 1
              ? '1 ação do sindicato apareceu no Diário'
              : `${itens.length} ações do sindicato apareceram no Diário`}
          </strong>{' '}
          e ainda não {itens.length === 1 ? 'está cadastrada' : 'estão cadastradas'} aqui.
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-amber-700 transition-transform dark:text-amber-400',
            aberto && 'rotate-180',
          )}
        />
      </button>

      {aberto && (
        <ul className="border-t border-amber-200 dark:border-amber-900/40">
          {itens.map((s) => {
            const polo = POLO_ROTULO[s.nossoPolo];
            /*
              QUEM ESTÁ DO OUTRO LADO é o que distingue uma linha da outra. O
              nome do sindicato aparece em todas — repeti-lo gastaria a largura
              que no celular já é curta.
            */
            const outraParte = (s.partes ?? [])
              .map((p) => (p?.nome ?? '').trim())
              .filter((n) => n && !n.toUpperCase().includes('SINDICATO'))
              .slice(0, 2)
              .join(' · ');

            return (
              <li
                key={s.id}
                className="border-t border-amber-200/60 px-4 py-3 first:border-t-0 dark:border-amber-900/30"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-sm font-semibold">
                        {formatNPU(s.numeroCNJ)}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          polo.classe,
                        )}
                      >
                        {polo.texto}
                      </span>
                      {s.siglaTribunal && (
                        <span className="text-xs text-muted-foreground">{s.siglaTribunal}</span>
                      )}
                    </div>
                    {outraParte && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground" title={outraParte}>
                        {s.nossoPolo === 'PASSIVO' ? 'Movida por' : 'Contra'} {outraParte}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {s.nomeClasse ? `${s.nomeClasse} · ` : ''}
                      {s.nomeOrgao ? `${s.nomeOrgao} · ` : ''}
                      {/*
                        A CONTAGEM DIZ HÁ QUANTO TEMPO ESTAMOS PERDENDO ISSO. Uma
                        ação que já apareceu oito vezes no Diário sem cadastro
                        não é novidade de ontem — é acompanhamento que não houve.
                      */}
                      {s.publicacoes === 1
                        ? '1 publicação'
                        : `${s.publicacoes} publicações`}{' '}
                      desde {new Date(s.primeiraEm).toLocaleDateString('pt-BR')}
                    </p>
                  </div>

                  {podeCadastrar && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onCadastrar(s.numeroCNJ)}
                        className="h-9 rounded-md bg-brand-800 px-3 text-xs font-semibold text-white transition hover:bg-brand-900 sm:h-8"
                      >
                        Cadastrar
                      </button>
                      <button
                        type="button"
                        onClick={() => setIgnorando(s.id)}
                        title="Não é para acompanhar"
                        aria-label="Não é para acompanhar"
                        className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground transition hover:bg-muted sm:h-8 sm:w-8"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/*
                  O MOTIVO É OPCIONAL, e o campo aparece só quando alguém decide
                  descartar. Exigir texto transformaria a fila num formulário, e
                  aí ninguém a limpa — que é o mesmo que não ter fila.
                */}
                {ignorando === s.id && (
                  <form
                    className="mt-2 flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const campo = new FormData(e.currentTarget).get('motivo');
                      ignorar.mutate({ id: s.id, motivo: String(campo ?? '') || undefined });
                    }}
                  >
                    <input
                      name="motivo"
                      autoFocus
                      maxLength={500}
                      placeholder="Por quê? (opcional — ex.: processo particular do advogado)"
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-xs"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="submit"
                        disabled={ignorar.isPending}
                        className="h-9 rounded-md border border-input px-3 text-xs font-semibold transition hover:bg-muted disabled:opacity-60"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setIgnorando(null)}
                        className="h-9 rounded-md px-3 text-xs text-muted-foreground transition hover:bg-muted"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/*
        O RODAPÉ EXPLICA DE ONDE ISSO VEIO. Sem a frase, uma lista de processos
        desconhecidos no topo da tela parece defeito de importação — e a reação
        certa (cadastrar) depende de entender que foi o tribunal que falou.
      */}
      {aberto && (
        <p className="flex items-start gap-1.5 border-t border-amber-200 px-4 py-2 text-[11px] text-amber-900/80 dark:border-amber-900/40 dark:text-amber-200/80">
          {itens.some((i) => i.nossoPolo === 'PASSIVO') ? (
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          ) : (
            <Scale className="mt-px h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            Encontradas na varredura do Diário pela OAB dos advogados. Só aparecem
            aqui as que citam o sindicato entre as partes.
          </span>
        </p>
      )}
    </section>
  );
}
