'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, User, Phone, Mail, MapPin, UserCog, Clock, ArrowRight, History,
  Gavel, CheckCircle2, XCircle, RotateCcw, CalendarClock, Pencil, Tag, Video, Copy, Link2,
  AlertTriangle, RotateCw,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Carregando, Esqueleto, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeEditar as podeEditarModulo, podeVer } from '@/lib/permissoes';
import { normalizarLinkReuniao } from '@/lib/link-reuniao';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import { AtualizacaoCadastralModal } from '@/components/atendimentos/atualizacao-cadastral-modal';
import { AnexosSection } from '@/components/anexos/anexos-section';
import { AtendimentoParaDesfecho } from '@/components/atendimentos/registrar-desfecho-modal';
import { ChipEncaminhamento } from '@/components/atendimentos/estado-do-encaminhamento';
import {
  getAtendimento, mudarStatusAtendimento, atualizarAssunto, atualizarLinkDaConsulta,
  linkWhatsApp, mensagemSaudacao, formatDataHora,
  CANAL_LABEL, DESFECHO_LABEL, DESFECHO_COR, STATUS_LABEL, STATUS_COR, TIPO_ENC_LABEL, StatusAtendimento,
  ASSUNTO_OUTRO_MAX, ESTADO_ENCAMINHAMENTO, STATUS_CONSULTA_LABEL, CompromissoResumo, Encaminhamento,
  consultasDoAtendimento, corpoDoAssunto, erroDoAssunto, faltaConcluir, fraseDoEncaminhamento,
  modalidadeDoLocal, nomeDeQuemAtende, rotuloDoAssunto, rotuloDoInstante,
} from '@/lib/atendimentos';
import { ASSUNTO_LABEL, ASSUNTOS } from '@/lib/relatorios';
import { formatNPU } from '@/lib/processos';
import { mascararCpf } from '@/lib/utils';
import { V } from '@/lib/vocabulario';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

