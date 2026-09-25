'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Eye, Loader2, MessageSquareText, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { formatDataHora } from '@/lib/processos';
import { V } from '@/lib/vocabulario';
import { cn } from '@/lib/utils';

interface Recado {
  id: string;
  texto: string;
  autorNome: string;
  createdAt: string;
  vistoEm: string | null;
}

const LIMITE = 2000;

/**
 * O RECADO DO SINDICATO PARA O FILIADO — escrito aqui, lido no portal.
 *
 * "Existe algo no sistema que o advogado pode colocar para comunicar algo ao
 * filiado pelo portal?" — o dono, 25/09/2026. Não existia.
 *
 * A DIFERENÇA PARA A NOTA INTERNA É QUEM LÊ, e a tela precisa gritar isso: as
 * duas são caixas de texto na mesma gaveta, e a única coisa que impede
 * estratégia processual de ir parar no celular da parte contrária é o autor
 * saber, na hora de escrever, para quem está escrevendo. Por isso o aviso não é
 * uma legenda cinza no rodapé — é a primeira coisa do bloco, e o botão diz
 * "Enviar ao {filiado}", não "Salvar".
 */
export function RecadoAoFiliado({
  processoId,
  temFiliado,
  podeEditar,
}: {
  processoId: string;
  temFiliado: boolean;
  podeEditar: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ehAdmin = user?.role === 'ADMINISTRADOR';
  const [texto, setTexto] = useState('');
  const [apagando, setApagando] = useState<Recado | null>(null);

  const chave = ['processo', processoId, 'recados'];
  const { data: recados = [], isLoading } = useQuery({
    queryKey: chave,
    queryFn: async () => (await api.get<Recado[]>(`/processos/${processoId}/recados`)).data,
  });

  const enviar = useMutation({
    mutationFn: async () =>
      (await api.post(`/processos/${processoId}/recados`, { texto: texto.trim() })).data,
    onSuccess: () => {
      setTexto('');
      toast.success(`Recado enviado. ${V.Filiado} vê no portal.`);
      qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível enviar o recado.'),
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => api.delete(`/processos/${processoId}/recados/${id}`),
    onSuccess: () => {
      toast.success('Recado apagado.');
      qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível apagar.'),
  });

  const limpo = texto.trim();

  return (
    <section className="space-y-3">
      {/*
        O AVISO VEM ANTES DO CAMPO, e é verde (a cor de "deu certo"/institucional)
        justamente para não se confundir com o âmbar das notas internas, que
        fica na aba ao lado dizendo o contrário.
      */}
      <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/20 dark:text-brand-200">
        <p className="flex items-center gap-1.5 font-semibold">
          <Eye className="h-3.5 w-3.5" /> {V.Filiado} vai ler isto
        </p>
        <p className="mt-0.5 leading-snug">
          Escreva como quem explica para alguém de fora do Direito. Para observação da equipe, use
          a aba <strong>Notas internas</strong> — aquela ninguém de fora vê.
        </p>
      </div>

      {!temFiliado ? (
        /*
          SEM FILIADO NO PROCESSO, NINGUÉM LÊ. Medido: 174 dos 194 processos não
          têm filiado vinculado. Deixar escrever ali produziria um recado sem
          leitor — e o advogado achando que avisou.
        */
        <p className="rounded-lg border bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
          Este processo não tem {V.filiado} vinculado, então não há quem leia o recado no portal.
          Vincule a parte na aba <strong>Partes</strong> e o campo aparece aqui.
        </p>
      ) : (
        podeEditar && (
          <div className="rounded-lg border bg-card p-3">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, LIMITE))}
              rows={4}
              placeholder={`Ex.: A audiência foi remarcada para 12/11. Você não precisa comparecer — eu represento você. Qualquer dúvida, me procure.`}
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-brand-500"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span
                className={cn(
                  'text-[11px]',
                  limpo.length > LIMITE - 100 ? 'text-amber-700' : 'text-muted-foreground',
                )}
              >
                {limpo.length}/{LIMITE}
              </span>
              <Button
                size="sm"
                disabled={limpo.length < 3 || enviar.isPending}
                onClick={() => enviar.mutate()}
              >
                {enviar.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Enviar ao {V.filiado}
              </Button>
            </div>
          </div>
        )
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando os recados…</p>
      ) : !recados.length ? (
        temFiliado && (
          <p className="text-xs text-muted-foreground">Nenhum recado enviado ainda.</p>
        )
      ) : (
        <ul className="space-y-2">
          {recados.map((r) => (
            <li key={r.id} className="rounded-lg border bg-card p-3">
              <p className="whitespace-pre-line text-sm leading-snug">{r.texto}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  {r.autorNome} · {formatDataHora(r.createdAt)}
                </span>
                {/*
                  "VISTO EM" É O QUE FAZ O ADVOGADO CONFIAR NO CANAL. Sem isso
                  ele escreve, não sabe se chegou, e liga assim mesmo — e o
                  recado vira trabalho a mais em vez de trabalho a menos.
                */}
                {r.vistoEm ? (
                  <span className="flex items-center gap-1 font-medium text-brand-700 dark:text-brand-400">
                    <Check className="h-3 w-3" /> Visto em {formatDataHora(r.vistoEm)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <MessageSquareText className="h-3 w-3" /> Ainda não aberto
                  </span>
                )}
                {ehAdmin && (
                  <button
                    type="button"
                    onClick={() => setApagando(r)}
                    className="ml-auto flex items-center gap-1 text-rose-700 transition-colors hover:underline dark:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" /> Apagar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!apagando}
        variant="destructive"
        title="Apagar este recado?"
        description={
          <div className="space-y-2 text-sm">
            <p>Ele some do portal {V.filiado === 'filiado' ? 'do filiado' : 'do servidor'}.</p>
            {apagando?.vistoEm && (
              <p className="text-muted-foreground">
                Atenção: {V.filiado} <strong>já leu</strong> este recado em{' '}
                {formatDataHora(apagando.vistoEm)}. Apagar não desfaz a leitura.
              </p>
            )}
          </div>
        }
        confirmLabel="Apagar recado"
        onConfirm={() => {
          if (apagando) apagar.mutate(apagando.id);
          setApagando(null);
        }}
        onClose={() => setApagando(null)}
      />
    </section>
  );
}
