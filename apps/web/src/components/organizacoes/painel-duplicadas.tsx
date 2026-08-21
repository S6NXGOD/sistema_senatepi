'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyCheck, ChevronDown, ChevronRight, ArrowRight, CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  organizacoesDuplicadas, naoSaoDuplicadas, formatDocumento, MOTIVO_SEMELHANCA_LABEL,
  type ParDuplicado, type ParteExterna,
} from '@/lib/partes';

/**
 * A FILA DE LIMPEZA — as duplicatas que já estão no cadastro.
 *
 * O aviso ao digitar impede a PRÓXIMA duplicata. Este painel existe para as que
 * já entraram e ninguém vai procurar: cada uma parte em duas a contagem de
 * processos contra aquela organização, que é a razão de o cadastro existir, e
 * ninguém acorda pensando "vou auditar o cadastro de partes hoje".
 *
 * FICA RECOLHIDO E SÓ APARECE COM ALGO DENTRO. Um painel de manutenção sempre
 * visível vira paisagem em uma semana; um que só aparece quando há trabalho
 * mantém o sinal. E ele não some quando está vazio sem dizer nada — a versão
 * vazia é o retorno positivo de que o cadastro está limpo.
 *
 * A SUGESTÃO DE QUEM FICA VEM DA API (quem tem mais vínculos, dossiê patronal
 * ou documento), mas quem decide é a pessoa: o botão abre o modal com a
 * sugestão preenchida e dá para inverter lá.
 */
export function PainelDuplicadas({
  onMesclar,
  podeMesclar,
}: {
  /** Abre o modal com a organização sugerida como sobrevivente. */
  onMesclar: (fica: ParteExterna, duplicada: ParteExterna) => void;
  /** Só ADMINISTRADOR mescla — para os demais, o painel é informativo. */
  podeMesclar: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['organizacoes', 'duplicadas'],
    queryFn: organizacoesDuplicadas,
    staleTime: 120_000,
  });

  if (isLoading) return null;
  const pares = data?.pares ?? [];

  if (!pares.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        Nenhuma organização duplicada encontrada entre as {data?.analisadas ?? 0} analisadas.
        {data?.truncou && ' (a varredura parou no limite — há cadastros não comparados)'}
      </p>
    );
  }

  return (
    <Card className="overflow-hidden border-amber-300 dark:border-amber-800">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-amber-50 p-3 text-left transition hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
      >
        <span className="flex items-center gap-2">
          <CopyCheck className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="text-sm font-semibold text-amber-900 dark:text-amber-300">
            {pares.length} possível{pares.length === 1 ? '' : 'is'} duplicata
            {pares.length === 1 ? '' : 's'} no cadastro
          </span>
          <span className="hidden text-xs text-amber-800/80 sm:inline dark:text-amber-300/70">
            — cada uma divide em duas a contagem de processos daquela organização
          </span>
        </span>
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>

      {aberto && (
        <ul className="divide-y">
          {pares.map((par) => (
            <LinhaPar
              key={`${par.fica.id}|${par.duplicada.id}`}
              par={par}
              podeMesclar={podeMesclar}
              onMesclar={onMesclar}
              onDescartar={async () => {
                try {
                  await naoSaoDuplicadas(par.fica.id, par.duplicada.id);
                  await qc.invalidateQueries({ queryKey: ['organizacoes', 'duplicadas'] });
                  toast.success('Par descartado — não aparece mais nesta fila.');
                } catch {
                  toast.error('Não foi possível descartar o par.');
                }
              }}
            />
          ))}
          {data?.truncou && (
            <li className="p-2.5 text-[11px] text-muted-foreground">
              A varredura analisou as primeiras {data.analisadas} organizações e parou no limite.
              Depois de resolver estas, recarregue para ver o resto.
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function LinhaPar({
  par, podeMesclar, onMesclar, onDescartar,
}: {
  par: ParDuplicado;
  podeMesclar: boolean;
  onMesclar: (fica: ParteExterna, duplicada: ParteExterna) => void;
  onDescartar: () => void | Promise<void>;
}) {
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Lado p={par.duplicada} rotulo="some" tom="red" />
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Lado p={par.fica} rotulo="fica" tom="emerald" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {MOTIVO_SEMELHANCA_LABEL[par.motivo]}
        </span>
        {podeMesclar && (
          <Button size="sm" variant="outline" onClick={() => onMesclar(par.fica, par.duplicada)}>
            Revisar
          </Button>
        )}
        {/*
          O DESCARTE não pede ADMINISTRADOR, ao contrário de mesclar: ele não
          apaga nada. Exigir o perfil mais alto para dizer "isto está errado"
          faria a fila encher justamente por quem tem menos acesso — e quem
          conhece as organizações pelo nome raramente é o administrador.
        */}
        <button
          type="button"
          onClick={onDescartar}
          title="Não são a mesma organização — tirar este par da fila"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

/**
 * Cada lado mostra o que a pessoa precisa para decidir em um olhar: quantos
 * processos e quantos vínculos de trabalho tem preso nele. É o custo de escolher
 * errado, e é o único número que importa aqui.
 */
function Lado({
  p, rotulo, tom,
}: {
  p: ParDuplicado['fica'];
  rotulo: string;
  tom: 'red' | 'emerald';
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="flex items-center gap-1.5">
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
            tom === 'red'
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
          )}
        >
          {rotulo}
        </span>
        <span className="truncate text-[13px] font-medium" title={p.nome}>{p.nome}</span>
      </p>
      <p className="truncate text-[11px] text-muted-foreground">
        {p.documento ? formatDocumento(p.documento) : 'sem documento'}
        {' · '}
        {p._count.participacoes} processo{p._count.participacoes === 1 ? '' : 's'}
        {' · '}
        {p._count.vinculos} vínculo{p._count.vinculos === 1 ? '' : 's'}
        {p.dossiePatronal ? ' · patronal' : ''}
      </p>
    </div>
  );
}
