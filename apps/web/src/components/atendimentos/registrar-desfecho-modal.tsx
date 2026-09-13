'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  X, Loader2, ArrowRight, CheckCircle2, CalendarClock, Clock, Users, Video, Phone, Building2,
  AlertTriangle, RotateCw, Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { podeVer } from '@/lib/permissoes';
import { estaNoHorario } from '@/lib/escalas';
import { listarProcessos, formatNPU } from '@/lib/processos';
import { ASSUNTO_LABEL, ASSUNTOS } from '@/lib/relatorios';
import { celularParaWhatsApp, linkWhatsApp as linkDoWhatsApp } from '@/lib/whatsapp';
import { normalizarLinkReuniao, provedorDoLink } from '@/lib/link-reuniao';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import {
  registrarDesfecho, atualizarAssunto, opcoesDeEncaminhamento, choquesNaAgenda,
  DesfechoAtendimento, TipoEncaminhamento, TIPO_ENC_LABEL, ModalidadeConsulta, MODALIDADES, MODALIDADE_LABEL,
  AtendimentoDossie, ASSUNTO_OUTRO_MAX, agruparEquipe, assuntoMudou, deQuem, confirmacaoDoEncaminhamento,
  corpoDoAssunto, dataJaPassou, diaBR, diaDoPlantao, erroDoAssuntoNoDesfecho, horaBR, mensagemDaConsulta,
  modalidadeRemota, nomeDeQuemAtende, rotuloDoDia,
} from '@/lib/atendimentos';
import { V } from '@/lib/vocabulario';

const inputCls = 'h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm';

export interface AtendimentoParaDesfecho {
  id: string;
  numero: number;
  descricao: string;
  assunto?: string | null;
  assuntoOutro?: string | null;
  filiado: { id: string; nomeCompleto: string };
}

const ICONE_MODALIDADE: Record<ModalidadeConsulta, typeof Video> = {
  SEDE: Building2,
  VIDEO: Video,
  TELEFONE: Phone,
};

/**
 * REGISTRAR DESFECHO — resolvido no ato, ou encaminhado a um advogado.
 *
 * O PLANTÃO MOSTRADO É O DO DIA EM QUE A CONSULTA CAI. Antes a tela destacava
 * "de plantão hoje" enquanto o servidor marcava a consulta para o próximo dia
 * útil: escolhia-se o plantonista de hoje e a consulta nascia na agenda de quem
 * não estaria de plantão. Agora o dia vem do servidor (`dataPadrao`), pela
 * mesma função que grava.
 *
 * E A LISTA VEM DE UMA ROTA DE ATENDIMENTOS. O modal lia `/escalas`, que a
 * Triagem não pode ver: a recusa aparecia como "ninguém de plantão" e o
 * dropdown vazio. Quem registra o desfecho alcança, por construção, o que o
 * desfecho precisa — e erro é erro, nunca lista vazia.
 */
