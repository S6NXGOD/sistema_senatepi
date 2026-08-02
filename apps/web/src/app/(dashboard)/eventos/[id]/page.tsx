'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, Copy, Gift, Loader2, Play, Plus, Square, Users, Vote, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { podeEditar } from '@/lib/permissoes';
import { cn } from '@/lib/utils';
import {
  STATUS_EVENTO_COR, STATUS_EVENTO_LABEL, TIPO_EVENTO_LABEL,
  abrirPauta, atualizarEvento, conferirSorteio, criarPauta, encerrarPauta,
  listarPautas, listarSorteios, obterEvento, sortear,
  type ModoVotacao, type Pauta,
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

  const { data: pautas } = useQuery({
    queryKey: ['evento-pautas', id],
    queryFn: () => listarPautas(id),
    enabled: !!evento?.configuracoes?.habilitarVotacao,
    // A mesa precisa ver a contagem subir enquanto a votação corre.
    refetchInterval: 3000,
  });

  const { data: sorteios } = useQuery({
    queryKey: ['evento-sorteios', id],
    queryFn: () => listarSorteios(id),
    enabled: !!evento?.configuracoes?.habilitarSorteio,
  });

  if (isLoading || !evento) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" />
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

      {/* Link da sala — o que a mesa divulga aos filiados. */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Link da sala virtual — divulgue este endereço
              </label>
              <Input readOnly value={linkSala} className="font-mono text-xs" />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(linkSala);
                toast.success('Link copiado.');
              }}
            >
              <Copy className="h-4 w-4" /> Copiar
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-muted-foreground" />
              <strong>{evento._count?.presencas ?? 0}</strong> presente(s)
            </span>
            {pode && evento.status !== 'REALIZADO' && (
              <Button
                size="sm"
                variant={evento.status === 'EM_ANDAMENTO' ? 'outline' : 'default'}
                onClick={async () => {
                  const novo = evento.status === 'EM_ANDAMENTO' ? 'REALIZADO' : 'EM_ANDAMENTO';
                  await atualizarEvento(id, { status: novo });
                  toast.success(novo === 'EM_ANDAMENTO' ? 'Evento aberto.' : 'Evento encerrado.');
                  invalidar();
                }}
              >
                {evento.status === 'EM_ANDAMENTO' ? 'Encerrar evento' : 'Abrir evento'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {evento.configuracoes?.habilitarVotacao && (
        <SecaoPautas eventoId={id} pautas={pautas ?? []} pode={pode} onMudou={invalidar} />
      )}

      {evento.configuracoes?.habilitarSorteio && (
        <SecaoSorteios eventoId={id} sorteios={sorteios ?? []} pode={pode} onMudou={invalidar} />
      )}
    </div>
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
          <Vote className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" /> Pautas
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
        <Card key={p.id} className={cn(p.status === 'ABERTA' && 'border-senatepi-400')}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-[200px] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{p.titulo}</p>
                <Badge className={
                  p.status === 'ABERTA'
                    ? 'bg-senatepi-100 text-senatepi-900 dark:bg-senatepi-900/40 dark:text-senatepi-100'
                    : p.status === 'ENCERRADA'
                      ? 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200'
                      : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
                }>
                  {p.status === 'ABERTA' ? 'Aberta' : p.status === 'ENCERRADA' ? 'Encerrada' : 'Rascunho'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {p.modo === 'SECRETA' ? 'secreta' : 'nominal'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {p.opcoes.map((o) => o.rotulo).join(' · ')}
                {p.status !== 'RASCUNHO' && ` — ${p.totalVotantes ?? 0} voto(s)`}
              </p>
            </div>

            {pode && (
              <div className="flex gap-2">
                {p.status === 'RASCUNHO' && (
                  <Button
                    size="sm"
                    // Uma pauta aberta por vez: a API recusa a segunda, e
                    // desabilitar aqui evita o erro em vez de explicá-lo.
                    disabled={!!aberta}
                    title={aberta ? `Encerre "${aberta.titulo}" primeiro` : undefined}
                    onClick={async () => {
                      try {
                        await abrirPauta(eventoId, p.id);
                        toast.success('Votação aberta.');
                        onMudou();
                      } catch (e: any) {
                        toast.error(e?.response?.data?.message ?? 'Não foi possível abrir.');
                      }
                    }}
                  >
                    <Play className="h-4 w-4" /> Abrir votação
                  </Button>
                )}
                {p.status === 'ABERTA' && (
                  <Button size="sm" variant="outline" onClick={() => setEncerrando(p)}>
                    <Square className="h-4 w-4" /> Encerrar
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
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
          <>
            Depois de encerrada, <strong>a pauta não pode ser reaberta</strong> e o resultado
            passa a aparecer para todos os participantes. Quem ainda não votou perde o direito
            nesta pauta.
          </>
        }
      />
    </div>
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
        // O id vem do rótulo normalizado: é o que a urna grava, e precisa ser
        // estável e legível quando alguém abrir o dossiê daqui a anos.
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
            <label className="text-sm font-medium">Modo</label>
            <select
              className="h-12 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
              value={modo}
              onChange={(e) => setModo(e.target.value as ModoVotacao)}
            >
              <option value="SECRETA">Secreta — ninguém saberá quem votou o quê</option>
              <option value="NOMINAL">Nominal — o voto de cada um fica registrado</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {modo === 'SECRETA'
                ? 'Uso típico: eleição de diretoria.'
                : 'Uso típico: quando a ata precisa registrar o voto de cada presente.'}
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpcoes((l) => l.filter((_, j) => j !== i))}
                >
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

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <Gift className="h-4 w-4 text-senatepi-800 dark:text-senatepi-400" /> Sorteios
      </h3>

      {pode && (
        <Card><CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <label className="text-sm font-medium">O que será sorteado</label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Brinde da assembleia"
            />
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
              title="Reexecuta a semente e confirma que o resultado gravado é o que ela produz"
              onClick={async () => {
                const r = await conferirSorteio(eventoId, s.id);
                (r.confere ? toast.success : toast.error)(r.explicacao);
              }}
            >
              <Check className="h-4 w-4" /> Conferir
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
