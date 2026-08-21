'use client';

import { useEffect, useState } from 'react';
import {
  Clock, MapPin, Pencil, Trash2, History, Timer,
  Play, CalendarClock, CheckCircle2, RotateCcw, Ban, FileSearch, Bot, PenLine, Gavel,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SeloUrgente } from '@/components/ui/selo-urgente';
import {
  Compromisso, StatusCompromisso, rotuloTipo, corDeTipo,
  formatData, formatHora, estaAtrasado, cronometroHMS,
  DESFECHO_LABEL, corDesfecho,
  rotuloDesfecho, CATEGORIA_CANCELAMENTO_LABEL,
} from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { V } from '@/lib/vocabulario';

/** Cronômetro ao vivo em HH:MM:SS (atualiza a cada segundo) desde `iniciadoEm`. */
function Cronometro({ desde }: { desde: string }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
      <Timer className="h-3.5 w-3.5 animate-pulse" /> {cronometroHMS(desde, agora)}
    </span>
  );
}

/**
 * AÇÃO PRINCIPAL — o único passo que faz sentido dar agora, em destaque.
 * O quadro tinha 4 botões do mesmo tamanho e peso, e nenhum dizia qual era "o"
 * próximo passo. Aqui a hierarquia é explícita: um botão cheio + secundários
 * discretos.
 */
function AcaoPrimaria({
  onClick, children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-800 px-2.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-900"
    >
      {children}
    </button>
  );
}

function AcaoBtn({
  onClick, children, tom = 'neutro', titulo,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tom?: 'neutro' | 'perigo' | 'aviso';
  titulo?: string;
}) {
  const cor = {
    neutro: 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
    perigo: 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30',
    aviso: 'border-amber-300 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20',
  }[tom];
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={cn('inline-flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors', cor)}
    >
      {children}
    </button>
  );
}

/**
 * Avatar do responsável (foto quando há, iniciais quando não).
 *
 * 24px em vez de 20: a 20 a foto virava um borrão e não dava para reconhecer
 * quem é — que é a única razão de haver foto num quadro com dezenas de cards.
 *
 * As INICIAIS usam duas letras (primeiro nome + sobrenome). Com uma só, "Dra.
 * Morgana" e "Dr. Matheus" viravam ambos um "D" — o avatar deixava de
 * distinguir as pessoas justamente onde precisava.
 */
function MiniAvatar({ nome, url, titulo }: { nome: string; url?: string | null; titulo?: string }) {
  const iniciais = nome
    .replace(/^(dra?\.?|sr[a]?\.?)\s+/i, '') // "Dr." e "Dra." não identificam ninguém
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" title={titulo} className="h-6 w-6 shrink-0 rounded-full border object-cover" />
  ) : (
    <span
      title={titulo}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-400 text-[10px] font-bold text-brand-900"
    >
      {iniciais || '?'}
    </span>
  );
}