export function RegistrarDesfechoModal({
  open, onClose, atendimento, onRegistrado,
}: {
  open: boolean;
  onClose: () => void;
  atendimento: AtendimentoParaDesfecho | null;
  onRegistrado: (resultado: DesfechoAtendimento) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const podeVerAgenda = podeVer(user?.role, user?.permissoes, 'agenda');
  const tituloId = useId();

  /*
    NADA PRÉ-MARCADO. Com "Encaminhado" já escolhido, a opção mais pesada (criar
    atividade na agenda de alguém) era o caminho de menor esforço.
  */
  const [resultado, setResultado] = useState<DesfechoAtendimento | null>(null);
  const [assunto, setAssunto] = useState('');
  const [assuntoOutro, setAssuntoOutro] = useState('');
  const [desfechoObs, setDesfechoObs] = useState('');
  const [selecionados, setSelecionados] = useState<{ id: string; nome: string }[]>([]);
  const [tipoEnc, setTipoEnc] = useState<TipoEncaminhamento>('CONSULTA_NOVA');
  const [processoId, setProcessoId] = useState('');
  const [dataConsulta, setDataConsulta] = useState('');
  const [modalidade, setModalidade] = useState<ModalidadeConsulta>('SEDE');
  const [linkReuniao, setLinkReuniao] = useState('');
  /** Depois de encaminhar: a confirmação com o que o SERVIDOR gravou. */
  const [registrado, setRegistrado] = useState<AtendimentoDossie | null>(null);

  useEffect(() => {
    if (open) {
      setResultado(null); setDesfechoObs(''); setSelecionados([]);
      setTipoEnc('CONSULTA_NOVA'); setProcessoId(''); setDataConsulta('');
      setModalidade('SEDE'); setLinkReuniao(''); setRegistrado(null);
      setAssunto(atendimento?.assunto ?? '');
      setAssuntoOutro(atendimento?.assuntoOutro ?? '');
    }
    // Reinicia só ao abrir; o atendimento é fixo enquanto o modal está aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const encaminhando = open && resultado === 'ENCAMINHADO' && !registrado;

  /** Sem data digitada: o dia padrão, a equipe e o plantão desse dia. */
  const padrao = useQuery({
    queryKey: ['encaminhamento-opcoes', 'padrao'],
    queryFn: () => opcoesDeEncaminhamento(),
    enabled: encaminhando,
    staleTime: 60_000,
  });
  const dataPadrao = padrao.data?.dataPadrao ?? null;
  const diaAlvo = diaDoPlantao(dataConsulta, dataPadrao);
  const precisaDiaProprio = !!diaAlvo && !!padrao.data && diaAlvo !== padrao.data.dia;
  const doDia = useQuery({
    queryKey: ['encaminhamento-opcoes', diaAlvo],
    queryFn: () => opcoesDeEncaminhamento(diaAlvo!),
    enabled: encaminhando && precisaDiaProprio,
    staleTime: 60_000,
  });
  const plantaoQuery = precisaDiaProprio ? doDia : padrao;
  const plantao = plantaoQuery.data?.plantao ?? [];
  const alvoEhHoje = !!diaAlvo && diaAlvo === diaBR(new Date());

  const equipe = useMemo(() => agruparEquipe(padrao.data?.advogados ?? []), [padrao.data]);

  const processos = useQuery({
    queryKey: ['processos-desfecho', atendimento?.filiado.id],
    queryFn: () => listarProcessos({ filiadoId: atendimento?.filiado.id, pageSize: 50 }),
    enabled: encaminhando && !!atendimento && tipoEnc === 'ANDAMENTO_PROCESSO',
  });

  /*
    O HORÁRIO QUE VAI OCUPAR A AGENDA. Digitado, é ele. Em branco, a consulta cai
    às 9h do dia padrão (proximoHorarioUtilBR) — é esse o horário que o aviso de
    choque confere, e não um "amanhã" do calendário do aparelho.
  */
  const inicioISO = useMemo(() => {
    if (dataConsulta) {
      const d = new Date(dataConsulta);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return dataPadrao ? new Date(`${dataPadrao}T09:00:00-03:00`).toISOString() : null;
  }, [dataConsulta, dataPadrao]);
  const fimISO = inicioISO ? new Date(new Date(inicioISO).getTime() + 3_600_000).toISOString() : null;

  const choques = useQueries({
    queries: selecionados.map((s) => ({
      queryKey: ['agenda-conflitos', s.id, inicioISO, fimISO],
      queryFn: () => choquesNaAgenda({ responsavelId: s.id, inicio: inicioISO!, fim: fimISO! }),
      enabled: encaminhando && podeVerAgenda && !!inicioISO && !!fimISO,
      staleTime: 15_000,
    })),
  });

  /*
    O LINK É CONFERIDO ENQUANTO SE COLA, pelo espelho da regra do servidor
    (`lib/link-reuniao.ts`). Quem grava continua sendo o servidor; o espelho só
    evita descobrir "esse link não serve" depois de apertar Encaminhar.
  */
  const linkConferido = modalidade === 'VIDEO' ? normalizarLinkReuniao(linkReuniao) : null;
  const erroDoLink = linkConferido && !linkConferido.ok ? linkConferido.erro : null;

  const idsSelec = useMemo(() => new Set(selecionados.map((s) => s.id)), [selecionados]);
  const addAdv = (id: string, nome: string) => setSelecionados((s) => (s.some((x) => x.id === id) ? s : [...s, { id, nome }]));
  const remAdv = (id: string) => setSelecionados((s) => s.filter((x) => x.id !== id));

  const salvar = useMutation({
    mutationFn: async () => {
      const a = atendimento!;
      // O assunto vai pela rota própria (e só se mudou): o desfecho não ganha
      // um segundo jeito de reclassificar.
      if (assuntoMudou(a, { assunto, assuntoOutro })) {
        await atualizarAssunto(a.id, corpoDoAssunto(assunto, assuntoOutro));
      }
      return registrarDesfecho(a.id, {
        resultado: resultado!,
        desfechoObs: desfechoObs.trim() || undefined,
        ...(resultado === 'ENCAMINHADO'
          ? {
              advogadoIds: selecionados.map((s) => s.id),
              tipoEncaminhamento: tipoEnc,
              processoId: tipoEnc === 'ANDAMENTO_PROCESSO' ? processoId : undefined,
              dataConsulta: dataConsulta ? new Date(dataConsulta).toISOString() : undefined,
              // Na sede é o padrão do servidor (local vazio): não precisa ir.
              ...(modalidade !== 'SEDE' ? { modalidade } : {}),
              ...(modalidade === 'VIDEO' && linkReuniao.trim() ? { linkReuniao: linkReuniao.trim() } : {}),
            }
          : {}),
      });
    },
    onSuccess: (r) => {
      const a = atendimento!;
      qc.invalidateQueries({ queryKey: ['atendimento', a.id] });
      qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
      onRegistrado(resultado!);
      if (resultado === 'ENCAMINHADO' && r?.atendimento) setRegistrado(r);
      else onClose();
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message;
      toast.error(Array.isArray(m) ? m[0] : m ?? 'Não foi possível registrar o desfecho.');
    },
  });

  function submeter() {
    if (!resultado) return toast.error('Escolha como o atendimento terminou.');
    // Registro antigo com "Outro" e sem texto fecha sem reclassificar: só se confere o que mudou.
    const erroAssunto = erroDoAssuntoNoDesfecho(atendimento ?? {}, { assunto, assuntoOutro });
    if (erroAssunto) return toast.error(erroAssunto);
    if (resultado === 'ENCAMINHADO') {
      if (selecionados.length === 0) return toast.error('Escolha quem vai atender a consulta.');
      if (tipoEnc === 'ANDAMENTO_PROCESSO' && !processoId) return toast.error('Selecione o processo existente.');
      if (modalidadeRemota(modalidade) && !dataConsulta) {
        return toast.error('Consulta por vídeo ou por telefone precisa de dia e hora combinados com o filiado.');
      }
      if (erroDoLink) return toast.error(erroDoLink);
    }
    salvar.mutate();
  }

  if (!open || !atendimento) return null;

  const fechar = salvar.isPending ? undefined : onClose;

  const ChipPlantao = ({ item }: { item: (typeof plantao)[number] }) => {
    const nome = item.advogado.nomeExibicao || item.advogado.nome;
    const sel = idsSelec.has(item.advogado.id);
    const noHorario = alvoEhHoje && estaNoHorario(item);
    return (
      <button
        type="button"
        aria-pressed={sel}
        onClick={() => (sel ? remAdv(item.advogado.id) : addAdv(item.advogado.id, nome))}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
          sel
            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-300'
            : 'border-input text-foreground hover:bg-muted',
        )}
      >
        {sel && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
        {nome}
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />{item.horaInicio}–{item.horaFim}
        </span>
        {noHorario && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">no horário</span>}
      </button>
    );
  };

  const tituloPlantao = !diaAlvo
    ? 'De plantão no dia da consulta'
    : alvoEhHoje
      ? 'De plantão hoje'
      : `De plantão em ${rotuloDoDia(diaAlvo)}${dataConsulta ? '' : ', dia da consulta'}`;

  const choquesVisiveis = selecionados
    .map((s, i) => ({ pessoa: s, q: choques[i] }))
    .filter(({ q }) => q && (q.isError || (q.data?.length ?? 0) > 0));

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={fechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b py-3 pl-5 pr-2">
          <h3 id={tituloId} className="text-lg font-bold">{registrado ? 'Consulta marcada' : 'Registrar desfecho'}</h3>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {registrado ? (
          <Confirmacao dossie={registrado} onFechar={onClose} />
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {/* Contexto do atendimento */}
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Atendimento #{atendimento.numero}</p>
                <p className="font-semibold">{atendimento.filiado.nomeCompleto}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{atendimento.descricao}</p>
              </div>

              {/* Resultado */}
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 text-sm font-medium">Como terminou? *</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    { v: 'RESOLVIDO_ATO', titulo: 'Resolvido no ato', apoio: 'Orientação dada, sem consulta', Icone: CheckCircle2 },
                    { v: 'ENCAMINHADO', titulo: 'Encaminhar a um advogado', apoio: 'Marca uma consulta na agenda', Icone: ArrowRight },
                  ] as const).map(({ v, titulo, apoio, Icone }) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={resultado === v}
                      onClick={() => setResultado(v)}
                      className={cn(
                        'flex min-h-14 items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                        resultado === v
                          ? 'border-brand-700 bg-brand-50 ring-1 ring-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:ring-brand-400'
                          : 'border-input hover:bg-muted',
                      )}
                    >
                      <Icone className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-medium">{titulo}</span>
                        <span className="block text-xs text-muted-foreground">{apoio}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {/* Sobre o que era — o momento em que mais se sabe o assunto é este. */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor={`${tituloId}-assunto`}>
                  Sobre o que era? <span className="font-normal text-muted-foreground">(opcional)</span>
                </label>
                <select
                  id={`${tituloId}-assunto`}
                  className={inputCls}
                  value={assunto}
                  onChange={(e) => setAssunto(e.target.value)}
                >
                  <option value="">Sem assunto</option>
                  {ASSUNTOS.map((a) => <option key={a} value={a}>{ASSUNTO_LABEL[a]}</option>)}
                </select>
                {assunto === 'OUTRO' && (
                  <Input
                    autoFocus={!atendimento.assuntoOutro}
                    maxLength={ASSUNTO_OUTRO_MAX}
                    value={assuntoOutro}
                    onChange={(e) => setAssuntoOutro(e.target.value)}
                    placeholder="Qual assunto? Ex.: aposentadoria, plano de saúde"
                    aria-label="Qual assunto?"
                  />
                )}
              </div>

              {resultado === 'RESOLVIDO_ATO' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor={`${tituloId}-obs`}>O que foi resolvido?</label>
                  <textarea
                    id={`${tituloId}-obs`}
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                    placeholder={`Descreva a orientação ou a solução dada ao ${V.filiado}…`}
                    value={desfechoObs}
                    onChange={(e) => setDesfechoObs(e.target.value)}
                  />
                </div>
              )}

              {resultado === 'ENCAMINHADO' && (
                <>
                  {/* Como vai ser */}
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium">Como vai ser a consulta?</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {MODALIDADES.map((m) => {
                        const Icone = ICONE_MODALIDADE[m];
                        return (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={modalidade === m}
                            onClick={() => setModalidade(m)}
                            className={cn(
                              'flex h-12 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm transition-colors',
                              modalidade === m
                                ? 'border-brand-700 bg-brand-50 font-medium text-brand-900 ring-1 ring-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-200 dark:ring-brand-400'
                                : 'border-input hover:bg-muted',
                            )}
                          >
                            <Icone className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {MODALIDADE_LABEL[m]}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  {modalidade === 'VIDEO' && (
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor={`${tituloId}-link`}>
                        <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        Link da chamada <span className="font-normal text-muted-foreground">(cole agora ou depois)</span>
                      </label>
                      <Input
                        id={`${tituloId}-link`}
                        inputMode="url"
                        maxLength={2000}
                        value={linkReuniao}
                        onChange={(e) => setLinkReuniao(e.target.value)}
                        placeholder="meet.google.com/abc-defg-hij"
                        aria-invalid={!!erroDoLink}
                        aria-describedby={`${tituloId}-link-ajuda`}
                      />
                      <p
                        id={`${tituloId}-link-ajuda`}
                        className={cn('break-all text-xs', erroDoLink ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}
                      >
                        {erroDoLink
                          ?? (linkConferido?.ok
                            ? `${linkConferido.provedor}: ${linkConferido.url}`
                            : 'Pode colar o convite inteiro: o sistema pega o link de dentro dele.')}
                      </p>
                    </div>
                  )}

                  {/* Data e hora */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor={`${tituloId}-data`}>
                      Dia e hora da consulta{modalidadeRemota(modalidade) ? ' *' : ''}
                    </label>
                    <Input
                      id={`${tituloId}-data`}
                      type="datetime-local"
                      value={dataConsulta}
                      onChange={(e) => setDataConsulta(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {modalidadeRemota(modalidade)
                        ? 'Obrigatório por vídeo ou telefone: combine o horário com o filiado.'
                        : dataConsulta
                          ? 'Apague para deixar no próximo dia útil, às 9h.'
                          : dataPadrao
                            ? `Em branco, a consulta fica para ${rotuloDoDia(dataPadrao)}, às 9h.`
                            : 'Em branco, a consulta fica para o próximo dia útil, às 9h.'}
                    </p>
                    {dataJaPassou(dataConsulta) && (
                      <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Esse dia e hora já passaram. Assim a consulta entra na agenda como algo que ficou para trás. Confira se não é engano de digitação.
                      </p>
                    )}
                  </div>

                  {/* Plantão do dia da consulta */}
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                      {tituloPlantao} — toque para escolher
                    </p>
                    {plantaoQuery.isError ? (
                      <ErroComNovaTentativa
                        texto="Não deu para carregar a escala deste dia."
                        onTentar={() => plantaoQuery.refetch()}
                      />
                    ) : plantaoQuery.isLoading || !diaAlvo ? (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Conferindo a escala…
                      </p>
                    ) : plantao.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Ninguém escalado neste dia. Escolha na lista abaixo.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">{plantao.map((p) => <ChipPlantao key={p.id} item={p} />)}</div>
                    )}
                  </div>

                  {/* Quem atende */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium" htmlFor={`${tituloId}-equipe`}>
                      <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Quem vai atender *
                    </label>
                    {selecionados.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selecionados.map((s, i) => (
                          <span key={s.id} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-brand-100 pl-3 text-sm font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
                            {s.nome}
                            {i === 0 && selecionados.length > 1 && (
                              <span className="text-xs font-normal opacity-80">· responsável</span>
                            )}
                            <button
                              type="button"
                              onClick={() => remAdv(s.id)}
                              aria-label={`Tirar ${s.nome}`}
                              className="flex h-11 w-10 items-center justify-center rounded-full hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {padrao.isError ? (
                      <ErroComNovaTentativa
                        texto="Não deu para carregar a equipe."
                        onTentar={() => padrao.refetch()}
                      />
                    ) : (
                      <select
                        id={`${tituloId}-equipe`}
                        className={inputCls}
                        value=""
                        disabled={padrao.isLoading}
                        onChange={(e) => {
                          const a = (padrao.data?.advogados ?? []).find((x) => x.id === e.target.value);
                          if (a) addAdv(a.id, a.nomeExibicao || a.nome);
                        }}
                      >
                        <option value="">{padrao.isLoading ? 'Carregando a equipe…' : 'Escolher pessoa…'}</option>
                        {equipe.advogados.length > 0 && equipe.outros.length > 0 ? (
                          <>
                            <optgroup label="Advogados">
                              {equipe.advogados.filter((a) => !idsSelec.has(a.id)).map((a) => (
                                <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Outros da equipe">
                              {equipe.outros.filter((a) => !idsSelec.has(a.id)).map((a) => (
                                <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>
                              ))}
                            </optgroup>
                          </>
                        ) : (
                          [...equipe.advogados, ...equipe.outros].filter((a) => !idsSelec.has(a.id)).map((a) => (
                            <option key={a.id} value={a.id}>{a.nomeExibicao || a.nome}</option>
                          ))
                        )}
                      </select>
                    )}
                    {selecionados.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        A primeira pessoa responde pela consulta; as outras entram como participantes.
                      </p>
                    )}

                    {/* Choque de horário: avisa, não bloqueia. */}
                    {choquesVisiveis.length > 0 && (
                      <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/70 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
                        {choquesVisiveis.map(({ pessoa, q }) => (
                          q.isError ? (
                            <p key={pessoa.id} className="text-xs text-muted-foreground">
                              Não deu para conferir a agenda de {pessoa.nome}.
                            </p>
                          ) : (
                            <div key={pessoa.id} className="space-y-0.5">
                              {(q.data ?? []).map((c) => (
                                <p key={c.id} className="flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-200">
                                  <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span className="min-w-0 break-words">
                                    {pessoa.nome} já tem {c.titulo}, das {horaBR(c.inicio)} às {horaBR(c.fim)}
                                  </span>
                                </p>
                              ))}
                            </div>
                          )
                        ))}
                        <p className="text-[11px] text-muted-foreground">
                          Dá para encaminhar assim mesmo. Só confira se não é engano.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Tipo de encaminhamento */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor={`${tituloId}-tipo`}>Tipo de encaminhamento *</label>
                    <select
                      id={`${tituloId}-tipo`}
                      className={inputCls}
                      value={tipoEnc}
                      onChange={(e) => { setTipoEnc(e.target.value as TipoEncaminhamento); setProcessoId(''); }}
                    >
                      <option value="CONSULTA_NOVA">{TIPO_ENC_LABEL.CONSULTA_NOVA}</option>
                      <option value="ANDAMENTO_PROCESSO">{TIPO_ENC_LABEL.ANDAMENTO_PROCESSO}</option>
                    </select>
                  </div>

                  {tipoEnc === 'ANDAMENTO_PROCESSO' && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium" htmlFor={`${tituloId}-processo`}>Processo existente *</label>
                      {processos.isError ? (
                        <ErroComNovaTentativa texto="Não deu para carregar os processos." onTentar={() => processos.refetch()} />
                      ) : (
                        <select id={`${tituloId}-processo`} className={inputCls} value={processoId} onChange={(e) => setProcessoId(e.target.value)}>
                          <option value="">{processos.isLoading ? 'Carregando…' : 'Selecionar processo…'}</option>
                          {(processos.data?.items ?? []).map((p) => (
                            <option key={p.id} value={p.id}>{formatNPU(p.numeroCNJ)}{p.classeProcessual ? ` — ${p.classeProcessual}` : ''}</option>
                          ))}
                        </select>
                      )}
                      {processos.isSuccess && (processos.data?.items ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground">Este {V.filiado} não tem processos cadastrados.</p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium" htmlFor={`${tituloId}-nota`}>
                      Nota para quem vai atender <span className="font-normal text-muted-foreground">(opcional)</span>
                    </label>
                    <textarea
                      id={`${tituloId}-nota`}
                      className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                      placeholder="Algo que a descrição não diz"
                      value={desfechoObs}
                      onChange={(e) => setDesfechoObs(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
              <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
              <Button onClick={submeter} disabled={salvar.isPending || !resultado}>
                {salvar.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : resultado === 'ENCAMINHADO' ? <ArrowRight className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {resultado === 'ENCAMINHADO' ? 'Encaminhar' : 'Registrar'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ErroComNovaTentativa({ texto, onTentar }: { texto: string; onTentar: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {texto}
      </span>
      <Button type="button" size="sm" variant="ghost" className="h-11 md:h-9" onClick={onTentar}>
        <RotateCw className="h-3.5 w-3.5" /> Tentar de novo
      </Button>
    </div>
  );
}

/**
 * DEPOIS DE ENCAMINHAR — o que ficou gravado, lido da resposta do servidor.
 *
 * A frase sai do `encaminhamento` que a API calculou (e não do que foi
 * digitado): se o servidor escolheu o dia padrão, é esse dia que aparece.
 * O WhatsApp fica desabilitado, com o motivo, quando o cadastro não tem celular
 * nem no telefone principal nem no secundário.
 */
function Confirmacao({ dossie, onFechar }: { dossie: AtendimentoDossie; onFechar: () => void }) {
  const at = dossie.atendimento;
  const ultimaConsulta = (at.consultas ?? at.compromissos ?? []).filter((c) => !c.origemDesfechoId).slice(-1)[0];
  const consulta = at.encaminhamento
    ? {
        responsavel: at.encaminhamento.responsavel,
        inicio: at.encaminhamento.inicio,
        local: at.encaminhamento.local,
        linkReuniao: at.encaminhamento.linkReuniao,
      }
    : ultimaConsulta
      ? {
          responsavel: ultimaConsulta.responsavel,
          inicio: ultimaConsulta.inicio,
          local: ultimaConsulta.local ?? null,
          linkReuniao: ultimaConsulta.linkReuniao ?? null,
        }
      : null;

  const celular = celularParaWhatsApp(at.filiado.telefonePrincipal, at.filiado.telefoneSecundario);
  const quem = nomeDeQuemAtende(consulta?.responsavel);

  function enviar() {
    if (!celular || !consulta) return;
    const texto = mensagemDaConsulta({
      nomeFiliado: at.filiado.nomeCompleto,
      responsavel: consulta.responsavel,
      inicio: consulta.inicio,
      local: consulta.local,
      linkReuniao: consulta.linkReuniao,
    });
    window.open(linkDoWhatsApp(celular, texto), '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-xl bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-semibold leading-snug">
              {consulta ? confirmacaoDoEncaminhamento(consulta) : 'Encaminhamento registrado'}
            </p>
            <p className="text-sm text-muted-foreground">
              {quem
                ? `A consulta já está na agenda e no painel ${deQuem(quem)}. Ninguém recebe aviso fora do sistema.`
                : 'A consulta já está na agenda. Ninguém recebe aviso fora do sistema.'}
            </p>
            {consulta?.linkReuniao && (
              <p className="flex items-center gap-1.5 break-all text-sm">
                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {provedorDoLink(consulta.linkReuniao)}: {consulta.linkReuniao}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Button
            type="button"
            className="w-full bg-[#25D366] text-white hover:bg-[#20bd5a]"
            disabled={!celular || !consulta}
            onClick={enviar}
          >
            <WhatsAppIcon className="h-4 w-4" /> Enviar ao filiado pelo WhatsApp
          </Button>
          {!celular && (
            <p className="text-xs text-muted-foreground">
              O cadastro não tem celular, nem no telefone principal nem no secundário. Avise o {V.filiado} por outro meio.
            </p>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t bg-muted/30 p-4">
        <Button onClick={onFechar}>Fechar</Button>
      </div>
    </>
  );
}
