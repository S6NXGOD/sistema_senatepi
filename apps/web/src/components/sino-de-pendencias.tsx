'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCircle2, ChevronRight, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { minhasPendencias, PENDENCIA, rotulo, type Pendencia } from '@/lib/pendencias';

/**
 * O SINO — e o que ele deliberadamente NÃO faz.
 *
 * Não tem "marcar como lida", não guarda histórico e não avisa duas vezes da
 * mesma coisa. Ele mostra o ESTADO: o que está aberto e é seu. Concluiu, some.
 * É o que impede o número de inflar até virar decoração — todo sistema que a
 * equipe já usou ensinou a ignorar o sininho justamente por acumular evento.
 *
 * SER INCISIVO SEM SER CHATO. O ponto vermelho aparece só quando existe prazo
 * VENCIDO ou publicação sem dono; audiência da semana e tarefa de hoje ficam em
 * cinza. Pintar tudo de vermelho ensina a ignorar o vermelho, e aí o dia do
 * prazo perdido de verdade passa igual aos outros.
 */

/**
 * Um minuto. Curto o bastante para o número não mentir depois de concluir uma
 * tarefa em outra aba; longo o bastante para não virar polling agressivo.
 */
const REVALIDAR_MS = 60_000;

export function SinoDePendencias() {
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const caminho = usePathname();

  /*
    O GATE CONTINUA SENDO O DA AGENDA — e isso é escolha, não esquecimento.

    O sino passou a contar também ação do sindicato sem cadastro, que é do
    módulo de PROCESSOS. A tentação era alargar este `podeVer` para incluir
    processos — só que a ROTA é `@Modulo('agenda')`, e o ícone passaria a ser
    desenhado para quem receberia 403 ao clicar. Botão que erra é pior que botão
    ausente; já entreguei um assim neste projeto.

    Consequência assumida: quem tiver `agenda: SEM_ACESSO` e `processos: EDITAR`
    (ninguém hoje, mas a tela de usuários permite) não vê o sino. Para essa
    pessoa o aviso continua no painel e na fila da tela de Processos.
  */
  const permitido = podeVer(user?.role, user?.permissoes, 'agenda');

  const { data } = useQuery({
    queryKey: ['minhas-pendencias'],
    queryFn: minhasPendencias,
    enabled: permitido,
    refetchInterval: REVALIDAR_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Navegou: a gaveta fecha. Sem isto ela ficaria aberta sobre a tela nova.
  useEffect(() => setAberto(false), [caminho]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  if (!permitido) return null;

  const pendencias = data?.pendencias ?? [];
  const total = data?.total ?? 0;
  const temUrgente = pendencias.some((p) => PENDENCIA[p.tipo].urgente);

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label={total ? `${total} pendências suas` : 'Nada pendente para você'}
        aria-expanded={aberto}
        className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span
            className={cn(
              'absolute right-1 top-1 min-w-[18px] rounded-full px-1 text-[10px] font-bold leading-[18px] text-white',
              temUrgente ? 'bg-red-600' : 'bg-brand-700',
            )}
          >
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-label="Suas pendências"
          className={cn(
            'z-50 overflow-hidden border bg-card shadow-lg',
            /*
              FOLHA NO CELULAR, GAVETA NO DESKTOP.

              Ancorada no botão, a caixa nascia com ~328px num aparelho de 360 —
              e cada linha traz NPU, polo e data, que não cabem em 328px sem
              truncar as três. Presa ao canto direito, ainda deixava o polegar
              longe: o botão fica no alto da tela e a lista descia dali.

              No telefone ela passa a ocupar a largura toda, encostada embaixo,
              onde a mão está. `max-h-[70svh]` usa a altura VISÍVEL (svh), não a
              do documento — com `vh`, a barra do navegador móvel cortava o
              rodapé da lista.
            */
            'fixed inset-x-2 bottom-2 max-h-[70svh] rounded-2xl',
            'sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-1 sm:max-h-none sm:w-[min(24rem,calc(100vw-2rem))] sm:rounded-xl',
          )}
        >
          <div className="flex items-start justify-between gap-2 border-b px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">O que precisa de você</p>
              {/*
                A EXPLICAÇÃO DO MECANISMO SÓ NA PRIMEIRA VEZ QUE FAZ DIFERENÇA.

                "Some sozinho quando você resolve — não há o que marcar como
                lido" é uma boa frase e estava em TODA abertura, inclusive nas
                mil seguintes. Ela responde a uma pergunta que só se faz quando
                há algo na lista; com a lista vazia é o sistema falando de si
                mesmo para quem não perguntou.
              */}
              {pendencias.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Some sozinho quando você resolve — não há o que marcar como lido.
                </p>
              )}
            </div>
            {/*
              FECHAR EXPLÍCITO — no celular a folha cobre metade da tela e
              "clicar fora" vira adivinhação sobre onde é fora.
            */}
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar"
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted sm:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {pendencias.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Nada em aberto no seu nome.
            </div>
          ) : (
            <ul className="max-h-[calc(70svh-3.5rem)] divide-y overflow-y-auto sm:max-h-[60vh]">
              {pendencias.map((p) => (
                <Grupo key={p.tipo} p={p} />
              ))}
            </ul>
          )}


        </div>
      )}
    </div>
  );
}