export function CompromissoCard({
  c, onAbrir, onEditar, onVerTriagem, onAcao, onConcluir, onCancelar, onRemarcar,
  onExcluir, podeExcluir, draggable, onDragStart,
}: {
  c: Compromisso;
  onAbrir: (c: Compromisso) => void;
  onEditar: (c: Compromisso) => void;
  onVerTriagem: (atendimentoId: string) => void;
  onAcao: (id: string, status: StatusCompromisso) => void;
  onConcluir: (c: Compromisso) => void;
  onCancelar: (c: Compromisso) => void;
  onRemarcar: (c: Compromisso) => void;
  onExcluir?: (c: Compromisso) => void;
  podeExcluir?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
}) {
  const { tipos } = useTiposEvento();
  const cor = corDeTipo(c.tipo, tipos);
  const atrasado = estaAtrasado(c);
  // A API devolve a equipe com o responsável primeiro; aqui interessa o resto.
  const participantes = (c.equipe ?? []).filter((e) => !e.principal);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn('rounded-lg border border-l-4 bg-card p-3 shadow-sm', cor.borda, draggable && 'cursor-grab active:cursor-grabbing')}
    >
      {/* Cabeçalho: tipo + ações de edição */}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', cor.badge)}>
            <Gavel className="h-3 w-3" /> {rotuloTipo(c.tipo, tipos)}
          </span>
          {c.urgente && <SeloUrgente motivo={c.urgenteMotivo} desde={c.urgenteEm} />}
          {c.origemAutomatica && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
              title="Gerado automaticamente a partir de uma movimentação do DataJud"
            >
              <Bot className="h-3 w-3" /> Criado pelo Sistema
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => onEditar(c)} title="Editar" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {podeExcluir && onExcluir && (
            <button type="button" onClick={() => onExcluir(c)} title="Excluir" className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Corpo clicável — abre o detalhe do compromisso */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onAbrir(c)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir(c); } }}
        className="-mx-1 cursor-pointer rounded px-1 transition-colors hover:bg-muted/40"
        title="Ver detalhes"
      >
        <p className="line-clamp-2 text-sm font-semibold leading-tight">{c.titulo}</p>

        {c.status === 'EM_ANDAMENTO' && c.iniciadoEm && (
          <div className="mt-1"><Cronometro desde={c.iniciadoEm} /></div>
        )}

        <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          <p className={cn('flex items-center gap-1', atrasado && 'font-medium text-red-600 dark:text-red-400')}>
            <Clock className="h-3 w-3 shrink-0" /> {formatData(c.inicio)}, {formatHora(c.inicio)}
          </p>
          {c.local && <p className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" /> {c.local}</p>}
          {c.filiado && <p className="truncate">{V.Filiado}: <span className="text-foreground">{c.filiado.nomeCompleto}</span></p>}
        </div>

        {/* Quem responde e quem registrou — os dois com foto */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <MiniAvatar
              nome={c.responsavel.nomeExibicao || c.responsavel.nome}
              url={c.responsavel.avatarUrl}
              titulo={`Responsável: ${c.responsavel.nomeExibicao || c.responsavel.nome}`}
            />
            <span className="truncate text-xs text-muted-foreground">
              {c.responsavel.nomeExibicao || c.responsavel.nome}
            </span>
            {/*
              QUEM MAIS ATUA — avatares empilhados ao lado de quem responde.

              Só aparece quando há alguém: uma atividade de uma pessoa continua
              exatamente como era. A ordem é a da API (responsável primeiro),
              então basta pular o principal. Sem isto, uma audiência com três
              advogados apareceria no quadro como se fosse de um.
            */}
            {participantes.length > 0 && (
              <span
                className="flex items-center -space-x-1.5"
                title={`Também atuam: ${participantes
                  .map((e) => e.usuario.nomeExibicao || e.usuario.nome)
                  .join(', ')}`}
              >
                {participantes.slice(0, 3).map((e) => (
                  <span key={e.usuario.id} className="rounded-full ring-2 ring-background">
                    <MiniAvatar
                      nome={e.usuario.nomeExibicao || e.usuario.nome}
                      url={e.usuario.avatarUrl}
                      titulo={e.usuario.nomeExibicao || e.usuario.nome}
                    />
                  </span>
                ))}
                {participantes.length > 3 && (
                  <span className="ml-2 text-[11px] font-medium text-muted-foreground">
                    +{participantes.length - 3}
                  </span>
                )}
              </span>
            )}
          </span>

          {/* Criador: só quando difere do responsável — repetir a mesma foto
              duas vezes lado a lado não informa nada. */}
          {c.criador && c.criador.id !== c.responsavel.id && (
            <span className="flex min-w-0 items-center gap-1.5">
              <PenLine className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              <MiniAvatar
                nome={c.criador.nomeExibicao || c.criador.nome}
                url={c.criador.avatarUrl}
                titulo={`Registrado por ${c.criador.nomeExibicao || c.criador.nome}`}
              />
              <span className="truncate text-[11px] text-muted-foreground/80">
                {c.criador.nomeExibicao || c.criador.nome}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Desfecho registrado — o card conta como a demanda terminou */}
      {c.status === 'CONCLUIDO' && (
        <div className="mt-2">
          {c.desfecho ? (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', corDesfecho(c.desfecho))}>
              <CheckCircle2 className="h-3 w-3" /> {rotuloDesfecho(c.desfecho)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Desfecho não informado
            </span>
          )}
          {c.desfechoObs && (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{c.desfechoObs}</p>
          )}
        </div>
      )}

      {/* Por que caiu: a categoria explica; o texto, quando existe, complementa. */}
      {c.status === 'CANCELADO' && (c.canceladoCategoria || c.canceladoMotivo) && (
        <p className="mt-2 flex items-start gap-1 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/20 dark:text-red-300">
          <Ban className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0">
            {c.canceladoCategoria && (
              <strong className="font-semibold">
                {CATEGORIA_CANCELAMENTO_LABEL[c.canceladoCategoria] ?? 'Cancelada'}
              </strong>
            )}
            {c.canceladoCategoria && c.canceladoMotivo ? ' · ' : ''}
            {c.canceladoMotivo}
          </span>
        </p>
      )}

      {c.dataOriginal && (
        <p className="mt-2 flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          <History className="h-3 w-3 shrink-0" />
          Remarcado {c.remarcacoes > 1 ? `${c.remarcacoes}×` : ''} · original: {formatData(c.dataOriginal)}
        </p>
      )}

      {c.atendimentoId && (
        <button type="button" onClick={() => onVerTriagem(c.atendimentoId!)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400">
          <FileSearch className="h-3 w-3" /> Ver triagem de origem
        </button>
      )}

      {/*
        AÇÕES POR ETAPA — uma ação PRINCIPAL em destaque + as secundárias como
        ícones. O fluxo real é "Iniciar → Concluir": é isso que fica grande.
        Remarcar e cancelar viram gestos rápidos, mas cada um com o seu diálogo
        (data nova / motivo obrigatório) em vez de mudar o status no escuro.
      */}
      <div className="mt-2.5 flex items-center gap-1.5 border-t pt-2.5">
        {c.status === 'PENDENTE' && (
          <>
            <AcaoPrimaria onClick={() => onAcao(c.id, 'EM_ANDAMENTO')}>
              <Play className="h-3.5 w-3.5" /> Iniciar
            </AcaoPrimaria>
            <AcaoBtn onClick={() => onConcluir(c)} titulo="Concluir com desfecho">
              <CheckCircle2 className="h-3.5 w-3.5" /> Concluir
            </AcaoBtn>
            <AcaoBtn onClick={() => onRemarcar(c)} tom="aviso" titulo="Remarcar">
              <CalendarClock className="h-3.5 w-3.5" />
            </AcaoBtn>
            <AcaoBtn onClick={() => onCancelar(c)} tom="perigo" titulo="Cancelar">
              <Ban className="h-3.5 w-3.5" />
            </AcaoBtn>
          </>
        )}
        {c.status === 'EM_ANDAMENTO' && (
          <>
            <AcaoPrimaria onClick={() => onConcluir(c)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Concluir
            </AcaoPrimaria>
            <AcaoBtn onClick={() => onAcao(c.id, 'PENDENTE')} titulo="Voltar para pendente">
              <RotateCcw className="h-3.5 w-3.5" />
            </AcaoBtn>
            <AcaoBtn onClick={() => onRemarcar(c)} tom="aviso" titulo="Remarcar">
              <CalendarClock className="h-3.5 w-3.5" />
            </AcaoBtn>
            <AcaoBtn onClick={() => onCancelar(c)} tom="perigo" titulo="Cancelar">
              <Ban className="h-3.5 w-3.5" />
            </AcaoBtn>
          </>
        )}
        {(c.status === 'CONCLUIDO' || c.status === 'CANCELADO') && (
          <AcaoBtn onClick={() => onAcao(c.id, 'PENDENTE')} tom="aviso" titulo="Reabrir a atividade">
            <RotateCcw className="h-3.5 w-3.5" /> Reabrir
          </AcaoBtn>
        )}
      </div>
    </div>
  );
}
