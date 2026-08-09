'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, CalendarPlus, Check, Copy, ExternalLink, Gift, Loader2, Play,
  Plus, Square, Trash2, Users, Vote, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { podeEditar, podeExcluir } from '@/lib/permissoes';
import { cn } from '@/lib/utils';
import { ResultadoPauta } from '@/components/eventos/resultado-pauta';
import { ListaPresenca } from '@/components/eventos/lista-presenca';
import { BotaoEncerrar, ResumoEncerramento } from '@/components/eventos/encerramento';
import {
  STATUS_EVENTO_COR, STATUS_EVENTO_LABEL, TIPO_EVENTO_LABEL,
  abrirPauta, apurarPauta, atualizarEvento, conferirSorteio, criarPauta, encerrarPauta,
  excluirEvento, impactoExclusao, linkGoogleAgenda, listarPautas, listarSorteios,
  obterEvento, sortear,
  type Apuracao, type ModoVotacao, type Pauta,
} from '@/lib/eventos';

export default function EventoAdminPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const pode = podeEditar(user?.role, user?.permissoes, 'eventos');

  const { data: evento, isLoading } = useQuery({
    queryKey: ['evento', id],
    queryFn: () => obterEvento(id),
  });

  const encerrada = evento?.status === 'REALIZADO';

  const { data: pautas } = useQuery({
    queryKey: ['evento-pautas', id],
    queryFn: () => listarPautas(id),
    enabled: !!evento?.configuracoes?.habilitarVotacao && !encerrada,
    refetchInterval: encerrada ? false : 3000,
  });

  const { data: sorteios } = useQuery({
    queryKey: ['evento-sorteios', id],
    queryFn: () => listarSorteios(id),
    enabled: !!evento?.configuracoes?.habilitarSorteio && !encerrada,
  });

  if (isLoading || !evento) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" />
      </div>
    );
  }

  const linkSala = typeof window !== 'undefined'
    ? `${window.location.origin}/evento/${id}`
    : `/evento/${id}`;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['evento', id] });
    qc.invalidateQueries({ queryKey: ['evento-pautas', id] });
    qc.invalidateQueries({ queryKey: ['evento-sorteios', id] });
    qc.invalidateQueries({ queryKey: ['evento-resumo', id] });
    qc.invalidateQueries({ queryKey: ['evento-presencas', id] });
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/eventos" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Eventos
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold">{evento.nome}</h2>
          <Badge className={STATUS_EVENTO_COR[evento.status]}>
            {STATUS_EVENTO_LABEL[evento.status]}
          </Badge>
          <span className="text-sm text-muted-foreground">{TIPO_EVENTO_LABEL[evento.tipo]}</span>
        </div>
      </div>

      <PainelLinks
        eventoId={id}
        evento={evento}
        linkSala={linkSala}
        pode={pode}
        encerrada={encerrada}
        onMudou={invalidar}
      />

      {/* Depois de encerrada, os controles ao vivo dão lugar ao que a
          assembleia PRODUZIU — que era exatamente o que faltava. */}
      {encerrada ? (
        <ResumoEncerramento eventoId={id} />
      ) : (
        <>
          {evento.configuracoes?.habilitarVotacao && (
            <SecaoPautas eventoId={id} pautas={pautas ?? []} pode={pode} onMudou={invalidar} />
          )}
          {evento.configuracoes?.habilitarSorteio && (
            <SecaoSorteios eventoId={id} sorteios={sorteios ?? []} pode={pode} onMudou={invalidar} />
          )}
          <ListaPresenca eventoId={id} aoVivo />
        </>
      )}
    </div>
  );
}

/**
 * Os dois links do evento, com rótulos que dizem qual é qual.
 *
 * Antes só existia o da sala, e o do Meet só podia ser definido na criação —
 * se a reunião caísse e a mesa abrisse outra sala, não havia como avisar
 * ninguém. Agora é editável durante a assembleia, e quem está na sala vê a
 * troca em 3 segundos pelo polling que já existe.
 */