/**
 * "ABRIR MINHA AGENDA" SAIU DO RODAPÉ — e não por economia de pixel.
 *
 * Era um link fixo, igual para tudo. Com "publicação sem tarefa" já era estranho
 * (ela vive em Processos); com "ação nova sem cadastro" virou não-sequitur: o
 * sino anunciava um processo que nem existe e oferecia como saída... a agenda.
 *
 * Cada grupo leva ao SEU lugar, e só quando há mais do que os três exemplos
 * mostrados. O destino mora em `PENDENCIA`, junto do rótulo — a faixa global usa
 * a MESMA tabela, e duas listas de destinos divergiriam na primeira tela nova.
 */
function Grupo({ p }: { p: Pendencia }) {
  const urgente = PENDENCIA[p.tipo].urgente;
  const sobra = p.total - p.exemplos.length;
  const verTodas = PENDENCIA[p.tipo];
  return (
    <li className="px-4 py-2.5">
      <p
        className={cn(
          'text-sm font-medium',
          urgente ? 'text-red-700 dark:text-red-400' : 'text-foreground',
        )}
      >
        {rotulo(p)}
      </p>
      {/*
        DIZER QUANDO NÃO É SEU.

        O sino se chama "o que precisa de você" e tudo nele é pessoal — menos a
        ação nova, que não tem dono porque o processo ainda não existe. Sem esta
        linha, o administrador abria o sino, lia "30" sob aquele título e
        concluía que tinha trinta tarefas suas. Tem zero: é a fila da equipe, e
        o primeiro que cadastrar limpa o item para todo mundo.
      */}
      {verTodas.compartilhada && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Users className="h-3 w-3 shrink-0" />
          Fila da equipe — quem resolver primeiro limpa para todos
        </p>
      )}
      <ul className="mt-1 space-y-0.5">
        {p.exemplos.map((e) => (
          <li key={e.id}>
            <Link
              href={e.href}
              className="-mx-1 flex items-baseline gap-2 truncate rounded px-1 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <span className="truncate">{e.titulo}</span>
              {e.quando && (
                <span className="shrink-0 tabular-nums">
                  {/*
                    ESPERA, E NÃO DATA, na fila da equipe.

                    Nas tarefas a data é o PRAZO — "08/06" responde "quando
                    vence". Na ação nova ela é quando o Diário publicou pela
                    primeira vez, e aí "08/06" obriga a fazer a subtração de
                    cabeça para chegar ao que importa: há quanto tempo isto
                    está parado. No print do usuário eram três linhas "08/06",
                    "08/06", "09/06" — três meses de espera escritos de um jeito
                    que não parecia espera nenhuma.
                  */}
                  {verTodas.compartilhada ? esperaCurta(e.quando) : formatarDia(e.quando)}
                </span>
              )}
            </Link>
          </li>
        ))}
        {/*
          "e mais 4" era um beco sem saída: dizia que havia mais e não levava a
          lugar nenhum — quem quisesse ver tinha de adivinhar em que tela.
          Agora é o próprio link, e cada tipo leva ao SEU lugar.
        */}
        {sobra > 0 && (
          <li>
            <Link
              href={verTodas.href}
              className="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-brand-800 transition hover:bg-muted dark:text-brand-300"
            >
              e mais {sobra} · {verTodas.verTodas}
              <ChevronRight className="h-3 w-3" />
            </Link>
          </li>
        )}
      </ul>
    </li>
  );
}

/** "12/08" — a data do prazo, que é o que a tarefa quer dizer. */
function formatarDia(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** "há 91d" — quanto tempo o item está parado. Cabe na linha e é a pergunta. */
function esperaCurta(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias}d`;
}
