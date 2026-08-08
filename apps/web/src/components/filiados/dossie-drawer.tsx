'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  X, Loader2, ExternalLink, Phone, Mail, MapPin, IdCard, Clock, CalendarClock,
  Gavel, Wallet, FileText, History, MessageSquare, AlertTriangle, CheckCircle2,
  Users, Sun, Image as ImageIcon, Download, Link2, TrendingUp,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn, mascararCpf } from '@/lib/utils';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import {
  getDossie, moeda, dataBr, dataHoraBr, desde,
  FATO_COR, FATO_LABEL, type Dossie, type FatoDossie,
} from '@/lib/dossie';
import {
  CANAL_LABEL, DESFECHO_COR, DESFECHO_LABEL, STATUS_COR, STATUS_LABEL,
  linkWhatsApp, type CanalAtendimento, type DesfechoAtendimento, type StatusAtendimento,
} from '@/lib/atendimentos';
import {
  STATUS_COR as ATIV_COR, STATUS_LABEL as ATIV_LABEL, rotuloTipo, rotuloDesfecho,
  type StatusCompromisso,
} from '@/lib/agenda';
import { useTiposEvento } from '@/lib/use-tipos-evento';
import { formatNPU, STATUS_PROCESSO_LABEL } from '@/lib/processos';
import { FORMACAO_LABEL, SITUACAO_COR, SITUACAO_LABEL } from '@/lib/filiados';
import { ORIGEM_COR, ORIGEM_LABEL, ehImagem, formatTamanho } from '@/lib/anexos';
import { campoVisivel, tenant } from '@/tenant.config';

/**
 * DOSSIÊ DO FILIADO — o histórico completo do associado, sem sair da listagem.
 *
 * A pergunta do balcão é sempre a mesma: "esse filiado já veio aqui antes? por
 * quê? em que pé ficou?". Responder isso exigia abrir Triagem, Agenda,
 * Processos, Cobranças e o perfil — cinco telas. Aqui está tudo: os números do
 * relacionamento, cada domínio na sua aba e uma linha do tempo única.
 */

type Aba = 'resumo' | 'atendimentos' | 'agenda' | 'processos' | 'financeiro' | 'documentos' | 'timeline';

