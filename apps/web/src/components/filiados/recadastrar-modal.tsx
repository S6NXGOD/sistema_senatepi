'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, UserCheck, Copy, Check, Clock, ShieldCheck, Ban, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import { cn } from '@/lib/utils';
import {
  gerarLinkRecadastramento, listarLinksRecadastramento, revogarLinkRecadastramento,
  lerPreviaDoLink, DESAFIO_LABEL, type LinkRecadastramento,
} from '@/lib/filiados';
import { validadeCurta } from '@/lib/envio-recadastro';
import { EnviarLinkRecadastro } from '@/components/filiados/enviar-link-recadastro';

/** Vivo = não usado, não revogado e ainda dentro das 24h. */
function estaAtivo(l: LinkRecadastramento): boolean {
  return !l.usadoEm && !l.revogadoEm && new Date(l.expiraEm) > new Date();
}

function faltamHoras(expiraEm: string): string {
  const ms = new Date(expiraEm).getTime() - Date.now();
  if (ms <= 0) return 'expirado';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `faltam ${h}h${m > 0 ? ` ${m}min` : ''}` : `faltam ${m}min`;
}

/**
 * Escolha do modo de recadastramento:
 *  - LINK: o próprio filiado atualiza pelo celular. Os botões de envio
 *    reaproveitam o link que já está valendo (quem já recebeu continua com um
 *    link que abre) e só geram outro quando não há.
 *  - PRESENCIAL: a equipe preenche na hora (fluxo que já existia).
 *
 * "Gerar outro link" continua existindo, mas como ação explícita e confirmada:
 * ele cancela o link que o filiado talvez já tenha no WhatsApp.
 */
