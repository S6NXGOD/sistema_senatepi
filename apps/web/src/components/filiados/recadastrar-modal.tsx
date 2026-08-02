'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, UserCheck, Link2, Copy, Check, Clock, ShieldCheck, AlertTriangle, Ban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  gerarLinkRecadastramento, listarLinksRecadastramento, revogarLinkRecadastramento,
  DESAFIO_LABEL, type LinkRecadastramento,
} from '@/lib/filiados';

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
 *  - PRESENCIAL: a equipe preenche na hora (fluxo que já existia).
 *  - LINK: gera uma URL de 24h para o próprio filiado atualizar tudo.
 */
export function RecadastrarModal({
  open, onClose, filiadoId, filiadoNome,
}: {
  open: boolean;
  onClose: () => void;
  filiadoId: string;
  filiadoNome: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  // Cancelar link cai na regra global de exclusão (rota DELETE): só Administrador.
  // Quem não é admin ainda pode gerar outro — o novo já revoga o anterior.
  const ehAdmin = user?.role === 'ADMINISTRADOR';
  const [link, setLink] = useState<LinkRecadastramento | null>(null);
  const [copiado, setCopiado] = useState(false);

  // O que já existe para este filiado — a equipe precisa saber se há um link
  // circulando antes de gerar outro (gerar revoga o anterior).
  const { data: existentes, isLoading: carregandoLinks } = useQuery({
    queryKey: ['links-recadastramento', filiadoId],
    queryFn: () => listarLinksRecadastramento(filiadoId),
    enabled: open,
    staleTime: 0,
  });
  const ativo = existentes?.find(estaAtivo) ?? null;

  const gerar = useMutation({
    mutationFn: () => gerarLinkRecadastramento(filiadoId),
    onSuccess: (l) => {
      setLink(l);
      void qc.invalidateQueries({ queryKey: ['links-recadastramento', filiadoId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível gerar o link.'),
  });

  const revogar = useMutation({
    mutationFn: (id: string) => revogarLinkRecadastramento(id),
    onSuccess: () => {
      toast.success('Link cancelado. Ele não abre mais.');
      void qc.invalidateQueries({ queryKey: ['links-recadastramento', filiadoId] });
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
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={fechar}>
      <div className="w-full max-w-lg rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="min-w-0">
            <h3 className="font-semibold">Recadastramento</h3>
            <p className="truncate text-xs text-muted-foreground">{filiadoNome}</p>
          </div>
          <button type="button" onClick={fechar} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Link recém-gerado */}
        {link?.url ? (
          <div className="space-y-4 p-5">
            <div className="rounded-xl border border-senatepi-400/60 bg-senatepi-50/50 p-4 dark:bg-senatepi-900/10">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-senatepi-800 dark:text-senatepi-400">
                <ShieldCheck className="h-4 w-4" /> Link gerado
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Envie ao filiado por WhatsApp ou e-mail. Vale por 24h e só pode ser usado uma vez.
              </p>

              <div className="mt-3 flex items-center gap-2 rounded-lg border bg-card p-2">
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
                />
                <Button size="sm" variant={copiado ? 'outline' : 'default'} onClick={copiar}>
                  {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiado ? 'Copiado' : 'Copiar'}
                </Button>
              </div>

              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Expira em</span>
                  <strong>{new Date(link.expiraEm).toLocaleString('pt-BR')}</strong>
                </div>
                <div className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span><span className="text-muted-foreground">Segurança: </span>{DESAFIO_LABEL[link.desafio]}</span>
                </div>
              </dl>

              {link.desafio === 'NENHUM' && (
                <p className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-100 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Este cadastro não tem CPF, nascimento nem COREN — não há como pedir confirmação.
                  Quem tiver o link acessa direto, então envie apenas ao próprio filiado.
                </p>
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground">
              O link não poderá ser exibido novamente. Copie agora.
            </p>
            <Button variant="outline" className="w-full" onClick={fechar}>Fechar</Button>
          </div>
        ) : (
          /* Escolha do modo */
          <div className="space-y-3 p-5">
            {carregandoLinks ? (
              <p className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando links…
              </p>
            ) : ativo ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-300">
                  <Clock className="h-4 w-4" /> Já existe um link ativo
                </p>
                <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                  Gerado em {new Date(ativo.createdAt ?? ativo.expiraEm).toLocaleString('pt-BR')} — expira{' '}
                  {new Date(ativo.expiraEm).toLocaleString('pt-BR')} ({faltamHoras(ativo.expiraEm)}).
                  {(ativo.tentativas ?? 0) > 0 && ` ${ativo.tentativas} tentativa(s) de confirmação sem sucesso.`}
                </p>
                <p className="mt-1.5 text-xs text-amber-900/80 dark:text-amber-200/80">
                  A URL não pode ser exibida de novo. Se o filiado perdeu o link, gere outro — o
                  atual deixa de funcionar na hora.
                </p>
                {ehAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2.5"
                    disabled={revogar.isPending}
                    onClick={() => revogar.mutate(ativo.id)}
                  >
                    {revogar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                    Cancelar este link
                  </Button>
                )}
              </div>
            ) : null}

            <Opcao
              icon={UserCheck}
              titulo="Recadastramento presencial"
              descricao="A equipe preenche o formulário agora, com o filiado presente."
              onClick={() => { fechar(); router.push(`/filiados/${filiadoId}/recadastrar`); }}
            />
            <Opcao
              icon={Link2}
              titulo={ativo ? 'Gerar um novo link (revoga o atual)' : 'Gerar link para o filiado'}
              descricao="O filiado atualiza os próprios dados pelo celular. Vale 24h e é de uso único."
              carregando={gerar.isPending}
              onClick={() => gerar.mutate()}
            />
          </div>
        )}
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
        'hover:border-senatepi-400 hover:bg-muted/40 disabled:opacity-60',
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-senatepi-50 dark:bg-senatepi-900/30">
        {carregando ? (
          <Loader2 className="h-5 w-5 animate-spin text-senatepi-800 dark:text-senatepi-400" />
        ) : (
          <Icon className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
    </button>
  );
}
