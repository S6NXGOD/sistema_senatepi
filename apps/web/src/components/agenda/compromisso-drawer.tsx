'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, Pencil, Trash2, Clock, MapPin, Timer, User, Phone, Mail,
  GraduationCap, Gavel, UserCog, FileSearch, CalendarClock, ExternalLink, Users,
  Ban, CheckCircle2, Play, RotateCcw, PenLine,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import { AnexosSection } from '@/components/anexos/anexos-section';
import { cn, mascararCpf } from '@/lib/utils';
import { MotivoUrgencia, SeloUrgente } from '@/components/ui/selo-urgente';
import {
  getCompromisso, formatData, formatHora, formatDataHora, estaAtrasado, cronometroHMS,
  Compromisso, StatusCompromisso, rotuloTipo, corDeTipo, STATUS_LABEL, STATUS_COR,
  DESFECHO_LABEL, corDesfecho,
  rotuloDesfecho, CATEGORIA_CANCELAMENTO_LABEL,
} from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { CANAL_LABEL, linkWhatsApp, mensagemSaudacao, type CanalAtendimento } from '@/lib/atendimentos';
import { listarPlantao, estaNoHorario, nomeDeExibicao } from '@/lib/escalas';
import { PolosDoProcesso } from '@/components/agenda/polos-do-processo';
import { formatNPU, ehPreProcessual } from '@/lib/processos';
import { SeloPreProcessual } from '@/components/ui/selo-pre-processual';
import { HistoricoAtividade } from './historico-atividade';
import { V } from '@/lib/vocabulario';

/** Cronômetro ao vivo HH:MM:SS. */
function Cronometro({ desde }: { desde: string }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
      <Timer className="h-4 w-4 animate-pulse" /> {cronometroHMS(desde, agora)}
    </span>
  );
}

function Avatar({ nome, url }: { nome: string; url?: string | null }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full border object-cover" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-400 text-xs font-bold text-brand-900">
      {nome.charAt(0).toUpperCase()}
    </span>
  );
}

const soData = (iso: string) => iso.slice(0, 10);

