'use client';

import { useState } from 'react';
import { formatDataPura } from '@/lib/data-pura';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { podeExcluir, nivelEfetivo } from '@/lib/permissoes';
import { moduloAtivo } from '@/tenant.config';
import {
  ChevronDown, ChevronRight, User, Plus, CalendarClock, Trash2, Printer, Paperclip,
  ReceiptText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Carregando, Esqueleto } from '@/components/ui/esqueleto';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ParcelaAcoes } from '@/components/cobrancas/parcela-actions';
import { EmitirReciboModal } from '@/components/recibos/emitir-recibo-modal';
import { ReciboPrintModal } from '@/components/recibos/recibo-print-modal';
import type { PagamentoParaRecibo } from '@/lib/recibos';
import { CarnePrintModal } from '@/components/cobrancas/carne-print-modal';
import {
  FiliadoResumoFin, historicoFiliado, excluirCobranca,
  formatBRL, formatData, statusExibicao, STATUS_LABEL, STATUS_COR, TIPO_LABEL,
} from '@/lib/cobrancas';

/** Linha/card de um filiado na listagem agrupada — expande para ver as cobranças. */
export function FiliadoCobrancasCard({ resumo, onMudou }: { resumo: FiliadoResumoFin; onMudou: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  /*
    O RECIBO SAI DA LINHA DA PARCELA, e não de dentro do menu (13/10/2026).

    "Lá na parte de cobranças, não há um botão rápido para gerar o recibo?" —
    havia, no menu de três pontinhos, e o dono não achou. É a terceira vez que
    o mesmo defeito aparece nesta base: a ação existia, estava no lugar certo e
    não tinha PESO na hora da escolha (`senatepi-peso-nao-lugar`).

    O precedente está neste mesmo arquivo, logo abaixo: o comprovante enviado
    pelo filiado aparece INLINE na linha, "porque a pergunta da secretaria é
    'esta parcela pode receber baixa?' e a resposta tem de estar ao lado do
    botão que dá a baixa". Aqui a pergunta é "já dei o recibo desta?", e a
    resposta é a mesma coisa: na linha.
  */
  const [emitirRecibo, setEmitirRecibo] = useState<PagamentoParaRecibo | null>(null);
  const [verRecibo, setVerRecibo] = useState<string | null>(null);
  const temModuloRecibos = moduloAtivo('recibos');
  const podeMexerEmRecibo =
    temModuloRecibos && nivelEfetivo(user?.role, user?.permissoes, 'recibos') === 'EDITAR';
  const [aberto, setAberto] = useState(false);
  const [confirmar, setConfirmar] = useState<{
    id: string;
    label: string;
    qtdPagas: number;
    valorPago: number;
  } | null>(null);
  /*
    O CARNÊ INTEIRO GANHOU O LUGAR DELE (24/09/2026).

    Ele morava no menu de UMA parcela, onde prometia a parcela e mandava as
    doze. Aqui, no cabeçalho da cobrança, o alvo é a cobrança — e o número no
    rótulo diz quantas folhas saem antes de alguém clicar.
  */
  const [carneInteiro, setCarneInteiro] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['cobrancas-filiado', resumo.filiadoId],
    queryFn: () => historicoFiliado(resumo.filiadoId),
    enabled: aberto,
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['cobrancas-filiado', resumo.filiadoId] });
    onMudou();
  };

  const excluir = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) => excluirCobranca(id, force),
    onSuccess: () => {
      toast.success('Cobrança excluída.');
      setConfirmar(null);
      invalidar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível excluir a cobrança.'),
  });

  const emDia = resumo.totalVencido <= 0 && resumo.totalEmAberto <= 0;

  return (
    <div className="rounded-xl border bg-card">
      {/* Cabeçalho do filiado */}
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-label={aberto ? 'Recolher' : 'Expandir'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setAberto((v) => !v)} className="block w-full text-left">
            <p className="flex items-center gap-1.5 truncate font-semibold">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {resumo.nomeCompleto}
            </p>
            <p className="text-xs text-muted-foreground">Matrícula {resumo.matricula} · {resumo.qtdParcelas} parcela(s)</p>
          </button>
          {/* Chips de situação */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {resumo.totalVencido > 0 && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                Vencido {formatBRL(resumo.totalVencido)} · {resumo.qtdVencidas}
              </Badge>
            )}
            {resumo.totalEmAberto > 0 && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                A vencer {formatBRL(resumo.totalEmAberto)}
              </Badge>
            )}
            {emDia && (
              <Badge className="bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400">Em dia</Badge>
            )}
            {resumo.proximoVencimento && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <CalendarClock className="h-3 w-3" /> próx. {formatData(resumo.proximoVencimento)}
              </span>
            )}
          </div>
        </div>

        <Link href={`/cobrancas/nova?filiadoId=${resumo.filiadoId}`} className="shrink-0">
          <Button size="sm" variant="outline"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nova</span></Button>
        </Link>
      </div>

      {/* Cobranças do filiado (carregadas ao expandir) */}
      {aberto && (
        <div className="border-t p-4">
          {isLoading ? (
            <Carregando texto="Carregando as cobranças…" className="space-y-3">
              <Esqueleto className="h-24 w-full rounded-lg" />
              <Esqueleto className="h-24 w-full rounded-lg" />
            </Carregando>
          ) : !data || data.cobrancas.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma cobrança lançada.</p>
          ) : (
            <div className="space-y-3">
              {data.cobrancas.map((c) => (
                <div key={c.id} className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                    <p className="min-w-0 truncate text-sm">
                      <span className="font-semibold">{TIPO_LABEL[c.tipo]}</span> · {c.parcelas.length}× · {formatBRL(c.valorTotal)}
                      <span className="text-xs text-muted-foreground"> · {formatData(c.createdAt)}</span>
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                    {c.parcelas.length > 1 && (
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                        /* No celular só cabem o ícone e o número; o nome fica aqui. */
                        title={`Imprimir o carnê inteiro — ${c.parcelas.length} parcelas`}
                        aria-label={`Imprimir o carnê inteiro, ${c.parcelas.length} parcelas`}
                        onClick={() => setCarneInteiro(c.id)}
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Carnê inteiro</span>
                        <span className="tabular-nums">({c.parcelas.length})</span>
                      </Button>
                    )}
                    {/* Só o Administrador apaga — regra global do sistema. */}
                    {ehAdmin && (
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      title="Excluir cobrança"
                      onClick={() => {
                        const pagas = c.parcelas.filter((p) => p.status === 'PAGO');
                        setConfirmar({
                          id: c.id,
                          label: `${TIPO_LABEL[c.tipo]} (${c.parcelas.length}× · ${formatBRL(c.valorTotal)})`,
                          qtdPagas: pagas.length,
                          valorPago: pagas.reduce((s, p) => s + Number(p.valor), 0),
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    )}
                    </div>
                  </div>
                  <ul className="divide-y">
                    {c.parcelas.map((p) => {
                      const st = statusExibicao(p);
                      return (
                        <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{p.numero}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium tabular-nums">{formatBRL(p.valor)}</p>
                            <p className="text-xs text-muted-foreground">Vence {formatDataPura(p.dataVencimento)}</p>
                            {/*
                              O COMPROVANTE APARECE NA LINHA DA PARCELA, e não
                              numa aba à parte: a pergunta da secretaria é "esta
                              parcela pode receber baixa?", e a resposta tem de
                              estar ao lado do botão que dá a baixa.

                              Só em quem NÃO está paga — depois da baixa o
                              comprovante já cumpriu o papel e vira ruído.
                            */}
                            {/*
                              O RECIBO DA PARCELA PAGA — um só rótulo, e ele
                              diz qual dos dois caminhos é. Com recibo vivo,
                              "Recibo 007/2026" abre a 2ª via (mesmo número);
                              sem, "Emitir recibo" cria o primeiro. Oferecer
                              "emitir" onde já existe levaria à recusa da API,
                              e botão que dá erro é pior que botão ausente.
                            */}
                            {p.status === 'PAGO' && temModuloRecibos && (
                              p.recibo && !p.recibo.canceladoEm ? (
                                <button
                                  type="button"
                                  onClick={() => setVerRecibo(p.recibo!.id)}
                                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400"
                                >
                                  <ReceiptText className="h-3 w-3" />
                                  Recibo {String(p.recibo.numero).padStart(3, '0')}/{p.recibo.exercicio}
                                </button>
                              ) : podeMexerEmRecibo ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEmitirRecibo({
                                      tipo: 'ENTRADA',
                                      parcelaId: p.id,
                                      movimentacaoId: null,
                                      valor: Number(p.valorPago ?? p.valor),
                                      data: p.dataPagamento ?? new Date().toISOString(),
                                      conta: null,
                                      contraparteNome: resumo.nomeCompleto,
                                      contraparteDocumento: null,
                                      filiadoId: null,
                                      empresaId: null,
                                      referenteSugerido: '',
                                    })
                                  }
                                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400"
                                >
                                  <ReceiptText className="h-3 w-3" />
                                  Emitir recibo
                                </button>
                              ) : null
                            )}
                            {p.comprovante && p.status !== 'PAGO' && (
                              <a
                                href={p.comprovante.url ?? '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400"
                              >
                                <Paperclip className="h-3 w-3" />
                                Comprovante de {formatDataPura(p.comprovante.enviadoEm)}
                              </a>
                            )}
                          </div>
                          <Badge className={`${STATUS_COR[st]} shrink-0`}>{STATUS_LABEL[st]}</Badge>
                          <ParcelaAcoes
                            parcela={{
                              id: p.id, numero: p.numero, valor: p.valor,
                              dataCompetencia: p.dataCompetencia, dataVencimento: p.dataVencimento,
                              status: p.status, tipo: c.tipo, cobrancaId: c.id,
                              // O recibo da parcela paga, para o menu oferecer a 2ª via
                              // em vez de um segundo recibo do mesmo dinheiro.
                              dataPagamento: p.dataPagamento, valorPago: p.valorPago, recibo: p.recibo,
                              filiado: {
                                nomeCompleto: resumo.nomeCompleto,
                                matricula: resumo.matricula,
                                telefonePrincipal: resumo.telefonePrincipal,
                                telefoneSecundario: resumo.telefoneSecundario,
                              },
                            }}
                            onMudou={invalidar}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {carneInteiro && (
        <CarnePrintModal cobrancaId={carneInteiro} onClose={() => setCarneInteiro(null)} />
      )}

      {emitirRecibo && (
        <EmitirReciboModal
          origem={{ tipo: 'PAGAMENTO', pagamento: emitirRecibo }}
          onClose={() => setEmitirRecibo(null)}
          onEmitido={(id) => { setEmitirRecibo(null); setVerRecibo(id); invalidar(); }}
        />
      )}
      {verRecibo && <ReciboPrintModal reciboId={verRecibo} onClose={() => setVerRecibo(null)} />}

      <ConfirmDialog
        open={!!confirmar}
        variant="destructive"
        title="Excluir cobrança"
        icon={<Trash2 className="h-6 w-6" />}
        description={
          confirmar?.qtdPagas ? (
            <>
              A cobrança <strong>{confirmar.label}</strong> possui{' '}
              <strong>{confirmar.qtdPagas} parcela(s) paga(s)</strong>. Excluir também vai{' '}
              <strong>remover o(s) lançamento(s) financeiro(s)</strong> de{' '}
              <strong>{formatBRL(confirmar.valorPago)}</strong>, reduzindo o saldo da conta. Esta
              ação é <strong>irreversível</strong>.
            </>
          ) : (
            <>
              Excluir a cobrança <strong>{confirmar?.label}</strong> e todas as suas parcelas? Esta
              ação é irreversível.
            </>
          )
        }
        confirmLabel={confirmar?.qtdPagas ? 'Excluir mesmo assim' : 'Excluir cobrança'}
        loading={excluir.isPending}
        onConfirm={() => confirmar && excluir.mutate({ id: confirmar.id, force: confirmar.qtdPagas > 0 })}
        onClose={() => setConfirmar(null)}
      />
    </div>
  );
}
