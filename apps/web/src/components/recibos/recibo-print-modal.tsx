'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer, Scissors, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { obterIdentidade } from '@/lib/identidade-visual';
import {
  obterRecibo, formatBRL, formatData, formatDataExtenso, formatDataHora, formatDocumento,
  type ReciboCompleto,
} from '@/lib/recibos';

const LGPD =
  'Documento em conformidade com a LGPD (Lei nº 13.709/2018): dados pessoais tratados exclusivamente para a gestão financeira associativa.';

/**
 * O PAPEL — HTML com `@media print`, e não jsPDF.
 *
 * É o padrão da casa (o carnê e o carnê de uma parcela saem assim), e a razão é
 * prática: no jsPDF a seta e o emoji somem EM SILÊNCIO da fonte, o acento pede
 * cuidado, e qualquer ajuste de layout é aritmética de coordenadas. Aqui o que
 * se vê na tela é o que sai na folha.
 *
 * DUAS VIAS NA MESMA FOLHA — a do pagador e a do sindicato, com o picote no
 * meio. É como o recibo de papel sempre foi usado no balcão: uma vai, uma fica.
 * Imprimir duas folhas para isso seria gastar o dobro e obrigar a juntar.
 */
export function ReciboPrintModal({
  reciboId,
  onClose,
}: {
  reciboId: string;
  onClose: () => void;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recibo', reciboId],
    queryFn: () => obterRecibo(reciboId),
  });
  // Pública: a marca da instalação, quando o sindicato subiu a logo dele.
  const { data: marca } = useQuery({ queryKey: ['identidade-visual'], queryFn: obterIdentidade });
  const logo = marca?.logos['horizontal-cor'] ?? null;

  if (!montado) return null;

  const conteudo = (
    <div id="recibo-print-root">
      <div className="recibo-overlay fixed inset-0 z-[60] overflow-auto bg-black/60 p-4">
        <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-white">
              {data ? `Recibo ${data.codigo}` : 'Recibo'}
            </p>
            <p className="text-xs text-white/80">
              Sai em duas vias na mesma folha — uma para quem pagou, uma para o sindicato.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={() => window.print()} disabled={!data}>
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
            <Button variant="ghost" onClick={onClose} aria-label="Fechar" className="text-white hover:bg-white/15">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/*
          O AVISO DO CANCELAMENTO FICA NA TELA, e não só no papel: quem abriu
          para tirar 2ª via precisa ver ANTES de imprimir que este recibo não
          vale mais.
        */}
        {data?.cancelado && (
          <div className="no-print mx-auto mb-4 w-full max-w-[210mm] rounded-xl bg-rose-600 px-4 py-3 text-sm text-white">
            <strong>Este recibo foi cancelado</strong>
            {data.canceladoEm && ` em ${formatDataHora(data.canceladoEm)}`}
            {data.canceladoPorNome && ` por ${data.canceladoPorNome}`}.
            {data.canceladoMotivo && <> Motivo: {data.canceladoMotivo}</>}
          </div>
        )}

        <div className="recibo-paper mx-auto w-full max-w-[210mm] bg-white p-[10mm] text-[#111] shadow-xl">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-brand-800" />
            </div>
          ) : isError || !data ? (
            <p className="py-20 text-center text-sm text-red-600">
              Não foi possível carregar o recibo.
            </p>
          ) : (
            <div className="space-y-0">
              <ViaDoRecibo r={data} logo={logo} via="Via de quem pagou" />
              <Picote />
              <ViaDoRecibo r={data} logo={logo} via="Via do sindicato" />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(conteudo, document.body);
}

/** O picote entre as duas vias — a tesoura diz onde cortar sem precisar legenda. */
function Picote() {
  return (
    <div className="flex items-center gap-2 py-4 text-gray-400">
      <Scissors className="h-3 w-3 shrink-0" />
      <span className="h-0 flex-1 border-t border-dashed border-gray-400" />
    </div>
  );
}

