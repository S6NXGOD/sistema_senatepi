'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Loader2, TriangleAlert, UserCheck, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import {
  baixarPresencaCsv, candidatosPresenca, listarPresencas, vincularPresenca,
  type PresencaLista,
} from '@/lib/eventos';

const ORIGEM_LABEL: Record<string, string> = {
  QR_PRESENCIAL: 'QR na portaria',
  AUTOATENDIMENTO_VIRTUAL: 'Sala virtual',
  MANUAL: 'Lançada pela equipe',
};

/**
 * Lista de presença da assembleia.
 *
 * O CPF vem mascarado da API e o IP não vem — o endereço tem finalidade
 * probatória e mora no dossiê, que é documento de circulação restrita. Uma
 * tela que fica aberta no telão durante a sessão não é lugar para ele.
 */
export function ListaPresenca({ eventoId, aoVivo = false }: { eventoId: string; aoVivo?: boolean }) {
  const [identificando, setIdentificando] = useState<PresencaLista | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['evento-presencas', eventoId],
    queryFn: () => listarPresencas(eventoId),
    // Durante a assembleia a lista cresce; depois de encerrada, não muda mais.
    refetchInterval: aoVivo ? 5000 : false,
  });

  const pendentes = (data ?? []).filter((p) => !p.identificado);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4 text-brand-800 dark:text-brand-400" />
            Lista de presença
            <span className="rounded-full bg-muted px-2 text-sm">{data?.length ?? 0}</span>
          </h3>
          {(data?.length ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => baixarPresencaCsv(eventoId)}
              title="Abre no Excel — inclui quem votou em cada pauta"
            >
              <Download className="h-4 w-4" /> Baixar planilha
            </Button>
          )}
        </div>

        {/* Presenças sem vínculo com o cadastro.
            Elas NÃO votam e NÃO contam para o quórum enquanto não forem
            confirmadas — quórum e deliberação são de associados, e o sistema
            não pode adivinhar entre 1.309 grupos de nomes repetidos. */}
        {pendentes.length > 0 && (
          <div className="mb-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
            <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>{pendentes.length}</strong>{' '}
                {pendentes.length === 1 ? 'presença aguarda' : 'presenças aguardam'} confirmação de
                identidade. Até lá, {pendentes.length === 1 ? 'ela não vota' : 'elas não votam'} e
                não {pendentes.length === 1 ? 'conta' : 'contam'} para o quórum.
              </span>
            </p>
          </div>
        )}

        {isLoading && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        )}

        {!isLoading && data?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ninguém registrou presença ainda.
          </p>
        )}

        {(data?.length ?? 0) > 0 && (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Nome</th>
                  <th className="py-2 pr-2 font-medium">Matrícula</th>
                  <th className="py-2 pr-2 font-medium">CPF</th>
                  <th className="py-2 pr-2 font-medium">Hora</th>
                  <th className="py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {data!.map((p) => (
                  <tr
                    key={p.presencaId}
                    className={cn('border-b last:border-0', !p.identificado && 'bg-amber-50/60 dark:bg-amber-900/10')}
                  >
                    <td className="py-1.5 pr-2 font-medium">{p.nome}</td>
                    <td className="py-1.5 pr-2 font-mono text-xs">{p.matricula}</td>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground">{p.cpf}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-xs">
                      {new Date(p.registradoEm).toLocaleTimeString('pt-BR', {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-1.5 text-xs">
                      {p.identificado ? (
                        <span className="text-muted-foreground">{ORIGEM_LABEL[p.origem] ?? p.origem}</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setIdentificando(p)}>
                          <UserCheck className="h-3.5 w-3.5" /> Identificar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {identificando && (
          <ModalIdentificar
            eventoId={eventoId}
            presenca={identificando}
            onFechar={() => setIdentificando(null)}
          />
        )}

        <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
          CPF exibido parcialmente. O endereço IP de cada acesso consta apenas do dossiê,
          documento de circulação restrita (LGPD, Lei nº 13.709/2018).
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Confirma de quem é uma presença que o autoatendimento não conseguiu vincular.
 *
 * O sistema não adivinha entre homônimos — a base tem 1.309 grupos de nomes
 * repetidos, e escolher errado seria dar o voto de uma pessoa a outra. Aqui um
 * humano decide, com nome, matrícula, cidade e nascimento à vista.
 */
function ModalIdentificar({
  eventoId, presenca, onFechar,
}: { eventoId: string; presenca: PresencaLista; onFechar: () => void }) {
  const qc = useQueryClient();
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['presenca-candidatos', eventoId, presenca.presencaId],
    queryFn: () => candidatosPresenca(eventoId, presenca.presencaId),
  });

  return (
    <ConfirmDialog
      open
      title="De quem é esta presença?"
      confirmLabel="Confirmar identidade"
      loading={salvando}
      onClose={() => (salvando ? null : onFechar())}
      onConfirm={async () => {
        if (!escolhido) return;
        setSalvando(true);
        try {
          const r = await vincularPresenca(eventoId, presenca.presencaId, escolhido);
          toast.success(
            `Presença confirmada como ${r.filiado.nome}.` +
            (r.cpfGravado ? ' O CPF foi gravado no cadastro, que estava sem.' : ''),
          );
          qc.invalidateQueries({ queryKey: ['evento-presencas', eventoId] });
          onFechar();
        } catch (e: any) {
          toast.error(e?.response?.data?.message ?? 'Não foi possível confirmar.');
        } finally {
          setSalvando(false);
        }
      }}
      description={
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-muted/60 p-2.5 text-xs">
            <p>Informado no check-in: <strong>{data?.nomeInformado ?? presenca.nome}</strong></p>
            {data?.cpfInformado && <p className="text-muted-foreground">CPF: {data.cpfInformado}</p>}
          </div>

          {isLoading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Procurando no cadastro…
            </p>
          )}

          {!isLoading && data?.candidatos.length === 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              Nenhum associado com esse nome foi encontrado. A pessoa segue com presença
              registrada como visitante — sem voto e fora do quórum.
            </p>
          )}

          {(data?.candidatos.length ?? 0) > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {data!.candidatos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setEscolhido(c.id)}
                  className={cn(
                    'w-full rounded-lg border p-2.5 text-left transition',
                    escolhido === c.id
                      ? 'border-brand-700 bg-brand-50/60 ring-1 ring-brand-700 dark:bg-brand-900/20'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <p className="text-sm font-medium">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    Matrícula {c.matricula}
                    {c.cidade && ` · ${c.cidade}`}
                    {c.nascimento && ` · ${new Date(c.nascimento).toLocaleDateString('pt-BR')}`}
                    {!c.temCpf && ' · sem CPF no cadastro'}
                  </p>
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Ao confirmar, a pessoa passa a votar e a contar para o quórum. Se o cadastro
            estiver sem CPF, o informado no check-in será gravado.
          </p>
        </div>
      }
    />
  );
}
