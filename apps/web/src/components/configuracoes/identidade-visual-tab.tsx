'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Upload, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';
import {
  CONTRASTE_AA, contraste, derivarPaleta, hexParaRgb, TONS_COM_TEXTO_BRANCO,
} from '@/lib/paleta';
import {
  DICA_SLOT, ROTULO_SLOT, enviarLogo, obterIdentidade, removerLogo, salvarCor,
  type SlotLogo,
} from '@/lib/identidade-visual';

/**
 * IDENTIDADE VISUAL — a marca do sindicato, editável sem programador.
 *
 * UMA COR, E NÃO DEZ. A escala inteira é derivada da cor institucional, com
 * contraste conferido. Dez campos de cor pareceriam mais poderosos e
 * garantiriam, mais cedo ou mais tarde, um botão primário ilegível: o tom 700 é
 * fundo de botão com texto branco por cima, e já houve neste sistema um caso de
 * branco sobre branco por causa disso.
 *
 * A PRÉVIA MOSTRA O QUE VAI ACONTECER antes de salvar, porque errar a cor da
 * marca é o tipo de coisa que se percebe tarde — e a barra de contraste diz, em
 * português, se o texto vai ficar legível.
 */

const TONS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
const SLOTS: SlotLogo[] = [
  'horizontal-cor', 'horizontal-branco', 'vertical-cor', 'vertical-branco', 'icone',
];

