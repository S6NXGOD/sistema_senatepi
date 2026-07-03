'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Snowflake, Fan, Ticket, Phone, AlertTriangle, Loader2, Sun, Waves,
  UserCheck, UserX, ArrowRight, ArrowLeft, CalendarCheck2, CalendarX2, Clock, Ban, Sparkles,
  BedDouble, MapPin, Clock3,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getDisponibilidade, partesData, SECRETARIA, ESTRUTURA_QUARTO, LoteDisp, QuartoDisp } from '@/lib/colonia';
import { CheckoutModal, TipoCheckout } from '@/components/colonia/checkout-modal';

const WHATSAPP_MSG = 'Olá! Gostaria de saber mais informações sobre como me filiar ao SENATEPI.';
const WHATSAPP_URL = `https://wa.me/${SECRETARIA.whatsappNumero}?text=${encodeURIComponent(WHATSAPP_MSG)}`;

function primeiroDisponivel(quartos: QuartoDisp[], clim: 'AR_CONDICIONADO' | 'VENTILADOR') {
  return quartos.find((q) => q.climatizacao === clim && q.modoReserva === 'RESERVA_DIRETA' && q.disponivel);
}

/** Glifo oficial do WhatsApp (inline para respeitar CSP e permitir cor via currentColor). */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

