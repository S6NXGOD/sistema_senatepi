'use client';

import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, X } from 'lucide-react';

import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { Button } from '@/components/ui/button';
import { AREAS_JURIDICAS } from '@/lib/areas-juridicas';
import {
  FASE_LABEL,
  STATUS_PROCESSO_LABEL,
  STATUS_PROCESSO_ORDEM,
  listarAdvogadosDisponiveis,
  type FaseProcessual,
  type StatusProcesso,
} from '@/lib/processos';
import { cn } from '@/lib/utils';

/**
 * O QUE ESTÁ FILTRANDO AGORA, e como desligar cada coisa.
 *
 * POR QUE UM PAINEL, E NÃO MAIS SELETORES NA BARRA. A barra tinha quatro
 * controles em coluna no celular — busca, parte contrária, status e fase — cada
 * um com 48px de altura. Somados aos chips, que quebravam em três linhas, davam
 * mais de 200px de enfeite antes do primeiro processo aparecer. Numa tela de
 * 360px isso é metade do aparelho gasto com controles que quase nunca mudam.
 *
 * A API já aceitava `advogadoId`, `categoria`, `tribunal` e `etiqueta`, e
 * NENHUM deles tinha como ser usado pela tela — filtros que existiam só para
 * quem chamasse a API na mão. Empilhá-los na barra teria multiplicado o
 * problema por dois; aqui eles cabem, porque o painel só ocupa espaço quando
 * alguém o abre.
 *
 * A REGRA DE OURO é a segunda metade disto: filtro escondido precisa se
 * ANUNCIAR. O contador no botão e a fila de fichas removíveis existem para que
 * "só aparecem 3 processos" nunca seja um mistério — a razão fica na tela, ao
 * lado do resultado, com um × para desfazer uma de cada vez. Sem isso, um
 * painel fechado é uma armadilha.
 */

export interface FiltrosProcesso {
  status: '' | StatusProcesso;
  fase: '' | FaseProcessual;
  advogadoId: string;
  categoria: string;
}

export const FILTROS_VAZIOS: FiltrosProcesso = {
  status: '',
  fase: '',
  advogadoId: '',
  categoria: '',
};

/** Quantos filtros do painel estão ligados — o número da bolinha no botão. */
export function contarFiltros(f: FiltrosProcesso, temParte: boolean): number {
  return (
    (f.status ? 1 : 0) +
    (f.fase ? 1 : 0) +
    (f.advogadoId ? 1 : 0) +
    (f.categoria ? 1 : 0) +
    (temParte ? 1 : 0)
  );
}

const campoCls =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-base md:h-9 md:text-sm';

/** O botão que abre o painel, com o contador de filtros ativos. */
export function BotaoFiltros({
  aberto,
  onToggle,
  quantos,
}: {
  aberto: boolean;
  onToggle: () => void;
  quantos: number;
}) {
  return (
    <Button
      type="button"
      variant={quantos > 0 ? 'default' : 'outline'}
      onClick={onToggle}
      aria-expanded={aberto}
      className="h-12 shrink-0 gap-2 md:h-10"
    >
      <SlidersHorizontal className="h-4 w-4" />
      Filtros
      {quantos > 0 && (
        <span className="rounded-full bg-white/25 px-1.5 text-xs font-bold tabular-nums">
          {quantos}
        </span>
      )}
    </Button>
  );
}

