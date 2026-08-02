'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, ShieldCheck, Ban, FileText, Receipt, Building2, AlertTriangle,
  ScrollText, ExternalLink, Landmark, Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { podeExcluir } from '@/lib/permissoes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  carregarDocumento, homologarContribuicao, rejeitarContribuicao,
  excluirContribuicao, excluirLancamento,
  formatarReais, mascaraCnpj, STATUS_ADMIN, type ContribuicaoAdmin,
} from '@/lib/contribuicoes-patronais';

/** `GET /financeiro/contas` já devolve somente as contas ativas. */
interface ContaBancaria {
  id: string;
  nome: string;
  instituicao?: string | null;
}

/**
 * Auditoria de uma contribuição patronal.
 *
 * Mostra os dois documentos lado a lado — comprovante à esquerda, relação de
 * trabalhadores à direita — para a conferência ser feita sem sair da tela nem
 * baixar arquivo com dado pessoal para a máquina de quem confere.
 */
export function AuditoriaContribuicaoModal({
  contribuicao, onClose, onDecidido,
}: {
  contribuicao: ContribuicaoAdmin | null;
  onClose: () => void;
  /** Avisa a listagem para onde a guia foi, para ela não sumir sem explicação. */
  onDecidido?: (destino: 'HOMOLOGADA' | 'REJEITADA') => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [rejeitando, setRejeitando] = useState(false);
  const [contaId, setContaId] = useState('');

  const { user } = useAuth();
  // Excluir é privativo do Administrador (regra global do sistema); o botão
  // some para os demais em vez de aparecer e devolver 403.
  const ehAdmin = podeExcluir(user?.role);
  const [confirmando, setConfirmando] = useState<null | 'contribuicao' | 'lancamento'>(null);

  const podeDecidir = contribuicao?.status === 'EM_ANALISE';
  /** Mínimo exigido pela API — espelhado aqui só para explicar ao operador. */
  const MOTIVO_MINIMO = 10;
  const faltam = Math.max(0, MOTIVO_MINIMO - motivo.trim().length);

  // Contas para o lançamento no caixa. Se o financeiro não estiver montado,
  // a lista vem vazia e a homologação segue sem lançar.
  const { data: contas } = useQuery({
    queryKey: ['contas-bancarias'],
    queryFn: async () => (await api.get('/financeiro/contas')).data as ContaBancaria[],
    enabled: !!contribuicao && podeDecidir,
    retry: false,
  });
  const contasAtivas = contas ?? [];

  // Conta única: já vem escolhida, para o operador não precisar decidir nada.
  useEffect(() => {
    if (contasAtivas.length === 1) setContaId(contasAtivas[0].id);
  }, [contasAtivas.length, contasAtivas]);

  const homologar = useMutation({
    mutationFn: () =>
      homologarContribuicao(contribuicao!.id, { contaBancariaId: contaId || undefined }),
    onSuccess: (r) => {
      toast.success(
        r.lancamento
          ? `Homologada. Entrada lançada em ${r.lancamento.conta}. Veja em "Homologadas".`
          : 'Contribuição homologada. Veja em "Homologadas".',
      );
      if (r.avisoFinanceiro) toast.warning(r.avisoFinanceiro);
      invalidar();
      onDecidido?.('HOMOLOGADA');
      fechar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível homologar.'),
  });

  const rejeitar = useMutation({
    mutationFn: () => rejeitarContribuicao(contribuicao!.id, motivo.trim()),
    onSuccess: () => {
      toast.success('Rejeitada. A empresa verá o motivo no portal. Veja em "Rejeitadas".');
      invalidar();
      onDecidido?.('REJEITADA');
      fechar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível rejeitar.'),
  });

  const excluir = useMutation({
    mutationFn: () => excluirContribuicao(contribuicao!.id),
    onSuccess: (r) => {
      toast.success('Contribuição excluída permanentemente.');
      if (r.aviso) toast.warning(r.aviso);
      invalidar();
      fechar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.'),
  });

  const excluirLanc = useMutation({
    mutationFn: () => excluirLancamento(contribuicao!.movimentacaoId!),
    onSuccess: () => {
      toast.success('Lançamento removido do caixa. A contribuição segue homologada.');
      invalidar();
      fechar();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível excluir o lançamento.'),
  });

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['contribuicoes-patronais'] });
    void qc.invalidateQueries({ queryKey: ['cobrancas-dashboard'] });
  }

  function fechar() {
    setMotivo(''); setRejeitando(false); setContaId(''); setConfirmando(null);
    onClose();
  }

  if (!contribuicao) return null;
  const s = STATUS_ADMIN[contribuicao.status];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-[1400px] flex-col rounded-2xl bg-card shadow-xl">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-senatepi-800 dark:text-senatepi-400" />
              <h3 className="truncate font-semibold">{contribuicao.empresa.razaoSocial}</h3>
              <Badge className={s.classe}>{s.label}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              CNPJ {mascaraCnpj(contribuicao.empresa.cnpj)} · competência{' '}
              <span className="capitalize">{contribuicao.competencia}</span> ·{' '}
              <strong className="text-foreground">{formatarReais(contribuicao.valorDeclarado)}</strong>
              {contribuicao.enviadoEm &&
                ` · enviado em ${new Date(contribuicao.enviadoEm).toLocaleString('pt-BR')}`}
            </p>
          </div>
          <button type="button" onClick={fechar} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Visualizador lado a lado */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-4 lg:grid-cols-2">
          <Visualizador
            id={contribuicao.id}
            tipo="comprovante"
            titulo="Comprovante do PIX"
            Icone={Receipt}
            existe={contribuicao.temComprovante}
          />
          <Visualizador
            id={contribuicao.id}
            tipo="relacao"
            titulo="Relação de trabalhadores"
            Icone={FileText}
            existe={contribuicao.temRelacao}
          />
        </div>

        {/* Decisão */}
        <div className="space-y-3 border-t p-4 sm:p-5">
          {/* A empresa pode enviar um documento de cada vez; quem confere
              precisa saber que ainda falta algo antes de homologar. */}
          {podeDecidir && (!contribuicao.temComprovante || !contribuicao.temRelacao) && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                A empresa enviou apenas{' '}
                <strong>
                  {contribuicao.temComprovante ? 'o comprovante do PIX' : 'a relação de trabalhadores'}
                </strong>
                . Ela ainda pode completar o envio — homologue só se o que falta não for necessário.
              </span>
            </p>
          )}

          {contribuicao.status === 'REJEITADA' && contribuicao.motivoRejeicao && (
            <p className="flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><strong>Motivo da rejeição:</strong> {contribuicao.motivoRejeicao}</span>
            </p>
          )}

          {contribuicao.status === 'HOMOLOGADA' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-senatepi-600" />
                Homologada{contribuicao.analista ? ` por ${contribuicao.analista}` : ''}
                {contribuicao.analisadoEm && ` em ${new Date(contribuicao.analisadoEm).toLocaleString('pt-BR')}`}
                {contribuicao.movimentacaoId ? ' · entrada lançada no caixa.' : ' · sem lançamento no caixa.'}
              </p>
              {ehAdmin && contribuicao.movimentacaoId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-700 dark:text-red-400"
                  disabled={excluirLanc.isPending}
                  onClick={() => setConfirmando('lancamento')}
                >
                  <Landmark className="h-3.5 w-3.5" /> Desfazer lançamento
                </Button>
              )}
            </div>
          )}

          {podeDecidir && !rejeitando && (
            <div className="flex flex-wrap items-end gap-3">
              {contasAtivas.length > 0 && (
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium">
                    <Landmark className="h-3.5 w-3.5" /> Lançar a entrada em
                  </label>
                  <select
                    value={contaId}
                    onChange={(e) => setContaId(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Não lançar no caixa agora</option>
                    {contasAtivas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}{c.instituicao ? ` — ${c.instituicao}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-1 justify-end gap-2">
                <Button
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                  onClick={() => setRejeitando(true)}
                >
                  <Ban className="h-4 w-4" /> Rejeitar
                </Button>
                <Button onClick={() => homologar.mutate()} disabled={homologar.isPending}>
                  {homologar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Homologar pagamento
                </Button>
              </div>
            </div>
          )}

          {podeDecidir && rejeitando && (
            <div className="space-y-2 rounded-lg border border-red-300 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20">
              <label className="text-xs font-medium">
                Motivo da rejeição * <span className="font-normal text-muted-foreground">
                  (a empresa vai ler este texto no portal)
                </span>
              </label>
              <textarea
                autoFocus
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: o valor do comprovante não confere com o total da relação enviada."
                className="w-full rounded-md border border-input bg-background p-3 text-sm"
              />
              {/* A rejeição só acontece no botão abaixo. Sem este contador, o
                  botão ficava desabilitado sem dizer o porquê e dava a impressão
                  de que a recusa já tinha sido registrada. */}
              <p className="text-xs text-muted-foreground">
                {faltam > 0
                  ? `Faltam ${faltam} caractere(s) para poder confirmar.`
                  : 'Pronto — confirme abaixo para registrar a rejeição.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setRejeitando(false); setMotivo(''); }}>
                  Cancelar
                </Button>
                <Button
                  className="bg-red-600 text-white hover:bg-red-700"
                  disabled={faltam > 0 || rejeitar.isPending}
                  onClick={() => rejeitar.mutate()}
                >
                  {rejeitar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                  Confirmar rejeição
                </Button>
              </div>
            </div>
          )}

          {/* Exclusão permanente — só o Administrador, em qualquer situação. */}
          {ehAdmin && !rejeitando && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setConfirmando('contribuicao')}
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-red-600 dark:hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir esta contribuição
              </button>
            </div>
          )}

          {/* Rodapé legal — os PDFs abertos acima têm dado pessoal de terceiros. */}
          <p className="flex items-start gap-1.5 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
            <ScrollText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              O manuseio dos documentos acima, em especial a folha de pagamento e a relação de
              trabalhadores, observa a{' '}
              <strong>
                Lei Geral de Proteção de Dados Pessoais (LGPD), Lei nº 13.709, de 14 de agosto de
                2018
              </strong>{' '}
              (Fonte: Diário Oficial da União). O acesso é restrito à equipe autorizada, limitado à
              finalidade de conferência e homologação da contribuição patronal, e fica registrado
              na auditoria do sistema.
            </span>
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={confirmando === 'contribuicao'}
        variant="destructive"
        title="Excluir esta contribuição?"
        confirmLabel="Excluir definitivamente"
        loading={excluir.isPending}
        icon={<Trash2 className="h-6 w-6" />}
        onConfirm={() => excluir.mutate()}
        onClose={() => (excluir.isPending ? null : setConfirmando(null))}
        description={
          <>
            A guia de <strong className="capitalize">{contribuicao.competencia}</strong> de{' '}
            <strong>{contribuicao.empresa.razaoSocial}</strong> e os documentos enviados serão
            apagados de forma <strong>permanente</strong>.
            {contribuicao.movimentacaoId && (
              <> A entrada de {formatarReais(contribuicao.valorDeclarado)} já lançada no caixa
              <strong> será mantida</strong> — desfaça o lançamento separadamente se for o caso.</>
            )}
          </>
        }
      />

      <ConfirmDialog
        open={confirmando === 'lancamento'}
        variant="destructive"
        title="Desfazer o lançamento no caixa?"
        confirmLabel="Excluir lançamento"
        loading={excluirLanc.isPending}
        icon={<Landmark className="h-6 w-6" />}
        onConfirm={() => excluirLanc.mutate()}
        onClose={() => (excluirLanc.isPending ? null : setConfirmando(null))}
        description={
          <>
            A entrada de <strong>{formatarReais(contribuicao.valorDeclarado)}</strong> sai do fluxo
            de caixa. A contribuição continua <strong>homologada</strong>, apenas sem valor lançado.
          </>
        }
      />
    </div>
  );
}

/**
 * Painel de um documento.
 *
 * PDF vai em <iframe> (usa o leitor nativo do navegador) e imagem em <img>.
 * O object URL é revogado ao desmontar para o arquivo não ficar na memória
 * depois que a conferência acaba.
 */
function Visualizador({
  id, tipo, titulo, Icone, existe,
}: {
  id: string;
  tipo: 'comprovante' | 'relacao';
  titulo: string;
  Icone: React.ElementType;
  existe: boolean;
}) {
  const [estado, setEstado] = useState<
    { fase: 'carregando' } | { fase: 'ok'; url: string; mime: string } | { fase: 'erro' }
  >({ fase: 'carregando' });

  useEffect(() => {
    if (!existe) return;
    let urlCriada: string | null = null;
    let ativo = true;

    carregarDocumento(id, tipo)
      .then(({ url, tipoMime }) => {
        urlCriada = url;
        if (ativo) setEstado({ fase: 'ok', url, mime: tipoMime });
        else URL.revokeObjectURL(url);
      })
      .catch(() => ativo && setEstado({ fase: 'erro' }));

    return () => {
      ativo = false;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [id, tipo, existe]);

  return (
    <div className="flex min-h-[45vh] flex-col overflow-hidden rounded-xl border lg:min-h-[55vh]">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Icone className="h-3.5 w-3.5" /> {titulo}
        </p>
        {estado.fase === 'ok' && (
          <a
            href={estado.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" /> Abrir em aba
          </a>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20">
        {!existe && (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Documento não enviado pela empresa.
          </p>
        )}
        {existe && estado.fase === 'carregando' && (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
        {existe && estado.fase === 'erro' && (
          <p className="p-6 text-center text-xs text-muted-foreground">
            Não foi possível carregar o documento.
          </p>
        )}
        {existe && estado.fase === 'ok' &&
          (estado.mime === 'application/pdf' ? (
            <iframe src={estado.url} title={titulo} className="h-full w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={estado.url} alt={titulo} className="max-h-full max-w-full object-contain" />
          ))}
      </div>
    </div>
  );
}
