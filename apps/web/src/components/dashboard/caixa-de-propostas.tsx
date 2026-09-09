'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Inbox, Check, X, ChevronDown, Clock, ArrowRight, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import {
  listarPropostas, aceitarProposta, recusarProposta,
  PROVIDENCIA_LABEL, PROVIDENCIA_COR, PROVIDENCIA_COR_PADRAO,
  MOTIVOS_DE_RECUSA, type PropostaDeTarefa,
} from '@/lib/djen';
import { formatNPU } from '@/lib/processos';
import { separarTimbre } from '@/lib/timbre-do-tribunal';

/**
 * A CAIXA DE ENTRADA DO ADVOGADO — o robô propõe, a pessoa decide.
 *
 * POR QUE ESTA TELA EXISTE
 * O robô lê o teor da publicação e tenta descobrir de quem é a ordem. Medido
 * nas 1.433 do acervo: PROVA que é nossa em 15,8%, prova que é da outra parte
 * em 4,1% — e nos 80% restantes não sabe. Criar tarefa nesses 80% foi o que
 * encheu a agenda de trabalho alheio (das 14 que ele criou, 5 já tinham sido
 * canceladas à mão); não criar perderia prazo.
 *
 * A pergunta estava errada. Quem decide se aquilo é trabalho dele é o advogado,
 * e ele decide em um segundo — desde que veja O TRECHO DA ORDEM, que é onde
 * está o "de quem é isto". Por isso a prévia não é o título da providência nem
 * o teor inteiro: é a frase em que o juízo manda alguém fazer algo.
 *
 * O QUE NÃO CHEGA AQUI
 * Ordem nossa provada COM prazo escrito vira tarefa direto. Pedir aprovação
 * para um prazo já demonstrado é cerimônia, e cerimônia faz gente parar de ler.
 *
 * VOLUME MEDIDO (08/09/2026, últimos 30 dias): 40 propostas no mês para a
 * equipe inteira — 2,6 por semana no pior caso individual, 0,2 no melhor. Não é
 * uma segunda caixa de trabalho; é meia dúzia de decisões de um toque.
 *
 * MOBILE-FIRST: no celular cada proposta é um cartão empilhado com os dois
 * botões lado a lado ocupando a largura toda — alvos de 44px, sem menu, sem
 * navegação. No desktop a mesma coisa em linha, com o trecho da ordem à
 * esquerda e os botões à direita.
 */
const MOSTRAR = 4;

