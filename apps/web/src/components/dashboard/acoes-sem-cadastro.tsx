'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Radar, ChevronRight, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { minhasPendencias } from '@/lib/pendencias';

/**
 * AS AÇÕES QUE O DIÁRIO REVELOU E NINGUÉM CADASTROU — no painel, não na testa.
 *
 * POR QUE AQUI, E POR QUE ISTO NÃO É A FAIXA DE VOLTA
 * A faixa global mostrava este mesmo número em cima de TODA tela do sistema, e
 * o usuário reclamou com razão: são trinta itens que levam dias para conferir,
 * então ela virava cabeçalho — e cabeçalho ninguém lê, inclusive no dia em que
 * ele passar a dizer "prazo vencido". Um card no painel é o contrário de uma
 * faixa: aparece UMA vez, no lugar onde a pessoa vai ver o dia dela, e não
 * persegue ninguém até Cobranças.
 *
 * NÃO É VERMELHO, e é decisão. Vermelho é para o que já venceu. Isto é
 * trabalho a fazer, e o tom certo é o mesmo dos outros blocos do Diário —
 * índigo. O que dá urgência a uma ação recente agora é outra coisa: ela vira
 * TAREFA na agenda do advogado citado no ato.
 *
 * SEM REQUISIÇÃO NOVA. Usa a mesma chave do sino (`minhas-pendencias`), que já
 * roda em toda tela: o React Query serve os dois com uma chamada só. Também
 * herda o mesmo recorte de permissão — quem não pode cadastrar processo não
 * recebe o item do backend, então não vê o card.
 */
const POLO_CHIP: Record<string, { texto: string; cls: string }> = {
  Movemos: {
    texto: 'Movemos',
    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  'Movem contra nós': {
    texto: 'Contra nós',
    cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  },
  'Nos dois polos': {
    texto: 'Dois polos',
    cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  },
  'Polo não informado': {
    texto: 'Polo indefinido',
    cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

/** "Movemos · 0000737-34.2026.5.22.0105" → as duas metades, separadas. */
function partirTitulo(titulo: string): { polo: string; npu: string } {
  const i = titulo.indexOf(' · ');
  return i < 0
    ? { polo: '', npu: titulo }
    : { polo: titulo.slice(0, i), npu: titulo.slice(i + 3) };
}

/** Há quanto tempo esta ação espera — em dias, que é a unidade da decisão. */
function esperaEmDias(iso: string | null): number | null {
  if (!iso) return null;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return dias >= 0 ? dias : null;
}

export function AcoesSemCadastro() {
  const { user } = useAuth();
  // O MESMO gate do sino: a rota é @Modulo('agenda'). Desenhar o card para
  // quem levaria 403 seria oferecer um caminho que não existe.
  const permitido = podeVer(user?.role, user?.permissoes, 'agenda');

  const { data } = useQuery({
    queryKey: ['minhas-pendencias'],
    queryFn: minhasPendencias,
    enabled: permitido,
    refetchInterval: 60_000,
    retry: false,
  });

  const acoes = (data?.pendencias ?? []).find((p) => p.tipo === 'ACAO_NOVA');
  if (!acoes || acoes.total === 0) return null;

  const sobra = acoes.total - acoes.exemplos.length;

  return (
    <Card className="overflow-hidden border-indigo-200 dark:border-indigo-900/50">
      <div className="flex items-start gap-3 border-b border-indigo-100 bg-indigo-50/60 px-4 py-3 dark:border-indigo-900/40 dark:bg-indigo-950/20">
        <Radar className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700 dark:text-indigo-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {acoes.total === 1
              ? '1 ação do sindicato apareceu no Diário'
              : `${acoes.total} ações do sindicato apareceram no Diário`}
          </p>
          {/*
            O QUE JÁ ESTÁ ACONTECENDO, e não uma cobrança.

            Dizer só "não estão cadastradas" põe a bola no colo de quem lê, todo
            dia, sem dizer o que muda. Dizer que a recente já virou tarefa
            explica por que as outras podem esperar — e é o que impede este card
            de virar a mesma faixa de antes, só que em outro lugar.
          */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ainda não estão no acervo. As recentes já viraram tarefa na agenda do
            advogado citado no ato; as demais esperam aqui, sem prazo.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-indigo-100 dark:divide-indigo-900/30">
        {acoes.exemplos.map((e) => {
          const { polo, npu } = partirTitulo(e.titulo);
          const chip = POLO_CHIP[polo];
          const dias = esperaEmDias(e.quando);
          return (
            <li key={e.id}>
              <Link
                href={e.href}
                className="flex items-center gap-2 px-4 py-2.5 transition hover:bg-muted/60"
              >
                {chip && (
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      chip.cls,
                    )}
                  >
                    {chip.texto}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{npu}</span>
                {/*
                  A ESPERA, e não a data. "há 12 dias" responde a pergunta que a
                  pessoa faz olhando a linha; "26/08" obriga a fazer a conta.
                  Some no celular estreito para o NPU não ser truncado.
                */}
                {dias !== null && (
                  <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                    {dias === 0 ? 'hoje' : `há ${dias}d`}
                  </span>
                )}
                <span className="shrink-0 text-[11px] font-medium text-brand-800 dark:text-brand-300">
                  Cadastrar
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href="/processos"
        className="flex items-center justify-between gap-2 border-t border-indigo-100 px-4 py-2.5 text-xs font-medium text-brand-800 transition hover:bg-muted/60 dark:border-indigo-900/30 dark:text-brand-300"
      >
        {sobra > 0 ? `Ver as outras ${sobra} na fila` : 'Abrir a fila em Processos'}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </Card>
  );
}