export function ColoniaPublica({ slug }: { slug?: string }) {
  const qc = useQueryClient();
  const [etapa, setEtapa] = useState<'gate' | 'vitrine'>('gate');
  const [naoFiliado, setNaoFiliado] = useState(false);
  const [checkout, setCheckout] = useState<{ lote: LoteDisp['lote']; tipo: TipoCheckout; quarto?: QuartoDisp } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['colonia-disponibilidade', slug ?? 'ativa'],
    queryFn: () => getDisponibilidade(slug),
    enabled: etapa === 'vitrine',
    retry: false,
  });

  const status = (error as any)?.response?.status;
  const indisponivel = status === 403 || status === 404;

  return (
    <div className="min-h-screen bg-gradient-to-b from-senatepi-50/60 via-background to-background dark:from-senatepi-900/10">
      {/* Topo */}
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo orientation="horizontal" variant="auto" className="h-9" />
            <span className="hidden text-sm font-medium text-muted-foreground sm:inline">· Colônia de Férias</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        {/* ETAPA 1 — GATEKEEPER */}
        {etapa === 'gate' && (
          <div className="mx-auto max-w-lg animate-fade-in">
            <Card className="overflow-hidden">
              {/* Banner com vibe de férias */}
              <div className="relative isolate overflow-hidden bg-gradient-to-br from-senatepi-800 to-senatepi-600 px-8 py-10 text-center text-white">
                <Sun className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 text-white/10" />
                <Waves className="pointer-events-none absolute -bottom-8 -left-6 h-28 w-28 text-white/10" />
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                  <Sun className="h-9 w-9" />
                </div>
                <h1 className="text-2xl font-bold sm:text-3xl">Colônia de Férias SENATEPI</h1>
                <p className="mt-2 text-sm text-white/90 sm:text-base">
                  Descanso, lazer e boas memórias para você e sua família.
                </p>
              </div>

              <CardContent className="space-y-5 p-8 text-center">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Você é filiado ativo do SENATEPI?</h2>
                  <p className="text-sm text-muted-foreground">As reservas são exclusivas para filiados ativos.</p>
                </div>
                <div className="flex flex-col gap-3">
                  <Button size="lg" className="h-12 text-base" onClick={() => setEtapa('vitrine')}>
                    <UserCheck className="h-5 w-5" /> Sou Filiado Ativo <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button size="lg" variant="outline" className="h-12 text-base" onClick={() => setNaoFiliado(true)}>
                    <UserX className="h-5 w-5" /> Ainda não sou filiado
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A condição de filiado ativo é verificada no momento do check-in.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ETAPA 2 — VITRINE */}
        {etapa === 'vitrine' && (
          <div className="animate-fade-in space-y-6">
            {isLoading && (
              <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-senatepi-800 dark:text-senatepi-400" />
              </div>
            )}

            {indisponivel && (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                  <AlertTriangle className="h-10 w-10 text-amber-500" />
                  <p className="text-lg font-semibold">Reservas indisponíveis</p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Não há campanha aberta no momento. Acompanhe os canais oficiais do SENATEPI para a próxima temporada.
                  </p>
                  <Button variant="outline" className="mt-2" onClick={() => setEtapa('gate')}>
                    <ArrowLeft className="h-4 w-4" /> Voltar ao início
                  </Button>
                </CardContent>
              </Card>
            )}

            {data && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => setEtapa('gate')} aria-label="Voltar" title="Voltar">
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                      <h1 className="text-xl font-bold sm:text-2xl">Temporada {data.temporada.nome}</h1>
                      <p className="text-sm text-muted-foreground">Escolha um lote e reserve seu quarto</p>
                    </div>
                  </div>
                  <Badge className="bg-senatepi-50 text-senatepi-900 dark:bg-senatepi-900/30 dark:text-senatepi-400">
                    Reservas abertas
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.lotes.map((l) => (
                    <LoteCard
                      key={l.lote.id}
                      l={l}
                      onEscolher={(tipo, quarto) => setCheckout({ lote: l.lote, tipo, quarto })}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Overlay bloqueante — não filiado (conversão via WhatsApp) */}
      {naoFiliado && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setNaoFiliado(false)}
        >
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-6 text-center sm:p-8">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-senatepi-50 dark:bg-senatepi-900/30">
                <Sparkles className="h-8 w-8 text-senatepi-800 dark:text-senatepi-400" />
              </div>
              <h3 className="text-xl font-bold">Que tal fazer parte do SENATEPI?</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                As reservas da Colônia são um dos muitos benefícios exclusivos para filiados ativos. Fale com a nossa
                secretaria e descubra como se filiar — é rápido e acolhedor!
              </p>

              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex items-center justify-center gap-3 rounded-xl bg-[#25D366] px-5 py-3.5 font-semibold text-white shadow-sm transition-transform hover:scale-[1.02] hover:bg-[#20bd5a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/50"
              >
                <WhatsAppIcon className="h-6 w-6" /> Falar no WhatsApp
              </a>

              <a
                href={SECRETARIA.telefoneHref}
                className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-input px-5 py-3 font-semibold hover:bg-muted"
              >
                <Phone className="h-5 w-5 text-senatepi-800 dark:text-senatepi-400" /> Ligar para a Secretaria
              </a>

              {/* Endereço + horário de atendimento */}
              <div className="mt-4 space-y-2 rounded-xl bg-muted/50 p-4 text-left text-sm">
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-senatepi-800 dark:text-senatepi-400" />
                  <span>{SECRETARIA.endereco}</span>
                </p>
                <p className="flex items-start gap-2">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-senatepi-800 dark:text-senatepi-400" />
                  <span>{SECRETARIA.horario}</span>
                </p>
                <p className="flex items-start gap-2">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-senatepi-800 dark:text-senatepi-400" />
                  <span>{SECRETARIA.telefone}</span>
                </p>
              </div>

              <Button variant="ghost" className="mt-4 w-full" onClick={() => setNaoFiliado(false)}>
                Voltar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modal de checkout */}
      {checkout && data && (
        <CheckoutModal
          slug={data.temporada.slug}
          campanha={data.temporada.nome}
          lote={checkout.lote}
          tipo={checkout.tipo}
          quarto={checkout.quarto}
          onClose={() => setCheckout(null)}
          onReservado={() => qc.invalidateQueries({ queryKey: ['colonia-disponibilidade'] })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de Lote — DATA/HORÁRIO em destaque máximo
// ---------------------------------------------------------------------------

function LoteCard({ l, onEscolher }: { l: LoteDisp; onEscolher: (tipo: TipoCheckout, quarto?: QuartoDisp) => void }) {
  const arQuarto = primeiroDisponivel(l.quartos, 'AR_CONDICIONADO');
  const ventQuarto = primeiroDisponivel(l.quartos, 'VENTILADOR');
  const ini = partesData(l.lote.dataInicio);
  const fim = partesData(l.lote.dataFim);
  const vagasDiretas = l.quartos.filter((q) => q.disponivel).length;

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* Faixa: número do lote + status */}
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
        <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Lote {l.lote.numero}</span>
        <StatusBadge l={l} />
      </div>

      {/* HERO — Check-in / Check-out em destaque */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-1 px-3 py-5">
        <DataBloco rotulo="Check-in" Icon={CalendarCheck2} partes={ini} />
        <div className="flex flex-col items-center gap-1 self-center text-muted-foreground">
          <ArrowRight className="h-5 w-5" />
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">2 noites</span>
        </div>
        <DataBloco rotulo="Check-out" Icon={CalendarX2} partes={fim} />
      </div>

      {/* Vagas disponíveis */}
      <div className="px-4 pb-1 text-center text-xs font-semibold">
        {l.esgotado ? (
          <span className="text-muted-foreground">Sem vagas disponíveis</span>
        ) : vagasDiretas > 0 ? (
          <span className="text-senatepi-800 dark:text-senatepi-400">
            {vagasDiretas} {vagasDiretas === 1 ? 'vaga disponível' : 'vagas disponíveis'}
          </span>
        ) : l.sorteioHabilitado ? (
          <span className="text-amber-600 dark:text-amber-400">Vagas diretas esgotadas — sorteio aberto</span>
        ) : null}
      </div>

      {/* Ações */}
      <CardContent className="mt-auto space-y-2 border-t bg-muted/20 p-4">
        {l.esgotado ? (
          <div className="flex h-12 items-center justify-center gap-2 rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
            <Ban className="h-4 w-4" /> Lote Esgotado
          </div>
        ) : (
          <>
            {l.arDisponivel ? (
              <AcaoBtn Icon={Snowflake} texto="Reservar Quarto com Ar-condicionado" onClick={() => arQuarto && onEscolher('AR', arQuarto)} />
            ) : (
              <LinhaEsgotada Icon={Snowflake} texto="Ar-condicionado esgotado" />
            )}

            {l.ventiladorDiretoDisponivel ? (
              <AcaoBtn Icon={Fan} texto="Reservar Quarto com Ventilador" variant="secondary" onClick={() => ventQuarto && onEscolher('VENTILADOR', ventQuarto)} />
            ) : (
              <LinhaEsgotada Icon={Fan} texto="Ventilador esgotado" />
            )}

            {l.sorteioHabilitado && (
              <AcaoBtn
                Icon={Ticket}
                texto="Entrar no Sorteio"
                className="bg-amber-500 text-white shadow hover:bg-amber-600"
                onClick={() => onEscolher('SORTEIO')}
              />
            )}
          </>
        )}

        {/* Estrutura padrão dos quartos */}
        <p className="flex items-start gap-1 pt-1 text-[10px] leading-tight text-muted-foreground">
          <BedDouble className="mt-0.5 h-3 w-3 shrink-0" /> {ESTRUTURA_QUARTO}
        </p>
      </CardContent>
    </Card>
  );
}

function DataBloco({ rotulo, Icon, partes }: { rotulo: string; Icon: any; partes: ReturnType<typeof partesData> }) {
  return (
    <div className="text-center">
      <div className="mb-1 flex items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {rotulo}
      </div>
      <div className="text-4xl font-extrabold leading-none tracking-tight text-foreground">{partes.dia}</div>
      <div className="text-sm font-bold uppercase text-senatepi-800 dark:text-senatepi-400">{partes.mes}</div>
      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-senatepi-50 px-2 py-0.5 text-xs font-bold text-senatepi-900 dark:bg-senatepi-900/40 dark:text-senatepi-400">
        <Clock className="h-3 w-3" /> {partes.hora}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{partes.diaSemana}</div>
    </div>
  );
}

function AcaoBtn({
  Icon, texto, onClick, variant, className,
}: {
  Icon: any; texto: string; onClick: () => void;
  variant?: 'default' | 'secondary'; className?: string;
}) {
  return (
    <Button
      variant={variant}
      onClick={onClick}
      className={`h-12 w-full !whitespace-normal px-2 text-center text-sm font-semibold leading-tight ${className ?? ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" /> {texto}
    </Button>
  );
}

function LinhaEsgotada({ Icon, texto }: { Icon: any; texto: string }) {
  return (
    <div className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {texto}
    </div>
  );
}

function StatusBadge({ l }: { l: LoteDisp }) {
  if (l.esgotado) return <Badge className="bg-muted text-muted-foreground">Esgotado</Badge>;
  if (l.sorteioHabilitado)
    return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Sorteio aberto</Badge>;
  return <Badge className="bg-senatepi-50 text-senatepi-900 dark:bg-senatepi-900/30 dark:text-senatepi-400">Disponível</Badge>;
}
