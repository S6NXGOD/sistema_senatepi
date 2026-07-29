'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Compromisso, TIPO_COR, TIPO_LABEL, TIPOS, formatHora, estaAtrasado } from '@/lib/agenda';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function mesmaData(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function CalendarioView({
  compromissos, mes, onMudarMes, onSelecionar,
}: {
  compromissos: Compromisso[];
  mes: Date;
  onMudarMes: (delta: number) => void;
  onSelecionar: (c: Compromisso) => void;
}) {
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
          const eventos = eventosDoDia(dia);
          return (
            <div key={i} className={`min-h-[92px] border-b border-r p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0 ${foraDoMes ? 'bg-muted/20' : ''}`}>
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
                      onClick={() => onSelecionar(c)}
                      title={`${TIPO_LABEL[c.tipo]} · ${c.titulo}`}
                      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-muted ${atrasado ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TIPO_COR[c.tipo].ponto}`} />
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
        {TIPOS.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${TIPO_COR[t].ponto}`} /> {TIPO_LABEL[t]}
          </span>
        ))}
      </div>
    </div>
  );
}
