'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { FiliadoForm } from '@/components/filiados/filiado-form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import { Button } from '@/components/ui/button';
import { V } from '@/lib/vocabulario';

/**
 * O CADASTRO DE VERDADE, sem sair de onde se está.
 *
 * A primeira versão disto era um formulário de quatro campos — nome, CPF,
 * nascimento, telefone — e estava errada por dois motivos. O primeiro é que o
 * cadastro do sindicato exige mais que isso (cidade, estado, formação, COREN),
 * então o "cadastro rápido" produzia uma ficha pela metade que alguém teria de
 * completar depois, sem nada avisando que faltava. O segundo é que quem PODE
 * cadastrar é o balcão, e o balcão tem os dados na mão — a pressa era minha
 * suposição, não a realidade de quem usa.
 *
 * Então é o formulário inteiro, o mesmo de `/filiados/novo`, apresentado em
 * quatro etapas para caber num modal. Nada é duplicado: mudou a apresentação,
 * não as regras.
 *
 * SERVE TAMBÉM PARA RECADASTRAR. Passando `filiadoId`, ele carrega a ficha e
 * abre no modo `recadastrar` — mesmos campos, mesmas travas de campo imutável,
 * e a atualização acontece sem tirar ninguém da tela do processo.
 */
export function CadastroFiliadoModal({
  open,
  onClose,
  onSalvo,
  nomeInicial,
  filiadoId,
}: {
  open: boolean;
  onClose: () => void;
  /** Recebe o id do filiado salvo — quem chamou decide o que fazer com ele. */
  onSalvo: (id: string) => void;
  /** Nome já digitado na busca, para não redigitar. */
  nomeInicial?: string | null;
  /** Quando presente, recadastra em vez de criar. */
  filiadoId?: string | null;
}) {
  const { user } = useAuth();
  const pode = podeEditar(user?.role, user?.permissoes, 'filiados');

  const ficha = useQuery({
    queryKey: ['filiado', filiadoId],
    queryFn: async () => (await api.get(`/filiados/${filiadoId}`)).data,
    enabled: open && !!filiadoId,
  });

  if (!open) return null;

  const recadastro = !!filiadoId;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="min-w-0">
            <h3 className="text-base font-bold">
              {recadastro ? `Recadastrar ${V.filiado}` : `Cadastrar ${V.filiado}`}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {recadastro
                ? 'Confira e atualize os dados. O que já está preenchido continua valendo.'
                : 'Ao salvar, ele já entra vinculado ao que você estava fazendo.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!pode ? (
            <div className="space-y-3">
              <p className="rounded-md border bg-muted/50 px-3 py-2.5 text-[12px] leading-snug">
                O cadastro de {V.filiados} é feito pela secretaria. Peça a inclusão e volte para
                vincular — enquanto isso, dá para seguir com o nome da parte e resolver depois.
              </p>
              <div className="flex justify-end">
                <Button type="button" variant="outline" onClick={onClose}>
                  Entendi
                </Button>
              </div>
            </div>
          ) : recadastro && ficha.isLoading ? (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando a ficha…
            </p>
          ) : recadastro && !ficha.data ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Não foi possível carregar a ficha deste {V.filiado}.
            </p>
          ) : (
            <FiliadoForm
              emPassos
              modo={recadastro ? 'recadastrar' : 'criar'}
              inicial={
                recadastro
                  ? ficha.data
                  : (nomeInicial?.trim()
                      ? ({ nomeCompleto: nomeInicial.trim() } as never)
                      : undefined)
              }
              onCancelar={onClose}
              onSalvo={(id) => {
                onSalvo(id);
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