function PainelLinks({
  eventoId, evento, linkSala, pode, encerrada, onMudou,
}: {
  eventoId: string;
  evento: any;
  linkSala: string;
  pode: boolean;
  encerrada: boolean;
  onMudou: () => void;
}) {
  const [link, setLink] = useState(evento.linkReuniao ?? '');
  const [salvando, setSalvando] = useState(false);

  // Se outro membro da mesa trocar o link, a tela acompanha.
  useEffect(() => { setLink(evento.linkReuniao ?? ''); }, [evento.linkReuniao]);

  const mudou = link.trim() !== (evento.linkReuniao ?? '');

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Sala virtual — o que se divulga aos filiados */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Link da sala virtual — divulgue este aos filiados
            </label>
            <div className="flex gap-2">
              <Input readOnly value={linkSala} className="font-mono text-xs" />
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(linkSala);
                  toast.success('Link copiado.');
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              É por aqui que o filiado faz check-in e vota.
            </p>
          </div>

          {/* Videoconferência — editável a qualquer momento */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Link da videoconferência (Meet, Zoom, Teams)
            </label>
            <div className="flex gap-2">
              <Input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="text-xs"
                disabled={!pode || encerrada}
              />
              {pode && !encerrada && (
                <Button
                  variant={mudou ? 'default' : 'outline'}
                  disabled={!mudou || salvando}
                  onClick={async () => {
                    setSalvando(true);
                    try {
                      await atualizarEvento(eventoId, { linkReuniao: link.trim() || undefined });
                      toast.success('Link atualizado — quem está na sala vê em instantes.');
                      onMudou();
                    } catch (e: any) {
                      toast.error(e?.response?.data?.message ?? 'Não foi possível salvar.');
                    } finally {
                      setSalvando(false);
                    }
                  }}
                >
                  {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
                </Button>
              )}
              {evento.linkReuniao && (
                <a href={evento.linkReuniao} target="_blank" rel="noreferrer">
                  <Button variant="outline" title="Abrir reunião"><ExternalLink className="h-4 w-4" /></Button>
                </a>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Só aparece para quem já fez check-in. Pode ser trocado durante a assembleia.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <span className="flex items-center gap-1.5 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" />
            <strong>{evento._count?.presencas ?? 0}</strong> presente(s)
          </span>

          {/* "Adicionar à minha agenda" é uma URL montada, não integração:
              funciona com Gmail pessoal e não exige Workspace, projeto no
              Cloud nem conta de serviço. */}
          <a
            href={linkGoogleAgenda({ ...evento, linkSala })}
            target="_blank"
            rel="noreferrer"
            className="inline-flex"
          >
            <Button variant="outline" size="sm">
              <CalendarPlus className="h-4 w-4" /> Adicionar à minha agenda
            </Button>
          </a>

          <div className="ml-auto flex gap-2">
            {pode && !encerrada && (
              <BotaoEncerrar eventoId={eventoId} onEncerrado={onMudou} />
            )}
            <BotaoExcluir eventoId={eventoId} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Excluir evento — SOMENTE ADMINISTRADOR.
 *
 * A regra global do sistema é que só o administrador apaga, e o botão nem
 * aparece para os demais (o backend recusa de qualquer forma). A confirmação
 * lista o que será destruído: todas as relações do evento são em cascata, e
 * depois do clique não resta nada de onde reconstituir presenças, votos ou
 * dossiê.
 */
function BotaoExcluir({ eventoId }: { eventoId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const ehAdmin = podeExcluir(user?.role);
  const [aberto, setAberto] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const { data: impacto } = useQuery({
    queryKey: ['evento-impacto', eventoId],
    queryFn: () => impactoExclusao(eventoId),
    enabled: aberto,
  });

  if (!ehAdmin) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-red-600 dark:text-red-400"
        title="Excluir evento"
        onClick={() => setAberto(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <ConfirmDialog
        open={aberto}
        variant="destructive"
        title="Excluir este evento?"
        confirmLabel="Excluir definitivamente"
        loading={excluindo}
        onClose={() => (excluindo ? null : setAberto(false))}
        onConfirm={async () => {
          setExcluindo(true);
          try {
            await excluirEvento(eventoId);
            toast.success('Evento excluído.');
            router.push('/eventos');
          } catch (e: any) {
            toast.error(e?.response?.data?.message ?? 'Não foi possível excluir.');
          } finally {
            setExcluindo(false);
          }
        }}
        description={
          !impacto ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Conferindo…
            </span>
          ) : (
            <div className="space-y-3 text-sm">
              <p>Remove <strong>{impacto.nome}</strong> permanentemente.</p>

              {impacto.temHistorico ? (
                <div className="space-y-1.5 rounded-lg bg-rose-50 p-3 dark:bg-rose-900/20">
                  <p className="text-xs font-semibold text-rose-900 dark:text-rose-200">
                    Isto destrói o registro de uma assembleia que já aconteceu:
                  </p>
                  <ul className="space-y-0.5 text-xs text-rose-900 dark:text-rose-200">
                    {impacto.presencas > 0 && <li>{impacto.presencas} presença(s) registrada(s)</li>}
                    {impacto.pautas > 0 && <li>{impacto.pautas} pauta(s) e {impacto.votos} voto(s)</li>}
                    {impacto.sorteios > 0 && <li>{impacto.sorteios} sorteio(s)</li>}
                    {impacto.dossieEmitido && <li>o dossiê já emitido</li>}
                  </ul>
                  <p className="pt-1 text-xs text-rose-900 dark:text-rose-200">
                    Não há como desfazer. Para apenas tirar da lista sem perder o registro,
                    altere o status para <strong>Cancelado</strong>.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Este evento não tem presenças, votações nem dossiê — nada de histórico se perde.
                </p>
              )}
            </div>
          )
        }
      />
    </>
  );
}

function SecaoPautas({
  eventoId, pautas, pode, onMudou,
}: { eventoId: string; pautas: Pauta[]; pode: boolean; onMudou: () => void }) {
  const [criando, setCriando] = useState(false);
  const [encerrando, setEncerrando] = useState<Pauta | null>(null);
  const [agindo, setAgindo] = useState(false);

  const aberta = pautas.find((p) => p.status === 'ABERTA');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          <Vote className="h-4 w-4 text-brand-800 dark:text-brand-400" /> Pautas
        </h3>
        {pode && (
          <Button size="sm" variant="outline" onClick={() => setCriando((v) => !v)}>
            <Plus className="h-4 w-4" /> Nova pauta
          </Button>
        )}
      </div>

      {criando && (
        <FormPauta
          eventoId={eventoId}
          onCriada={() => { setCriando(false); onMudou(); }}
          onCancelar={() => setCriando(false)}
        />
      )}

      {pautas.length === 0 && !criando && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma pauta criada.
        </CardContent></Card>
      )}

      {pautas.map((p) => (
        <CardPauta
          key={p.id}
          eventoId={eventoId}
          pauta={p}
          pode={pode}
          bloqueadaPor={p.status === 'RASCUNHO' ? aberta : undefined}
          onAbrir={async () => {
            try {
              await abrirPauta(eventoId, p.id);
              toast.success('Votação aberta.');
              onMudou();
            } catch (e: any) {
              toast.error(e?.response?.data?.message ?? 'Não foi possível abrir.');
            }
          }}
          onEncerrar={() => setEncerrando(p)}
        />
      ))}

      <ConfirmDialog
        open={!!encerrando}
        variant="destructive"
        title="Encerrar a votação?"
        confirmLabel="Encerrar e apurar"
        loading={agindo}
        onClose={() => (agindo ? null : setEncerrando(null))}
        onConfirm={async () => {
          if (!encerrando) return;
          setAgindo(true);
          try {
            const ap = await encerrarPauta(eventoId, encerrando.id);
            toast.success(
              ap.empate ? 'Encerrada — resultado: EMPATE.' : `Encerrada. Venceu: ${ap.vencedora?.rotulo}.`,
            );
            setEncerrando(null);
            onMudou();
          } catch (e: any) {
            toast.error(e?.response?.data?.message ?? 'Não foi possível encerrar.');
          } finally {
            setAgindo(false);
          }
        }}
        description={
          <div className="space-y-2">
            <p>
              Depois de encerrada, <strong>a pauta não pode ser reaberta</strong>. Quem ainda
              não votou perde o direito nesta pauta, e o resultado passa a aparecer para todos.
            </p>
            {/* Deliberação sem o quórum exigido é nula — o aviso precisa vir
                ANTES do clique, não depois. */}
            {encerrando?.quorumMinimo != null &&
              (encerrando.totalVotantes ?? 0) < encerrando.quorumMinimo && (
                <p className="rounded-lg bg-rose-50 p-2.5 text-xs font-medium text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">
                  Atenção: há {encerrando.totalVotantes ?? 0} voto(s) e o quórum mínimo é{' '}
                  {encerrando.quorumMinimo}. Encerrar agora registra a deliberação SEM quórum.
                </p>
              )}
          </div>
        }
      />
    </div>
  );
}

function CardPauta({
  eventoId, pauta, pode, bloqueadaPor, onAbrir, onEncerrar,
}: {
  eventoId: string;
  pauta: Pauta;
  pode: boolean;
  bloqueadaPor?: Pauta;
  onAbrir: () => void;
  onEncerrar: () => void;
}) {
  // O resultado só existe depois de encerrada — buscar antes seria expor
  // placar parcial, que influencia quem ainda não votou.
  const { data: apuracao } = useQuery<Apuracao>({
    queryKey: ['pauta-apuracao', pauta.id],
    queryFn: () => apurarPauta(eventoId, pauta.id),
    enabled: pauta.status === 'ENCERRADA',
  });

  const semQuorum =
    pauta.status === 'ABERTA' &&
    pauta.quorumMinimo != null &&
    (pauta.totalVotantes ?? 0) < pauta.quorumMinimo;

  return (
    <Card className={cn(pauta.status === 'ABERTA' && 'border-brand-400')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[200px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{pauta.titulo}</p>
              <Badge className={
                pauta.status === 'ABERTA'
                  ? 'bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100'
                  : pauta.status === 'ENCERRADA'
                    ? 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200'
                    : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
              }>
                {pauta.status === 'ABERTA' ? 'Aberta' : pauta.status === 'ENCERRADA' ? 'Encerrada' : 'Rascunho'}
              </Badge>
              {/* A modalidade em destaque: a mesa precisa saber o que está
                  conduzindo antes de alguém perguntar. */}
              <Badge className={
                pauta.modo === 'SECRETA'
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100'
              }>
                {pauta.modo === 'SECRETA' ? 'Voto secreto' : 'Voto nominal'}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pauta.opcoes.map((o) => o.rotulo).join(' · ')}
              {pauta.status !== 'RASCUNHO' && ` — ${pauta.totalVotantes ?? 0} voto(s)`}
              {pauta.quorumMinimo != null && ` · quórum mínimo ${pauta.quorumMinimo}`}
            </p>
          </div>

          {pode && (
            <div className="flex gap-2">
              {pauta.status === 'RASCUNHO' && (
                <Button
                  size="sm"
                  disabled={!!bloqueadaPor}
                  title={bloqueadaPor ? `Encerre "${bloqueadaPor.titulo}" primeiro` : undefined}
                  onClick={onAbrir}
                >
                  <Play className="h-4 w-4" /> Abrir votação
                </Button>
              )}
              {pauta.status === 'ABERTA' && (
                <Button size="sm" variant="outline" onClick={onEncerrar}>
                  <Square className="h-4 w-4" /> Encerrar
                </Button>
              )}
            </div>
          )}
        </div>

        {semQuorum && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
            Quórum mínimo ainda não atingido: {pauta.totalVotantes ?? 0} de {pauta.quorumMinimo}.
          </p>
        )}

        {/* O resultado, ali mesmo. A mesa precisa anunciar em voz alta no
            momento seguinte ao encerramento — ir procurar no dossiê não serve. */}
        {pauta.status === 'ENCERRADA' && apuracao && (
          <div className="border-t pt-3">
            <ResultadoPauta apuracao={apuracao} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FormPauta({
  eventoId, onCriada, onCancelar,
}: { eventoId: string; onCriada: () => void; onCancelar: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [modo, setModo] = useState<ModoVotacao>('SECRETA');
  const [opcoes, setOpcoes] = useState<string[]>(['Aprovo', 'Rejeito']);
  const [quorum, setQuorum] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await criarPauta(eventoId, {
        titulo,
        modo,
        quorumMinimo: quorum ? Number(quorum) : undefined,
        opcoes: opcoes
          .map((r) => r.trim())
          .filter(Boolean)
          .map((rotulo, i) => ({
            id: rotulo.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
              .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `opcao-${i + 1}`,
            rotulo,
          })),
      });
      toast.success('Pauta criada.');
      onCriada();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível criar a pauta.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Enunciado da pauta</label>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Aprovação das contas do exercício de 2025"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Modalidade do voto</label>
            <select
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
              value={modo}
              onChange={(e) => setModo(e.target.value as ModoVotacao)}
            >
              <option value="SECRETA">Secreta</option>
              <option value="NOMINAL">Nominal</option>
            </select>
            {/* A escolha é irreversível depois de aberta, e define se será
                possível saber quem votou o quê. A tela precisa dizer isso
                ENQUANTO ainda dá para mudar. */}
            <p className={cn(
              'rounded-lg p-2.5 text-xs',
              modo === 'SECRETA'
                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300'
                : 'bg-sky-50 text-sky-900 dark:bg-sky-900/20 dark:text-sky-100',
            )}>
              {modo === 'SECRETA' ? (
                <>
                  <strong>Ninguém saberá quem votou o quê</strong> — nem a diretoria, nem
                  com acesso ao banco de dados. Fica registrado apenas quem votou.
                  Uso típico: eleição de diretoria.
                </>
              ) : (
                <>
                  <strong>O voto de cada participante fica registrado</strong> e consta da
                  ata e da planilha de presença. Uso típico: quando o estatuto exige que a
                  ata nomeie os votos.
                </>
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Quórum mínimo (opcional)</label>
            <Input
              type="number"
              min={1}
              value={quorum}
              onChange={(e) => setQuorum(e.target.value)}
              placeholder="sem exigência"
            />
            <p className="text-xs text-muted-foreground">
              O sistema avisa antes de encerrar caso não seja atingido — deliberação
              sem o quórum exigido pode ser anulada.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Opções</label>
          {opcoes.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={o}
                onChange={(e) => setOpcoes((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {opcoes.length > 2 && (
                <Button variant="ghost" size="icon" onClick={() => setOpcoes((l) => l.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setOpcoes((l) => [...l, ''])}>
            <Plus className="h-4 w-4" /> Adicionar opção
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
          <Button
            disabled={salvando || !titulo.trim() || opcoes.filter((o) => o.trim()).length < 2}
            onClick={salvar}
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Criar pauta
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SecaoSorteios({
  eventoId, sorteios, pode, onMudou,
}: { eventoId: string; sorteios: any[]; pode: boolean; onMudou: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [sorteando, setSorteando] = useState(false);
  const [detalhe, setDetalhe] = useState<{ explicacao: string; seed: string } | null>(null);

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <Gift className="h-4 w-4 text-brand-800 dark:text-brand-400" /> Sorteios
      </h3>

      {pode && (
        <Card><CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <label className="text-sm font-medium">O que será sorteado</label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Brinde da assembleia" />
          </div>
          <Button
            disabled={sorteando || !titulo.trim()}
            onClick={async () => {
              setSorteando(true);
              try {
                const r = await sortear(eventoId, { titulo, quantidade: 1 });
                toast.success(`Sorteado: ${r.ganhadores[0]?.nome}`);
                setTitulo('');
                onMudou();
              } catch (e: any) {
                toast.error(e?.response?.data?.message ?? 'Não foi possível sortear.');
              } finally {
                setSorteando(false);
              }
            }}
          >
            {sorteando && <Loader2 className="h-4 w-4 animate-spin" />}
            <Gift className="h-4 w-4" /> Sortear
          </Button>
        </CardContent></Card>
      )}

      {sorteios.map((s) => (
        <Card key={s.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{s.titulo}</p>
              <p className="text-sm text-muted-foreground">
                {s.resultado?.map((g: any) => g.nome).join(', ')}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              title="Confere se o resultado foi alterado depois de realizado"
              onClick={async () => {
                const r = await conferirSorteio(eventoId, s.id);
                // Em português de gente. A explicação técnica ("a ordem gravada
                // é a que a semente produz") é verdadeira e não diz nada a quem
                // preside uma assembleia — fica atrás do "ver detalhes".
                if (r.confere) {
                  toast.success('Sorteio conferido: o resultado não foi alterado.');
                } else {
                  toast.error('ATENÇÃO: o resultado gravado não confere com o sorteio original.');
                }
                setDetalhe({ explicacao: r.explicacao, seed: r.seed });
              }}
            >
              <Check className="h-4 w-4" /> Conferir
            </Button>
          </CardContent>
        </Card>
      ))}

      <ConfirmDialog
        open={!!detalhe}
        title="Como esta conferência funciona"
        confirmLabel="Entendi"
        onConfirm={() => setDetalhe(null)}
        onClose={() => setDetalhe(null)}
        description={
          <div className="space-y-2 text-sm">
            <p>
              No momento do sorteio, o sistema gera uma <strong>semente</strong> aleatória e a
              guarda. Os ganhadores saem de um cálculo que depende só dela e da lista de
              presentes — ou seja, o mesmo sorteio pode ser refeito e conferido por qualquer
              pessoa, mas ninguém consegue prevê-lo nem escolher o resultado.
            </p>
            <p className="text-muted-foreground">{detalhe?.explicacao}</p>
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              Semente: {detalhe?.seed}
            </p>
            <p className="text-xs text-muted-foreground">
              A semente também é impressa no dossiê da assembleia.
            </p>
          </div>
        }
      />
    </div>
  );
}
