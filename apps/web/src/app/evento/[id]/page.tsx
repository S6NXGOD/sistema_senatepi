'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2, ExternalLink, Gift, Loader2, Lock, ShieldCheck, Video, Vote,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AVISO_LGPD, abrirSala, checkinComDados, esquecerPresenca, estadoAoVivo, fazerCheckin, guardarPresenca,
  lerPresenca, obterSessao, votar,
  type EstadoAoVivo, type Sessao,
} from '@/lib/eventos';

/**
 * SALA VIRTUAL — a tela do participante, sem login.
 *
 * Dois estados: antes do check-in (CPF) e depois (plenário). A credencial é o
 * `presencaId`, guardado em sessionStorage para a pessoa não ter que digitar o
 * CPF de novo a cada atualização da página.
 */
export default function SalaPage() {
  const { id } = useParams<{ id: string }>();
  const [presencaId, setPresencaId] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  // Lê a credencial só no cliente: sessionStorage não existe no servidor.
  useEffect(() => {
    setPresencaId(lerPresenca(id));
    setPronto(true);
  }, [id]);

  const { data: sessao, isError } = useQuery({
    queryKey: ['sala-sessao', id, presencaId],
    queryFn: () => obterSessao(id, presencaId!),
    enabled: !!presencaId,
    retry: false,
  });

  // Credencial inválida (evento trocou, sessão antiga): volta ao check-in em
  // vez de deixar a tela travada num erro que a pessoa não sabe resolver.
  useEffect(() => {
    if (isError && presencaId) {
      esquecerPresenca(id);
      setPresencaId(null);
    }
  }, [isError, presencaId, id]);

  if (!pronto) return <Carregando />;

  return (
    <div className="min-h-screen bg-cinza-claro dark:bg-background">
      <header className="border-b bg-white dark:bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Logo orientation="horizontal" variant="auto" className="h-9" />
          {sessao && (
            <span className="truncate text-sm text-muted-foreground">
              {sessao.participante.nome}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {sessao ? (
          <Plenario eventoId={id} sessao={sessao} />
        ) : (
          <Checkin
            eventoId={id}
            onEntrou={(pid) => { guardarPresenca(id, pid); setPresencaId(pid); }}
          />
        )}
      </main>
    </div>
  );
}

function Carregando() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" />
    </div>
  );
}

// ===========================================================================
// Check-in
// ===========================================================================