function ViaDoRecibo({
  r,
  logo,
  via,
}: {
  r: ReciboCompleto;
  logo: string | null;
  via: string;
}) {
  const e = r.emitente;
  const cidade = e.cidade ? `${e.cidade}` : '';

  return (
    <section className="relative break-inside-avoid rounded-md border border-gray-400 p-4 text-[11px] leading-snug">
      {/*
        O CARIMBO DE CANCELADO ATRAVESSA O PAPEL. Um recibo cancelado que sai da
        impressora parecendo válido é pior que não sair: alguém vai guardar.
      */}
      {r.cancelado && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex -rotate-[18deg] items-center justify-center text-[42px] font-black tracking-[0.2em] text-rose-600/25"
        >
          CANCELADO
        </p>
      )}

      {/* Cabeçalho institucional */}
      <header className="flex items-start justify-between gap-4 border-b border-gray-300 pb-2">
        <div className="flex items-start gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-9 object-contain" />
          ) : (
            <p className="text-base font-bold text-brand-800">{e.sigla}</p>
          )}
          <div>
            <p className="text-[12px] font-bold uppercase leading-tight">{e.nomeCurto}</p>
            <p className="text-[9px] uppercase leading-tight text-gray-600">{e.nome}</p>
            <p className="mt-0.5 text-[9px] text-gray-600">
              {e.cnpj && <>CNPJ {e.cnpj}</>}
              {e.registroSindical && <> · Registro sindical {e.registroSindical}</>}
            </p>
            {e.endereco && <p className="text-[9px] text-gray-600">{e.endereco}</p>}
            {(e.telefone || e.email) && (
              <p className="text-[9px] text-gray-600">
                {[e.telefone, e.email].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[9px] uppercase tracking-wide text-gray-500">Recibo nº</p>
          <p className="text-lg font-bold tabular-nums leading-none">{r.codigo}</p>
          <p className="mt-1 text-[9px] uppercase tracking-wide text-gray-500">{via}</p>
        </div>
      </header>

      {/* O VALOR, em algarismo e por extenso — a parte que ninguém confere depois. */}
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray-300 pb-2">
        <p className="text-2xl font-bold tabular-nums">{formatBRL(r.valor)}</p>
        <p className="text-[11px] italic text-gray-700">({r.valorPorExtenso})</p>
      </div>

      {/* O corpo: quem pagou, por quê, como e quando */}
      <dl className="mt-2 space-y-1.5">
        <Linha rotulo="Recebemos de">
          <span className="font-semibold uppercase">{r.pagadorNome}</span>
          {r.pagadorDocumento && (
            <span className="text-gray-700"> — CPF/CNPJ {formatDocumento(r.pagadorDocumento)}</span>
          )}
          {r.filiadoMatricula && (
            <span className="text-gray-700"> — matrícula {r.filiadoMatricula}</span>
          )}
        </Linha>
        <Linha rotulo="Referente a">{r.referente}</Linha>
        <Linha rotulo="Forma de pagamento">
          {r.formaPagamento}
          <span className="text-gray-700"> · recebido em {formatData(r.recebidoEm)}</span>
        </Linha>
      </dl>

      {/* Fecho e assinatura */}
      <div className="mt-3 border-t border-gray-300 pt-2">
        <p className="text-[10px] text-gray-700">
          Para clareza e como prova de quitação do valor acima, firmamos o presente recibo.
        </p>
        <p className="mt-1 text-[10px]">
          {cidade && <>{cidade}, </>}
          {formatDataExtenso(r.recebidoEm)}.
        </p>
        <div className="mt-6 text-center">
          <p className="mx-auto w-[70%] border-t border-gray-500 pt-1 text-[10px] font-semibold uppercase">
            {e.nomeCurto}
          </p>
          <p className="text-[9px] text-gray-600">
            {e.cnpj ? `CNPJ ${e.cnpj}` : e.sigla} — assinatura e carimbo
          </p>
        </div>
      </div>

      {/* Rodapé: a trilha, UMA vez por via */}
      <footer className="mt-2 border-t border-gray-200 pt-1.5 text-[8px] leading-tight text-gray-500">
        <p>
          Emitido por {r.emitidoPorNome ?? 'sistema'} em {formatDataHora(r.emitidoEm)} ·
          recibo {r.codigo} · exercício {r.exercicio}
          {r.cancelado && (
            <span className="font-semibold text-rose-700">
              {' '}· CANCELADO
              {r.canceladoEm ? ` em ${formatDataHora(r.canceladoEm)}` : ''}
              {r.canceladoMotivo ? ` — ${r.canceladoMotivo}` : ''}
            </span>
          )}
        </p>
        <p>{LGPD}</p>
      </footer>
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="w-[34mm] shrink-0 text-[9px] uppercase tracking-wide text-gray-500">
        {rotulo}
      </dt>
      {/*
        SEM `truncate`: papel não tem reticências (`senatepi-carne-impresso`).
        O nome inteiro cabe quebrando a linha; cortado, ele vira adivinha num
        documento em que não há como clicar para ver o resto.
      */}
      <dd className={cn('min-w-0 flex-1 break-words')}>{children}</dd>
    </div>
  );
}
