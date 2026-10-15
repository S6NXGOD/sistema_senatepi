'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Gavel, MapPin, Video, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { Button } from '@/components/ui/button';
import { abrirChamada, normalizarLinkReuniao } from '@/lib/link-reuniao';

/**
 * A AUDIÊNCIA ESTÁ COMEÇANDO — o único aviso do sistema que interrompe.
 *
 * "Mostrar no dia da audiência um pop-up na tela do advogado responsável para
 * lembrá-lo de entrar, com um botão rápido." — o dono.
 *
 * A regra desta base é que aviso é ESTADO e mora na faixa, que de propósito
 * não fala do dia de hoje: faixa que aparece todo dia vira cabeçalho, e
 * cabeçalho ninguém lê. Audiência é a exceção que justifica parar a tela —
 * faltar é revelia —, e por isso este é o único componente modal de aviso.
 *
 * O QUE O IMPEDE DE VIRAR O SINO QUE FOI REMOVIDO EM 12/09/2026:
 *
 *  1. JANELA ESTREITA, contada no SERVIDOR: 30 minutos antes até o fim do ato.
 *     Fora disso a rota devolve nada, e não há o que renderizar.
 *  2. SÓ DO RESPONSÁVEL. O ato do tribunal intima a equipe inteira; quem tem
 *     de estar na sala é um. Interromper os outros nove ensina a ignorar.
 *  3. UMA VEZ. "Agora não" cala aquele compromisso naquele aparelho.
 *  4. SAI SOZINHO quando a audiência é concluída ou cancelada — é derivado do
 *     estado, como a faixa. Não há tabela de notificação nem item "lido".
 *
 * O "AGORA NÃO" MORA NO NAVEGADOR, e isto é deliberado: o que ele guarda vale
 * para UM compromisso que acaba em uma hora. A régua de "uma vez por semana"
 * da faixa de atrasadas precisou de coluna no banco porque atravessa dias e
 * aparelhos; esta não atravessa nem o fim da audiência. E a consequência de
 * perder o registro — reabrir no celular depois de fechar no computador — é
 * justamente o que alguém que trocou de aparelho ia querer.
 */

interface PautaDeAgora {
  id: string;
  titulo: string;
  inicio: string;
  fim: string | null;
  local: string | null;
  linkReuniao: string | null;
  processo: { id: string; numeroCNJ: string | null } | null;
  faltamMinutos: number;
  quando: string;
}

const chaveDoSilencio = (id: string) => `pauta-lembrada:${id}`;

/** "em 12 minutos", "agora", "começou há 8 minutos" — a frase que dá o tom. */
function frase(faltam: number): string {
  if (faltam > 1) return `Começa em ${faltam} minutos`;
  if (faltam === 1) return 'Começa em 1 minuto';
  if (faltam === 0) return 'Começa agora';
  const passou = Math.abs(faltam);
  return passou === 1 ? 'Começou há 1 minuto' : `Começou há ${passou} minutos`;
}

export function LembreteDaPauta() {
  const { user } = useAuth();
  const veAgenda = podeVer(user?.role, user?.permissoes, 'agenda');

  const { data } = useQuery({
    queryKey: ['pauta-de-agora'],
    queryFn: async () =>
      (await api.get<{ pauta: PautaDeAgora | null }>('/compromissos/pauta-de-agora')).data,
    enabled: !!user && veAgenda,
    // Um minuto: é a resolução da frase ("começa em 12 minutos") e o mesmo
    // ritmo da faixa de avisos.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const pauta = data?.pauta ?? null;
  const [calado, setCalado] = useState<string | null>(null);

  useEffect(() => {
    if (!pauta) return;
    try {
      setCalado(window.localStorage.getItem(chaveDoSilencio(pauta.id)));
    } catch {
      // Janela anônima ou armazenamento bloqueado: o lembrete aparece, que é
      // o lado seguro de errar.
      setCalado(null);
    }
  }, [pauta]);

  if (!pauta || calado === pauta.id) return null;

  const sala = normalizarLinkReuniao(pauta.linkReuniao);
  const virtual = !!sala?.ok;
  const atrasada = pauta.faltamMinutos < 0;

  const silenciar = () => {
    try {
      window.localStorage.setItem(chaveDoSilencio(pauta.id), pauta.id);
    } catch {
      /* sem armazenamento, fecha só nesta tela */
    }
    setCalado(pauta.id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lembrete-pauta-titulo"
      className="fixed inset-0 z-[60] flex animate-overlay-entrar items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      <div className="w-full max-w-md animate-dialogo-entrar overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        {/*
          O CABEÇALHO DIZ O QUE É E QUANTO FALTA, nesta ordem. Quem é
          interrompido precisa saber em meio segundo se aquilo é com ele.
        */}
        <div className="flex items-start gap-3 border-b px-4 py-3.5">
          <span
            className={
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ' +
              (atrasada
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300')
            }
          >
            <Gavel className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Audiência hoje · {pauta.quando.split(',').pop()?.trim() ?? pauta.quando}
            </p>
            <h2 id="lembrete-pauta-titulo" className="text-base font-bold leading-snug">
              {frase(pauta.faltamMinutos)}
            </h2>
          </div>
          <button
            type="button"
            onClick={silenciar}
            aria-label="Fechar o lembrete"
            className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-2 px-4 py-3.5">
          <p className="font-semibold leading-snug">{pauta.titulo}</p>
          {pauta.local && (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{pauta.local}</span>
            </p>
          )}
        </div>

        {/*
          A AÇÃO PRINCIPAL É ENTRAR — e só existe quando há sala de verdade.
          Botão que não leva a lugar nenhum na hora da audiência é pior que
          botão nenhum: a pessoa clica, não acontece nada e perde os segundos
          que tinha. Sem sala, o caminho é a ficha do compromisso.
        */}
        <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row">
          {virtual ? (
            <Button
              className="h-12 flex-1 text-base"
              onClick={() => {
                abrirChamada(pauta.linkReuniao);
                silenciar();
              }}
            >
              <Video className="h-4.5 w-4.5" aria-hidden="true" /> Entrar na audiência
            </Button>
          ) : (
            <Link
              href={`/agenda?compromisso=${pauta.id}`}
              onClick={silenciar}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 text-base font-semibold text-white transition-colors hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-700"
            >
              Abrir a audiência <ArrowRight className="h-4.5 w-4.5" aria-hidden="true" />
            </Link>
          )}
          <Button variant="outline" className="h-12 sm:h-12 sm:w-auto" onClick={silenciar}>
            Agora não
          </Button>
        </div>
      </div>
    </div>
  );
}
