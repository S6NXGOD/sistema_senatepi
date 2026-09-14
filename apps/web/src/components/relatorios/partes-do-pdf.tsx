'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PRESETS_DO_PERIODO, hojeComoTexto, periodoAnterior, periodoDoPreset, periodoValido, rotuloDoPeriodo,
  type Periodo, type PresetDoPeriodo,
} from '@/lib/periodo-do-pdf';

/**
 * AS PEÇAS DOS DOIS DIÁLOGOS DE PDF — o do sindicato e o do uso do sistema.
 *
 * Escolher o período, comparar, pôr título: é a mesma conversa nos dois, e duas
 * cópias dela divergiriam na primeira mudança.
 */

export const campoCls =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ' +
  'ring-offset-background focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A CASCA: de baixo no celular, onde o polegar alcança; no centro no computador.
 * Esc fecha — menos enquanto gera, para o PDF não se perder no meio.
 */
export function DialogoDoPdf({
  titulo, subtitulo, gerando, onFechar, rodape, children,
}: {
  titulo: string;
  subtitulo?: string;
  gerando: boolean;
  onFechar: () => void;
  rodape: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !gerando) onFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [gerando, onFechar]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={gerando ? undefined : onFechar}
    >
      {/* Só ENTRADA: fechar desmonta na hora, e é a desmontagem que zera o diálogo. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-do-pdf"
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b py-2 pl-4 pr-2">
          <div className="min-w-0 py-2">
            <h2 id="titulo-do-pdf" className="font-semibold">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-xs text-muted-foreground">{subtitulo}</p>}
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={gerando}
            aria-label="Fechar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 divide-y overflow-y-auto">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 p-4">
          {rodape}
        </div>
      </div>
    </div>
  );
}

export function ParteDoDialogo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {children}
    </section>
  );
}

export function Opcao({
  marcada, onMudar, titulo, texto,
}: {
  marcada: boolean;
  onMudar: (marcada: boolean) => void;
  titulo: string;
  texto?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(e) => onMudar(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{titulo}</span>
        {texto && <span className="block text-xs text-muted-foreground">{texto}</span>}
      </span>
    </label>
  );
}

/**
 * O PERÍODO DO PDF — "mensal, anual, personalizado". Os atalhos primeiro; as
 * datas só quando se pede. Embaixo, por extenso, o período que vai sair e o
 * anterior contra o qual se compara: ninguém descobre no papel que pegou o mês
 * errado.
 */
export function EscolhaDoPeriodo({
  preset, onPreset, datas, onDatas, tela, comparar, onComparar,
}: {
  preset: PresetDoPeriodo;
  onPreset: (preset: PresetDoPeriodo) => void;
  datas: Periodo;
  onDatas: (datas: Periodo) => void;
  tela: Periodo;
  comparar: boolean;
  onComparar: (comparar: boolean) => void;
}) {
  const valido = preset !== 'PERSONALIZADO' || periodoValido(datas);
  const periodo = valido ? periodoDoPreset(preset, hojeComoTexto(new Date()), tela, datas) : null;

  return (
    <ParteDoDialogo titulo="Período">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS_DO_PERIODO.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => onPreset(p.id)}
            className={cn(
              'min-h-11 rounded-full border px-3.5 text-xs font-medium transition sm:min-h-8',
              preset === p.id
                ? 'border-brand-700 bg-brand-700 text-white dark:border-brand-500 dark:bg-brand-600'
                : 'hover:bg-muted',
            )}
          >
            {p.texto}
          </button>
        ))}
      </div>

      {preset === 'PERSONALIZADO' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">De</span>
            <input
              type="date"
              value={datas.de}
              max={datas.ate || undefined}
              onChange={(e) => onDatas({ ...datas, de: e.target.value })}
              className={campoCls}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Até</span>
            <input
              type="date"
              value={datas.ate}
              min={datas.de || undefined}
              onChange={(e) => onDatas({ ...datas, ate: e.target.value })}
              className={campoCls}
            />
          </label>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {periodo ? (
          <>
            Sai com <strong className="font-semibold text-foreground">{rotuloDoPeriodo(periodo)}</strong>.
          </>
        ) : (
          'Escolha as duas datas.'
        )}
      </p>

      <Opcao
        marcada={comparar}
        onMudar={onComparar}
        titulo="Comparar com o período anterior"
        texto={
          periodo
            ? `Contra ${rotuloDoPeriodo(periodoAnterior(periodo, preset))}. Só entram contagens do período.`
            : 'Só entram contagens do período.'
        }
      />
    </ParteDoDialogo>
  );
}

/** O tamanho da observação nos PDFs de sempre (o do sindicato, o do panorama e o da equipe). */
export const OBSERVACAO_MAXIMA = 600;

/**
 * TÍTULO E OBSERVAÇÃO — recolhidos até alguém pedir. Não ficam guardados:
 * "Assembleia de setembro" no PDF de outubro é armadilha.
 */
export function TituloEObservacao({
  titulo, onTitulo, observacao, onObservacao, tituloPadrao, limiteDaObservacao = OBSERVACAO_MAXIMA, ajudaDaObservacao,
}: {
  titulo: string;
  onTitulo: (titulo: string) => void;
  observacao: string;
  onObservacao: (observacao: string) => void;
  tituloPadrao: string;
  /**
   * Até quantos caracteres a observação vai. O PDF de uma pessoa aceita menos
   * (14/09/2026): a folha é uma só, e a observação disputa espaço com os números.
   */
  limiteDaObservacao?: number;
  /** Uma frase embaixo do campo, dizendo por que o limite é esse. */
  ajudaDaObservacao?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const tamanho = observacao.trim().length;
  // Texto escrito antes de o limite baixar (trocou a equipe por uma pessoa) não some: o campo abre e diz quanto sobra.
  const passou = tamanho > limiteDaObservacao;
  return (
    <ParteDoDialogo titulo="Título e observação">
      {aberto || passou ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">Título</span>
            <input
              value={titulo}
              onChange={(e) => onTitulo(e.target.value)}
              placeholder={tituloPadrao}
              maxLength={90}
              className={campoCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">
              {ajudaDaObservacao ? 'Observação — sai antes dos números' : 'Observação — sai numa caixa, antes dos números'}
            </span>
            <textarea
              value={observacao}
              onChange={(e) => onObservacao(e.target.value)}
              rows={3}
              maxLength={Math.max(limiteDaObservacao, observacao.length)}
              placeholder="Ex.: números apresentados na assembleia de 20/09."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {passou ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              A observação tem {tamanho} caracteres. Para este PDF, encurte para {limiteDaObservacao} ou menos.
            </p>
          ) : (
            ajudaDaObservacao && <p className="text-xs text-muted-foreground">{ajudaDaObservacao}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sai como “{tituloPadrao}”.{' '}
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
          >
            Mudar o título ou escrever uma observação
          </button>
        </p>
      )}
    </ParteDoDialogo>
  );
}
