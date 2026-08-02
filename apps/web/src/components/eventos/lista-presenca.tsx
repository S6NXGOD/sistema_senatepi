'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Loader2, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { baixarPresencaCsv, listarPresencas } from '@/lib/eventos';

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
  const { data, isLoading } = useQuery({
    queryKey: ['evento-presencas', eventoId],
    queryFn: () => listarPresencas(eventoId),
    // Durante a assembleia a lista cresce; depois de encerrada, não muda mais.
    refetchInterval: aoVivo ? 5000 : false,
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" />
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
                  <th className="py-2 font-medium">Entrada</th>
                </tr>
              </thead>
              <tbody>
                {data!.map((p) => (
                  <tr key={p.presencaId} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 font-medium">{p.nome}</td>
                    <td className="py-1.5 pr-2 font-mono text-xs">{p.matricula}</td>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground">{p.cpf}</td>
                    <td className="py-1.5 pr-2 tabular-nums text-xs">
                      {new Date(p.registradoEm).toLocaleTimeString('pt-BR', {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {ORIGEM_LABEL[p.origem] ?? p.origem}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
          CPF exibido parcialmente. O endereço IP de cada acesso consta apenas do dossiê,
          documento de circulação restrita (LGPD, Lei nº 13.709/2018).
        </p>
      </CardContent>
    </Card>
  );
}
