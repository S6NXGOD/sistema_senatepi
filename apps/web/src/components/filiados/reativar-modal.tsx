'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, UserCheck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { reativarFiliado } from '@/lib/filiados';

/**
 * REATIVAÇÃO — desfazer a saída.
 *
 * O modal de desfiliação sempre prometeu, com todas as letras, que o cadastro
 * "pode ser reativado futuramente". A promessa não tinha porta: o menu da linha
 * mostrava um item morto, "Já desfiliado", e o único caminho era trocar a
 * situação no seletor do formulário de edição — que voltava o status e deixava
 * os cinco campos da saída gravados. O cadastro ficava ATIVO afirmando ter sido
 * desfiliado por inadimplência em tal data, e o Termo, se reemitido, saía com o
 * motivo antigo.
 *
 * O MOTIVO É OBRIGATÓRIO, e é texto livre — ao contrário da saída, que tem
 * lista fechada. A diferença não é descuido: sair da categoria tem meia dúzia
 * de causas que se repetem e viram estatística ("quantos saíram por
 * inadimplência?"); voltar é sempre um caso, com uma história própria que só o
 * texto conta.
 */
export function ReativarModal({
  filiado,
  onClose,
  onConfirmed,
}: {
  filiado: { id: string; nomeCompleto: string };
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const valido = motivo.trim().length >= 5;

  async function confirmar() {
    if (!valido) return;
    setSalvando(true);
    try {
      await reativarFiliado(filiado.id, motivo.trim());
      toast.success(`${filiado.nomeCompleto} voltou ao quadro associativo.`);
      onConfirmed();
    } catch (e: any) {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível reativar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      {/*
        MOBILE-FIRST: no celular o modal encosta na base da tela, onde o polegar
        alcança; do `sm` para cima vira caixa centrada. Mesma escolha do resto
        do sistema.
      */}
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-background shadow-xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            <UserCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Reativar associado</h2>
            {/* `break-words`: nome de pessoa não vira reticências num título. */}
            <p className="break-words text-xs uppercase text-muted-foreground">
              {filiado.nomeCompleto}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
            O cadastro volta a <strong>Ativo</strong> e os dados da saída
            anterior — motivo, data e mês de corte — são <strong>apagados</strong>,
            porque deixaram de ser verdade. A saída continua registrada na linha
            do tempo e na auditoria.
          </p>

          <div className="space-y-1.5">
            <label htmlFor="motivo-reativacao" className="text-sm font-medium">
              Motivo da reativação *
            </label>
            <textarea
              id="motivo-reativacao"
              className="min-h-[92px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              placeholder="Ex.: retornou à categoria após concurso; desfiliação registrada por engano; quitou o débito e pediu retorno…"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Readmitir é decisão da entidade — sem motivo gravado, ela não pode
              ser revista depois.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!valido || salvando}>
            {salvando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserCheck className="mr-2 h-4 w-4" />
            )}
            Confirmar reativação
          </Button>
        </div>
      </div>
    </div>
  );
}
