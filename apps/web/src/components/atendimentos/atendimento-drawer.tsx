'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, User, Phone, Mail, MapPin, UserCog, Clock, ArrowRight, History,
  Gavel, CheckCircle2, XCircle, RotateCcw, CalendarClock, Pencil, Tag, Video, Copy, Link2,
  AlertTriangle, RotateCw, Building2, CalendarPlus,
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
import { AvisoCadastroIncompleto } from '@/components/filiados/aviso-cadastro-incompleto';
import { AnexosSection } from '@/components/anexos/anexos-section';
import { AtendimentoParaDesfecho } from '@/components/atendimentos/registrar-desfecho-modal';
import { ChipEncaminhamento } from '@/components/atendimentos/estado-do-encaminhamento';
import {
  FecharAtendimentoModal, ReabrirAtendimentoDialog, useInvalidarAtendimentoEAgenda,
} from '@/components/atendimentos/fechar-atendimento-modal';
import { celularParaWhatsApp, linkWhatsApp as linkDoWhatsApp } from '@/lib/whatsapp';
import {
  getAtendimento, atualizarAssunto, mudarModalidadeDaConsulta,
  linkWhatsApp, mensagemSaudacao, formatDataHora,
  CANAL_LABEL, DESFECHO_LABEL, DESFECHO_COR, STATUS_LABEL, STATUS_COR, TIPO_ENC_LABEL,
  ASSUNTO_OUTRO_MAX, ESTADO_ENCAMINHAMENTO, STATUS_CONSULTA_LABEL, CompromissoResumo, Encaminhamento,
  LOCAL_DA_MODALIDADE, MODALIDADES, MODALIDADE_LABEL,
  type AcaoDeFechar, type ModalidadeConsulta, type StatusAtendimento,
  concluirEhDireto, consultaRemarcada, consultasDoAtendimento, corDoStatus, corpoDoAssunto, erroDoAssunto, faltaConcluir,
  fraseDoEncaminhamento, fraseDoFechamento, mensagemDaConsulta, mensagemDaFalha, modalidadeDoCartao, modalidadeRemota,
  modoDoFechamento, nomeDeQuemAtende, podeMarcarNovaConsulta, rotuloDaModalidadeNoCartao, rotuloDoAssunto,
  rotuloDoInstante, rotuloDoStatus, textoDaConsultaSemRegistro, textoDaRemarcada, textoDoFechaSozinho,
  tomDoEncaminhamento, type FilaNaResposta,
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
  /*
    CONCLUIR, CANCELAR E REABRIR ABREM DIÁLOGO (14/09/2026). Eram seis toques
    únicos entre a gaveta e a lista, sem dizer o que acontecia com a consulta.
    O modal é o mesmo da lista; a gaveta tem a sua instância porque também abre
    sozinha, a partir da agenda.
  */
  const [fechar, setFechar] = useState<AcaoDeFechar | null>(null);
  const [reabrindo, setReabrindo] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['atendimento', atendimentoId],
    queryFn: () => getAtendimento(atendimentoId!),
    enabled: open && !!atendimentoId,
  });

  const at = data?.atendimento;
  const filiado = at?.filiado;
  const consultas = at ? consultasDoAtendimento(at) : [];
  const temEncaminhamento = at?.desfecho === 'ENCAMINHADO' || consultas.length > 0;
  /*
    O ATENDIMENTO INDEPENDENTE (15/09/2026). Com a consulta de pé, a triagem não
    tem o que concluir: o atendimento fecha quando quem atende registra a
    consulta. As ações desse caso moram no bloco do encaminhamento, e o rodapé
    não repete Concluir nem Cancelar.
  */
  const modo = at ? modoDoFechamento(at) : 'OUTRO';
  const consultaDePe = modo === 'FECHA_SOZINHO' || modo === 'CONSULTA_SEM_REGISTRO';
  const remarcada = at ? consultaRemarcada(at.encaminhamento, at.status) : false;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['atendimento', atendimentoId] });
    qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
    onMudou?.();
  };

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
                {/* Ver o mesmo comentário no `novo-atendimento-drawer`: o
                    formulário paralelo saiu, e a porta de edição mora no aviso
                    de cadastro incompleto, logo abaixo. */}
              </div>
              {!celularLink && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Sem WhatsApp: o cadastro não tem celular, nem no telefone principal nem no secundário.
                </p>
              )}
              {/*
                O CADASTRO FURADO TAMBÉM É COBRADO AQUI — a triagem volta a esta
                gaveta para acompanhar o atendimento, e é mais uma chance de
                pedir a atualização enquanto o assunto está aberto. Compacto: a
                explicação longa já apareceu no registro.
              */}
              {filiado.id && (
                <AvisoCadastroIncompleto
                  compacto
                  className="mt-3"
                  filiadoId={filiado.id}
                  nome={filiado.nomeCompleto}
                  filiado={{
                    cpf: filiado.cpf,
                    telefone: filiado.telefonePrincipal,
                    telefoneSecundario: filiado.telefoneSecundario,
                    /* O dossiê não traz o nascimento; sem ele a régua não
                       tem como saber se falta, e não inventa que falta. */
                    email: filiado.email,
                  }}
                />
              )}
            </div>

            {/* Dossiê do atendimento */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-muted text-muted-foreground">{CANAL_LABEL[at.canal]}</Badge>
                {at.desfecho
                  ? <Badge className={DESFECHO_COR[at.desfecho]}>{DESFECHO_LABEL[at.desfecho]}</Badge>
                  : <span className="text-sm italic text-muted-foreground">Sem desfecho</span>}
                <Badge className={corDoStatus(at)}>{rotuloDoStatus(at)}</Badge>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> {formatDataHora(at.createdAt)}</span>
              </div>

              <BlocoDoFechamento at={at} />

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
                    <ChipEncaminhamento encaminhamento={at.encaminhamento} statusAtendimento={at.status} fila={at.fila} />
                  </div>

                  {at.encaminhamento && !remarcada && modo !== 'CONSULTA_SEM_REGISTRO' && (
                    <p className="text-sm">{fraseDoEncaminhamento(at.encaminhamento, at.status)}</p>
                  )}

                  {/* Remarcada: neutra, com o aviso ao filiado a um toque (E6). */}
                  {remarcada && at.encaminhamento && (
                    <AvisoDaRemarcada
                      encaminhamento={at.encaminhamento}
                      filiado={filiado}
                    />
                  )}

                  {at.encaminhamento && consultaDePe && (
                    <EsperaPelaConsulta
                      modo={modo}
                      encaminhamento={at.encaminhamento}
                      podeEditar={podeEditar}
                      podeResolverSemConsulta={!!at.fechamento?.concluir.permitido}
                      podeVerAgenda={podeVerAgenda}
                      onResolverSemConsulta={() => setFechar('CONCLUIR')}
                      onCancelar={() => setFechar('CANCELAR')}
                    />
                  )}

                  {/* API de antes (sem fila nem plano): o "falta concluir" de sempre. */}
                  {podeEditar && modo === 'OUTRO' && faltaConcluir(at) && (
                    <Button className="w-full sm:w-auto" onClick={() => setFechar('CONCLUIR')}>
                      <CheckCircle2 className="h-4 w-4" /> Concluir atendimento
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
                          statusAtendimento={at.status}
                          fila={at.fila}
                          filiado={filiado}
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
            {/*
              A 400 px, uma ação por linha e em largura total: lado a lado, os
              botões dividiam a largura e um toque errado cancelava.
            */}
            {podeEditar && (
              <div className="grid grid-cols-1 gap-2 border-y py-3 sm:flex sm:flex-wrap">
                {!at.desfecho && onRegistrarDesfecho && (
                  <Button
                    className="h-12 sm:h-10"
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
                {/*
                  MARCAR NOVA CONSULTA (D13, fase 2): todas as consultas nascidas
                  foram canceladas e a demanda segue aberta. Abre o desfecho já em
                  "Encaminhar", e a consulta nasce com o vínculo do atendimento.
                */}
                {podeMarcarNovaConsulta(at) && onRegistrarDesfecho && (
                  <Button
                    className="h-12 sm:h-10"
                    onClick={() => {
                      onRegistrarDesfecho({
                        id: at.id, numero: at.numero, descricao: at.descricao,
                        assunto: at.assunto, assuntoOutro: at.assuntoOutro ?? null,
                        filiado: { id: filiado.id, nomeCompleto: filiado.nomeCompleto },
                        novaConsulta: true,
                      });
                      onClose();
                    }}
                  >
                    <CalendarPlus className="h-4 w-4" /> Marcar nova consulta
                  </Button>
                )}
                {/*
                  Sólido só quando concluir não decide nada além de fechar (atendida ou resolvido no ato).
                  Com a fila, só aparece quando a vez é da triagem (FALTA_CONCLUIR, SEM_CONSULTA,
                  CONSULTA_CANCELADA); sem ela, a regra de antes.
                */}
                {(modo === 'CONCLUIR' || (modo === 'OUTRO' && at.desfecho && at.status === 'PENDENTE' && !faltaConcluir(at))) && (
                  <Button
                    variant={concluirEhDireto(at) ? 'default' : 'outline'}
                    className="h-12 sm:h-10"
                    onClick={() => setFechar('CONCLUIR')}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Concluir atendimento
                  </Button>
                )}
                {at.status !== 'PENDENTE' && (
                  <Button variant="outline" className="h-12 sm:h-10" onClick={() => setReabrindo(true)}>
                    <RotateCcw className="h-4 w-4" /> Reabrir
                  </Button>
                )}
                {/*
                  Concluído não vira cancelado direto: é preciso reabrir antes, como na agenda.
                  Com a consulta de pé, o Cancelar mora no bloco do encaminhamento.
                */}
                {at.status === 'PENDENTE' && !consultaDePe && (
                  <Button
                    variant="outline"
                    className="h-12 text-amber-700 hover:bg-amber-50 sm:h-10 dark:text-amber-400 dark:hover:bg-amber-950/20"
                    onClick={() => setFechar('CANCELAR')}
                  >
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

      <FecharAtendimentoModal
        atendimentoId={open && fechar && at ? at.id : null}
        acao={fechar}
        onClose={() => setFechar(null)}
        onFechado={invalidar}
      />
      <ReabrirAtendimentoDialog
        alvo={open && reabrindo && at ? { id: at.id, numero: at.numero, status: at.status } : null}
        onClose={() => setReabrindo(false)}
        onReaberto={invalidar}
      />
    </>
  );
}

/**
 * ENQUANTO A CONSULTA ESTÁ DE PÉ (E2, 15/09/2026).
 *
 * Das 4 consultas concluídas até 14/09, as 4 exigiram a triagem concluir o
 * atendimento à mão depois, e o #13 esperou um dia com a triagem sem ter o que
 * fazer. Aqui a gaveta diz que o atendimento fecha sozinho e oferece só o que
 * é da triagem: resolver sem a consulta, ou cancelar.
 *
 * Com 2 dias úteis sem registro, a vez volta à triagem: o bloco fica âmbar e
 * diz com quem falar. Nenhum botão sólido "Concluir atendimento".
 */
function EsperaPelaConsulta({
  modo, encaminhamento, podeEditar, podeResolverSemConsulta, podeVerAgenda, onResolverSemConsulta, onCancelar,
}: {
  modo: 'FECHA_SOZINHO' | 'CONSULTA_SEM_REGISTRO' | 'CONCLUIR' | 'OUTRO';
  encaminhamento: Encaminhamento;
  podeEditar: boolean;
  podeResolverSemConsulta: boolean;
  podeVerAgenda: boolean;
  onResolverSemConsulta: () => void;
  onCancelar: () => void;
}) {
  const semRegistro = modo === 'CONSULTA_SEM_REGISTRO';
  const espera = textoDoFechaSozinho(encaminhamento.responsavel);
  return (
    <div
      className={cn(
        'animate-surgir space-y-2 rounded-lg border p-3 text-sm',
        semRegistro
          ? 'border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200'
          : 'bg-muted/40',
      )}
    >
      {semRegistro ? (
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{textoDaConsultaSemRegistro(encaminhamento)}</span>
        </p>
      ) : (
        <>
          <p>{espera.texto}</p>
          <p className="text-muted-foreground">{espera.apoio}</p>
        </>
      )}
      {/* Uma ação por linha a 400 px: lado a lado, um toque errado cancelava. */}
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        {podeEditar && podeResolverSemConsulta && (
          <Button variant="outline" className="h-12 bg-background sm:h-11" onClick={onResolverSemConsulta}>
            <CheckCircle2 className="h-4 w-4" /> Resolvido sem a consulta
          </Button>
        )}
        {podeEditar && (
          <Button
            variant="outline"
            className="h-12 bg-background text-amber-700 hover:bg-amber-50 sm:h-11 dark:text-amber-400 dark:hover:bg-amber-950/20"
            onClick={onCancelar}
          >
            <XCircle className="h-4 w-4" /> Cancelar atendimento
          </Button>
        )}
        {!semRegistro && podeVerAgenda && (
          <Link
            href={`/agenda?compromisso=${encaminhamento.compromissoId}`}
            className={cn(buttonVariants({ variant: 'ghost' }), 'h-12 sm:h-11')}
          >
            Abrir na agenda <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * A CONSULTA REMARCADA (E6, 15/09/2026): neutra e com o WhatsApp à mão.
 *
 * Nunca âmbar: o sistema não sabe se o filiado foi avisado, e um aviso que não
 * tem como se apagar ensina a ignorar os outros.
 */
function AvisoDaRemarcada({
  encaminhamento, filiado,
}: {
  encaminhamento: Encaminhamento;
  filiado: { nomeCompleto: string; telefonePrincipal: string | null; telefoneSecundario: string | null };
}) {
  const celular = celularParaWhatsApp(filiado.telefonePrincipal, filiado.telefoneSecundario);
  function avisar() {
    if (!celular) return;
    const texto = mensagemDaConsulta({
      nomeFiliado: filiado.nomeCompleto,
      responsavel: encaminhamento.responsavel,
      inicio: encaminhamento.inicio,
      local: encaminhamento.local,
      linkReuniao: encaminhamento.linkReuniao,
    });
    window.open(linkDoWhatsApp(celular, texto), '_blank', 'noopener,noreferrer');
  }
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <p>{textoDaRemarcada(encaminhamento)}</p>
      <Button
        className="h-12 w-full bg-[#25D366] text-white hover:bg-[#20bd5a] sm:h-11 sm:w-auto"
        disabled={!celular}
        onClick={avisar}
      >
        <WhatsAppIcon className="h-4 w-4" /> Avisar pelo WhatsApp
      </Button>
      {!celular && (
        <p className="text-xs text-muted-foreground">
          O cadastro não tem celular, nem no telefone principal nem no secundário. Avise por outro meio.
        </p>
      )}
    </div>
  );
}

/**
 * "Concluído em … por …" / "Cancelado em … por … · motivo", logo abaixo das
 * fichas. A Triagem não vê a auditoria: sem isto, semanas depois "Cancelado"
 * não explicava nada. Registro fechado antes de 14/09/2026 não tem as colunas
 * e não mostra o bloco.
 */
function BlocoDoFechamento({ at }: { at: Parameters<typeof fraseDoFechamento>[0] }) {
  const frase = fraseDoFechamento(at);
  if (!frase) return null;
  return (
    <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="font-medium">{frase.texto}</p>
      {frase.detalhe && <p className="whitespace-pre-wrap text-muted-foreground">{frase.detalhe}</p>}
    </div>
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

const ICONE_MODALIDADE: Record<ModalidadeConsulta, typeof Video> = {
  SEDE: Building2,
  VIDEO: Video,
  TELEFONE: Phone,
};

/**
 * Uma consulta nascida do atendimento: quem, quando, como, em que pé, e o link.
 *
 * O status mostrado na consulta que VALE é o estado calculado pelo servidor
 * ("ficou para trás" inclusive); as demais mostram o status cru (em geral
 * canceladas, ou substituídas por uma mais nova).
 *
 * "MUDAR COMO VAI SER" (D12, 14/09/2026). A consulta #14 dizia "chamada de
 * vídeo" na demanda e estava marcada na sede: a advogada esperaria na sede e a
 * filiada, um link. A Triagem não edita a agenda, e o "Colar o link" só aparecia
 * em consulta que já era por vídeo. Agora a modalidade é sempre escrita no
 * cartão e, para quem grava em atendimentos, trocável aqui, pela rota estreita
 * da consulta nascida deste atendimento. O link mora dentro do "Por vídeo".
 * De propósito, nada fareja a demanda atrás de "vídeo": a heurística erra, e a
 * demanda está escrita logo acima.
 */
function ConsultaDoAtendimento({
  atendimentoId, consulta: c, encaminhamento, statusAtendimento, fila, filiado, podeEditar, podeVerAgenda, onMudou,
}: {
  atendimentoId: string;
  consulta: CompromissoResumo;
  encaminhamento: Encaminhamento | null;
  statusAtendimento: StatusAtendimento;
  fila?: FilaNaResposta;
  filiado: { nomeCompleto: string; telefonePrincipal: string | null; telefoneSecundario: string | null };
  podeEditar: boolean;
  podeVerAgenda: boolean;
  onMudou: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [modalidade, setModalidade] = useState<ModalidadeConsulta | null>(modalidadeDoCartao(c.local));
  const [link, setLink] = useState(c.linkReuniao ?? '');
  /** Depois de salvar: o que foi gravado, para montar o aviso ao filiado. */
  const [avisar, setAvisar] = useState<{ local: string | null; linkReuniao: string | null } | null>(null);
  // A modalidade mora na atividade da agenda: o cartão e a gaveta dela leem as
  // chaves 'compromissos' e 'compromisso', não a do atendimento.
  const invalidarComAAgenda = useInvalidarAtendimentoEAgenda();
  const ehAVigente = encaminhamento?.compromissoId === c.id;
  const rotuloStatus = ehAVigente && encaminhamento
    ? ESTADO_ENCAMINHAMENTO[encaminhamento.estado]?.rotulo
    : STATUS_CONSULTA_LABEL[c.status] ?? c.status;
  const pedeAtencao = ehAVigente && encaminhamento && tomDoEncaminhamento(encaminhamento.estado, statusAtendimento, fila) === 'ambar';
  const aberta = c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO';
  const quem = nomeDeQuemAtende(c.responsavel);
  const localLivre = !!c.local?.trim() && modalidadeDoCartao(c.local) === null;
  const celular = celularParaWhatsApp(filiado.telefonePrincipal, filiado.telefoneSecundario);
  /*
    O botão só abre o que passa pela regra do link (https, sem usuário e senha):
    um valor gravado antes da regra não vira clique. E o que se cola é conferido
    enquanto se digita, pelo espelho da regra do servidor.
  */
  const gravado = normalizarLinkReuniao(c.linkReuniao);
  const linkValido = gravado?.ok ? gravado : null;
  const digitado = editando && modalidade === 'VIDEO' && link.trim() ? normalizarLinkReuniao(link) : null;
  const erroDoLink = digitado && !digitado.ok ? digitado.erro : null;
  const linkNovo = modalidade === 'VIDEO' ? (link.trim() || null) : null;
  const nadaMudou = modalidade === modalidadeDoCartao(c.local) && (modalidade !== 'VIDEO' || linkNovo === (c.linkReuniao ?? null));

  function abrirEdicao() {
    setModalidade(modalidadeDoCartao(c.local));
    setLink(c.linkReuniao ?? '');
    setAvisar(null);
    setEditando(true);
  }

  const salvar = useMutation({
    mutationFn: (m: ModalidadeConsulta) =>
      mudarModalidadeDaConsulta(atendimentoId, c.id, { modalidade: m, ...(m === 'VIDEO' ? { linkReuniao: linkNovo } : {}) }),
    onSuccess: (_r, m) => {
      toast.success('Modalidade salva.');
      setEditando(false);
      setAvisar({
        local: LOCAL_DA_MODALIDADE[m],
        linkReuniao: m === 'VIDEO' ? (digitado?.ok ? digitado.url : linkNovo) : null,
      });
      invalidarComAAgenda(atendimentoId);
      onMudou();
    },
    onError: (e: any) => toast.error(mensagemDaFalha(e, 'Não foi possível salvar como vai ser a consulta.')),
  });

  function avisarPeloWhatsApp() {
    if (!celular || !avisar) return;
    const texto = mensagemDaConsulta({
      nomeFiliado: filiado.nomeCompleto,
      responsavel: c.responsavel,
      inicio: c.inicio,
      local: avisar.local,
      linkReuniao: avisar.linkReuniao,
    });
    window.open(linkDoWhatsApp(celular, texto), '_blank', 'noopener,noreferrer');
  }

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
        {rotuloDoInstante(c.inicio)} · {rotuloDaModalidadeNoCartao(c.local)}
      </p>

      {c.linkReuniao && !editando && (
        <div className="flex flex-wrap gap-2">
          {linkValido ? (
            <a
              href={linkValido.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ size: 'default' }), 'h-12 w-full sm:w-auto md:h-11')}
            >
              <Video className="h-4 w-4" /> Entrar na chamada · {linkValido.provedor}
            </a>
          ) : (
            <p className="w-full text-xs text-amber-800 dark:text-amber-300">
              O link gravado não é um endereço seguro de chamada. Troque pelo link certo.
            </p>
          )}
          <Button variant="outline" className="md:h-11" onClick={copiar}>
            <Copy className="h-4 w-4" /> Copiar link
          </Button>
        </div>
      )}

      {editando ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Como vai ser a consulta?</legend>
            {localLivre && <p className="text-xs text-muted-foreground">Hoje diz: {c.local}</p>}
            <div className="grid grid-cols-3 gap-2">
              {MODALIDADES.map((m) => {
                const Icone = ICONE_MODALIDADE[m];
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={modalidade === m}
                    disabled={salvar.isPending}
                    onClick={() => setModalidade(m)}
                    className={cn(
                      'flex h-12 items-center justify-center gap-1.5 rounded-lg border px-1.5 text-sm transition-colors disabled:opacity-60',
                      modalidade === m
                        ? 'border-brand-700 bg-brand-50 font-medium text-brand-900 ring-1 ring-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-200 dark:ring-brand-400'
                        : 'border-input hover:bg-muted',
                    )}
                  >
                    <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{MODALIDADE_LABEL[m]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {modalidade === 'VIDEO' && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor={`link-${c.id}`}>
                <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Link da chamada <span className="font-normal text-muted-foreground">(cole agora ou depois)</span>
              </label>
              <Input
                id={`link-${c.id}`}
                inputMode="url"
                maxLength={2000}
                value={link}
                disabled={salvar.isPending}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Cole o link ou o convite da chamada"
                aria-invalid={!!erroDoLink}
              />
              {(erroDoLink || digitado?.ok) && (
                <p className={cn('break-all text-xs', erroDoLink ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}>
                  {erroDoLink ?? (digitado?.ok ? `${digitado.provedor}: ${digitado.url}` : '')}
                </p>
              )}
            </div>
          )}

          {modalidadeRemota(modalidade) && (
            <p className="text-xs text-muted-foreground">
              Combine o horário com o {V.filiado}. Se precisar mudar o dia, peça a remarcação a quem cuida da agenda.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="md:h-11" onClick={() => setEditando(false)} disabled={salvar.isPending}>
              Cancelar
            </Button>
            <Button
              className="md:h-11"
              onClick={() => modalidade && salvar.mutate(modalidade)}
              disabled={salvar.isPending || !modalidade || nadaMudou || !!erroDoLink}
            >
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {avisar && aberta && (
            <div className="w-full space-y-1">
              <Button
                className="h-12 w-full bg-[#25D366] text-white hover:bg-[#20bd5a] sm:w-auto md:h-11"
                disabled={!celular}
                onClick={avisarPeloWhatsApp}
              >
                <WhatsAppIcon className="h-4 w-4" /> Avisar pelo WhatsApp
              </Button>
              {!celular && (
                <p className="text-xs text-muted-foreground">
                  O cadastro não tem celular, nem no telefone principal nem no secundário. Avise por outro meio.
                </p>
              )}
            </div>
          )}
          {podeEditar && aberta && (
            <Button variant="outline" className="md:h-11" onClick={abrirEdicao}>
              <Pencil className="h-4 w-4" /> Mudar como vai ser
            </Button>
          )}
          {podeVerAgenda && (
            <Link
              href={`/agenda?compromisso=${c.id}`}
              className={cn(buttonVariants({ variant: 'ghost' }), 'md:h-11')}
            >
              Abrir na agenda <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