export function AtendimentoDrawer({
  atendimentoId, open, onClose, onMudou, onRegistrarDesfecho,
}: {
  atendimentoId: string | null;
  open: boolean;
  onClose: () => void;
  onMudou?: () => void;
  onRegistrarDesfecho?: (a: AtendimentoParaDesfecho) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  /*
    A GAVETA DECIDE SOZINHA O QUE OFERECER. Ela abre na tela de atendimentos e
    também a partir da agenda ("Abrir triagem completa"), onde quem olha costuma
    ser o advogado — que VÊ atendimentos, mas não grava. Mostrar Concluir,
    Cancelar ou Classificar a ele era deixar a pessoa agir para levar 403.
  */
  const podeEditar = podeEditarModulo(user?.role, user?.permissoes, 'atendimentos');
  const podeVerAgenda = podeVer(user?.role, user?.permissoes, 'agenda');
  const podeEditarFiliados = podeEditarModulo(user?.role, user?.permissoes, 'filiados');
  const [cadastral, setCadastral] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['atendimento', atendimentoId],
    queryFn: () => getAtendimento(atendimentoId!),
    enabled: open && !!atendimentoId,
  });

  const at = data?.atendimento;
  const filiado = at?.filiado;
  const consultas = at ? consultasDoAtendimento(at) : [];
  const temEncaminhamento = at?.desfecho === 'ENCAMINHADO' || consultas.length > 0;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['atendimento', atendimentoId] });
    qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    onMudou?.();
  };

  const status = useMutation({
    mutationFn: (s: StatusAtendimento) => mudarStatusAtendimento(atendimentoId!, s),
    onSuccess: () => invalidar(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Não foi possível mudar o status.'),
  });

  const celularLink = filiado && at
    ? linkWhatsApp(
        filiado.telefonePrincipal,
        mensagemSaudacao({ nome: filiado.nomeCompleto, data: at.createdAt }),
        filiado.telefoneSecundario,
      )
    : null;

  const Linha = ({ Icon, children }: { Icon: any; children: React.ReactNode }) => (
    <p className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> {children}</p>
  );

  return (
    <>
      <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-lg">
        <div className="flex items-center justify-between gap-2 border-b py-3 pl-5 pr-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Atendimento {at ? `#${at.numero}` : ''}</p>
            <h3 className="truncate text-lg font-bold">{filiado?.nomeCompleto ?? (isError ? 'Atendimento' : 'Abrindo…')}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-600" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Não deu para abrir este atendimento.</p>
            <Button variant="outline" onClick={() => refetch()}><RotateCw className="h-4 w-4" /> Tentar de novo</Button>
          </div>
        ) : isLoading || !at || !filiado ? (
          <Carregando texto="Abrindo o atendimento" className="flex-1 space-y-5 p-5">
            <Esqueleto className="h-40 w-full rounded-xl" />
            <div className="space-y-2">
              <Esqueleto className="h-5 w-2/3" />
              <Esqueleto className="h-16 w-full" />
            </div>
            <EsqueletoLinhas quantidade={3} className="-mx-4" />
          </Carregando>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {/* Filiado */}
            <div className="rounded-xl border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold"><User className="h-4 w-4 text-brand-700 dark:text-brand-400" aria-hidden="true" /> {V.Filiado}</p>
                <Badge className="bg-muted text-muted-foreground">Matrícula {filiado.matricula}</Badge>
              </div>
              <div className="space-y-1.5">
                <Linha Icon={User}>{mascararCpf(filiado.cpf ?? '')}</Linha>
                <Linha Icon={Phone}>
                  {filiado.telefonePrincipal || filiado.telefoneSecundario
                    ? [filiado.telefonePrincipal, filiado.telefoneSecundario].filter(Boolean).join(' · ')
                    : <span className="text-muted-foreground">sem telefone</span>}
                </Linha>
                <Linha Icon={Mail}>{filiado.email || <span className="text-muted-foreground">sem e-mail</span>}</Linha>
                <Linha Icon={MapPin}>{[filiado.endereco, filiado.numero, filiado.bairro, filiado.cidade].filter(Boolean).join(', ') || <span className="text-muted-foreground">sem endereço</span>}</Linha>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="bg-[#25D366] text-white hover:bg-[#20bd5a]"
                  disabled={!celularLink}
                  onClick={() => celularLink && window.open(celularLink, '_blank', 'noopener,noreferrer')}
                >
                  <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                </Button>
                {podeEditarFiliados && (
                  <Button variant="outline" onClick={() => setCadastral(true)}>
                    <UserCog className="h-4 w-4" /> Atualização cadastral
                  </Button>
                )}
              </div>
              {!celularLink && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Sem WhatsApp: o cadastro não tem celular, nem no telefone principal nem no secundário.
                </p>
              )}
            </div>

            {/* Dossiê do atendimento */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-muted text-muted-foreground">{CANAL_LABEL[at.canal]}</Badge>
                {at.desfecho
                  ? <Badge className={DESFECHO_COR[at.desfecho]}>{DESFECHO_LABEL[at.desfecho]}</Badge>
                  : <span className="text-sm italic text-muted-foreground">Sem desfecho</span>}
                <Badge className={STATUS_COR[at.status]}>{STATUS_LABEL[at.status]}</Badge>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> {formatDataHora(at.createdAt)}</span>
              </div>

              {/* O assunto é o que o relatório soma; aqui se confere e se corrige. */}
              <AssuntoDoAtendimento
                key={`${at.id}-${at.assunto ?? ''}-${at.assuntoOutro ?? ''}`}
                atendimentoId={at.id}
                assunto={at.assunto}
                assuntoOutro={at.assuntoOutro ?? null}
                podeEditar={podeEditar}
                onSalvo={invalidar}
              />

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Demanda</p>
                <p className="whitespace-pre-wrap text-sm">{at.descricao}</p>
              </div>

              {at.desfecho === 'RESOLVIDO_ATO' && at.desfechoObs && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Resolução</p>
                  <p className="whitespace-pre-wrap">{at.desfechoObs}</p>
                </div>
              )}

              {temEncaminhamento && (
                <section className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <ArrowRight className="h-4 w-4 text-brand-700 dark:text-brand-400" aria-hidden="true" /> Encaminhamento jurídico
                    </p>
                    <ChipEncaminhamento encaminhamento={at.encaminhamento} statusAtendimento={at.status} />
                  </div>

                  {at.encaminhamento && (
                    <p className="text-sm">{fraseDoEncaminhamento(at.encaminhamento, at.status)}</p>
                  )}

                  {podeEditar && faltaConcluir(at) && (
                    <Button className="w-full sm:w-auto" onClick={() => status.mutate('CONCLUIDO')} disabled={status.isPending}>
                      {status.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Concluir atendimento
                    </Button>
                  )}

                  <p className="text-sm text-muted-foreground">{at.tipoEncaminhamento ? TIPO_ENC_LABEL[at.tipoEncaminhamento] : '—'}</p>
                  {at.processo && (
                    <p className="flex items-center gap-1.5 text-sm"><Gavel className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {formatNPU(at.processo.numeroCNJ)}{at.processo.classeProcessual ? ` · ${at.processo.classeProcessual}` : ''}</p>
                  )}
                  {/* O texto gravado no desfecho é histórico: quem cuida HOJE vem da consulta. */}
                  {consultas.length === 0 && at.responsavel && (
                    <p className="text-sm">Encaminhado a <strong>{at.responsavel}</strong></p>
                  )}

                  {consultas.length > 0 && (
                    <ul className="space-y-2">
                      {consultas.map((c) => (
                        <ConsultaDoAtendimento
                          key={c.id}
                          atendimentoId={at.id}
                          consulta={c}
                          encaminhamento={at.encaminhamento ?? null}
                          podeEditar={podeEditar}
                          podeVerAgenda={podeVerAgenda}
                          onMudou={invalidar}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
              <p className="text-xs text-muted-foreground">Registrado por <strong>{at.atendente.nome}</strong></p>
            </div>

            {/* Ações da demanda — só para quem grava em atendimentos. */}
            {podeEditar && (
              <div className="flex flex-wrap gap-2 border-y py-3">
                {!at.desfecho && onRegistrarDesfecho && (
                  <Button
                    onClick={() => {
                      onRegistrarDesfecho({
                        id: at.id, numero: at.numero, descricao: at.descricao,
                        assunto: at.assunto, assuntoOutro: at.assuntoOutro ?? null,
                        filiado: { id: filiado.id, nomeCompleto: filiado.nomeCompleto },
                      });
                      onClose();
                    }}
                  >
                    <Gavel className="h-4 w-4" /> Registrar desfecho
                  </Button>
                )}
                {at.desfecho && at.status === 'PENDENTE' && !faltaConcluir(at) && (
                  <Button variant="outline" onClick={() => status.mutate('CONCLUIDO')} disabled={status.isPending}>
                    <CheckCircle2 className="h-4 w-4" /> Concluir atendimento
                  </Button>
                )}
                {at.status !== 'PENDENTE' && (
                  <Button variant="outline" onClick={() => status.mutate('PENDENTE')} disabled={status.isPending}>
                    <RotateCcw className="h-4 w-4" /> Reabrir
                  </Button>
                )}
                {at.status !== 'CANCELADO' && (
                  <Button variant="outline" className="text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/20" onClick={() => status.mutate('CANCELADO')} disabled={status.isPending}>
                    <XCircle className="h-4 w-4" /> Cancelar atendimento
                  </Button>
                )}
              </div>
            )}

            {/* Histórico do filiado */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4" aria-hidden="true" /> Histórico do {V.filiado}</p>
              {data.historico.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum atendimento anterior.</p>
              ) : (
                <ul className="space-y-2">
                  {data.historico.map((h) => (
                    <li key={h.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge className="bg-muted text-muted-foreground">{CANAL_LABEL[h.canal]}</Badge>
                        {h.desfecho
                          ? <Badge className={DESFECHO_COR[h.desfecho]}>{DESFECHO_LABEL[h.desfecho]}</Badge>
                          : <span className="text-[11px] italic text-muted-foreground">sem desfecho</span>}
                        <Badge className={cn('text-[10px]', STATUS_COR[h.status])}>{STATUS_LABEL[h.status]}</Badge>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" aria-hidden="true" /> {formatDataHora(h.createdAt)}</span>
                      </div>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{h.descricao}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Anexos — com "Puxar do acervo" (o filiado não reenvia o que já entregou) */}
            <AnexosSection atendimentoId={at.id} filiadoId={filiado.id} />
          </div>
        )}
      </Sheet>

      {cadastral && filiado && (
        <AtualizacaoCadastralModal
          filiado={filiado}
          onClose={() => setCadastral(false)}
          onSaved={invalidar}
        />
      )}
    </>
  );
}

/**
 * O ASSUNTO, CLASSIFICÁVEL DEPOIS.
 *
 * "Não informar agora" prometia um depois que não existia: a gaveta só mostrava
 * o selo. Agora quem grava em atendimentos toca no selo para corrigir, ou em
 * "Classificar" quando está vazio. Vai pela rota própria do assunto, que
 * registra de onde para onde na auditoria.
 */
function AssuntoDoAtendimento({
  atendimentoId, assunto, assuntoOutro, podeEditar, onSalvo,
}: {
  atendimentoId: string;
  assunto: string | null;
  assuntoOutro: string | null;
  podeEditar: boolean;
  onSalvo: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(assunto ?? '');
  const [outro, setOutro] = useState(assuntoOutro ?? '');
  const rotulo = rotuloDoAssunto(assunto, assuntoOutro);

  const salvar = useMutation({
    mutationFn: () => atualizarAssunto(atendimentoId, corpoDoAssunto(valor, outro)),
    onSuccess: () => { toast.success('Assunto salvo.'); setEditando(false); onSalvo(); },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível salvar o assunto.');
    },
  });

  function confirmar() {
    const erro = erroDoAssunto(valor, outro);
    if (erro) return toast.error(erro);
    salvar.mutate();
  }

  if (editando) {
    return (
      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor={`assunto-${atendimentoId}`}>
          Sobre o que era?
        </label>
        <select id={`assunto-${atendimentoId}`} className={inputCls} value={valor} onChange={(e) => setValor(e.target.value)}>
          <option value="">Sem assunto</option>
          {ASSUNTOS.map((a) => <option key={a} value={a}>{ASSUNTO_LABEL[a]}</option>)}
        </select>
        {valor === 'OUTRO' && (
          <Input
            autoFocus
            maxLength={ASSUNTO_OUTRO_MAX}
            value={outro}
            onChange={(e) => setOutro(e.target.value)}
            placeholder="Qual assunto? Ex.: aposentadoria, plano de saúde"
            aria-label="Qual assunto?"
          />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => { setEditando(false); setValor(assunto ?? ''); setOutro(assuntoOutro ?? ''); }} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </div>
      </div>
    );
  }

  if (!podeEditar) {
    return rotulo ? (
      <p className="flex items-center gap-1.5 text-sm"><Tag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {rotulo}</p>
    ) : null;
  }

  return rotulo ? (
    <button
      type="button"
      onClick={() => setEditando(true)}
      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-input px-3 text-sm hover:bg-muted md:min-h-9"
      aria-label={`Assunto: ${rotulo}. Tocar para mudar`}
    >
      <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{rotulo}</span>
      <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setEditando(true)}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:min-h-9"
    >
      <Tag className="h-3.5 w-3.5" aria-hidden="true" /> Classificar o assunto
    </button>
  );
}

/**
 * Uma consulta nascida do atendimento: quem, quando, em que pé, e o link.
 *
 * O status mostrado na consulta que VALE é o estado calculado pelo servidor
 * ("ficou para trás" inclusive); as demais mostram o status cru (em geral
 * canceladas, ou substituídas por uma mais nova).
 */
function ConsultaDoAtendimento({
  atendimentoId, consulta: c, encaminhamento, podeEditar, podeVerAgenda, onMudou,
}: {
  atendimentoId: string;
  consulta: CompromissoResumo;
  encaminhamento: Encaminhamento | null;
  podeEditar: boolean;
  podeVerAgenda: boolean;
  onMudou: () => void;
}) {
  const [editandoLink, setEditandoLink] = useState(false);
  const [link, setLink] = useState(c.linkReuniao ?? '');
  const ehAVigente = encaminhamento?.compromissoId === c.id;
  const rotuloStatus = ehAVigente && encaminhamento
    ? ESTADO_ENCAMINHAMENTO[encaminhamento.estado]?.rotulo
    : STATUS_CONSULTA_LABEL[c.status] ?? c.status;
  const pedeAtencao = ehAVigente && encaminhamento && ESTADO_ENCAMINHAMENTO[encaminhamento.estado]?.tom === 'ambar';
  const aberta = c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO';
  const porVideo = modalidadeDoLocal(c.local) === 'VIDEO';
  const quem = nomeDeQuemAtende(c.responsavel);
  /*
    O botão só abre o que passa pela regra do link (https, sem usuário e senha):
    um valor gravado antes da regra não vira clique. E o que se cola é conferido
    enquanto se digita, pelo espelho da regra do servidor.
  */
  const gravado = normalizarLinkReuniao(c.linkReuniao);
  const linkValido = gravado?.ok ? gravado : null;
  const digitado = editandoLink ? normalizarLinkReuniao(link) : null;
  const erroDoLink = digitado && !digitado.ok ? digitado.erro : null;

  const salvarLink = useMutation({
    mutationFn: (valor: string | null) => atualizarLinkDaConsulta(atendimentoId, c.id, valor),
    onSuccess: (_r, valor) => {
      toast.success(valor ? 'Link da chamada salvo.' : 'Link da chamada retirado.');
      setEditandoLink(false);
      onMudou();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível salvar o link.');
    },
  });

  async function copiar() {
    if (!c.linkReuniao) return;
    try {
      await navigator.clipboard.writeText(c.linkReuniao);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não deu para copiar. Segure o link para copiar à mão.');
    }
  }

  return (
    <li className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <CalendarClock className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" aria-hidden="true" />
          <span className="truncate">{quem || 'Sem responsável'}</span>
        </span>
        <span
          className={cn(
            'text-xs font-medium',
            pedeAtencao ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {rotuloStatus}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {rotuloDoInstante(c.inicio)}
        {c.local ? ` · ${c.local}` : ''}
      </p>

      {c.linkReuniao && !editandoLink && (
        <div className="flex flex-wrap gap-2">
          {linkValido ? (
            <a
              href={linkValido.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: 'default' }), 'h-12 w-full sm:w-auto md:h-9')}
            >
              <Video className="h-4 w-4" /> Entrar na chamada · {linkValido.provedor}
            </a>
          ) : (
            <p className="w-full text-xs text-amber-800 dark:text-amber-300">
              O link gravado não é um endereço seguro de chamada. Troque pelo link certo.
            </p>
          )}
          <Button variant="outline" className="md:h-9" onClick={copiar}>
            <Copy className="h-4 w-4" /> Copiar link
          </Button>
        </div>
      )}

      {editandoLink ? (
        <div className="space-y-2">
          <Input
            autoFocus
            inputMode="url"
            maxLength={2000}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Cole o link ou o convite da chamada"
            aria-label="Link da chamada"
            aria-invalid={!!erroDoLink}
          />
          {(erroDoLink || digitado?.ok) && (
            <p className={cn('text-xs', erroDoLink ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}>
              {erroDoLink ?? (digitado?.ok ? `${digitado.provedor}: ${digitado.url}` : '')}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {c.linkReuniao && (
              <Button variant="ghost" onClick={() => salvarLink.mutate(null)} disabled={salvarLink.isPending}>
                Tirar o link
              </Button>
            )}
            <Button variant="outline" onClick={() => { setEditandoLink(false); setLink(c.linkReuniao ?? ''); }} disabled={salvarLink.isPending}>
              Cancelar
            </Button>
            <Button onClick={() => salvarLink.mutate(link.trim() || null)} disabled={salvarLink.isPending || !link.trim() || !!erroDoLink}>
              {salvarLink.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar link
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {podeEditar && aberta && (porVideo || c.linkReuniao) && (
            <Button variant="outline" className="md:h-9" onClick={() => setEditandoLink(true)}>
              <Link2 className="h-4 w-4" /> {c.linkReuniao ? 'Trocar o link' : 'Colar o link da chamada'}
            </Button>
          )}
          {podeVerAgenda && (
            <Link
              href={`/agenda?compromisso=${c.id}`}
              className={cn(buttonVariants({ variant: 'ghost' }), 'md:h-9')}
            >
              Abrir na agenda <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
