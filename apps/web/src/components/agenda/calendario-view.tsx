'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parteContrariaDoProcesso } from '@/components/agenda/identidade-do-processo';
import { cn } from '@/lib/utils';
import { Compromisso, rotuloTipo, corDeTipo, formatHora, estaAtrasado } from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function mesmaData(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Calendário do mês — bloco FIXO acima do quadro, não uma visão alternativa.
 *
 * POR QUE MUDOU DE LUGAR
 * Antes era uma das duas visões: ou se via o calendário, ou se via o quadro.
 * Isso obrigava a alternar o tempo todo — o calendário responde "o que tem no
 * dia 14?" e o quadro responde "o que eu faço agora?", e as duas perguntas
 * andam juntas. Com ele fixo no topo, clicar num dia passa a FILTRAR o quadro
 * logo abaixo, que é o uso real.
 *
 * `onSelecionarDia` recebe `null` quando o mesmo dia é clicado de novo — clicar
 * de volta é como se sai do filtro, sem precisar procurar um botão "limpar".
 */
export function CalendarioView({
  compromissos, mes, onMudarMes, onSelecionar, diaSelecionado, onSelecionarDia,
}: {
  compromissos: Compromisso[];
  mes: Date;
  onMudarMes: (delta: number) => void;
  onSelecionar: (c: Compromisso) => void;
  diaSelecionado?: Date | null;
  onSelecionarDia?: (d: Date | null) => void;
}) {
  const { tipos } = useTiposEvento();
  const hoje = new Date();
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const inicioGrade = new Date(primeiro);
  inicioGrade.setDate(1 - primeiro.getDay()); // recua até domingo
  const celulas = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicioGrade);
    d.setDate(inicioGrade.getDate() + i);
    return d;
  });

  /** Os tipos que de fato aparecem na janela exibida. */
  const tiposPresentes = [...new Set(compromissos.map((c) => c.tipo))].sort((a, b) =>
    rotuloTipo(a, tipos).localeCompare(rotuloTipo(b, tipos), 'pt-BR'),
  );

  const eventosDoDia = (dia: Date) =>
    compromissos
      .filter((c) => mesmaData(new Date(c.inicio), dia))
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());

  return (
    <div className="rounded-xl border bg-card">
      {/* Cabeçalho do mês */}
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-lg font-bold capitalize">
          {mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </p>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" onClick={() => onMudarMes(-1)} aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => onMudarMes(0)}>Hoje</Button>
          <Button variant="outline" size="icon" onClick={() => onMudarMes(1)} aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Semana */}
      <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
        {DIAS.map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>

      {/* Grade */}
      <div className="grid grid-cols-7">
        {celulas.map((dia, i) => {
          const foraDoMes = dia.getMonth() !== mes.getMonth();
          const ehHoje = mesmaData(dia, hoje);
          const selecionado = !!diaSelecionado && mesmaData(dia, diaSelecionado);
          const eventos = eventosDoDia(dia);
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
                'group min-h-[58px] border-b border-r p-1 last:border-r-0 sm:min-h-[92px] [&:nth-child(7n)]:border-r-0',
                onSelecionarDia && 'cursor-pointer transition-colors hover:bg-muted/40',
                foraDoMes && 'bg-muted/20',
                selecionado && 'bg-brand-50 ring-1 ring-inset ring-brand-400 dark:bg-brand-900/20',
              )}
            >
              <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${ehHoje ? 'bg-brand-700 font-bold text-white' : foraDoMes ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
                {dia.getDate()}
              </div>
              {/*
                NO CELULAR, SÓ OS PONTOS.

                Sete colunas num aparelho de 360px dão 51px por célula. "09:00
                Juntar documentos" cabia em três letras e um reticências — a
                grade inteira virava uma coluna de "09:0…" repetido, e o mês,
                que é a única coisa que o calendário faz melhor que o quadro,
                ficava ilegível. Os pontos preservam a leitura que importa nesse
                tamanho ("que dias têm coisa, e de que tipo"); o detalhe vem ao
                tocar no dia, que traz as atividades para o quadro acima.
              */}
              <div className="flex flex-wrap gap-1 px-0.5 sm:hidden">
                {eventos.slice(0, 6).map((c) => (
                  <span
                    key={c.id}
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      estaAtrasado(c) ? 'bg-red-500' : corDeTipo(c.tipo, tipos).ponto,
                    )}
                  />
                ))}
                {eventos.length > 6 && (
                  <span className="text-[9px] leading-none text-muted-foreground">
                    +{eventos.length - 6}
                  </span>
                )}
              </div>

              <div className="hidden space-y-1 sm:block">
                {eventos.slice(0, 3).map((c) => {
                  const atrasado = estaAtrasado(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelecionar(c); }}
                      // A CÉLULA NÃO COMPORTA MAIS TEXTO, mas a dica sim: sem o
                      // processo, duas "Verificação de Intimação / Prazo" no
                      // mesmo dia eram indistinguíveis até clicar.
                      title={[
                        rotuloTipo(c.tipo, tipos),
                        c.titulo,
                        parteContrariaDoProcesso(c.processo) && `contra ${parteContrariaDoProcesso(c.processo)}`,
                      ].filter(Boolean).join(' · ')}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted ${atrasado ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${corDeTipo(c.tipo, tipos).ponto}`} />
                      <span className="truncate">{formatHora(c.inicio)} {c.titulo}</span>
                    </button>
                  );
                })}
                {/*
                  "+12 MAIS" NÃO PARECIA CLICÁVEL — e é o dia mais cheio do mês
                  que fica escondido atrás dele. A célula inteira já seleciona o
                  dia; o que faltava era o texto anunciar que há uma saída.
                */}
                {eventos.length > 3 && (
                  <p className="px-1 text-[10px] font-medium text-brand-800 underline-offset-2 group-hover:underline dark:text-brand-400">
                    +{eventos.length - 3} — ver o dia
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/*
        A LEGENDA EXPLICA O QUE ESTÁ NA TELA, e só isso.

        Ela listava TODOS os tipos cadastrados — inclusive os que não aparecem
        no mês nenhum dia. Numa instalação com dez tipos, oito eram legenda de
        cor que a grade não usa: a pessoa procura o ponto roxo e não acha.
      */}
      {tiposPresentes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t p-3 text-xs text-muted-foreground">
          {tiposPresentes.map((slug) => (
            <span key={slug} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${corDeTipo(slug, tipos).ponto}`} />
              {rotuloTipo(slug, tipos)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
