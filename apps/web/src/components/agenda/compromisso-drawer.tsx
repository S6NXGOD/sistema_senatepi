'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, Pencil, Trash2, Clock, MapPin, Timer, User, Phone, Mail,
  GraduationCap, Gavel, UserCog, FileSearch, CalendarClock, ExternalLink, Users,
  Ban, Bot, CheckCircle2, Play, RotateCcw, PenLine, Newspaper, HandHelping, UserMinus, AlertTriangle,
  Video, Copy, Paperclip,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Carregando, EsqueletoLinhas } from '@/components/ui/esqueleto';
import { abrirChamada, normalizarLinkReuniao } from '@/lib/link-reuniao';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { Button } from '@/components/ui/button';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import { AnexosSection } from '@/components/anexos/anexos-section';
import { cn, mascararCpf } from '@/lib/utils';
import { MotivoUrgencia, SeloUrgente } from '@/components/ui/selo-urgente';
import {
  getCompromisso, atualizarCompromisso, ehReserva, estaFechado,
  formatData, formatHora, formatDataHora, estaAtrasado, duracaoEntre,
  Compromisso, StatusCompromisso, rotuloTipo, corDeTipo, STATUS_LABEL, STATUS_COR,
  DESFECHO_LABEL, corDesfecho,
  rotuloDesfecho, CATEGORIA_CANCELAMENTO_LABEL, diaBRDe, acaoPrincipalDoCartao,
} from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { useAuth } from '@/lib/auth';
import { podeEditar, podeVer } from '@/lib/permissoes';
import { definirAdvogadosDoProcesso, listarAdvogadosDoProcesso } from '@/lib/partes';
import {
  CANAL_LABEL, fraseDaTriagemNaConsulta, linkWhatsApp, mensagemSaudacao, rotuloDoAssunto, type CanalAtendimento,
} from '@/lib/atendimentos';
import { listarPlantao, estaNoHorario, nomeDeExibicao } from '@/lib/escalas';
import { PolosDoProcesso } from '@/components/agenda/polos-do-processo';
import { formatNPU, ehPreProcessual } from '@/lib/processos';
import { SeloPreProcessual } from '@/components/ui/selo-pre-processual';
import { Cronometro } from '@/components/agenda/cronometro';
import { PassosDaTarefa } from '@/components/agenda/passos-da-tarefa';
import { HistoricoAtividade } from './historico-atividade';
import { agruparPublicacoes } from '@/lib/publicacoes-irmas';
import { PublicacaoDjenCard } from '@/components/processos/publicacao-djen-card';
import { V } from '@/lib/vocabulario';

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

/** Demanda maior que isto começa recolhida em três linhas, com "Ver tudo". */
const DEMANDA_CURTA = 220;