export function RecadastrarModal({
  open, onClose, filiadoId, filiadoNome, semNavegar, onRecadastrarPresencial,
}: {
  open: boolean;
  onClose: () => void;
  filiadoId: string;
  filiadoNome: string;
  /**
   * NÃO SAIA DA TELA.
   *
   * Chamado de dentro do modal de importação, o `router.push` do presencial
   * levaria embora o número do processo, o tribunal, a equipe e os réus já
   * digitados — e sem aviso nenhum, porque a navegação é instantânea. Com
   * isto ligado, quem chamou decide como abrir o formulário.
   */
  semNavegar?: boolean;
  onRecadastrarPresencial?: (filiadoId: string) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  // Cancelar link cai na regra global de exclusão (rota DELETE): só Administrador.
  // Quem não é admin ainda pode gerar outro — o novo já revoga o anterior.
  const ehAdmin = user?.role === 'ADMINISTRADOR';
  // Gerar, mandar e o presencial gravam no cadastro: a API exige filiados EDITAR.
  const podeEditarFiliado = podeEditar(user?.role, user?.permissoes, 'filiados');
  const [link, setLink] = useState<LinkRecadastramento | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmandoNovo, setConfirmandoNovo] = useState(false);

  // O que já existe para este filiado — a equipe precisa saber se há um link
  // circulando antes de gerar outro (gerar revoga o anterior).
  const { data: existentes, isLoading: carregandoLinks, isError: erroLinks } = useQuery({
    queryKey: ['links-recadastramento', filiadoId],
    queryFn: () => listarLinksRecadastramento(filiadoId),
    enabled: open,
    staleTime: 0,
  });
  const ativo = existentes?.find(estaAtivo) ?? null;

  /*
    A MESMA PRÉVIA do envio (mesma chave, um pedido só). Sem nada que confirme
    a identidade, a API recusa gerar desde 14/09/2026: o "Gerar outro link"
    some junto com os botões de envio, em vez de voltar 400 no toque.
  */
  const { data: previa } = useQuery({
    queryKey: ['filiado', filiadoId, 'previa-do-link'],
    queryFn: () => lerPreviaDoLink(filiadoId),
    enabled: open && podeEditarFiliado,
    retry: false,
    staleTime: 0,
  });
  const semConfirmacao = previa?.podeGerar === false;

  function abrirPresencial() {
    if (semNavegar) { onRecadastrarPresencial?.(filiadoId); return; }
    fechar();
    router.push(`/filiados/${filiadoId}/recadastrar`);
  }

  const gerar = useMutation({
    mutationFn: () => gerarLinkRecadastramento(filiadoId),
    onSuccess: (l) => {
      setLink(l);
      setConfirmandoNovo(false);
      void qc.invalidateQueries({ queryKey: ['links-recadastramento', filiadoId] });
      void qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível gerar o link.'),
  });

  const revogar = useMutation({
    mutationFn: (id: string) => revogarLinkRecadastramento(id),
    onSuccess: () => {
      toast.success('Link cancelado. Ele não abre mais.');
      void qc.invalidateQueries({ queryKey: ['links-recadastramento', filiadoId] });
      void qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível cancelar o link.'),
  });

  async function copiar() {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiado(true);
      toast.success('Link copiado.');
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error('Não foi possível copiar — selecione o texto manualmente.');
    }
  }

  function fechar() {
    setLink(null);
    setCopiado(false);
    setConfirmandoNovo(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={fechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recadastrar-titulo"
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b py-3 pl-5 pr-2">
          <div className="min-w-0 pt-1">
            <h3 id="recadastrar-titulo" className="font-semibold">Recadastramento</h3>
            <p className="truncate text-xs text-muted-foreground">{filiadoNome}</p>
          </div>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!podeEditarFiliado ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              O seu perfil só visualiza o cadastro dos filiados. Pedir o recadastramento, pelo link
              ou no balcão, fica com quem edita o cadastro.
            </p>
          ) : (
            <>
              {/* O estado do link: o que já está circulando para este filiado. */}
              {carregandoLinks ? (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando se já há link ativo…
                </p>
              ) : erroLinks ? (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  Não foi possível ver se já existe um link ativo. Os botões abaixo continuam
                  funcionando: se houver um valendo, mandam o mesmo.
                </p>
              ) : ativo && !link ? (
                <div className="rounded-xl border bg-muted/30 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Link ativo até {validadeCurta(ativo.expiraEm)}
                    <span className="font-normal text-muted-foreground">({faltamHoras(ativo.expiraEm)})</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gerado em {validadeCurta(ativo.createdAt ?? ativo.expiraEm)}.
                    {(ativo.tentativas ?? 0) > 0 && ` ${ativo.tentativas} tentativa(s) de confirmação sem sucesso.`}
                  </p>
                  {ehAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2.5 h-11"
                      disabled={revogar.isPending}
                      onClick={() => revogar.mutate(ativo.id)}
                    >
                      {revogar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                      Cancelar este link
                    </Button>
                  )}
                </div>
              ) : null}

              {/* Link recém-gerado pelo "Gerar outro link". */}
              {link?.url && (
                <div className="rounded-xl border border-brand-400/60 bg-brand-50/50 p-3 dark:bg-brand-900/10">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-800 dark:text-brand-400">
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Link novo gerado
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    O anterior deixou de abrir. Este vale até {validadeCurta(link.expiraEm)}.{' '}
                    {DESAFIO_LABEL[link.desafio]}.
                  </p>
                  <div className="mt-2 flex items-center gap-2 rounded-lg border bg-card p-1.5">
                    <input
                      readOnly
                      value={link.url}
                      aria-label="Endereço do link"
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
                    />
                    <Button size="sm" className="h-11" variant={copiado ? 'outline' : 'default'} onClick={copiar}>
                      {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiado ? 'Copiado' : 'Copiar'}
                    </Button>
                  </div>
                </div>
              )}

              {/* A chave troca com o link novo: o estado e a mensagem de antes não valem mais. */}
              <EnviarLinkRecadastro key={link?.url ?? 'vigente'} filiadoId={filiadoId} onCompletarFicha={abrirPresencial} />

              {ativo && !link && !semConfirmacao && (
                <div className="border-t pt-3">
                  {confirmandoNovo ? (
                    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                      <p className="text-xs text-amber-900 dark:text-amber-200">
                        O link atual deixa de abrir na hora, inclusive se o filiado já o recebeu.
                        Só faça isso se ele perdeu a mensagem ou se o link foi parar com outra pessoa.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="h-11 md:h-11"
                          disabled={gerar.isPending}
                          onClick={() => gerar.mutate()}
                        >
                          {gerar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Gerar outro link
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11 md:h-11"
                          disabled={gerar.isPending}
                          onClick={() => setConfirmandoNovo(false)}
                        >
                          Manter o atual
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmandoNovo(true)}
                      className="min-h-11 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      O filiado perdeu o link? Gerar outro
                    </button>
                  )}
                </div>
              )}

              <div className="border-t pt-4">
                <Opcao
                  icon={UserCheck}
                  titulo="Recadastramento presencial"
                  descricao="A equipe preenche o formulário agora, com o filiado presente."
                  onClick={abrirPresencial}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Opcao({
  icon: Icon, titulo, descricao, onClick, carregando,
}: {
  icon: any; titulo: string; descricao: string; onClick: () => void; carregando?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={carregando}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition',
        'hover:border-brand-400 hover:bg-muted/40 disabled:opacity-60',
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-900/30">
        {carregando ? (
          <Loader2 className="h-5 w-5 animate-spin text-brand-800 dark:text-brand-400" />
        ) : (
          <Icon className="h-5 w-5 text-brand-800 dark:text-brand-400" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
    </button>
  );
}