function Checkin({ eventoId, onEntrou }: { eventoId: string; onEntrou: (id: string) => void }) {
  const [cpf, setCpf] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * Segunda etapa — o CPF não localizou nenhum cadastro.
   *
   * A tela NÃO diz "você não está cadastrado": além de provavelmente falso
   * (70% da base veio da planilha sem CPF), num link público isso revelaria a
   * estranhos quem é ou não filiado. Pede a complementação como parte normal
   * do fluxo, porque para o filiado é exatamente isso.
   */
  const [complementar, setComplementar] = useState(false);
  const [nome, setNome] = useState('');
  const [nascimento, setNascimento] = useState('');

  const { data: sala, isLoading } = useQuery({
    queryKey: ['sala', eventoId],
    queryFn: () => abrirSala(eventoId),
    retry: false,
    // Enquanto o check-in não abriu, revalida sozinho: quem chegou cedo não
    // precisa ficar atualizando a página para descobrir que já pode entrar.
    refetchInterval: (q) => (q.state.data?.checkinAberto ? false : 30_000),
  });

  function concluir(r: Awaited<ReturnType<typeof fazerCheckin>>) {
    if (!r.participante) return;
    toast.success(r.participante.jaEstava ? 'Bem-vindo(a) de volta!' : 'Presença registrada!');
    onEntrou(r.participante.presencaId);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await fazerCheckin(eventoId, cpf);
      // CPF não localizado não é recusa — é a segunda etapa.
      if (r.precisaComplementar) {
        setComplementar(true);
        return;
      }
      if (!r.liberado || !r.participante) {
        setErro(r.motivo);
        return;
      }
      concluir(r);
    } catch (e: any) {
      setErro(e?.response?.data?.message ?? 'Não foi possível registrar sua presença.');
    } finally {
      setEnviando(false);
    }
  }

  async function enviarComplemento(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await checkinComDados(eventoId, {
        cpf,
        nomeCompleto: nome,
        dataNascimento: nascimento || undefined,
      });
      if (!r.liberado || !r.participante) {
        setErro(r.motivo);
        return;
      }
      concluir(r);
    } catch (e: any) {
      setErro(e?.response?.data?.message ?? 'Não foi possível registrar sua presença.');
    } finally {
      setEnviando(false);
    }
  }

  if (isLoading) return <Carregando />;

  if (!sala) {
    return (
      <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
        Evento não encontrado. Confira o link recebido.
      </CardContent></Card>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{sala.nome}</h1>
        {sala.descricao && <p className="mt-1 text-sm text-muted-foreground">{sala.descricao}</p>}
        <p className="mt-2 text-sm text-muted-foreground">
          {new Date(sala.dataInicio).toLocaleString('pt-BR', {
            dateStyle: 'long', timeStyle: 'short',
          })}
        </p>
      </div>

      {sala.avisoCheckin && (
        <Card><CardContent className="p-4 text-sm">{sala.avisoCheckin}</CardContent></Card>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          {!sala.checkinAberto ? (
            <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{sala.motivo}</span>
            </div>
          ) : complementar ? (
            /* Segunda etapa. O texto é neutro de propósito: "confirme seus
               dados", não "você não foi encontrado". O cadastro é que está
               incompleto, e dizer o contrário culpa a pessoa errada. */
            <form onSubmit={enviarComplemento} className="space-y-3">
              <div>
                <p className="text-sm font-medium">Confirme seus dados</p>
                <p className="text-xs text-muted-foreground">
                  Precisamos de mais uma informação para registrar sua presença.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="nome">Nome completo</label>
                <Input
                  id="nome"
                  autoComplete="off"
                  placeholder="Como está no seu cadastro"
                  value={nome}
                  onChange={(e) => { setNome(e.target.value); setErro(null); }}
                  className="text-lg"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="nasc">
                  Data de nascimento <span className="font-normal text-muted-foreground">(opcional)</span>
                </label>
                <Input
                  id="nasc"
                  type="date"
                  value={nascimento}
                  onChange={(e) => setNascimento(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Ajuda a confirmar sua identidade caso haja outro associado com nome parecido.
                </p>
              </div>

              {erro && (
                <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">
                  {erro}
                </p>
              )}

              <Button
                type="submit"
                className="h-12 w-full text-base"
                disabled={enviando || nome.trim().length < 5}
              >
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar presença
              </Button>
              <button
                type="button"
                className="w-full text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => { setComplementar(false); setErro(null); }}
              >
                Corrigir o CPF informado
              </button>
            </form>
          ) : (
            <form onSubmit={enviar} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="cpf">
                  Informe seu CPF para confirmar presença
                </label>
                <Input
                  id="cpf"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={(e) => { setCpf(e.target.value); setErro(null); }}
                  className="text-lg"
                />
              </div>

              {sala.exigeAdimplencia && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Este evento exige contribuição associativa em dia.
                </p>
              )}

              {erro && (
                <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">
                  {erro}
                </p>
              )}

              <Button type="submit" className="h-12 w-full text-base" disabled={enviando || cpf.replace(/\D/g, '').length !== 11}>
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar presença
              </Button>
            </form>
          )}

          {/* O aviso vem ANTES da coleta. Avisar depois não é aviso. */}
          <p className="border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
            {AVISO_LGPD}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ===========================================================================
// Plenário
// ===========================================================================

function Plenario({ eventoId, sessao }: { eventoId: string; sessao: Sessao }) {
  const qc = useQueryClient();

  const { data: aoVivo } = useQuery({
    queryKey: ['sala-ao-vivo', eventoId, sessao.participante.presencaId],
    queryFn: () => estadoAoVivo(eventoId, sessao.participante.presencaId),
    // 3s: abrir uma pauta e ver a contagem subir não precisa ser instantâneo,
    // e polling sobrevive a queda de rede sem reconexão manual.
    refetchInterval: 3000,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      {/* Esquerda: a reunião */}
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Video className="h-4 w-4 text-brand-800 dark:text-brand-400" />
              {sessao.evento.nome}
            </h2>
            {sessao.evento.linkReuniao ? (
              <>
                <a href={sessao.evento.linkReuniao} target="_blank" rel="noreferrer">
                  <Button className="h-12 w-full text-base">
                    <ExternalLink className="h-4 w-4" /> Entrar na videoconferência
                  </Button>
                </a>
                {/* O Google Meet recusa ser exibido dentro de outra página
                    (X-Frame-Options). Em vez de mostrar um quadro cinza que
                    parece defeito, a reunião abre ao lado e a tela explica. */}
                <p className="text-xs text-muted-foreground">
                  A reunião abre em outra janela. Deixe esta aba aberta ao lado — é
                  por ela que você vota e acompanha os avisos da mesa.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                O link da reunião ainda não foi publicado pela organização.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-2.5 p-4 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
            <span>
              Presença confirmada como <strong>{sessao.participante.nome}</strong>.
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Direita: painel dinâmico */}
      <div className="space-y-4">
        {sessao.recursos.votacao && (
          <PainelVotacao
            eventoId={eventoId}
            presencaId={sessao.participante.presencaId}
            aoVivo={aoVivo}
            onVotou={() => qc.invalidateQueries({ queryKey: ['sala-ao-vivo'] })}
          />
        )}
        {sessao.recursos.sorteio && aoVivo?.ultimoSorteio && (
          <PainelSorteio sorteio={aoVivo.ultimoSorteio} />
        )}
        {!sessao.recursos.votacao && !sessao.recursos.sorteio && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            Acompanhe a reunião. Avisos da mesa aparecem aqui.
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

function PainelVotacao({
  eventoId, presencaId, aoVivo, onVotou,
}: {
  eventoId: string;
  presencaId: string;
  aoVivo?: EstadoAoVivo;
  onVotou: () => void;
}) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const pauta = aoVivo?.pauta;

  async function escolher(opcaoId: string) {
    if (!pauta) return;
    setEnviando(opcaoId);
    try {
      await votar(eventoId, pauta.id, presencaId, opcaoId);
      // A confirmação NÃO repete a opção escolhida — numa pauta secreta, o
      // próprio aviso na tela vazaria o voto para quem estiver ao lado.
      toast.success('Seu voto foi registrado.');
      onVotou();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Não foi possível registrar seu voto.');
    } finally {
      setEnviando(null);
    }
  }

  if (!pauta) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <Vote className="h-7 w-7 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Nenhuma votação aberta no momento.</p>
      </CardContent></Card>
    );
  }

  const encerrada = pauta.status === 'ENCERRADA';

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div>
          <span className={cn(
            'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
            encerrada
              ? 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200'
              : 'bg-brand-100 text-brand-900 dark:bg-brand-900/40 dark:text-brand-100',
          )}>
            {encerrada ? 'Encerrada' : 'Votação aberta'}
            {pauta.modo === 'SECRETA' && ' · secreta'}
          </span>
          <h3 className="mt-2 font-semibold leading-tight">{pauta.titulo}</h3>
          {pauta.descricao && (
            <p className="mt-1 text-sm text-muted-foreground">{pauta.descricao}</p>
          )}
        </div>

        {encerrada && pauta.resultado ? (
          <Resultado apuracao={pauta.resultado} />
        ) : pauta.jaVotou ? (
          <div className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm dark:bg-brand-900/20">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
            <span>
              Seu voto já foi registrado.
              {pauta.modo === 'SECRETA' && ' Por ser votação secreta, ele não fica vinculado ao seu nome.'}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {pauta.opcoes.map((o) => (
              <Button
                key={o.id}
                variant="outline"
                className="h-12 w-full justify-start text-base"
                disabled={!!enviando}
                onClick={() => escolher(o.id)}
              >
                {enviando === o.id && <Loader2 className="h-4 w-4 animate-spin" />}
                {o.rotulo}
              </Button>
            ))}
          </div>
        )}

        {/* Com a pauta aberta, só o número de votantes — nunca o placar.
            Resultado parcial influencia quem ainda não votou. */}
        {!encerrada && (
          <p className="text-center text-xs text-muted-foreground">
            {pauta.votantes ?? 0} voto(s) registrado(s)
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Resultado({ apuracao }: { apuracao: NonNullable<EstadoAoVivo['pauta']>['resultado'] }) {
  if (!apuracao) return null;
  return (
    <div className="space-y-2">
      {apuracao.resultado.map((r) => (
        <div key={r.opcaoId} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className={cn(apuracao.vencedora?.opcaoId === r.opcaoId && 'font-semibold')}>
              {r.rotulo}
            </span>
            <span className="text-muted-foreground">{r.votos} ({r.percentual}%)</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full transition-all',
                apuracao.vencedora?.opcaoId === r.opcaoId
                  ? 'bg-brand-700 dark:bg-brand-400'
                  : 'bg-muted-foreground/30',
              )}
              style={{ width: `${r.percentual}%` }}
            />
          </div>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        {apuracao.totalVotantes} de {apuracao.presentes} presentes votaram.
        {apuracao.empate && ' Resultado: EMPATE.'}
        {apuracao.quorumMinimo != null && !apuracao.quorumAtingido && ' Quórum mínimo NÃO atingido.'}
      </p>
    </div>
  );
}

function PainelSorteio({ sorteio }: { sorteio: NonNullable<EstadoAoVivo['ultimoSorteio']> }) {
  return (
    <Card className="border-brand-300 dark:border-brand-800">
      <CardContent className="space-y-2 p-5 text-center">
        <Gift className="mx-auto h-7 w-7 text-brand-700 dark:text-brand-400" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{sorteio.titulo}</p>
        {sorteio.resultado?.map((g) => (
          <p key={g.filiadoId} className="text-lg font-bold leading-tight">{g.nome}</p>
        ))}
        {sorteio.premio && <p className="text-sm text-muted-foreground">{sorteio.premio}</p>}
      </CardContent>
    </Card>
  );
}