export function DossieDrawer({
  filiadoId, open, onClose,
}: {
  filiadoId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [aba, setAba] = useState<Aba>('resumo');
  const { tipos } = useTiposEvento();

  const { data, isLoading } = useQuery({
    queryKey: ['dossie', filiadoId],
    queryFn: () => getDossie(filiadoId!),
    enabled: open && !!filiadoId,
  });

  const f = data?.filiado;
  const r = data?.resumo;

  const abas: Array<{ id: Aba; rotulo: string; contador?: number }> = [
    { id: 'resumo', rotulo: 'Resumo' },
    { id: 'atendimentos', rotulo: 'Atendimentos', contador: r?.atendimentos.total },
    { id: 'agenda', rotulo: 'Agenda', contador: r?.atividades.total },
    { id: 'processos', rotulo: 'Processos', contador: r?.processos.total },
    { id: 'financeiro', rotulo: 'Financeiro', contador: r?.financeiro.parcelasAbertas },
    { id: 'documentos', rotulo: 'Documentos', contador: r?.documentos.total },
    { id: 'timeline', rotulo: 'Linha do tempo' },
  ];

  return (
    <Sheet open={open} onClose={onClose} side="right" className="w-full max-w-3xl">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 border-b p-5">
        <div className="flex min-w-0 items-center gap-3">
          {f?.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.fotoUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xl font-bold text-brand-800 dark:bg-brand-900/30 dark:text-brand-300">
              {f?.nomeCompleto?.charAt(0) ?? '—'}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Dossiê do filiado
            </p>
            <h3 className="truncate text-lg font-bold leading-tight">
              {f?.nomeCompleto ?? 'Carregando…'}
            </h3>
            {f && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">{f.matricula}</span>
                {/* Escondido no formulário mas visível aqui, o campo voltava
                    pela porta dos fundos — e numa instalação sem formação o
                    traço seco ("—") ainda ocuparia a linha de identificação. */}
                {campoVisivel('formacao') && (
                  <>
                    <span>·</span>
                    <span>{f.formacao ? FORMACAO_LABEL[f.formacao] : '—'}</span>
                  </>
                )}
                <Badge className={cn('text-[10px]', SITUACAO_COR[f.situacao])}>
                  {SITUACAO_LABEL[f.situacao]}
                </Badge>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {f && (
            <Link
              href={`/filiados/${f.id}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Abrir cadastro completo"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {isLoading || !data || !f || !r ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" />
        </div>
      ) : (
        <>
          {/* Abas (rolam na horizontal no mobile) */}
          <div className="flex gap-1 overflow-x-auto border-b px-3 py-2">
            {abas.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAba(a.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  aba === a.id
                    ? 'bg-brand-700 text-white dark:bg-brand-600'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {a.rotulo}
                {!!a.contador && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[10px] font-semibold',
                      aba === a.id ? 'bg-white/20' : 'bg-muted-foreground/15',
                    )}
                  >
                    {a.contador}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {aba === 'resumo' && <AbaResumo d={data} />}
            {aba === 'atendimentos' && <AbaAtendimentos d={data} />}
            {aba === 'agenda' && <AbaAgenda d={data} tipos={tipos} />}
            {aba === 'processos' && <AbaProcessos d={data} />}
            {aba === 'financeiro' && <AbaFinanceiro d={data} />}
            {aba === 'documentos' && <AbaDocumentos d={data} />}
            {aba === 'timeline' && <AbaTimeline fatos={data.linhaDoTempo} />}
          </div>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

function AbaResumo({ d }: { d: Dossie }) {
  const { filiado: f, resumo: r } = d;
  const whats = linkWhatsApp(
    f.telefonePrincipal,
    `Olá, ${f.nomeCompleto.split(' ')[0]}! 👋 Aqui é do *${tenant.sigla}*.`,
  );

  return (
    <div className="space-y-5">
      {/* Sinais que exigem ação */}
      <div className="space-y-2">
        {r.financeiro.inadimplente && (
          <Alerta tom="vermelho" icone={<Wallet className="h-4 w-4" />}>
            <strong>{r.financeiro.parcelasVencidas} parcela(s) vencida(s)</strong> —{' '}
            {moeda(r.financeiro.valorVencido)} em atraso.
          </Alerta>
        )}
        {r.atendimentos.semDesfecho > 0 && (
          <Alerta tom="amarelo" icone={<MessageSquare className="h-4 w-4" />}>
            <strong>{r.atendimentos.semDesfecho} atendimento(s) sem desfecho</strong> — a triagem
            ainda não registrou o resultado.
          </Alerta>
        )}
        {r.atividades.proxima && (
          <Alerta tom="azul" icone={<CalendarClock className="h-4 w-4" />}>
            Próxima atividade: <strong>{r.atividades.proxima.titulo}</strong> em{' '}
            {dataHoraBr(r.atividades.proxima.inicio)} ({desde(r.atividades.proxima.inicio)}).
          </Alerta>
        )}
      </div>

      {/* Números do relacionamento */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          icone={<MessageSquare className="h-4 w-4" />}
          rotulo="Atendimentos"
          valor={r.atendimentos.total}
          nota={r.atendimentos.pendentes > 0 ? `${r.atendimentos.pendentes} em aberto` : 'nenhum em aberto'}
        />
        <Kpi
          icone={<CalendarClock className="h-4 w-4" />}
          rotulo="Atividades"
          valor={r.atividades.total}
          nota={r.atividades.pendentes > 0 ? `${r.atividades.pendentes} pendente(s)` : 'sem pendências'}
        />
        <Kpi
          icone={<Gavel className="h-4 w-4" />}
          rotulo="Processos"
          valor={r.processos.total}
          nota={`${r.processos.ativos} ativo(s)`}
        />
        <Kpi
          icone={<FileText className="h-4 w-4" />}
          rotulo="Documentos"
          valor={r.documentos.total}
          nota="no acervo"
        />
        <Kpi
          icone={<Wallet className="h-4 w-4" />}
          rotulo="Em aberto"
          valor={moeda(r.financeiro.valorAberto)}
          nota={`${r.financeiro.parcelasAbertas} parcela(s)`}
          alerta={r.financeiro.inadimplente}
        />
        <Kpi
          icone={<Users className="h-4 w-4" />}
          rotulo="Dependentes"
          valor={r.dependentes}
          nota="cadastrados"
        />
        <Kpi
          icone={<TrendingUp className="h-4 w-4" />}
          rotulo="Eventos"
          valor={r.eventos.presencas}
          nota="presenças"
        />
        <Kpi
          icone={<Sun className="h-4 w-4" />}
          rotulo="Colônia"
          valor={r.colonia.reservas}
          nota={r.colonia.ultimaTemporada ?? 'sem reservas'}
        />
      </div>

      {/* Relacionamento */}
      <Bloco titulo="Relacionamento" icone={<Clock className="h-4 w-4" />}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Info rotulo="Filiado desde" valor={`${dataBr(r.relacionamento.desde)} (${desde(r.relacionamento.desde)})`} />
          <Info
            rotulo="Último contato"
            valor={
              r.relacionamento.ultimoContatoEm
                ? `${dataBr(r.relacionamento.ultimoContatoEm)} (${desde(r.relacionamento.ultimoContatoEm)})`
                : 'nunca'
            }
          />
          <Info rotulo="1º atendimento" valor={dataBr(r.atendimentos.primeiroEm)} />
          <Info rotulo="Resolvidos no ato" valor={String(r.atendimentos.resolvidosNoAto)} />
          <Info rotulo="Encaminhados ao Jurídico" valor={String(r.atendimentos.encaminhados)} />
          <Info
            rotulo="Recadastramentos"
            valor={
              r.recadastramentos.total > 0
                ? `${r.recadastramentos.total} · último ${dataBr(r.recadastramentos.ultimoEm)}`
                : 'nenhum'
            }
          />
        </dl>
        {Object.keys(r.atendimentos.porCanal).length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              Por onde ele procura o sindicato
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(r.atendimentos.porCanal)
                .sort((a, b) => b[1] - a[1])
                .map(([canal, qtd]) => (
                  <span key={canal} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {CANAL_LABEL[canal as CanalAtendimento] ?? canal}: <strong>{qtd}</strong>
                  </span>
                ))}
            </div>
          </div>
        )}
      </Bloco>

      {/* Contato */}
      <Bloco titulo="Contato" icone={<IdCard className="h-4 w-4" />}>
        <div className="space-y-1.5 text-sm">
          <Linha Icon={IdCard}>{f.cpf ? mascararCpf(f.cpf) : 'sem CPF'}</Linha>
          <Linha Icon={Phone}>{f.telefonePrincipal || 'sem telefone'}</Linha>
          <Linha Icon={Mail}>{f.email || 'sem e-mail'}</Linha>
          <Linha Icon={MapPin}>
            {[f.endereco, f.numero, f.bairro, f.cidade, f.estado].filter(Boolean).join(', ') ||
              'sem endereço'}
          </Linha>
          {f.vinculos?.length > 0 && (
            <Linha Icon={Users}>
              {f.vinculos.map((v) => [v.empresa, v.cargo].filter(Boolean).join(' — ')).join(' · ')}
            </Linha>
          )}
        </div>
        {whats && (
          <a
            href={whats}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#20bd5a]"
          >
            <WhatsAppIcon className="h-4 w-4" /> WhatsApp
          </a>
        )}
      </Bloco>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atendimentos
// ---------------------------------------------------------------------------

function AbaAtendimentos({ d }: { d: Dossie }) {
  if (d.atendimentos.length === 0) return <Vazio>Nenhum atendimento registrado para este filiado.</Vazio>;
  return (
    <ul className="space-y-3">
      {d.atendimentos.map((a) => (
        <li key={a.id} className="rounded-xl border p-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-semibold">#{a.numero}</span>
            <Badge className="bg-muted text-muted-foreground">
              {CANAL_LABEL[a.canal as CanalAtendimento] ?? a.canal}
            </Badge>
            {a.desfecho ? (
              <Badge className={DESFECHO_COR[a.desfecho as DesfechoAtendimento]}>
                {DESFECHO_LABEL[a.desfecho as DesfechoAtendimento]}
              </Badge>
            ) : (
              <span className="text-[11px] italic text-muted-foreground">sem desfecho</span>
            )}
            <Badge className={cn('text-[10px]', STATUS_COR[a.status as StatusAtendimento])}>
              {STATUS_LABEL[a.status as StatusAtendimento]}
            </Badge>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {dataHoraBr(a.createdAt)}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{a.descricao}</p>
          {a.desfechoObs && (
            <p className="mt-2 rounded-lg bg-muted/50 p-2 text-sm">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Resolução
              </span>
              <br />
              {a.desfechoObs}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>Registrado por {a.atendente.nomeExibicao || a.atendente.nome}</span>
            {a.responsavel && <span>· Advogado(s): {a.responsavel}</span>}
            {a._count.anexos > 0 && <span>· {a._count.anexos} anexo(s)</span>}
            {a._count.compromissos > 0 && <span>· {a._count.compromissos} atividade(s)</span>}
            {a.processo && (
              <span>· Processo {a.processo.numeroCNJ ? formatNPU(a.processo.numeroCNJ) : a.processo.titulo}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

function AbaAgenda({ d, tipos }: { d: Dossie; tipos?: any[] }) {
  if (d.atividades.length === 0) return <Vazio>Nenhuma atividade agendada para este filiado.</Vazio>;
  return (
    <ul className="space-y-3">
      {d.atividades.map((c) => (
        <li key={c.id} className="rounded-xl border p-3">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{c.titulo}</span>
            {c.urgente && (
              <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                Urgente
              </Badge>
            )}
            <Badge className={cn('text-[10px]', ATIV_COR[c.status as StatusCompromisso])}>
              {ATIV_LABEL[c.status as StatusCompromisso]}
            </Badge>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3 w-3" /> {dataHoraBr(c.inicio)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {rotuloTipo(c.tipo, tipos)}
            {c.local ? ` · ${c.local}` : ''} · Resp.:{' '}
            {c.responsavel.nomeExibicao || c.responsavel.nome}
            {c.remarcacoes > 0 && ` · remarcada ${c.remarcacoes}×`}
          </p>
          {c.desfecho && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/50 p-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-400" />
              <span>
                <strong>{rotuloDesfecho(c.desfecho)}</strong>
                {c.desfechoObs ? ` — ${c.desfechoObs}` : ''}
              </span>
            </p>
          )}
          {c.status === 'CANCELADO' && (c.canceladoCategoria || c.canceladoMotivo) && (
            <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950/20 dark:text-red-300">
              Cancelada{c.canceladoCategoria ? ` (${c.canceladoCategoria})` : ''}
              {c.canceladoMotivo ? ` — ${c.canceladoMotivo}` : ''}
            </p>
          )}
          {(c.atendimento || c.processo) && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {c.atendimento && `Origem: triagem #${c.atendimento.numero}`}
              {c.atendimento && c.processo && ' · '}
              {c.processo &&
                `Processo ${c.processo.numeroCNJ ? formatNPU(c.processo.numeroCNJ) : c.processo.titulo ?? 'rascunho'}`}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Processos
// ---------------------------------------------------------------------------

function AbaProcessos({ d }: { d: Dossie }) {
  if (d.processos.length === 0) return <Vazio>Este filiado não figura em nenhum processo.</Vazio>;
  return (
    <ul className="space-y-3">
      {d.processos.map((p) => (
        <li key={p.id} className="rounded-xl border p-3">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Gavel className="h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-400" />
            <span className="font-mono text-sm font-semibold">
              {p.numeroCNJ ? formatNPU(p.numeroCNJ) : p.titulo || 'Rascunho'}
            </span>
            <Badge className="bg-muted text-muted-foreground">
              {STATUS_PROCESSO_LABEL[p.statusInterno as keyof typeof STATUS_PROCESSO_LABEL] ??
                p.statusInterno}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {[p.classeProcessual, p.assuntoPrincipal].filter(Boolean).join(' · ') || 'sem classe'}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {p.orgaoJulgador && <span>{p.orgaoJulgador}</span>}
            {p.tribunal && <span>· {p.tribunal}</span>}
            {p.advogado && <span>· Adv.: {p.advogado.nomeExibicao || p.advogado.nome}</span>}
            {p.valorCausa != null && <span>· Causa: {moeda(p.valorCausa)}</span>}
            <span>· {p._count.movimentacoes} movimentação(ões)</span>
            {p._count.anexos > 0 && <span>· {p._count.anexos} anexo(s)</span>}
          </div>
          {p.etiquetas?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.etiquetas.map((e) => (
                <span key={e} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                  {e}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------

const PARCELA_COR: Record<string, string> = {
  PAGO: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400',
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  VENCIDO: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CANCELADO: 'bg-muted text-muted-foreground line-through',
};

function AbaFinanceiro({ d }: { d: Dossie }) {
  const r = d.resumo.financeiro;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi icone={<Wallet className="h-4 w-4" />} rotulo="Pago" valor={moeda(r.valorPago)} nota={`${r.parcelasPagas} parcela(s)`} />
        <Kpi icone={<Wallet className="h-4 w-4" />} rotulo="Em aberto" valor={moeda(r.valorAberto)} nota={`${r.parcelasAbertas} parcela(s)`} />
        <Kpi icone={<AlertTriangle className="h-4 w-4" />} rotulo="Vencido" valor={moeda(r.valorVencido)} nota={`${r.parcelasVencidas} parcela(s)`} alerta={r.inadimplente} />
      </div>

      {d.cobrancas.length === 0 ? (
        <Vazio>Nenhuma cobrança emitida para este filiado.</Vazio>
      ) : (
        <ul className="space-y-3">
          {d.cobrancas.map((c) => (
            <li key={c.id} className="rounded-xl border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {c.tipo} · {moeda(c.valorTotal)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.descricao ? `${c.descricao} · ` : ''}emitida em {dataBr(c.createdAt)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{c.parcelas.length} parcela(s)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {c.parcelas.map((p) => (
                  <span
                    key={p.id}
                    title={`Parcela ${p.numero} · vence ${dataBr(p.dataVencimento)} · ${moeda(p.valor)}`}
                    className={cn(
                      'rounded-md px-2 py-0.5 text-[11px] font-medium',
                      PARCELA_COR[p.status] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {p.numero}/{c.parcelas.length} · {moeda(p.valor)}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documentos (acervo consolidado)
// ---------------------------------------------------------------------------

function AbaDocumentos({ d }: { d: Dossie }) {
  if (d.documentos.length === 0) return <Vazio>Nenhum documento do filiado no sistema.</Vazio>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Todo documento que o filiado já entregou — em atendimentos, processos, na agenda e no
        cadastro. É deste acervo que sai o “Puxar do acervo” ao criar um atendimento novo.
      </p>
      <ul className="space-y-2">
        {d.documentos.map((doc) => {
          const Icone = ehImagem(doc.tipoMime) ? ImageIcon : FileText;
          return (
            <li
              key={`${doc.origemTipo}:${doc.origemId}`}
              className="flex items-center gap-3 rounded-lg border bg-card p-2.5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icone className="h-4 w-4 text-brand-700 dark:text-brand-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={doc.nomeArquivo}>
                  {doc.nomeArquivo}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                      ORIGEM_COR[doc.origemTipo],
                    )}
                  >
                    {ORIGEM_LABEL[doc.origemTipo]}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {doc.origemRotulo}
                    {doc.tamanhoBytes ? ` · ${formatTamanho(doc.tamanhoBytes)}` : ''}
                  </span>
                </div>
              </div>
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Baixar"
              >
                <Download className="h-4 w-4" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------

function AbaTimeline({ fatos }: { fatos: FatoDossie[] }) {
  if (fatos.length === 0) return <Vazio>Sem registros na linha do tempo.</Vazio>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {fatos.map((fato, i) => (
        <li key={`${fato.tipo}-${fato.refId ?? i}-${fato.data}`} className="relative">
          <span className="absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-card ring-2 ring-border">
            <span className={cn('h-2 w-2 rounded-full', pontoDoFato(fato.tipo))} />
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', FATO_COR[fato.tipo])}>
              {FATO_LABEL[fato.tipo]}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {dataHoraBr(fato.data)} · {desde(fato.data)}
            </span>
          </div>
          <p className="mt-0.5 text-sm font-medium">{fato.titulo}</p>
          {fato.detalhe && <p className="text-xs text-muted-foreground">{fato.detalhe}</p>}
          {fato.situacao && (
            <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {fato.situacao}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Cor do marcador da linha do tempo (a bolinha), por domínio. */
function pontoDoFato(tipo: FatoDossie['tipo']): string {
  const mapa: Record<FatoDossie['tipo'], string> = {
    FILIACAO: 'bg-brand-600',
    ATENDIMENTO: 'bg-sky-500',
    ATIVIDADE: 'bg-amber-500',
    PROCESSO: 'bg-violet-500',
    COBRANCA: 'bg-rose-500',
    EVENTO: 'bg-teal-500',
    RECADASTRAMENTO: 'bg-indigo-500',
    CADASTRO: 'bg-muted-foreground',
  };
  return mapa[tipo];
}

// ---------------------------------------------------------------------------
// Peças de UI
// ---------------------------------------------------------------------------

function Kpi({
  icone, rotulo, valor, nota, alerta,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: string | number;
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        alerta && 'border-red-300 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/10',
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icone} {rotulo}
      </p>
      <p className="mt-1 truncate text-xl font-bold leading-none">{valor}</p>
      {nota && <p className="mt-1 truncate text-[11px] text-muted-foreground">{nota}</p>}
    </div>
  );
}

function Bloco({
  titulo, icone, children,
}: {
  titulo: string;
  icone?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border p-4">
      <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        {icone} {titulo}
      </h4>
      {children}
    </section>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="truncate text-sm font-medium" title={valor}>
        {valor}
      </dd>
    </div>
  );
}

function Linha({ Icon, children }: { Icon: any; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> {children}
    </p>
  );
}

function Alerta({
  tom, icone, children,
}: {
  tom: 'vermelho' | 'amarelo' | 'azul';
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  const cores = {
    vermelho: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300',
    amarelo: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300',
    azul: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300',
  }[tom];
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border p-2.5 text-sm', cores)}>
      <span className="mt-0.5 shrink-0">{icone}</span>
      <span>{children}</span>
    </div>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <History className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
