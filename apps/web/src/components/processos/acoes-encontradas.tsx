'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, History, Loader2, Radar, Scale, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatNPU,
  ignorarSugestao,
  listarSugestoesDeProcesso,
  type SugestaoDeProcesso,
} from '@/lib/processos';
import { varrerDjenAgora } from '@/lib/djen';

/**
 * NOVENTA DIAS — o que cobre a distribuição recente sem pesar.
 *
 * A busca por OAB devolve a carteira INTEIRA do advogado: medido, ~113
 * publicações por dia somando os oito. Noventa dias são ~10 mil itens, ~100
 * páginas, uns oito minutos de cota — e cobrem o tempo em que um processo
 * distribuído ainda é "novo". Meio ano dobraria o custo para achar quase nada:
 * ação de um ano atrás que ninguém cadastrou não é novidade, é outro problema.
 */
const DIAS_DE_HISTORICO = 90;

/**
 * O botão diz quanto custa ANTES do clique. Oito minutos segurando a tela sem
 * aviso é um clique que ninguém dá duas vezes — e este é para dar uma vez só.
 */
function BotaoHistorico({ m }: { m: { mutate: () => void; isPending: boolean } }) {
  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      title={`Consulta ${DIAS_DE_HISTORICO} dias do Diário para todos os advogados`}
      className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-semibold transition hover:bg-muted disabled:opacity-60 sm:h-8"
    >
      {m.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <History className="h-3.5 w-3.5" />
      )}
      {m.isPending ? 'Buscando… (uns 8 min)' : `Buscar ${DIAS_DE_HISTORICO} dias atrás`}
    </button>
  );
}

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

/**
 * DISTRIBUÍDA HÁ POUCO?
 *
 * O corte é o ano corrente e o anterior: nesse intervalo o processo ainda está
 * na fase em que perder um prazo custa caro, e a ação é "cadastre agora". Mais
 * velho que isso, o caso já corre há tempo sem nós — continua valendo cadastrar,
 * mas é arrumação de acervo, não emergência. Marcar tudo de âmbar faria o âmbar
 * deixar de significar alguma coisa.
 */
function ehRecente(ano: number): boolean {
  return ano >= new Date().getFullYear() - 1;
}

export function AcoesEncontradas({
  podeCadastrar,
  podeVarrerHistorico,
  onCadastrar,
}: {
  /** Quem só lê o acervo vê a fila, mas não decide — a API cobra o mesmo. */
  podeCadastrar?: boolean;
  /** A varredura completa é `@Roles(ADMINISTRADOR)` na API. */
  podeVarrerHistorico?: boolean;
  /** A sugestão INTEIRA: o diálogo aproveita as partes que o Diário já disse. */
  onCadastrar: (sugestao: SugestaoDeProcesso) => void;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(true);
  const [ignorando, setIgnorando] = useState<string | null>(null);

  /*
    A MESMA CADÊNCIA DO SINO — senão os dois números brigam na mesma tela.

    A fila tinha `staleTime` e nenhuma revalidação; o sino recarrega a cada
    minuto. Durante a colheita de histórico, que leva minutos e vai somando, o
    sino subia para 28 enquanto a fila continuava mostrando os 24 do primeiro
    carregamento. Dois números diferentes para o mesmo fato fazem os DOIS
    parecerem errados — e foi exatamente o que o usuário viu no print.
  */
  const q = useQuery({
    queryKey: ['processos', 'sugestoes'],
    queryFn: listarSugestoesDeProcesso,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const ignorar = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo?: string }) => ignorarSugestao(id, motivo),
    onSuccess: () => {
      toast.success('Ação marcada como "não é para acompanhar".');
      qc.invalidateQueries({ queryKey: ['processos', 'sugestoes'] });
      // O sino conta a mesma fila: sem isto ele fica com o número de antes até
      // a próxima revalidação, e a tela mostra dois totais diferentes.
      qc.invalidateQueries({ queryKey: ['minhas-pendencias'] });
      setIgnorando(null);
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível ignorar agora.'),
  });

  /*
    A COLHEITA DE HISTÓRICO — uma passada, não uma rotina.

    A varredura diária olha TRÊS DIAS de publicações. Para quem já está no acervo
    isso basta, porque o processo cadastrado também é consultado por NPU e essa
    consulta traz o histórico inteiro dele. Mas ação NOVA só aparece pela busca
    por OAB — e aí a janela manda. Um processo do sindicato distribuído há dois
    meses e quieto nesta semana era invisível para sempre.

    Não vira rotina: a rodada de três dias já absorve fim de semana e feriado, e
    alargar todo dia só gastaria cota reprocessando o que o `hash` único
    descartaria.
  */
  const historico = useMutation({
    mutationFn: () => varrerDjenAgora(DIAS_DE_HISTORICO),
    onSuccess: (r) => {
      toast.success(
        r.sugeridas > 0
          ? `${r.sugeridas} ação(ões) do sindicato encontrada(s) sem cadastro.`
          : 'Nenhuma ação nossa sem cadastro nos últimos meses.',
      );
      qc.invalidateQueries({ queryKey: ['processos', 'sugestoes'] });
      qc.invalidateQueries({ queryKey: ['minhas-pendencias'] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível varrer o histórico agora.'),
  });

  const itens = q.data ?? [];

  /*
    FILA VAZIA NÃO DESENHA MOLDURA — com uma exceção: quem pode fazer a colheita
    de histórico precisa de um lugar para clicar, e o lugar é este. Uma linha
    discreta, só para o Administrador, e só enquanto ele não rodou nesta sessão.
  */
  if (!itens.length) {
    if (!podeVarrerHistorico || historico.isSuccess) return null;
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2">
          <Radar className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
          <span>
            A varredura diária olha os últimos 3 dias do Diário. Ação do sindicato
            distribuída antes disso só aparece numa busca de histórico.
          </span>
        </span>
        <BotaoHistorico m={historico} />
      </div>
    );
  }

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
                      {/*
                        O ANO SEPARA DUAS COISAS QUE ESTAVAM NA MESMA LISTA.

                        Medido na primeira colheita: das 32 encontradas, só 4 eram
                        de 2026 — havia seis de 2015. Ação recém-distribuída tem
                        prazo correndo e ninguém olhando; processo de dez anos que
                        nunca foi cadastrado é passivo de acervo, importante e não
                        urgente. Sem o ano, as duas pareciam a mesma urgência — e o
                        ano estava ali o tempo todo, escondido no meio de vinte
                        dígitos que ninguém lê.
                      */}
                      {s.anoDistribuicao != null && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                            ehRecente(s.anoDistribuicao)
                              ? 'bg-amber-200 text-amber-950 dark:bg-amber-800/60 dark:text-amber-100'
                              : 'text-muted-foreground',
                          )}
                        >
                          {ehRecente(s.anoDistribuicao)
                            ? `distribuída em ${s.anoDistribuicao}`
                            : `de ${s.anoDistribuicao}`}
                        </span>
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
                        onClick={() => onCadastrar(s)}
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
          <span className="min-w-0 flex-1">
            Encontradas na varredura do Diário pela OAB dos advogados. Só aparecem
            aqui as que citam o sindicato entre as partes — a rodada diária cobre os
            últimos 3 dias.
          </span>
          {podeVarrerHistorico && !historico.isSuccess && <BotaoHistorico m={historico} />}
        </p>
      )}
    </section>
  );
}
