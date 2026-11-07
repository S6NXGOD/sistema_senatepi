'use client';

import { ChevronLeft, ChevronRight, Paperclip } from 'lucide-react';
import { Esqueleto } from '@/components/ui/esqueleto';
import { parteContrariaDoProcesso } from '@/components/agenda/identidade-do-processo';
import { cn } from '@/lib/utils';
import {
  Compromisso, rotuloTipo, corDeTipo, formatHora,
  diaBRDe, doDiaDeTeresina, rotuloDoMes, ymdDoCalendario,
} from '@/lib/agenda';
import { chipsAVista, chipsDoDia, noCalendario, type ChipDoDia } from '@/lib/agenda-calendario';
import { useTiposEvento } from '@/lib/use-tipos-evento';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function mesmaData(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Calendário do mês — bloco FIXO junto do quadro, não uma visão alternativa.
 *
 * POR QUE MUDOU DE LUGAR
 * Antes era uma das duas visões: ou se via o calendário, ou se via o quadro.
 * Isso obrigava a alternar o tempo todo — o calendário responde "o que tem no
 * dia 14?" e o quadro responde "o que eu faço agora?", e as duas perguntas
 * andam juntas. Clicar num dia FILTRA o quadro, que é o uso real.
 *
 * `onSelecionarDia` recebe `null` quando o mesmo dia é clicado de novo — clicar
 * de volta é como se sai do filtro, sem precisar procurar um botão "limpar".
 *
 * O VISUAL DE 07/11/2026 veio de um calendário de referência que o dono mandou:
 * o mesmo tipo no mesmo dia vira uma linha só ("3× Prazo"), concluída fica
 * riscada, cancelada sai da grade, o dia de hoje se destaca e o mês fica
 * centrado entre as setas. O que cada dia mostra está em `agenda-calendario`.
 */
export function CalendarioView({
  compromissos, mes, onMudarMes, onSelecionar, diaSelecionado, onSelecionarDia, carregando = false,
}: {
  compromissos: Compromisso[];
  /**
   * Primeira carga do mês. A grade e a navegação ficam onde estão (trocar de
   * mês não pode fazer o bloco inteiro sumir e voltar); só os dias ganham a
   * forma do que vai aparecer.
   */
  carregando?: boolean;
  mes: Date;
  onMudarMes: (delta: number) => void;
  onSelecionar: (c: Compromisso) => void;
  diaSelecionado?: Date | null;
  onSelecionarDia?: (d: Date | null) => void;
}) {
  const { tipos } = useTiposEvento();
  /*
    O DIA DAS CÉLULAS É O DE TERESINA (15/09/2026), o mesmo dos grupos da lista
    e do filtro do dia. A grade continua local (é o calendário que a pessoa
    vê); o que se compara é o texto do dia.
  */
  const hojeYmd = diaBRDe(Date.now());
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const diasNoMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  /*
    SÓ AS SEMANAS DO MÊS. Eram sempre seis linhas, e num mês que cabe em cinco
    a última era inteira do mês seguinte — uma linha de dias que pertencem a
    outra página do calendário.
  */
  const semanas = Math.ceil((primeiro.getDay() + diasNoMes) / 7);
  const inicioGrade = new Date(primeiro);
  inicioGrade.setDate(1 - primeiro.getDay()); // recua até domingo
  const celulas = Array.from({ length: semanas * 7 }, (_, i) => {
    const d = new Date(inicioGrade);
    d.setDate(inicioGrade.getDate() + i);
    return d;
  });

  const visiveis = noCalendario(compromissos);
  /** Os tipos que de fato aparecem na grade — cancelado não conta. */
  const tiposPresentes = [...new Set(visiveis.map((c) => c.tipo))].sort((a, b) =>
    rotuloTipo(a, tipos).localeCompare(rotuloTipo(b, tipos), 'pt-BR'),
  );
  const temConcluida = visiveis.some((c) => c.status === 'CONCLUIDO');

  const chipsDe = (dia: Date) => chipsDoDia(doDiaDeTeresina(compromissos, ymdDoCalendario(dia)));

  /** Uma linha só por tipo; com um item, o título — que diz mais que o tipo. */
  const textoDoChip = (g: ChipDoDia) =>
    g.itens.length > 1 ? `${g.itens.length}× ${rotuloTipo(g.tipo, tipos)}` : g.itens[0].titulo;

  const dicaDoChip = (g: ChipDoDia) =>
    g.itens.length > 1
      ? `${g.itens.length} ${rotuloTipo(g.tipo, tipos)}${g.feita ? ' concluídas' : ''} — toque para ver o dia`
      : [
          `${formatHora(g.itens[0].inicio)} · ${rotuloTipo(g.tipo, tipos)}`,
          g.itens[0].titulo,
          parteContrariaDoProcesso(g.itens[0].processo) && `contra ${parteContrariaDoProcesso(g.itens[0].processo)}`,
          g.feita && 'concluída',
        ].filter(Boolean).join(' · ');

  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-busy={carregando || undefined}>
      {/*
        O MÊS NO MEIO, AS SETAS NAS PONTAS. No celular é a forma de passar o mês
        com o polegar sem mirar num grupo de três botões colados.
      */}
      <div className="flex items-center justify-between gap-2 border-b px-2 py-2.5 sm:px-3">
        <button
          type="button"
          onClick={() => onMudarMes(-1)}
          aria-label="Mês anterior"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          {/* Sem `capitalize`: ele subia toda palavra ("Setembro De 2026"). */}
          <p className="truncate text-base font-bold sm:text-lg">{rotuloDoMes(mes)}</p>
          <button
            type="button"
            onClick={() => onMudarMes(0)}
            className="h-8 shrink-0 rounded-md border px-2.5 text-xs font-medium transition hover:bg-muted"
          >
            Hoje
          </button>
        </div>
        <button
          type="button"
          onClick={() => onMudarMes(1)}
          aria-label="Próximo mês"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Semana */}
      <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
        {DIAS.map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>

      {/* Grade */}
      <div className="grid grid-cols-7">
        {celulas.map((dia, i) => {
          const foraDoMes = dia.getMonth() !== mes.getMonth();
          /*
            O DIA DE OUTRO MÊS FICA EM BRANCO. Número apagado ao lado de número
            aceso parecia um dia sem nada; a célula vazia diz o que é: não é
            deste mês.
          */
          if (foraDoMes) {
            return (
              <div
                key={i}
                aria-hidden
                className="min-h-[58px] border-b border-r bg-muted/25 last:border-r-0 sm:min-h-[92px] [&:nth-child(7n)]:border-r-0"
              />
            );
          }
          const ehHoje = ymdDoCalendario(dia) === hojeYmd;
          const selecionado = !!diaSelecionado && mesmaData(dia, diaSelecionado);
          const chips = chipsDe(dia);
          const { aVista, escondidas } = chipsAVista(chips);
          const pontos = chips.flatMap((g) => g.itens.map((c) => ({ c, g })));
          return (
            <div
              key={i}
              // A célula inteira é a área de clique para selecionar o dia; os
              // botões de evento dentro dela param a propagação, para que clicar
              // num evento abra o evento em vez de só filtrar o dia.
              onClick={() => onSelecionarDia?.(selecionado ? null : dia)}
              className={cn(
                // No celular a célula encolhe: sem o texto dos eventos, 92px
                // eram 92px de vazio em sete colunas.
                'group min-h-[58px] border-b border-r p-1 last:border-r-0 sm:min-h-[92px] sm:p-1.5 [&:nth-child(7n)]:border-r-0',
                onSelecionarDia && 'cursor-pointer transition-colors hover:bg-muted/40',
                ehHoje && 'bg-brand-50/60 dark:bg-brand-900/15',
                selecionado && 'bg-brand-50 ring-1 ring-inset ring-brand-400 dark:bg-brand-900/20',
              )}
            >
              <div
                className={cn(
                  'mb-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                  ehHoje ? 'bg-foreground text-background' : 'text-foreground',
                )}
              >
                {dia.getDate()}
              </div>
              {/*
                NO CELULAR, SÓ OS PONTOS.

                Sete colunas num aparelho de 360px dão 51px por célula: texto não
                cabe. Os pontos preservam a leitura que importa nesse tamanho
                ("que dias têm coisa, e de que tipo"); o detalhe vem ao tocar no
                dia. Concluída vira ponto apagado; ficou para trás, âmbar.
              */}
              <div className="flex flex-wrap gap-1 px-0.5 sm:hidden">
                {pontos.slice(0, 6).map(({ c, g }) => (
                  <span
                    key={c.id}
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      g.atrasada ? 'bg-amber-500' : corDeTipo(c.tipo, tipos).ponto,
                      g.feita && 'opacity-35',
                    )}
                  />
                ))}
                {pontos.length > 6 && (
                  <span className="text-[9px] leading-none text-muted-foreground">
                    +{pontos.length - 6}
                  </span>
                )}
              </div>

              <div className="hidden space-y-1 sm:block">
                {carregando && i % 3 === 0 && <Esqueleto className="h-4 w-4/5" />}
                {aVista.map((g) => {
                  const unico = g.itens.length === 1 ? g.itens[0] : null;
                  const anexos = unico?._count?.anexos ?? 0;
                  return (
                    <button
                      key={g.chave}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Um só abre a atividade; um grupo abre o dia, onde estão todas.
                        if (unico) onSelecionar(unico);
                        else onSelecionarDia?.(dia);
                      }}
                      title={dicaDoChip(g)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] transition',
                        g.feita
                          ? 'bg-muted/40 text-muted-foreground line-through decoration-muted-foreground/60 hover:bg-muted'
                          : g.atrasada
                            ? 'bg-amber-50 font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300'
                            : 'bg-muted/70 font-medium text-foreground hover:bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          corDeTipo(g.tipo, tipos).ponto,
                          g.feita && 'opacity-50',
                        )}
                      />
                      <span className="truncate">{textoDoChip(g)}</span>
                      {anexos > 0 && <Paperclip className="h-3 w-3 shrink-0 opacity-60" aria-label="Tem anexo" />}
                    </button>
                  );
                })}
                {/*
                  "+N MAIS" CONTA ATIVIDADES, não grupos — e anuncia que é clicável:
                  é o dia mais cheio do mês que fica atrás dele.
                */}
                {escondidas > 0 && (
                  <p className="px-1.5 text-[10px] font-medium text-brand-800 underline-offset-2 group-hover:underline dark:text-brand-400">
                    +{escondidas} mais — ver o dia
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/*
        A LEGENDA EXPLICA O QUE ESTÁ NA TELA, e só isso — os tipos que aparecem
        no mês e as duas marcas de estado, quando existem.
      */}
      {tiposPresentes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t p-3 text-xs text-muted-foreground">
          {tiposPresentes.map((slug) => (
            <span key={slug} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${corDeTipo(slug, tipos).ponto}`} />
              {rotuloTipo(slug, tipos)}
            </span>
          ))}
          {temConcluida && <span className="line-through decoration-muted-foreground/60">concluída</span>}
          {visiveis.some((c) => chipsDoDia([c])[0]?.atrasada) && (
            <span className="font-medium text-amber-700 dark:text-amber-400">ficou para trás</span>
          )}
        </div>
      )}
    </div>
  );
}