export function CompromissoDrawer({
  compromissoId, open, onClose, onEditar, onExcluir, onVerTriagem, podeExcluir,
  onConcluir, onCancelar, onRemarcar, onAcao,
}: {
  compromissoId: string | null;
  open: boolean;
  onClose: () => void;
  onEditar: (c: Compromisso) => void;
  onExcluir?: (c: Compromisso) => void;
  onVerTriagem?: (atendimentoId: string) => void;
  podeExcluir?: boolean;
  onConcluir?: (c: Compromisso) => void;
  onCancelar?: (c: Compromisso) => void;
  onRemarcar?: (c: Compromisso) => void;
  onAcao?: (id: string, status: StatusCompromisso) => void;
}) {
  const { tipos } = useTiposEvento();
  const { data: c, isLoading } = useQuery({
    queryKey: ['compromisso', compromissoId],
    queryFn: () => getCompromisso(compromissoId!),
    enabled: open && !!compromissoId,
  });

  // Plantão do dia do compromisso (reaproveita a escala).
  const dataPlantao = c ? soData(c.inicio) : undefined;
  const { data: plantao = [] } = useQuery({
    queryKey: ['plantao', dataPlantao],
    queryFn: () => listarPlantao(dataPlantao),
    enabled: open && !!dataPlantao,
  });
  const hoje = new Date().toISOString().slice(0, 10);

  const filiado = c?.filiado;
  const atrasado = c ? estaAtrasado(c) : false;

  function abrirWhatsApp() {
    if (!filiado || !c) return;
    if (!filiado.telefonePrincipal) return toast.error(`${V.Filiado} sem telefone cadastrado.`);
    const url = linkWhatsApp(filiado.telefonePrincipal, mensagemSaudacao({ nome: filiado.nomeCompleto, data: c.inicio }));
    if (!url) return toast.error('Telefone inválido para WhatsApp.');
    window.open(url, '_blank');
  }

  const Bloco = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      {children}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-lg">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-2 border-b p-5">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {c && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', corDeTipo(c.tipo, tipos).badge)}>{rotuloTipo(c.tipo, tipos)}</span>}
            {c && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_COR[c.status])}>{STATUS_LABEL[c.status]}</span>}
            {c?.urgente && <SeloUrgente motivo={c.urgenteMotivo} desde={c.urgenteEm} />}
          </div>
          <h3 className="truncate text-lg font-bold">{c?.titulo ?? 'Carregando…'}</h3>
          {/* O selo diz QUE é urgente; aqui cabe o PORQUÊ por extenso — e é
              nesta tela que a decisão de "isto ainda é urgente?" é tomada. */}
          {c?.urgente && (
            <MotivoUrgencia motivo={c.urgenteMotivo} desde={c.urgenteEm} className="mt-2" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {c && (
            <button type="button" onClick={() => { onEditar(c); }} title="Editar" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {c && podeExcluir && onExcluir && (
            <button type="button" onClick={() => onExcluir(c)} title="Excluir" className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onClose} title="Fechar" className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {isLoading || !c ? (
        <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" /></div>
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Quando / onde */}
          <div className="space-y-1.5">
            <p className={cn('flex items-center gap-2 text-sm', atrasado && 'font-medium text-red-600 dark:text-red-400')}>
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
              {formatData(c.inicio)} · {formatHora(c.inicio)}{c.fim ? ` – ${formatHora(c.fim)}` : ''}
              {atrasado && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Atrasada</span>}
            </p>
            {c.local && <p className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 shrink-0 text-muted-foreground" /> {c.local}</p>}
            {c.status === 'EM_ANDAMENTO' && c.iniciadoEm && (
              <p className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Em andamento há</span> <Cronometro desde={c.iniciadoEm} /></p>
            )}
            {c.dataOriginal && (
              <p className="flex flex-wrap items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <CalendarClock className="h-3.5 w-3.5" />
                Remarcado {c.remarcacoes > 1 ? `${c.remarcacoes}×` : ''} · original: {formatDataHora(c.dataOriginal)}
                {c.remarcadoMotivo && <span className="font-normal">— {c.remarcadoMotivo}</span>}
              </p>
            )}
          </div>

          {/* Como terminou */}
          {c.status === 'CONCLUIDO' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/10">
              <p className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Desfecho</span>
                {c.desfecho ? (
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', corDesfecho(c.desfecho))}>
                    {rotuloDesfecho(c.desfecho)}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    não informado
                  </span>
                )}
                {c.concluidoEm && (
                  <span className="text-xs text-muted-foreground">· {formatDataHora(c.concluidoEm)}</span>
                )}
              </p>
              {c.desfechoObs ? (
                <p className="whitespace-pre-wrap text-sm">{c.desfechoObs}</p>
              ) : !c.desfecho ? (
                <p className="text-xs text-muted-foreground">
                  Concluída antes do registro de desfecho passar a ser exigido.
                </p>
              ) : null}
            </div>
          )}

          {c.status === 'CANCELADO' && (
            <div className="rounded-xl border border-red-200 bg-red-50/40 p-3 dark:border-red-900/40 dark:bg-red-950/10">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Ban className="h-3.5 w-3.5" /> Cancelada
                {c.canceladoEm && <span className="font-normal normal-case">· {formatDataHora(c.canceladoEm)}</span>}
              </p>
              {c.canceladoCategoria ? (
                <p className="text-sm font-semibold">
                  {CATEGORIA_CANCELAMENTO_LABEL[c.canceladoCategoria] ?? c.canceladoCategoria}
                </p>
              ) : null}
              {/* O texto é complemento: só aparece quando alguém escreveu algo.
                  Sem categoria E sem texto = cancelamento anterior a esta regra. */}
              {c.canceladoMotivo ? (
                <p className="whitespace-pre-wrap text-sm">{c.canceladoMotivo}</p>
              ) : !c.canceladoCategoria ? (
                <p className="text-sm text-muted-foreground">Motivo não registrado (cancelamento antigo).</p>
              ) : null}
            </div>
          )}

          {/* Ações — mesmo fluxo do card, com espaço para rótulos completos */}
          {(onConcluir || onCancelar || onRemarcar || onAcao) && (
            <div className="flex flex-wrap gap-2">
              {c.status === 'PENDENTE' && onAcao && (
                <Button size="sm" onClick={() => onAcao(c.id, 'EM_ANDAMENTO')}>
                  <Play className="h-4 w-4" /> Iniciar
                </Button>
              )}
              {(c.status === 'PENDENTE' || c.status === 'EM_ANDAMENTO') && (
                <>
                  {onConcluir && (
                    <Button
                      size="sm"
                      variant={c.status === 'EM_ANDAMENTO' ? 'default' : 'outline'}
                      onClick={() => onConcluir(c)}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Concluir
                    </Button>
                  )}
                  {onRemarcar && (
                    <Button size="sm" variant="outline" onClick={() => onRemarcar(c)}>
                      <CalendarClock className="h-4 w-4" /> Remarcar
                    </Button>
                  )}
                  {onCancelar && (
                    <Button size="sm" variant="outline" onClick={() => onCancelar(c)}>
                      <Ban className="h-4 w-4" /> Cancelar
                    </Button>
                  )}
                </>
              )}
              {(c.status === 'CONCLUIDO' || c.status === 'CANCELADO') && onAcao && (
                <Button size="sm" variant="outline" onClick={() => onAcao(c.id, 'PENDENTE')}>
                  <RotateCcw className="h-4 w-4" /> Reabrir
                </Button>
              )}
            </div>
          )}

          {/* Filiado */}
          {filiado && (
            <div className="rounded-xl border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold"><User className="h-4 w-4 text-brand-800 dark:text-brand-400" /> {V.Filiado}</p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Matrícula {filiado.matricula}</span>
              </div>
              <p className="text-sm font-medium">{filiado.nomeCompleto}</p>
              <div className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                {filiado.cpf && <p className="flex items-center gap-2"><User className="h-3.5 w-3.5" /> {mascararCpf(filiado.cpf)}</p>}
                <p className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {filiado.telefonePrincipal || 'sem telefone'}</p>
                {filiado.email && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {filiado.email}</p>}
                {filiado.formacao && <p className="flex items-center gap-2"><GraduationCap className="h-3.5 w-3.5" /> {filiado.formacao}</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#20bd5a]" onClick={abrirWhatsApp}>
                  <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                </Button>
                <Link href={`/filiados/${filiado.id}`}>
                  <Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> Ver cadastro</Button>
                </Link>
              </div>
            </div>
          )}

          {/* Responsável + criação/triagem */}
          <div className="grid grid-cols-1 gap-3">
            <Bloco titulo="Advogado(a) responsável">
              <div className="flex items-center gap-2">
                <Avatar nome={c.responsavel.nomeExibicao || c.responsavel.nome} url={c.responsavel.avatarUrl} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.responsavel.nomeExibicao || c.responsavel.nome}</p>
                  {c.responsavel.role && <p className="text-xs text-muted-foreground">{c.responsavel.role}</p>}
                </div>
              </div>
            </Bloco>

            {/*
              A EQUIPE, quando há mais de uma pessoa.

              Bloco separado do responsável de propósito: a gaveta é onde alguém
              vai descobrir "com quem falo sobre isto", e misturar as duas
              coisas apagaria justamente a distinção entre quem responde e quem
              acompanha.
            */}
            {(c.equipe ?? []).filter((e) => !e.principal).length > 0 && (
              <Bloco titulo="Também atuam">
                <ul className="space-y-2">
                  {(c.equipe ?? [])
                    .filter((e) => !e.principal)
                    .map((e) => (
                      <li key={e.usuario.id} className="flex items-center gap-2">
                        <Avatar
                          nome={e.usuario.nomeExibicao || e.usuario.nome}
                          url={e.usuario.avatarUrl}
                        />
                        <p className="truncate text-sm">
                          {e.usuario.nomeExibicao || e.usuario.nome}
                        </p>
                      </li>
                    ))}
                </ul>
              </Bloco>
            )}

            {/* QUEM REGISTROU A DEMANDA — com foto. Aparece sempre que houver
                criador, inclusive quando o evento veio de uma triagem: são
                perguntas diferentes ("quem atendeu" × "quem lançou na agenda"). */}
            {c.criador ? (
              <Bloco titulo="Registrado por">
                <div className="flex items-center gap-2">
                  <Avatar nome={c.criador.nomeExibicao || c.criador.nome} url={c.criador.avatarUrl} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {c.criador.nomeExibicao || c.criador.nome}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <PenLine className="h-3 w-3" /> {formatDataHora(c.createdAt)}
                    </p>
                  </div>
                </div>
              </Bloco>
            ) : c.origemAutomatica ? (
              <Bloco titulo="Registrado por">
                <p className="text-sm text-muted-foreground">Robô de prazos (DataJud)</p>
              </Bloco>
            ) : c.criadoPorNome ? (
              <Bloco titulo="Registrado por">
                <p className="text-sm">{c.criadoPorNome}</p>
              </Bloco>
            ) : null}

            {c.atendimento && (
              <Bloco titulo="Triagem de origem">
                <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900/40 dark:bg-sky-950/10">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="font-medium text-muted-foreground">#{c.atendimento.numero}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{CANAL_LABEL[c.atendimento.canal as CanalAtendimento] ?? c.atendimento.canal}</span>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserCog className="h-3.5 w-3.5" /> Triagem por <strong className="text-foreground">{c.atendimento.atendente.nomeExibicao || c.atendimento.atendente.nome}</strong> · {formatDataHora(c.atendimento.createdAt)}
                  </p>
                  {onVerTriagem && (
                    <button type="button" onClick={() => onVerTriagem(c.atendimento!.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline dark:text-brand-400">
                      <FileSearch className="h-3.5 w-3.5" /> Abrir triagem completa
                    </button>
                  )}
                </div>
              </Bloco>
            )}

            {c.processo && (
              <Bloco titulo="Processo vinculado">
                {/* `?processo=<id>` abre a FICHA daquele processo, não a lista.
                    Antes o link levava a `/processos` puro: quem clicava caía
                    na lista inteira e tinha de procurar o processo na mão —
                    justamente o que o link deveria evitar. A página consome o
                    parâmetro e o remove da URL ao abrir a ficha. */}
                <Link
                  href={`/processos?processo=${c.processo.id}`}
                  className="flex items-center gap-1.5 text-sm text-brand-800 hover:underline dark:text-brand-400"
                >
                  <Gavel className="h-3.5 w-3.5" />
                  {/* Pré-processual ainda não tem NPU — mostra o rótulo do caso. */}
                  {c.processo.numeroCNJ ? formatNPU(c.processo.numeroCNJ) : (c.processo.titulo || 'Caso sem título')}
                  {c.processo.classeProcessual ? ` · ${c.processo.classeProcessual}` : ''}
                </Link>
                {ehPreProcessual(c.processo.statusInterno) && (
                  <SeloPreProcessual className="mt-1" />
                )}

                {/*
                  OS POLOS, inteiros — a pergunta que traz alguém a este bloco.
                  O cartão da lista mostra "Autor × Réu" resumido porque tem uma
                  linha; aqui há espaço para todas as partes, e é o que evita a
                  viagem até a ficha do processo só para ver contra quem se
                  litiga.
                */}
                <PolosDoProcesso partes={c.processo.partes} className="mt-2.5" />
              </Bloco>
            )}
          </div>

          {/* Descrição / observações */}
          {(c.descricao || c.observacoesInternas) && (
            <div className="space-y-3">
              {c.descricao && (
                <Bloco titulo="Descrição">
                  <p className="whitespace-pre-wrap text-sm">{c.descricao}</p>
                </Bloco>
              )}
              {c.observacoesInternas && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Observações internas</p>
                  <p className="whitespace-pre-wrap text-sm">{c.observacoesInternas}</p>
                </div>
              )}
            </div>
          )}

          {/* Linha do tempo: quem mexeu na atividade e o que fez. */}
          <HistoricoAtividade compromissoId={c.id} />

          {/* Plantão do dia */}
          <Bloco titulo={`Plantão do dia · ${formatData(c.inicio)}`}>
            {plantao.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguém de plantão nesta data.</p>
            ) : (
              <ul className="space-y-1.5">
                {plantao.map((p) => {
                  const noHorario = dataPlantao === hoje && estaNoHorario(p);
                  return (
                    <li key={p.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
                      <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {/*
                        NOME INTEIRO, com o tratamento. A linha tem ~300px e o
                        `truncate` cuida do excesso — encurtar aqui era o que
                        transformava o plantão numa lista de "Dr." e "Dra.".
                      */}
                      <span className="min-w-0 flex-1 truncate text-sm">{nomeDeExibicao(p.advogado)}</span>
                      <span className="text-xs text-muted-foreground">{p.horaInicio}–{p.horaFim}</span>
                      {noHorario && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">no horário</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Bloco>

          {/* Documentos da atividade.
              Os anexos da triagem/processo de origem aparecem HERDADOS, em bloco
              separado: o que foi puxado lá não precisa ser puxado de novo aqui. */}
          <AnexosSection
            compromissoId={c.id}
            filiadoId={c.filiado?.id}
            titulo="Documentos da atividade"
            heranca={
              c.atendimento
                ? {
                    atendimentoId: c.atendimento.id,
                    rotulo: `Documentos da triagem #${c.atendimento.numero}`,
                  }
                : c.processo
                  ? { processoId: c.processo.id, rotulo: 'Documentos do processo' }
                  : undefined
            }
          />
        </div>
      )}
    </Sheet>
  );
}
