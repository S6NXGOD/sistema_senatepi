'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, Loader2, ShieldOff, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  buscarAcessoAoPortal,
  emitirSenhaDoPortal,
  revogarAcessoAoPortal,
  type AcessoAoPortal as AcessoAoPortalDados,
  type SenhaEmitida,
} from '@/lib/filiados';
import { V } from '@/lib/vocabulario';

/**
 * ACESSO AO PORTAL — o cartão da secretaria na ficha.
 *
 * A senha aparece UMA VEZ. O banco guarda só o hash: nem o Administrador
 * consegue lê-la de volta, e a tela tem de dizer isso na hora em que mostra —
 * senão a pessoa fecha o cartão achando que pode voltar depois.
 */
export function AcessoAoPortal({
  filiadoId,
  situacao,
}: {
  filiadoId: string;
  situacao: string;
}) {
  const qc = useQueryClient();
  const [senha, setSenha] = useState<SenhaEmitida | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState<'gerar' | 'revogar' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['filiado', filiadoId, 'portal'],
    queryFn: () => buscarAcessoAoPortal(filiadoId),
  });

  const emitir = useMutation({
    mutationFn: () => emitirSenhaDoPortal(filiadoId),
    onSuccess: (r) => {
      setSenha(r);
      setCopiado(false);
      qc.invalidateQueries({ queryKey: ['filiado', filiadoId, 'portal'] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível gerar a senha.'),
  });

  const revogar = useMutation({
    mutationFn: () => revogarAcessoAoPortal(filiadoId),
    onSuccess: () => {
      setSenha(null);
      toast.success('Acesso ao portal revogado.');
      qc.invalidateQueries({ queryKey: ['filiado', filiadoId, 'portal'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível revogar.'),
  });

  async function copiar() {
    if (!senha) return;
    try {
      await navigator.clipboard.writeText(senha.senhaProvisoria);
      setCopiado(true);
      toast.success('Senha copiada.');
    } catch {
      // Sem permissão de área de transferência (acontece em http): a senha
      // continua na tela para ser lida em voz alta ou digitada.
      toast.error('Copie a senha da tela — o navegador não liberou a cópia automática.');
    }
  }

  const desfiliado = situacao === 'DESFILIADO';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-brand-800 dark:text-brand-400" /> Acesso ao portal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : desfiliado ? (
          <p className="text-sm text-muted-foreground">
            Quem foi desfiliado não tem portal. Reative a filiação para liberar o acesso.
          </p>
        ) : !data?.temCpf ? (
          /*
            SEM CPF NÃO HÁ PORTAL, e a ficha diz isso ANTES do clique.

            O portal entra só pelo CPF, e 61% dos ativos não têm CPF no
            cadastro. Sem este bloco, a secretaria liberaria o acesso, ditaria a
            senha e a pessoa levaria "CPF ou senha inválidos" — os dois lados
            achando que o sistema falhou, quando falta um campo do cadastro.
          */
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/70 dark:bg-amber-900/20">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Este cadastro não tem CPF.
            </p>
            <p className="mt-1 text-xs leading-snug text-amber-900/80 dark:text-amber-200/80">
              O portal entra pelo CPF. Preencha o CPF na ficha — ou envie o link de
              recadastramento, que pede o dado ao próprio {V.filiado} — e o botão de liberar
              aparece aqui.
            </p>
          </div>
        ) : (
          <>
            {/* ---- A senha recém-gerada, enquanto a tela está aberta ---- */}
            {senha ? (
              <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-3 dark:border-brand-900/70 dark:bg-brand-900/20">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-300">
                  Senha provisória
                </p>
                {/*
                  MONOESPAÇADA E GRANDE porque ela vai ser DITADA: a secretaria
                  lê em voz alta no balcão e no telefone. As palavras existem
                  justamente para sobreviver a isso.
                */}
                <p className="mt-1 select-all font-mono text-xl font-bold tracking-wide">
                  {senha.senhaProvisoria}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={copiar}>
                    {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiado ? 'Copiada' : 'Copiar'}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-brand-900/80 dark:text-brand-200/80">
                  <strong>Anote ou envie agora.</strong> Ela não aparece de novo — o sistema guarda
                  só o embaralhado, e nem o administrador consegue lê-la. Se perder, gere outra.
                  {' '}
                  {V.Filiado} entra com o <strong>CPF</strong> e troca a senha no primeiro acesso.
                </p>
              </div>
            ) : (
              <Estado data={data} />
            )}

            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                disabled={emitir.isPending}
                onClick={() => (data?.liberado ? setConfirmando('gerar') : emitir.mutate())}
              >
                {emitir.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {data?.liberado ? 'Gerar nova senha' : 'Liberar acesso'}
              </Button>

              {data?.liberado && (
                <Button
                  variant="outline"
                  className="w-full text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  disabled={revogar.isPending}
                  onClick={() => setConfirmando('revogar')}
                >
                  <ShieldOff className="h-4 w-4" /> Revogar acesso
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      {/*
        GERAR DE NOVO DERRUBA A SENHA ATUAL — e quem já usava o portal vai
        descobrir isso na próxima vez que tentar entrar. Vale perguntar.
      */}
      <ConfirmDialog
        open={confirmando === 'gerar'}
        onClose={() => setConfirmando(null)}
        title="Gerar uma senha nova?"
        description={
          <div className="space-y-2 text-sm">
            <p>A senha que {V.filiado} usa hoje deixa de funcionar na hora.</p>
            <p className="text-muted-foreground">
              Use quando a pessoa esqueceu a senha ou nunca recebeu a provisória. A nova aparece
              aqui uma vez só.
            </p>
          </div>
        }
        confirmLabel="Gerar nova senha"
        onConfirm={() => {
          setConfirmando(null);
          emitir.mutate();
        }}
      />

      <ConfirmDialog
        open={confirmando === 'revogar'}
        onClose={() => setConfirmando(null)}
        title="Revogar o acesso ao portal?"
        description={
          <div className="space-y-2 text-sm">
            <p>
              A sessão cai na próxima vez que {V.filiado} abrir o portal, e a senha deixa de valer.
            </p>
            <p className="text-muted-foreground">
              O cadastro, a carteirinha e os processos continuam intactos — isto tira só o acesso.
              Para devolver, é só liberar de novo.
            </p>
          </div>
        }
        confirmLabel="Revogar acesso"
        variant="destructive"
        onConfirm={() => {
          setConfirmando(null);
          revogar.mutate();
        }}
      />
    </Card>
  );
}

/** Em que pé está o acesso — em uma frase, sem jargão. */
function Estado({ data }: { data: AcessoAoPortalDados | null | undefined }) {
  if (!data?.liberado) {
    return (
      <p className="text-sm text-muted-foreground">
        Sem acesso. Libere para {V.filiado} ver a carteirinha, os processos e o próprio cadastro
        pelo celular.
      </p>
    );
  }
  if (data.aguardandoPrimeiroAcesso) {
    return (
      <p className="text-sm text-amber-800 dark:text-amber-300">
        Liberado, mas ainda não entrou — a senha provisória continua valendo.
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      Em uso.
      {data.ultimoAcessoEm &&
        ` Último acesso em ${new Date(data.ultimoAcessoEm).toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}.`}
    </p>
  );
}