export function CaixaDePropostas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  /*
    QUEM DECIDE PRECISA PODER EDITAR. A rota é `@Modulo('processos')` e aceitar
    CRIA atividade — desenhar os botões para quem levaria 403 é oferecer um
    caminho que não existe.
  */
  const permitido = podeEditar(user?.role, user?.permissoes, 'processos');
  const [aberta, setAberta] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['djen', 'propostas'],
    queryFn: () => listarPropostas(false),
    enabled: permitido,
    staleTime: 30_000,
    retry: false,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['djen', 'propostas'] });
    qc.invalidateQueries({ queryKey: ['agenda'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const aceitar = useMutation({
    mutationFn: (id: string) => aceitarProposta(id),
    onSuccess: () => {
      toast.success('Virou atividade na sua agenda.');
      invalidar();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível aceitar agora.'),
  });

  const recusar = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => recusarProposta(id, motivo),
    onSuccess: () => {
      toast.success('Dispensada. O motivo ajuda o robô a errar menos.');
      setAberta(null);
      invalidar();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível dispensar agora.'),
  });

  const itens = q.data ?? [];
  if (!permitido || !itens.length) return null;

  const mostradas = itens.slice(0, MOSTRAR);
  const sobra = itens.length - mostradas.length;

  return (
    <Card className="overflow-hidden border-sky-200 dark:border-sky-900/50">
      <div className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/60 px-4 py-3 dark:border-sky-900/40 dark:bg-sky-950/20">
        <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {itens.length === 1
              ? '1 publicação esperando sua decisão'
              : `${itens.length} publicações esperando sua decisão`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            O robô não teve certeza de que o prazo é seu. Confira a ordem do juízo e
            decida — nada entra na sua agenda sem você.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-sky-100 dark:divide-sky-900/30">
        {mostradas.map((p) => (
          <LinhaDaProposta
            key={p.id}
            proposta={p}
            ocupado={aceitar.isPending || recusar.isPending}
            recusando={aberta === p.id}
            onAbrirRecusa={() => setAberta(aberta === p.id ? null : p.id)}
            onAceitar={() => aceitar.mutate(p.id)}
            onRecusar={(motivo) => recusar.mutate({ id: p.id, motivo })}
          />
        ))}
      </ul>

      {sobra > 0 && (
        <Link
          href="/publicacoes?caixa=1"
          className="flex items-center justify-between gap-2 border-t border-sky-100 px-4 py-2.5 text-xs font-medium text-brand-800 transition hover:bg-muted/60 dark:border-sky-900/30 dark:text-brand-300"
        >
          Ver as outras {sobra} esperando decisão
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </Card>
  );
}

function LinhaDaProposta({
  proposta: p,
  ocupado,
  recusando,
  onAbrirRecusa,
  onAceitar,
  onRecusar,
}: {
  proposta: PropostaDeTarefa;
  ocupado: boolean;
  recusando: boolean;
  onAbrirRecusa: () => void;
  onAceitar: () => void;
  onRecusar: (motivo: string) => void;
}) {
  const [livre, setLivre] = useState('');
  const adversario = (p.processo?.partes ?? []).find((x) => x.polo === 'PASSIVO')?.nome;
  const dias = Math.max(
    0,
    Math.floor((Date.now() - new Date(p.dataDisponibilizacao).getTime()) / 86_400_000),
  );

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {p.providencia && PROVIDENCIA_LABEL[p.providencia] && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              PROVIDENCIA_COR[p.providencia] ?? PROVIDENCIA_COR_PADRAO,
            )}
          >
            {PROVIDENCIA_LABEL[p.providencia]}
          </span>
        )}
        {/*
          O PRAZO É O QUE MUDA A URGÊNCIA DA DECISÃO — e por isso vem em âmbar,
          não em vermelho: o sistema não calcula vencimento, só repete o que o
          tribunal escreveu.
        */}
        {p.prazoMencionadoDias != null && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            menciona {p.prazoMencionadoDias} dias
          </span>
        )}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {dias === 0 ? 'hoje' : `há ${dias}d`}
        </span>
      </div>

      {/*
        UMA LINHA, NÃO DUAS. Medido no telefone: cada proposta custava 192px, e
        quatro delas somavam 898px — mais que a dobra inteira (600px). O NPU
        ocupava uma linha inteira para si; agora divide com o adversário, que é
        quem a pessoa lê primeiro. O número trunca antes do nome porque vinte
        dígitos não decidem nada.
      */}
      <p className="mt-1 flex min-w-0 items-baseline gap-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {adversario ? (
            <>
              <span className="text-muted-foreground">× </span>
              {adversario}
            </>
          ) : (
            <span className="text-muted-foreground">{p.nomeClasse ?? 'Publicação'}</span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {(formatNPU(p.numeroProcesso) || p.numeroProcesso).slice(0, 11)}…
        </span>
      </p>

      {/*
        A PRÉVIA QUE FAZ A DECISÃO DURAR UM SEGUNDO.

        Não é o título da providência (pede fé) nem o teor inteiro, que tem
        2.476 caracteres em média (pede leitura). É a frase em que o juízo manda
        alguém fazer algo — é ali que está o "de quem é isto".

        Sem ordem legível cai para o começo do teor: 29,9% dos atos não têm
        ordem nenhuma escrita, e inventar uma seria pior que mostrar o texto.
      */}
      {/*
        DUAS LINHAS DE PRÉVIA, NÃO TRÊS. 180 caracteres a 319px de largura
        ocupam três linhas; `line-clamp-2` corta em duas e o resto está a um
        toque, na publicação. A frase da ordem começa pelo verbo, então as duas
        primeiras linhas já dizem de quem é.
      */}
      <p className="mt-1.5 line-clamp-2 rounded-md bg-muted/60 px-2 py-1.5 text-[11px] leading-snug">
        {p.ordem ?? previaSemTimbre(p.texto)}
      </p>

      {!recusando ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onAceitar}
            disabled={ocupado}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-800 px-3 text-sm font-medium text-white transition hover:bg-brand-900 disabled:opacity-60 sm:h-9"
          >
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            É minha
          </button>
          <button
            type="button"
            onClick={onAbrirRecusa}
            disabled={ocupado}
            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-60 sm:h-9"
          >
            <X className="h-4 w-4" />
            Não é minha
          </button>
        </div>
      ) : (
        /*
          O MOTIVO É O ÚNICO DADO QUE DIZ ONDE A REGRA ERRA.

          Hoje o robô só sabe que 80% dos atos são indefinidos. Com o motivo ele
          passa a saber quantos eram da outra parte, quantos já estavam
          resolvidos e quantos não pedem nada — é por aí que a heurística
          melhora sem palpite.

          Botões prontos em vez de campo livre: num celular, texto livre é o
          jeito mais rápido de o motivo vir vazio. O campo livre fica embaixo,
          para o que não couber nos três.
        */
        <div className="mt-2 space-y-2 rounded-md border border-input p-2">
          <p className="text-[11px] font-medium text-muted-foreground">Por que não é sua?</p>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_DE_RECUSA.map((m) => (
              <button
                key={m.slug}
                type="button"
                onClick={() => onRecusar(m.label)}
                disabled={ocupado}
                className="h-9 rounded-md border border-input px-2.5 text-xs font-medium transition hover:bg-muted disabled:opacity-60"
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={livre}
              onChange={(e) => setLivre(e.target.value)}
              placeholder="Outro motivo…"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => onRecusar(livre.trim() || 'Não informado')}
              disabled={ocupado}
              className="h-9 shrink-0 rounded-md bg-muted px-3 text-xs font-medium transition hover:bg-muted/70 disabled:opacity-60"
            >
              Dispensar
            </button>
            <button
              type="button"
              onClick={onAbrirRecusa}
              className="h-9 shrink-0 rounded-md px-2 text-xs text-muted-foreground transition hover:bg-muted"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * O FALLBACK NUNCA MOSTRA O TIMBRE.
 *
 * Quando o ato não tem ordem legível (29,9% deles), a prévia é o começo do
 * teor — e o teor começa, em 83% dos casos, com 302 caracteres de "PODER
 * JUDICIÁRIO JUSTIÇA DO TRABALHO TRIBUNAL REGIONAL…". Mostrar isso é o mesmo
 * que não mostrar nada, e foi o que a simulação contra a produção revelou.
 *
 * `separarTimbre` é a mesma função que o cartão de publicação usa e que já tem
 * teste — não existe segunda cópia da régua do timbre.
 */
function previaSemTimbre(texto: string): string {
  const { corpo } = separarTimbre(texto);
  const limpo = (corpo || texto).replace(/\s+/g, ' ').trim();
  return limpo.length > 180 ? `${limpo.slice(0, 180)}…` : limpo;
}
