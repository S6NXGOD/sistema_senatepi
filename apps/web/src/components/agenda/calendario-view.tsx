'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
                'min-h-[92px] border-b border-r p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0',
                onSelecionarDia && 'cursor-pointer transition-colors hover:bg-muted/40',
                foraDoMes && 'bg-muted/20',
                selecionado && 'bg-senatepi-50 ring-1 ring-inset ring-senatepi-400 dark:bg-senatepi-900/20',
              )}
            >
              <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${ehHoje ? 'bg-senatepi-700 font-bold text-white' : foraDoMes ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
                {dia.getDate()}
              </div>
              <div className="space-y-1">
                {eventos.slice(0, 3).map((c) => {
                  const atrasado = estaAtrasado(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onSelecionar(c); }}
                      title={`${rotuloTipo(c.tipo, tipos)} · ${c.titulo}`}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted ${atrasado ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${corDeTipo(c.tipo, tipos).ponto}`} />
                      <span className="truncate">{formatHora(c.inicio)} {c.titulo}</span>
                    </button>
                  );
                })}
                {eventos.length > 3 && <p className="px-1 text-[10px] text-muted-foreground">+{eventos.length - 3} mais</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legenda de tipos */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t p-3 text-xs text-muted-foreground">
        {tipos.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${corDeTipo(t.slug, tipos).ponto}`} /> {t.nome}
          </span>
        ))}
      </div>
    </div>
  );
}