export function IdentidadeVisualTab() {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['identidade-visual'],
    queryFn: obterIdentidade,
  });

  const corSalva = data?.corPrimaria ?? tenant.paleta[800] ?? '#000000';
  const [cor, setCor] = useState(corSalva);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { setCor(corSalva); }, [corSalva]);

  const previa = derivarPaleta(cor);
  const valida = previa !== null;
  const mudou = cor.toUpperCase() !== corSalva.toUpperCase();

  /** Recarrega a marca em todas as telas sem exigir F5. */
  const revalidarMarca = () => qc.invalidateQueries({ queryKey: ['identidade-visual'] });

  async function salvar() {
    if (!valida || salvando) return;
    setSalvando(true);
    try {
      await salvarCor(cor);
      await revalidarMarca();
      toast.success('Cor institucional atualizada.');
    } catch (e: unknown) {
      toast.error(mensagemErro(e, 'Não foi possível salvar a cor.'));
    } finally {
      setSalvando(false);
    }
  }

  async function restaurar() {
    setSalvando(true);
    try {
      await salvarCor(null);
      await revalidarMarca();
      setCor(tenant.paleta[800] ?? '#000000');
      toast.success('Cor restaurada para o padrão da instalação.');
    } catch (e: unknown) {
      toast.error(mensagemErro(e, 'Não foi possível restaurar.'));
    } finally {
      setSalvando(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-brand-800 dark:text-brand-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cor institucional</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Escolha a cor principal do sindicato. Os dez tons usados pelo sistema — botões,
            abas, gráficos, destaques — são calculados a partir dela, sempre com contraste
            suficiente para o texto continuar legível.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cor</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Seletor de cor"
                  value={valida ? normalizar(cor) : '#000000'}
                  onChange={(e) => setCor(e.target.value.toUpperCase())}
                  className="h-10 w-14 cursor-pointer rounded-lg border bg-transparent p-1"
                />
                <Input
                  value={cor}
                  onChange={(e) => setCor(e.target.value.toUpperCase())}
                  placeholder="#0F4C81"
                  className={cn('w-36 font-mono', !valida && 'border-red-500')}
                />
              </div>
              {!valida && (
                <p className="text-xs text-red-500">
                  Use um hexadecimal, por exemplo <span className="font-mono">#0F4C81</span>.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={salvar} disabled={!valida || !mudou || salvando}>
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar
              </Button>
              <Button variant="outline" onClick={restaurar} disabled={salvando || !data?.corPrimaria}>
                <RotateCcw className="h-4 w-4" />
                Restaurar padrão
              </Button>
            </div>
          </div>

          {previa && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Prévia dos dez tons</p>
              <div className="flex overflow-hidden rounded-lg border">
                {TONS.map((tom) => (
                  <div key={tom} className="flex-1" title={`${tom} · ${previa[String(tom)]}`}>
                    <div className="h-12" style={{ backgroundColor: previa[String(tom)] }} />
                    <div className="bg-muted/40 py-1 text-center text-[10px] text-muted-foreground">
                      {tom}
                    </div>
                  </div>
                ))}
              </div>

              {/* O que a pessoa realmente vai ver, com a cor aplicada. */}
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: previa['700'] }}
                >
                  Botão primário
                </span>
                <span
                  className="rounded-lg px-3 py-1.5 text-xs font-medium"
                  style={{ backgroundColor: previa['50'], color: previa['800'] }}
                >
                  Destaque suave
                </span>
              </div>

              <Contraste paleta={previa} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            PNG, WebP ou SVG com fundo transparente, até 2 MB. Enquanto um logo não for
            enviado, o sistema usa o arquivo padrão da instalação — e, se ele também não
            existir, a sigla <span className="font-semibold">{tenant.sigla}</span> escrita.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {SLOTS.map((slot) => (
              <CampoLogo
                key={slot}
                slot={slot}
                url={data?.logos?.[slot] ?? null}
                onMudou={async () => { await refetch(); await revalidarMarca(); }}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {data?.atualizadoEm && (
        <p className="text-center text-xs text-muted-foreground">
          Última alteração em{' '}
          {new Date(data.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          {data.atualizadoPor ? ` por ${data.atualizadoPor}` : ''}.
        </p>
      )}
    </div>
  );
}

/**
 * Diz em português se o texto branco fica legível sobre os tons de fundo
 * sólido. A derivação já garante isso — a barra existe para a pessoa VER a
 * garantia, em vez de confiar.
 */
function Contraste({ paleta }: { paleta: Record<string, string> }) {
  const piores = TONS_COM_TEXTO_BRANCO.map((tom) => ({
    tom,
    razao: contraste(paleta[String(tom)], '#FFFFFF'),
  }));
  const pior = piores.reduce((a, b) => (a.razao < b.razao ? a : b));
  const ok = pior.razao >= CONTRASTE_AA;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        ok
          ? 'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300'
          : 'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300',
      )}
    >
      {ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span>
        {ok ? (
          <>
            Texto branco legível em todos os fundos sólidos (pior caso: tom {pior.tom}, contraste{' '}
            {pior.razao.toFixed(1)}:1 — o mínimo recomendado é {CONTRASTE_AA}:1).
          </>
        ) : (
          <>
            O tom {pior.tom} ficou com contraste {pior.razao.toFixed(1)}:1 contra texto branco.
            Escolha uma cor mais escura.
          </>
        )}
      </span>
    </div>
  );
}

function CampoLogo({
  slot,
  url,
  onMudou,
}: {
  slot: SlotLogo;
  url: string | null;
  onMudou: () => void | Promise<void>;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  // O ícone é quadrado e colorido: prévia em fundo claro, como a aba.
  const fundoEscuro = slot.endsWith('branco');

  async function enviar(arquivo: File) {
    setOcupado(true);
    try {
      await enviarLogo(slot, arquivo);
      await onMudou();
      toast.success(`Logo ${ROTULO_SLOT[slot].toLowerCase()} atualizado.`);
    } catch (e: unknown) {
      toast.error(mensagemErro(e, 'Não foi possível enviar o arquivo.'));
    } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function remover() {
    setOcupado(true);
    try {
      await removerLogo(slot);
      await onMudou();
      toast.success('Voltou ao logo padrão da instalação.');
    } catch (e: unknown) {
      toast.error(mensagemErro(e, 'Não foi possível remover.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">{ROTULO_SLOT[slot]}</p>
        <p className="text-xs text-muted-foreground">{DICA_SLOT[slot]}</p>
      </div>

      {/* A versão branca só se enxerga sobre fundo escuro — mostrar as duas no
          mesmo fundo claro esconderia justamente o arquivo que se quer conferir. */}
      <div
        className={cn(
          'flex h-16 items-center justify-center rounded-md border',
          fundoEscuro ? 'bg-slate-800' : 'bg-white',
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="max-h-12 max-w-full object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">usando o padrão</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          ref={entrada}
          type="file"
          accept="image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar(f); }}
        />
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={ocupado}
          onClick={() => entrada.current?.click()}
        >
          {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Enviar
        </Button>
        {url && (
          <Button size="sm" variant="ghost" disabled={ocupado} onClick={remover}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function normalizar(hex: string): string {
  const rgb = hexParaRgb(hex);
  if (!rgb) return '#000000';
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function mensagemErro(e: unknown, padrao: string): string {
  const resposta = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  const msg = resposta?.data?.message;
  if (Array.isArray(msg)) return msg[0] ?? padrao;
  return msg ?? padrao;
}