/** "Sem entrar no sistema há 39 dias." — a mesma régua da faixa de avisos e do painel. */
function textoDaAusencia(a: { diasSemEntrar: number | null; inativo: boolean }): string {
  if (a.inativo) return 'Não está mais no sistema.';
  if (a.diasSemEntrar === null) return 'Nunca entrou no sistema.';
  return `Sem entrar no sistema há ${a.diasSemEntrar} dias.`;
}

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
  const { user } = useAuth();
  const { data: c, isLoading, isError } = useQuery({
    queryKey: ['compromisso', compromissoId],
    queryFn: () => getCompromisso(compromissoId!),
    enabled: open && !!compromissoId,
  });

  /** Agenda EDITAR: sem ela a gaveta é só leitura (a API recusaria cada botão). */
  const podeEditarAgenda = podeEditar(user?.role, user?.permissoes, 'agenda');

  /*
    PLANTÃO DO DIA — o dia de TERESINA, e só para quem vê a escala.

    Cortar o ISO em UTC trocava o dia depois das 21h: a atividade das 21h30
    buscava o plantão de amanhã, e o "no horário" sumia à noite. E quem não tem
    o módulo de escalas levava 403, que a tela mostrava como "ninguém de
    plantão" — uma afirmação falsa.
  */
  const verEscalas = podeVer(user?.role, user?.permissoes, 'escalas');
  const dataPlantao = c ? diaBRDe(c.inicio) : undefined;
  const plantaoQ = useQuery({
    queryKey: ['plantao', dataPlantao],
    queryFn: () => listarPlantao(dataPlantao),
    enabled: open && !!dataPlantao && verEscalas,
    retry: false,
  });
  const plantao = plantaoQ.data ?? [];
  const hoje = diaBRDe(Date.now());

  /** A demanda da triagem começa recolhida a cada atividade aberta. */
  const [demandaInteira, setDemandaInteira] = useState(false);
  useEffect(() => setDemandaInteira(false), [compromissoId]);

  /*
    ASSUMIR — o que a reserva existe para permitir.

    O robô põe os advogados do caso como reserva justamente para o dia em que o
    responsável está em audiência. Sem um botão, "assumir" seria: abrir a
    edição, achar o campo de responsável, trocar, salvar — quatro passos para
    uma decisão de um segundo. A rota é a mesma da edição, então o histórico
    registra "Responsável alterado" com nome e hora, como sempre registrou.
  */
  const qc = useQueryClient();
  const assumir = useMutation({
    mutationFn: (id: string) => atualizarCompromisso(id, { responsavelId: user!.id }),
    onSuccess: () => {
      toast.success('Atividade assumida — agora ela é sua.');
      // As chaves "agenda-alertas" e "dashboard" saíram em 14/09/2026 junto com
      // GET /compromissos/alertas: nenhuma consulta as declarava, invalidar não fazia nada.
      for (const k of [['compromissos'], ['compromisso'], ['minhas-pendencias'], ['dashboard-resumo']]) {
        qc.invalidateQueries({ queryKey: k });
      }
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível assumir a atividade.'),
  });

  /*
    "NÃO ATUA MAIS NESTE PROCESSO?" — a frase que eu tinha escrito numa
    explicação ("tire-a da equipe na ficha: ela sai das tarefas e o robô não a
    recoloca") e que ninguém entendeu virou um botão, no lugar em que a dúvida
    aparece.

    Tira a pessoa da EQUIPE DO PROCESSO, e não só desta tarefa: o banco a remove
    das tarefas abertas do robô naquele processo, e a lápide impede a varredura
    do Diário de colocá-la de volta amanhã. O responsável pelo processo não sai
    por aqui — trocar o dono do caso é decisão da ficha, com a lista inteira à
    vista.
  */
  const podeCuidarDaEquipe = podeEditar(user?.role, user?.permissoes, 'processos');
  const [tirando, setTirando] = useState<string | null>(null);
  const tirarDaEquipe = useMutation({
    mutationFn: async ({ processoId, advogadoId }: { processoId: string; advogadoId: string }) => {
      const atuais = await listarAdvogadosDoProcesso(processoId);
      const alvo = atuais.find((a) => a.advogado.id === advogadoId);
      if (!alvo) return;
      if (alvo.principal) {
        throw new Error('É o responsável pelo processo. Troque o responsável na ficha do processo antes.');
      }
      await definirAdvogadosDoProcesso(
        processoId,
        atuais.map((a) => a.advogado.id).filter((id) => id !== advogadoId),
        atuais.find((a) => a.principal)?.advogado.id,
      );
    },
    onSuccess: () => {
      toast.success('Saiu da equipe do processo — e das tarefas abertas dele.');
      setTirando(null);
      for (const k of [['compromissos'], ['compromisso'], ['minhas-pendencias'], ['dashboard-resumo']]) {
        qc.invalidateQueries({ queryKey: k });
      }
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? e?.message ?? 'Não foi possível tirar da equipe.'),
  });

  const filiado = c?.filiado;
  const atrasado = c ? estaAtrasado(c) : false;

  /** Só vira botão o link que passa pela mesma regra do servidor. */
  const linkAvaliado = c?.linkReuniao ? normalizarLinkReuniao(c.linkReuniao) : null;
  const linkDaChamada = linkAvaliado?.ok ? linkAvaliado : null;

  async function copiarLink() {
    if (!linkDaChamada) return;
    try {
      await navigator.clipboard.writeText(linkDaChamada.url);
      toast.success('Link da chamada copiado.');
    } catch {
      toast.error(`Não deu para copiar. O link é: ${linkDaChamada.url}`);
    }
  }

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
          <h3 className="truncate text-lg font-bold">{c?.titulo ?? (isError ? 'Atividade' : 'Carregando…')}</h3>
          {/* O selo diz QUE é urgente; aqui cabe o PORQUÊ por extenso — e é
              nesta tela que a decisão de "isto ainda é urgente?" é tomada. */}
          {c?.urgente && (
            <MotivoUrgencia motivo={c.urgenteMotivo} desde={c.urgenteEm} className="mt-2" />
          )}
        </div>
        {/* Editar e excluir moram aqui — no cartão, no celular, não cabiam no dedo. */}
        <div className="-mr-2 flex shrink-0 items-center">
          {c && podeEditarAgenda && (
            <button type="button" onClick={() => { onEditar(c); }} title="Editar" aria-label="Editar" className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:h-9 sm:w-9">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {c && podeExcluir && onExcluir && (
            <button type="button" onClick={() => onExcluir(c)} title="Excluir" aria-label="Excluir" className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 sm:h-9 sm:w-9">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button type="button" onClick={onClose} title="Fechar" aria-label="Fechar" className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:h-9 sm:w-9">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {isError && !c ? (
        <div role="alert" className="flex-1 p-5 text-sm">
          Não deu para abrir esta atividade. Ela pode ter sido excluída, ou a conexão caiu — feche e tente de novo.
        </div>
      ) : isLoading || !c ? (
        <Carregando texto="Abrindo a atividade…" className="flex-1 p-5">
          <EsqueletoLinhas quantidade={6} />
        </Carregando>
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Quando / onde */}
          <div className="space-y-1.5">
            {/* Ficou para trás é âmbar, como no painel e na faixa — nunca vermelho. */}
            <p className={cn('flex flex-wrap items-center gap-2 text-sm', atrasado && 'font-medium text-amber-700 dark:text-amber-400')}>
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
              {formatData(c.inicio)} · {formatHora(c.inicio)}{c.fim ? ` – ${formatHora(c.fim)}` : ''}
              {atrasado && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  Ficou para trás
                </span>
              )}
            </p>
            {c.local && <p className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 shrink-0 text-muted-foreground" /> {c.local}</p>}
            {/*
              A CHAMADA, A UM TOQUE — botão grande porque é a ação do momento:
              quem abre a gaveta de uma consulta por vídeo às 10h está atrasado
              para entrar nela. "Copiar" é para mandar ao filiado.
            */}
            {linkDaChamada && (
              estaFechado(c.status) ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Video className="h-4 w-4 shrink-0" /> Chamada por {linkDaChamada.provedor}
                </p>
              ) : (
                <div className="flex gap-2 pt-1">
                  <Button className="h-12 min-w-0 flex-1 md:h-11" onClick={() => abrirChamada(c.linkReuniao)}>
                    <Video className="h-4 w-4 shrink-0" />
                    <span className="truncate">Entrar na chamada · {linkDaChamada.provedor}</span>
                  </Button>
                  <Button variant="outline" className="h-12 md:h-11" onClick={copiarLink} aria-label="Copiar o link da chamada">
                    <Copy className="h-4 w-4" /> Copiar
                  </Button>
                </div>
              )
            )}
            {c.status === 'EM_ANDAMENTO' && c.iniciadoEm && (
              <p className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Em andamento há</span> <Cronometro desde={c.iniciadoEm} fimPrevisto={c.fim} tipo={c.origemAutomatica ? null : c.tipo} tamanho="md" /></p>
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
              {/*
                POR QUEM — a metade que faltava do registro.

                "Peça protocolada às 16:52" sem autor é um fato sem responsável:
                dá para saber O QUE foi feito e não POR QUEM. Numa atividade
                jurídica isso é o que separa histórico de boato.

                Quando foi o robô (a tarefa de cadastro que fecha sozinha ao o
                processo entrar no acervo), a linha DIZ que foi o sistema em vez
                de ficar em branco — ausência de nome se lê como dado perdido.
              */}
              <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {c.concluidoPorUsuario ? (
                  <>
                    <AvatarPessoa
                      nome={c.concluidoPorUsuario.nomeExibicao || c.concluidoPorUsuario.nome}
                      url={c.concluidoPorUsuario.avatarUrl}
                      tamanho="xs"
                    />
                    <span>
                      por{' '}
                      <strong className="font-semibold text-foreground">
                        {c.concluidoPorUsuario.nomeExibicao || c.concluidoPorUsuario.nome}
                      </strong>
                    </span>
                  </>
                ) : (
                  <>
                    <Bot className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span>concluída pelo sistema</span>
                  </>
                )}
              </p>
              {/*
                QUANTO LEVOU, com os dois extremos à vista.

                Na gaveta cabe mais do que no card: além da duração, os horários
                de início e fim reais — que é o que permite conferir o número em
                vez de acreditar nele. Só aparece quando a atividade foi
                cronometrada de ponta a ponta; ver `duracaoEntre`.
              */}
              {duracaoEntre(c.iniciadoEm, c.concluidoEm) && (
                <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Timer className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Levou <strong className="font-semibold text-foreground">
                      {duracaoEntre(c.iniciadoEm, c.concluidoEm)}
                    </strong>
                  </span>
                  <span className="text-muted-foreground/80">
                    ({formatHora(c.iniciadoEm!)} → {formatHora(c.concluidoEm!)})
                  </span>
                </p>
              )}
              {c.desfechoObs ? (
                <p className="whitespace-pre-wrap text-sm">{c.desfechoObs}</p>
              ) : !c.desfecho ? (
                <p className="text-xs text-muted-foreground">
                  Concluída antes do registro de desfecho passar a ser exigido.
                </p>
              ) : null}
            </div>
          )}

          {/*
            O QUE FAZER VEM ANTES DO TEOR — e a ordem estava invertida.

            A gaveta abria com a parede de texto do tribunal (o maior acórdão do
            acervo tem 22 mil caracteres) e só no rodapé, depois de responsável,
            registrado por e processo vinculado, dizia o que a atividade é. O
            advogado lia a prova antes de saber a pergunta.

            Agora: o que se espera, qual é o processo, e SÓ ENTÃO o teor.
          */}
          {c.origemAutomatica && (
            <PassosDaTarefa providencia={c.origemComunicacoes?.[0]?.providencia ?? null} />
          )}

          {/*
            "TEM ANEXO?" — respondido no topo, e a um toque de distância.

            Os documentos moram no rodapé da gaveta, depois de tudo. Para saber
            se existem era preciso rolar a gaveta inteira — e no celular, na
            hora da chamada, ninguém rola. Esta linha diz QUANTOS e leva até
            lá; a lista continua onde estava, porque é lá que se baixa e se
            envia. Um número só, sem lista duplicada.
          */}
          {!!c._count?.anexos && (
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(`anexos-${c.id}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className="flex w-full items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2.5 text-left transition hover:bg-brand-100/60 dark:border-brand-900/50 dark:bg-brand-950/20 dark:hover:bg-brand-950/40"
            >
              <Paperclip className="h-4 w-4 shrink-0 text-brand-800 dark:text-brand-300" />
              <span className="min-w-0 flex-1 text-sm font-medium">
                {c._count.anexos === 1
                  ? '1 documento anexado'
                  : `${c._count.anexos} documentos anexados`}
              </span>
              <span className="shrink-0 text-xs font-medium text-brand-800 dark:text-brand-300">
                ver
              </span>
            </button>
          )}

          {/*
            O QUE O FILIADO PEDIU SUBIU — 21/09/2026.

            "Para ao clicar na atividade para detalhar, ele já veja o mais
            importante primeiro e que não seja obrigado a rolar até embaixo."

            O bloco da triagem estava ABAIXO de responsável, também atuam e
            registrado por — três blocos de metadado na frente da única coisa
            que responde "do que se trata". Ele não foi copiado para cá: foi
            MOVIDO, porque a mesma informação em dois lugares da mesma gaveta é
            o defeito que a faixa e o painel já custaram a corrigir.
          */}
            {c.atendimento && (
            <Bloco titulo="Triagem de origem">
              <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900/40 dark:bg-sky-950/10">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="font-medium text-muted-foreground">#{c.atendimento.numero}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{CANAL_LABEL[c.atendimento.canal as CanalAtendimento] ?? c.atendimento.canal}</span>
                  {rotuloDoAssunto(c.atendimento.assunto, c.atendimento.assuntoOutro) && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                      {rotuloDoAssunto(c.atendimento.assunto, c.atendimento.assuntoOutro)}
                    </span>
                  )}
                </div>
                {/*
                  O QUE O FILIADO PEDIU — a razão de a consulta existir. A API
                  sempre mandou e a gaveta não mostrava: o advogado precisava
                  abrir a triagem inteira, e no celular, na hora da chamada, é
                  exatamente o que não se faz.
                */}
                {c.atendimento.descricao && (
                  <div className="mt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      O que foi pedido
                    </p>
                    <p className={cn('mt-0.5 whitespace-pre-wrap text-sm', !demandaInteira && 'line-clamp-3')}>
                      {c.atendimento.descricao}
                    </p>
                    {(c.atendimento.descricao.length > DEMANDA_CURTA || c.atendimento.descricao.split('\n').length > 3) && (
                      <button
                        type="button"
                        onClick={() => setDemandaInteira((v) => !v)}
                        aria-expanded={demandaInteira}
                        className="mt-0.5 min-h-9 text-xs font-medium text-brand-800 hover:underline dark:text-brand-400"
                      >
                        {demandaInteira ? 'Mostrar menos' : 'Ver tudo'}
                      </button>
                    )}
                  </div>
                )}
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserCog className="h-3.5 w-3.5" /> Triagem por <strong className="text-foreground">{c.atendimento.atendente.nomeExibicao || c.atendimento.atendente.nome}</strong> · {formatDataHora(c.atendimento.createdAt)}
                </p>
                {/*
                  O QUE REGISTRAR ESTA CONSULTA FAZ COM O ATENDIMENTO (E5, 15/09/2026).
                  O advogado é avisado no próprio lugar: antes, que fecha junto;
                  depois, que fechou; cancelada, que voltou para a triagem.
                */}
                {fraseDaTriagemNaConsulta(c) && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-foreground/80">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>{fraseDaTriagemNaConsulta(c)}</span>
                  </p>
                )}
                {/*
                  OS ARQUIVOS DA TRIAGEM, ANUNCIADOS AQUI (24/09/2026).

                  "A atividade inclusive tinha 17 anexos, mas não tá avisando no
                  card." Medido: a consulta tinha ZERO anexos próprios — os 17
                  estavam no ATENDIMENTO que a originou. A gaveta contava certo
                  e informava nada: o advogado abria a consulta sem saber que
                  dezessete documentos estavam a um clique.

                  Fica junto do botão que leva até eles, porque contar sem dizer
                  onde pegar é o aviso que obriga a procurar.
                */}
                {!!c.atendimento?._count?.anexos && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {c.atendimento._count.anexos === 1
                      ? '1 arquivo veio com a triagem'
                      : `${c.atendimento._count.anexos} arquivos vieram com a triagem`}
                  </p>
                )}
                {onVerTriagem && (
                  <button type="button" onClick={() => onVerTriagem(c.atendimento!.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline dark:text-brand-400">
                    <FileSearch className="h-3.5 w-3.5" />
                    {c.atendimento?._count?.anexos ? 'Abrir a triagem e os arquivos' : 'Abrir triagem completa'}
                  </button>
                )}
              </div>
            </Bloco>
          )}

          {c.descricao && (
            <Bloco titulo="Descrição">
              <p className="whitespace-pre-wrap text-sm">{c.descricao}</p>
            </Bloco>
          )}

          {/*
            O TEOR QUE ORIGINOU A ATIVIDADE.

            Quando o robô cria "Verificação de Intimação / Prazo", a descrição
            traz o rótulo do ato — "Publicação", "Expedição de documento" —
            porque é só isso que o DataJud entrega. O texto que permite DECIDIR
            o que fazer vem do DJEN, e já estava vinculado a esta atividade no
            banco desde a correlação: ficava invisível, e o advogado abria o
            processo, achava a aba Publicações e procurava qual era.
          */}
          {agruparPublicacoes(c.origemComunicacoes ?? []).map((grupo) => (
            <PublicacaoDjenCard
              key={grupo.principal.id}
              grupo={grupo}
              rotulo="Teor da publicação"
              acoes={
                grupo.principal.processoId && (
                  <Link
                    href={`/processos?processo=${grupo.principal.processoId}`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-300"
                  >
                    <Newspaper className="h-3 w-3" /> Ver no processo
                  </Link>
                )
              }
            />
          ))}

          {/* Cancelada é decisão tomada, não alarme: neutro, nunca vermelho (15/09/2026). */}
          {c.status === 'CANCELADO' && (
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Ban className="h-3.5 w-3.5" /> Cancelada
                {c.canceladoEm && <span className="font-normal normal-case">· {formatDataHora(c.canceladoEm)}</span>}
              </p>
              {/*
                QUEM CANCELOU — a pergunta que a tela não respondia (24/09/2026).

                "Aqui diz que a atividade foi cancelada, filiado não compareceu.
                Mas quem cancelou?"

                O dado SEMPRE esteve lá: `cancelado_por` está preenchido em 45
                dos 61 cancelamentos da produção, e a API já mandava
                `canceladoPorUsuario` junto. O bloco de "concluída" mostra o
                autor logo acima; o de cancelada, não — omissão, não decisão.

                Cancelar uma consulta é decisão de gente, e decisão sem nome é
                boato. Os 16 sem autor são anteriores à coluna e ao robô: aí a
                linha DIZ isso, em vez de ficar em branco — ausência de nome se
                lê como dado perdido.
              */}
              <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {c.canceladoPorUsuario ? (
                  <>
                    <AvatarPessoa
                      nome={c.canceladoPorUsuario.nomeExibicao || c.canceladoPorUsuario.nome}
                      url={c.canceladoPorUsuario.avatarUrl}
                      tamanho="xs"
                    />
                    <span>
                      por{' '}
                      <strong className="font-semibold text-foreground">
                        {c.canceladoPorUsuario.nomeExibicao || c.canceladoPorUsuario.nome}
                      </strong>
                    </span>
                  </>
                ) : (
                  <>
                    <Bot className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    <span>autor não registrado (cancelamento antigo)</span>
                  </>
                )}
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
            {/*
              "RESPONSÁVEL", e não "Advogado(a) responsável".

              O rótulo afirmava uma profissão que o sistema não garante: das 89
              atividades da produção, 4 respondem a quem não é advogado (2
              coordenação, 1 triagem, 1 administrador) — e uma delas é a que o
              usuário abriu para relatar isto. O perfil real já aparece na linha
              de baixo, então o rótulo só precisa dizer o PAPEL na atividade.
            */}
            <Bloco titulo="Responsável">
              <div className="flex items-center gap-2">
                <Avatar nome={c.responsavel.nomeExibicao || c.responsavel.nome} url={c.responsavel.avatarUrl} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.responsavel.nomeExibicao || c.responsavel.nome}</p>
                  {c.responsavel.role && <p className="text-xs text-muted-foreground">{c.responsavel.role}</p>}
                </div>
              </div>
              {/*
                O RESPONSÁVEL SUMIU — dito aqui, antes de qualquer decisão. A gaveta
                mostrava o nome como se tudo estivesse sob controle, e ele não
                entrava no sistema havia 39 dias.
              */}
              {c.ausenciaDoResponsavel && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-snug text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {textoDaAusencia(c.ausenciaDoResponsavel)}
                    {(c.equipe ?? []).some((e) => !e.principal && ehReserva(e)) &&
                      ' Os advogados do caso serão avisados no painel e no aviso do topo quando entrarem — quem puder, assuma.'}
                  </span>
                </p>
              )}
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
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">
                            {e.usuario.nomeExibicao || e.usuario.nome}
                          </p>
                          {ehReserva(e) && (
                            <p className="text-[11px] text-muted-foreground">
                              advogado do processo — reserva
                              {c.processo && podeCuidarDaEquipe && user?.id !== e.usuario.id && !estaFechado(c.status) && (
                                <>
                                  {' · '}
                                  <button
                                    type="button"
                                    onClick={() => setTirando(e.usuario.id)}
                                    className="font-medium underline-offset-2 hover:text-foreground hover:underline"
                                  >
                                    não atua mais aqui?
                                  </button>
                                </>
                              )}
                            </p>
                          )}
                          {tirando === e.usuario.id && c.processo && (
                            <div className="mt-2 rounded-lg border bg-muted/40 p-2.5 text-xs">
                              <p className="leading-snug">
                                Tirar <strong>{e.usuario.nomeExibicao || e.usuario.nome}</strong> da equipe deste
                                processo? Sai desta e das outras tarefas abertas do processo, e o robô do Diário
                                não coloca de volta. Dá para recolocar na ficha do processo.
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setTirando(null)}
                                  disabled={tirarDaEquipe.isPending}
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  size="sm"
                                  className="bg-red-600 text-white hover:bg-red-700"
                                  disabled={tirarDaEquipe.isPending}
                                  onClick={() =>
                                    tirarDaEquipe.mutate({ processoId: c.processo!.id, advogadoId: e.usuario.id })
                                  }
                                >
                                  {tirarDaEquipe.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <UserMinus className="h-4 w-4" />
                                  )}
                                  Tirar da equipe
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Só aparece para quem pode agir: eu, e só se ainda não for meu. */}
                        {podeEditarAgenda && user?.id === e.usuario.id && !estaFechado(c.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            disabled={assumir.isPending}
                            onClick={() => assumir.mutate(c.id)}
                          >
                            {assumir.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <HandHelping className="h-4 w-4" />
                            )}
                            Assumir
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
                {/*
                  A HONESTIDADE QUE FALTAVA: reserva não é aviso — até ninguém
                  estar cuidando.

                  Quem lê "também atuam" supõe que a outra pessoa foi avisada.
                  Enquanto o responsável cuida, a reserva do robô não vira aviso de
                  ninguém — senão um prazo tocaria em quatro agendas. Quando ele
                  some por uma semana, ou o dia vira, os advogados do caso ficam
                  sabendo. Dizer isso aqui é o que separa uma lista de nomes de uma
                  combinação de trabalho.
                */}
                {(c.equipe ?? []).some((e) => !e.principal && ehReserva(e)) && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Reservas são os outros advogados do processo.
                    {' '}A tarefa não aparece como deles até ninguém estar cuidando:
                    {' '}se o responsável ficar uma semana sem entrar no sistema, ou se o dia marcado
                    passar, eles serão avisados no painel e no aviso do topo quando entrarem. Quem tocar em
                    Assumir vira o responsável.
                  </p>
                )}
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
              /*
                QUAL robô, e não "o robô".
                São dois: o de prazos lê os andamentos do DataJud; o do DJEN lê
                o teor das publicações. A gaveta dizia "DataJud" em toda tarefa
                automática, inclusive nas que nasceram de uma publicação — e o
                advogado que fosse conferir a origem procuraria na aba errada.
              */
              <Bloco titulo="Registrado por">
                <p className="text-sm text-muted-foreground">
                  {c.origemComunicacoes?.length
                    ? 'Robô de publicações (DJEN)'
                    : 'Robô de prazos (DataJud)'}
                </p>
              </Bloco>
            ) : c.criadoPorNome ? (
              <Bloco titulo="Registrado por">
                <p className="text-sm">{c.criadoPorNome}</p>
              </Bloco>
            ) : null}

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

          {/* Observações internas — a descrição subiu para antes do teor. */}
          {c.observacoesInternas && (
            <div className="space-y-3">
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

          {/* Plantão do dia — só para quem vê a escala. */}
          {verEscalas && (
          <Bloco titulo={`Plantão do dia · ${formatData(c.inicio)}`}>
            {plantaoQ.isLoading ? (
              <EsqueletoLinhas quantidade={2} altura={36} />
            ) : plantaoQ.isError ? (
              <p className="text-sm text-muted-foreground">Não deu para carregar a escala deste dia.</p>
            ) : plantao.length === 0 ? (
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
          )}

          {/* Documentos da atividade.
              Os anexos da triagem/processo de origem aparecem HERDADOS, em bloco
              separado: o que foi puxado lá não precisa ser puxado de novo aqui. */}
          <div id={`anexos-${c.id}`} className="scroll-mt-4">
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
        </div>
      )}

      {/*
        AS AÇÕES FICAM NO RODAPÉ, SEMPRE À MÃO. Vinham no meio da gaveta, depois
        do desfecho, dos passos e do teor da publicação — no celular, era rolar
        uma intimação inteira para achar "Concluir". O botão cheio segue a
        mesma regra do cartão (D7).
      */}
      {c && !isLoading && podeEditarAgenda && (onConcluir || onCancelar || onRemarcar || onAcao) && (
        <div className="grid grid-cols-2 gap-2 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:flex-wrap sm:justify-end">
          {c.status === 'PENDENTE' && onAcao && acaoPrincipalDoCartao(c) === 'INICIAR' && (
            <Button onClick={() => onAcao(c.id, 'EM_ANDAMENTO')}>
              <Play className="h-4 w-4" /> Iniciar
            </Button>
          )}
          {!estaFechado(c.status) && onConcluir && (
            <Button
              variant={c.status === 'EM_ANDAMENTO' || acaoPrincipalDoCartao(c) === 'CONCLUIR' ? 'default' : 'outline'}
              onClick={() => onConcluir(c)}
            >
              <CheckCircle2 className="h-4 w-4" /> Concluir
            </Button>
          )}
          {c.status === 'PENDENTE' && onAcao && acaoPrincipalDoCartao(c) === 'CONCLUIR' && (
            <Button variant="outline" onClick={() => onAcao(c.id, 'EM_ANDAMENTO')}>
              <Play className="h-4 w-4" /> Iniciar
            </Button>
          )}
          {c.status === 'EM_ANDAMENTO' && onAcao && (
            <Button variant="outline" onClick={() => onAcao(c.id, 'PENDENTE')}>
              <RotateCcw className="h-4 w-4" /> Voltar a pendente
            </Button>
          )}
          {!estaFechado(c.status) && onRemarcar && (
            <Button variant="outline" onClick={() => onRemarcar(c)}>
              <CalendarClock className="h-4 w-4" /> Remarcar
            </Button>
          )}
          {!estaFechado(c.status) && onCancelar && (
            <Button variant="outline" onClick={() => onCancelar(c)}>
              <Ban className="h-4 w-4" /> Cancelar
            </Button>
          )}
          {estaFechado(c.status) && onAcao && (
            <Button variant="outline" className="col-span-2" onClick={() => onAcao(c.id, 'PENDENTE')}>
              <RotateCcw className="h-4 w-4" /> Reabrir
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
