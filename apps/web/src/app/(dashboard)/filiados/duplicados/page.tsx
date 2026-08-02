'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle, ArrowLeft, CheckCircle2, HelpCircle, Loader2, Merge, Users, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { podeExcluir } from '@/lib/permissoes';
import { cn, formatarData, mascararCpf } from '@/lib/utils';
import {
  CAMPOS_COMPARADOS, CONFIANCA_COR, CONFIANCA_EXPLICACAO, CONFIANCA_LABEL,
  fundirDuplicados, listarDuplicados, marcarDistintos,
  type CandidatoDuplicata, type Confianca, type GrupoDuplicata,
} from '@/lib/duplicidade';

const NIVEIS: Confianca[] = ['ALTA', 'MEDIA', 'BAIXA'];

export default function DuplicadosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const [aba, setAba] = useState<Confianca>('ALTA');
  const [fundindo, setFundindo] = useState<{ grupo: GrupoDuplicata; manter: CandidatoDuplicata } | null>(null);
  const [executando, setExecutando] = useState(false);
  /** Escolha do operador quando ele discorda do sugerido (ou não há sugestão). */
  const [escolha, setEscolha] = useState<Record<string, string>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['duplicados'],
    queryFn: listarDuplicados,
    // A varredura percorre a base inteira: não vale refazer a cada foco.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const porNivel = useMemo(() => {
    const mapa: Record<Confianca, GrupoDuplicata[]> = { ALTA: [], MEDIA: [], BAIXA: [] };
    for (const g of data ?? []) mapa[g.confianca].push(g);
    return mapa;
  }, [data]);

  const grupos = porNivel[aba];

  async function confirmarFusao() {
    if (!fundindo) return;
    const descartar = fundindo.grupo.candidatos.find((c) => c.id !== fundindo.manter.id);
    if (!descartar) return;
    setExecutando(true);
    try {
      const r = await fundirDuplicados(fundindo.manter.id, descartar.id);
      toast.success(
        r.camposAbsorvidos?.length
          ? `Consolidado. Aproveitados: ${r.camposAbsorvidos.join(', ')}.`
          : 'Cadastros consolidados.',
      );
      setFundindo(null);
      qc.invalidateQueries({ queryKey: ['duplicados'] });
      qc.invalidateQueries({ queryKey: ['filiados'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível consolidar.');
    } finally {
      setExecutando(false);
    }
  }

  async function naoDuplicado(g: GrupoDuplicata) {
    const [a, b] = g.candidatos;
    try {
      await marcarDistintos(a.id, b.id);
      toast.success('Marcado como pessoas diferentes — não aparecerá de novo.');
      qc.invalidateQueries({ queryKey: ['duplicados'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível registrar.');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/filiados" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Filiados
          </Link>
          <h2 className="text-2xl font-bold">Possíveis cadastros duplicados</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A mesma pessoa cadastrada mais de uma vez. Consolidar copia para o registro
            mantido o que só existe no outro, e só então remove o duplicado — nenhum dado
            se perde.
          </p>
        </div>
      </div>

      {/* Abas por confiança */}
      <div className="flex flex-wrap gap-2">
        {NIVEIS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setAba(n)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm transition',
              aba === n ? 'border-senatepi-800 bg-senatepi-50 font-semibold dark:bg-senatepi-900/30' : 'hover:bg-muted',
            )}
          >
            Confiança {CONFIANCA_LABEL[n]}
            <span className="ml-2 rounded-full bg-muted px-1.5 text-xs">{porNivel[n].length}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{CONFIANCA_EXPLICACAO[aba]}</p>

      {isLoading && (
        <Card><CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Comparando os 7 mil cadastros…
        </CardContent></Card>
      )}

      {isError && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Não foi possível carregar. A ferramenta pode ter sido desligada.
        </CardContent></Card>
      )}

      {!isLoading && !isError && grupos.length === 0 && (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-senatepi-700 dark:text-senatepi-400" />
          <p className="text-sm font-medium">Nada pendente nesta confiança</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Os grupos resolvidos não voltam a aparecer.
          </p>
        </CardContent></Card>
      )}

      <div className="space-y-4">
        {grupos.map((g) => (
          <GrupoCard
            key={g.chave}
            grupo={g}
            ehAdmin={ehAdmin}
            escolhidoId={escolha[g.chave] ?? g.candidatos.find((c) => c.sugerido)?.id ?? null}
            onEscolher={(id) => setEscolha((e) => ({ ...e, [g.chave]: id }))}
            onFundir={(manter) => setFundindo({ grupo: g, manter })}
            onNaoDuplicado={() => naoDuplicado(g)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={!!fundindo}
        variant="destructive"
        title="Consolidar os cadastros?"
        confirmLabel="Consolidar e remover"
        loading={executando}
        onConfirm={confirmarFusao}
        onClose={() => (executando ? null : setFundindo(null))}
        description={
          fundindo ? (
            <ResumoFusao
              manter={fundindo.manter}
              descartar={fundindo.grupo.candidatos.find((c) => c.id !== fundindo.manter.id)!}
            />
          ) : null
        }
      />
    </div>
  );
}

function GrupoCard({
  grupo, ehAdmin, escolhidoId, onEscolher, onFundir, onNaoDuplicado,
}: {
  grupo: GrupoDuplicata;
  ehAdmin: boolean;
  escolhidoId: string | null;
  onEscolher: (id: string) => void;
  onFundir: (manter: CandidatoDuplicata) => void;
  onNaoDuplicado: () => void;
}) {
  /**
   * Um campo só é "divergente" quando os dois lados têm valor e diferem.
   * Vazio de um lado não é divergência — é justamente o padrão do cadastro
   * duplicado incompleto, e destacá-lo afogaria o que importa em amarelo.
   */
  const divergentes = useMemo(() => {
    const set = new Set<string>();
    for (const { chave } of CAMPOS_COMPARADOS) {
      const valores = grupo.candidatos
        .map((c) => normalizarValor(c[chave as keyof CandidatoDuplicata]))
        .filter((v) => v !== '');
      if (new Set(valores).size > 1) set.add(chave);
    }
    return set;
  }, [grupo]);

  const escolhido = grupo.candidatos.find((c) => c.id === escolhidoId) ?? null;
  const podeFundir = ehAdmin && grupo.candidatos.length === 2 && !!escolhido;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{grupo.candidatos[0].nomeCompleto}</p>
            <p className="text-xs text-muted-foreground">{grupo.criterio}</p>
          </div>
          <div className="flex items-center gap-2">
            {grupo.contradicoes.length > 0 && (
              <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200">
                <AlertCircle className="mr-1 h-3 w-3" />
                {grupo.contradicoes.join(', ')} divergem
              </Badge>
            )}
            <Badge className={CONFIANCA_COR[grupo.confianca]}>
              {CONFIANCA_LABEL[grupo.confianca]}
            </Badge>
          </div>
        </div>

        {/* Quando o sistema não sabe escolher, ele DIZ isso. Fingir uma
            recomendação em 256 grupos empatados seria transformar sorteio em
            conselho. */}
        {!grupo.decidiu ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {grupo.contradicoes.length > 0
              ? 'Há campos que se contradizem — pode ser que sejam pessoas diferentes. O sistema não sugere nada aqui.'
              : 'Os cadastros estão igualmente preenchidos: não há critério técnico para escolher. A decisão é sua.'}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sugestão: manter o marcado. {grupo.motivoSugestao}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {grupo.candidatos.map((c) => (
            <CandidatoCard
              key={c.id}
              c={c}
              escolhido={c.id === escolhidoId}
              divergentes={divergentes}
              onEscolher={() => onEscolher(c.id)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onNaoDuplicado}>
            <X className="h-4 w-4" /> Não é duplicado
          </Button>
          {podeFundir && (
            <Button size="sm" onClick={() => onFundir(escolhido!)}>
              <Merge className="h-4 w-4" /> Consolidar mantendo {escolhido!.matricula}
            </Button>
          )}
          {ehAdmin && grupo.candidatos.length > 2 && (
            <p className="text-xs text-muted-foreground">
              Grupo com {grupo.candidatos.length} cadastros — consolide dois de cada vez.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CandidatoCard({
  c, escolhido, divergentes, onEscolher,
}: {
  c: CandidatoDuplicata;
  escolhido: boolean;
  divergentes: Set<string>;
  onEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEscolher}
      className={cn(
        'rounded-xl border p-3 text-left transition',
        escolhido
          ? 'border-senatepi-700 bg-senatepi-50/60 ring-1 ring-senatepi-700 dark:bg-senatepi-900/20'
          : 'hover:bg-muted/50',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{c.matricula}</span>
        <span className={cn('text-xs font-semibold', escolhido ? 'text-senatepi-800 dark:text-senatepi-300' : 'text-muted-foreground')}>
          {escolhido ? 'MANTER' : 'remover'}
        </span>
      </div>
      <p className="mb-2 truncate text-sm font-medium">{c.nomeCompleto}</p>
      <dl className="space-y-1 text-xs">
        {CAMPOS_COMPARADOS.map(({ chave, rotulo }) => {
          const bruto = c[chave as keyof CandidatoDuplicata];
          const vazio = bruto === null || bruto === undefined || bruto === '';
          return (
            <div key={chave} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{rotulo}</dt>
              <dd
                className={cn(
                  'truncate text-right',
                  vazio && 'text-muted-foreground/40',
                  !vazio && divergentes.has(chave) && 'font-semibold text-amber-700 dark:text-amber-300',
                )}
              >
                {formatarCampo(chave, bruto)}
              </dd>
            </div>
          );
        })}
        <div className="flex justify-between gap-2 border-t pt-1">
          <dt className="text-muted-foreground">Locais de trabalho</dt>
          <dd className={cn('text-right', c.vinculos === 0 && 'text-muted-foreground/40')}>
            {c.vinculos}
          </dd>
        </div>
      </dl>
    </button>
  );
}

/** O que exatamente vai acontecer — antes de acontecer. */
function ResumoFusao({ manter, descartar }: { manter: CandidatoDuplicata; descartar: CandidatoDuplicata }) {
  const absorvidos = CAMPOS_COMPARADOS.filter(({ chave }) => {
    const meu = manter[chave as keyof CandidatoDuplicata];
    const dele = descartar[chave as keyof CandidatoDuplicata];
    return (meu === null || meu === undefined || meu === '') && dele !== null && dele !== undefined && dele !== '';
  });

  return (
    <div className="space-y-3 text-sm">
      <p>
        Mantém <strong>{manter.matricula}</strong> e remove <strong>{descartar.matricula}</strong>{' '}
        permanentemente.
      </p>
      {absorvidos.length > 0 ? (
        <div className="rounded-lg bg-muted/60 p-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Será copiado para o cadastro mantido
          </p>
          <ul className="space-y-0.5 text-xs">
            {absorvidos.map(({ chave, rotulo }) => (
              <li key={chave}>
                {rotulo}: <strong>{formatarCampo(chave, descartar[chave as keyof CandidatoDuplicata])}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          O cadastro removido não tem nenhum dado que o mantido já não tenha.
        </p>
      )}
      {descartar.vinculos > 0 && (
        <p className="text-xs">
          {descartar.vinculos} local(is) de trabalho serão transferidos.
        </p>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        A matrícula {descartar.matricula} ficará registrada no histórico do cadastro mantido.
      </p>
    </div>
  );
}

function normalizarValor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v).trim().toLowerCase();
}

function formatarCampo(chave: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (chave === 'cpf') return mascararCpf(String(v));
  if (chave === 'dataNascimento' || chave === 'dataFiliacao') return formatarData(String(v));
  return String(v);
}