/** Os seletores. Só monta quando aberto — não custa nada fechado. */
export function PainelDeFiltros({
  valor,
  onChange,
}: {
  valor: FiltrosProcesso;
  onChange: (f: FiltrosProcesso) => void;
}) {
  /**
   * A lista de advogados só é buscada quando o painel abre, e fica em cache por
   * dez minutos: é um cadastro que muda uma vez por semestre, e recarregá-lo a
   * cada abertura seria uma chamada por nada.
   */
  const { data: advogados = [] } = useQuery({
    queryKey: ['processos', 'advogados-disponiveis'],
    queryFn: listarAdvogadosDisponiveis,
    staleTime: 10 * 60_000,
  });

  const set = (parcial: Partial<FiltrosProcesso>) => onChange({ ...valor, ...parcial });

  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Situação</span>
        <select
          className={campoCls}
          value={valor.status}
          onChange={(e) => set({ status: e.target.value as '' | StatusProcesso })}
        >
          <option value="">Todas</option>
          {STATUS_PROCESSO_ORDEM.map((s) => (
            <option key={s} value={s}>
              {STATUS_PROCESSO_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Fase processual</span>
        <select
          className={campoCls}
          value={valor.fase}
          onChange={(e) => set({ fase: e.target.value as '' | FaseProcessual })}
        >
          <option value="">Todas</option>
          {(['PRE_PROCESSUAL', 'CONHECIMENTO', 'EXECUCAO', 'RECURSAL', 'ARQUIVADO'] as const).map(
            (f) => (
              <option key={f} value={f}>
                {FASE_LABEL[f]}
              </option>
            ),
          )}
        </select>
      </label>

      {/*
        ADVOGADO RESPONSÁVEL — o filtro que mais faltava.
        Existia só "Meus processos", que responde por quem está logado. A
        coordenação precisa da outra pergunta: "o que está com a Dra. Shérad?".
        A API já aceitava `advogadoId` desde sempre.
      */}
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Advogado responsável</span>
        <select
          className={campoCls}
          value={valor.advogadoId}
          onChange={(e) => set({ advogadoId: e.target.value })}
        >
          <option value="">Qualquer um</option>
          {advogados.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nomeExibicao || a.nome}
              {a.oab ? ` — OAB ${a.oab}/${a.oabUf ?? ''}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Área jurídica</span>
        <select
          className={campoCls}
          value={valor.categoria}
          onChange={(e) => set({ categoria: e.target.value })}
        >
          <option value="">Todas</option>
          {AREAS_JURIDICAS.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.nome}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Uma ficha removível. */
function Ficha({
  rotulo,
  valor,
  onRemover,
  avatar,
}: {
  rotulo: string;
  valor: string;
  onRemover: () => void;
  avatar?: { nome: string; avatarUrl: string | null };
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background py-1 pl-2.5 pr-1 text-xs">
      {avatar ? (
        <AvatarPessoa nome={avatar.nome} url={avatar.avatarUrl} tamanho="xs" />
      ) : (
        <span className="text-muted-foreground">{rotulo}:</span>
      )}
      <span className="truncate font-medium">{valor}</span>
      <button
        type="button"
        onClick={onRemover}
        aria-label={`Remover filtro ${rotulo}`}
        // 24px de alvo: o × de 12px sozinho é impossível de acertar no polegar.
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/**
 * A FILA DE FICHAS — o que está filtrando, em linguagem de gente.
 *
 * Some inteira quando não há filtro: uma barra vazia com "nenhum filtro" seria
 * ruído permanente para informar ausência.
 */
export function FichasDeFiltro({
  filtros,
  parte,
  busca,
  onLimparCampo,
  onLimparTudo,
}: {
  filtros: FiltrosProcesso;
  parte: { id: string; nome: string } | null;
  busca: string;
  onLimparCampo: (campo: keyof FiltrosProcesso | 'parte' | 'busca') => void;
  onLimparTudo: () => void;
}) {
  const { data: advogados = [] } = useQuery({
    queryKey: ['processos', 'advogados-disponiveis'],
    queryFn: listarAdvogadosDisponiveis,
    staleTime: 10 * 60_000,
    // Só busca se houver um advogado filtrado para nomear.
    enabled: !!filtros.advogadoId,
  });
  const advogado = advogados.find((a) => a.id === filtros.advogadoId);

  const fichas: React.ReactNode[] = [];
  if (busca) {
    fichas.push(
      <Ficha key="busca" rotulo="Busca" valor={`"${busca}"`} onRemover={() => onLimparCampo('busca')} />,
    );
  }
  if (parte) {
    fichas.push(
      <Ficha key="parte" rotulo="Parte" valor={parte.nome} onRemover={() => onLimparCampo('parte')} />,
    );
  }
  if (filtros.status) {
    fichas.push(
      <Ficha
        key="status"
        rotulo="Situação"
        valor={STATUS_PROCESSO_LABEL[filtros.status]}
        onRemover={() => onLimparCampo('status')}
      />,
    );
  }
  if (filtros.fase) {
    fichas.push(
      <Ficha
        key="fase"
        rotulo="Fase"
        valor={FASE_LABEL[filtros.fase]}
        onRemover={() => onLimparCampo('fase')}
      />,
    );
  }
  if (filtros.advogadoId) {
    fichas.push(
      <Ficha
        key="advogado"
        rotulo="Advogado"
        valor={advogado ? advogado.nomeExibicao || advogado.nome : 'carregando…'}
        avatar={
          advogado
            ? { nome: advogado.nomeExibicao || advogado.nome, avatarUrl: advogado.avatarUrl }
            : undefined
        }
        onRemover={() => onLimparCampo('advogadoId')}
      />,
    );
  }
  if (filtros.categoria) {
    fichas.push(
      <Ficha
        key="categoria"
        rotulo="Área"
        valor={AREAS_JURIDICAS.find((a) => a.slug === filtros.categoria)?.nome ?? filtros.categoria}
        onRemover={() => onLimparCampo('categoria')}
      />,
    );
  }

  if (!fichas.length) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5')}>
      {fichas}
      {fichas.length > 1 && (
        <button
          type="button"
          onClick={onLimparTudo}
          className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
        >
          limpar tudo
        </button>
      )}
    </div>
  );
}
