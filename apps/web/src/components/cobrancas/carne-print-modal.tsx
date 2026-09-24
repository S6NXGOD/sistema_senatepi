'use client';

import { useEffect, useState } from 'react';
import { formatDataPura } from '@/lib/data-pura';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getCarne, CarneData, TIPO_LABEL, formatBRL, formatData, formatCpf,
} from '@/lib/cobrancas';
import { tenant } from '@/tenant.config';
import { V } from '@/lib/vocabulario';

const LGPD =
  'Documento em conformidade com a LGPD (Lei nº 13.709/2018): dados pessoais tratados exclusivamente para fins de gestão financeira associativa.';

/**
 * Modal de impressão do carnê (A4). Renderiza um bloco por parcela — canhoto
 * (esquerda, controle do sindicato) + recibo (direita, filiado) — com QR do PIX.
 * O CSS global de `@media print` esconde a navegação e mostra só o carnê.
 */
export function CarnePrintModal({
  cobrancaId,
  parcelaId,
  onClose,
}: {
  cobrancaId: string;
  /**
   * Abre mostrando SÓ esta parcela.
   *
   * 24/09/2026: "E se eu quiser enviar só o carnê de uma parcela? Sou obrigado
   * enviar o carnê inteiro no final das contas." Estava — e o pior é que a
   * ação já vivia no menu DA PARCELA: clicar em "Imprimir carnê" na parcela 2
   * imprimia as doze. O menu prometia uma coisa e fazia outra.
   *
   * A escolha não fica presa: o cabeçalho troca entre as duas sem fechar nada.
   */
  parcelaId?: string;
  onClose: () => void;
}) {
  const [montado, setMontado] = useState(false);
  /** `null` = carnê inteiro. Começa no que quem abriu pediu. */
  const [somente, setSomente] = useState<string | null>(parcelaId ?? null);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['carne', cobrancaId],
    queryFn: () => getCarne(cobrancaId),
  });

  if (!montado) return null;

  /*
    O QUE ESTÁ NA TELA, em uma frase — e qual é a outra saída.

    Nada disto existe quando a cobrança tem UMA parcela só: aí "esta parcela" e
    "o carnê inteiro" são a mesma folha, e oferecer a troca seria oferecer nada.
  */
  const total = data?.parcelas.length ?? 0;
  const aParcela = somente ? data?.parcelas.find((p) => p.id === somente) : null;
  const vale = total > 1;

  const titulo = !data
    ? 'Pré-visualização do carnê'
    : aParcela
      ? `Parcela ${aParcela.numero} de ${data.cobranca.totalParcelas}`
      : `Carnê completo · ${total} ${total === 1 ? 'parcela' : 'parcelas'}`;

  const rotuloImprimir = aParcela ? 'Imprimir parcela' : 'Imprimir';

  const outraOpcao = !vale
    ? null
    : somente
      ? { rotulo: `Imprimir o carnê inteiro (${total})`, aoClicar: () => setSomente(null) }
      : parcelaId
        ? { rotulo: 'Voltar para só esta parcela', aoClicar: () => setSomente(parcelaId) }
        : null;

  const conteudo = (
    <div id="carne-print-root">
      <div className="carne-overlay fixed inset-0 z-[60] overflow-auto bg-black/60 p-4">
        {/*
          A BARRA DIZ O QUE VAI SAIR, e deixa trocar sem fechar nada.

          Antes dizia só "Pré-visualização do carnê" e imprimia sempre as doze
          parcelas — inclusive quando aberta pelo menu de UMA. Agora o título é
          o conteúdo ("Parcela 3 de 12" ou "Carnê completo · 12 parcelas") e ao
          lado fica a outra opção, em texto, porque é troca de recorte e não
          ação: botão daria a ela o mesmo peso de "Imprimir".
        */}
        <div className="no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{titulo}</p>
            {outraOpcao && (
              <button
                type="button"
                onClick={outraOpcao.aoClicar}
                className="text-xs text-white/75 underline underline-offset-2 hover:text-white"
              >
                {outraOpcao.rotulo}
              </button>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={onClose}><X className="h-4 w-4" /> Fechar</Button>
            <Button onClick={() => window.print()} disabled={isLoading || isError || !data}>
              <Printer className="h-4 w-4" /> {rotuloImprimir}
            </Button>
          </div>
        </div>

        {/* Papel A4 */}
        <div className="carne-paper mx-auto w-full max-w-[210mm] bg-white p-[10mm] text-[#111] shadow-xl">
          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-800" /></div>
          ) : isError || !data ? (
            <p className="py-20 text-center text-sm text-red-600">Não foi possível carregar o carnê.</p>
          ) : (
            <div className="space-y-3">
              {data.parcelas
                .filter((p) => !somente || p.id === somente)
                .map((p) => (
                  <CarneBloco key={p.id} data={data} parcela={p} />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(conteudo, document.body);
}

// ---------------------------------------------------------------------------

function CarneBloco({ data, parcela }: { data: CarneData; parcela: CarneData['parcelas'][number] }) {
  const { config, filiado, cobranca } = data;
  const recebedor = config?.pixNomeRecebedor ?? tenant.sigla;
  const posicao = `${parcela.numero}/${cobranca.totalParcelas}`;
  const rodape = [config?.textoRodapeCarne, LGPD].filter(Boolean).join(' ');

  return (
    <div className="flex break-inside-avoid overflow-hidden rounded-md border border-gray-400 text-[10px] leading-tight">
      {/* CANHOTO — controle do sindicato (esquerda, menor) */}
      <div className="w-[30%] border-r border-dashed border-gray-500 p-3">
        <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-gray-500">Controle · Sindicato</p>
        {config?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.logoUrl} alt="" className="mb-1 h-6 object-contain" />
        ) : (
          <p className="text-xs font-bold text-brand-800">{tenant.sigla}</p>
        )}
        <MiniLinha rotulo={V.Filiado} valor={filiado.nomeCompleto} />
        <MiniLinha rotulo="Matrícula" valor={filiado.matricula} />
        <MiniLinha rotulo="Parcela" valor={posicao} />
        <MiniLinha rotulo="Vencimento" valor={formatDataPura(parcela.dataVencimento)} />
        <div className="mt-1 border-t pt-1">
          <p className="text-[8px] uppercase text-gray-500">Valor</p>
          <p className="text-sm font-bold">{formatBRL(parcela.valor)}</p>
        </div>
      </div>

      {/* RECIBO — via do filiado (direita, maior) */}
      <div className="flex-1 p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {config?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={config.logoUrl} alt="" className="h-8 object-contain" />
            )}
            <div>
              <p className="text-sm font-bold text-brand-800">{recebedor}</p>
              <p className="text-[9px] uppercase tracking-wide text-gray-500">
                Carnê de Pagamento · {TIPO_LABEL[cobranca.tipo]}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[8px] uppercase text-gray-500">Parcela</p>
            <p className="text-base font-bold">{posicao}</p>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-4 gap-x-3 gap-y-1 border-y py-2">
          <Campo rotulo={V.Filiado} valor={filiado.nomeCompleto} className="col-span-2" />
          <Campo rotulo="CPF" valor={formatCpf(filiado.cpf)} />
          <Campo rotulo="Vencimento" valor={formatDataPura(parcela.dataVencimento)} />
          <Campo rotulo="Competência" valor={formatDataPura(parcela.dataCompetencia)} />
          <Campo rotulo="Valor" valor={formatBRL(parcela.valor)} destaque className="col-span-3" />
        </div>

        <div className="mt-2 flex items-start gap-3">
          {/* QR do PIX (gerado no front a partir do payload do backend) */}
          <div className="shrink-0 text-center">
            {parcela.copiaECola ? (
              <>
                <QRCodeSVG value={parcela.copiaECola} size={92} level="M" />
                <p className="mt-1 w-[92px] text-[7.5px] font-semibold uppercase text-gray-500">
                  Pague com o app do banco
                </p>
              </>
            ) : (
              <div className="flex h-[92px] w-[92px] items-center justify-center rounded border border-dashed p-1 text-center text-[8px] text-gray-400">
                Configure a chave PIX do sindicato
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {parcela.copiaECola && (
              <>
                <p className="text-[8px] font-semibold uppercase text-gray-500">PIX Copia e Cola</p>
                <p className="break-all font-mono text-[8px] leading-snug text-gray-700">{parcela.copiaECola}</p>
              </>
            )}
            {/* Assinatura do presidente */}
            <div className="mt-3 flex justify-end">
              <div className="text-center">
                {config?.assinaturaPresidenteUrl ? (
                  /*
                    A ASSINATURA PARECIA COLADA — e estava (24/09/2026).

                    "Pelo que me parece, a assinatura do presidente tá como se
                    fosse um fundo. Como se ela tivesse colada."

                    Baixei a imagem da produção e medi: é um PNG 243×52 COM
                    canal alfa e com **100% dos pixels opacos** — ou seja, uma
                    foto do papel, com o papel dentro. O fundo tem luminância
                    mediana 239 e puxa para o verde (um canto é 214,239,210);
                    sobre a folha branca isso vira um retângulo acinzentado em
                    volta da assinatura. Só 5,2% dos pixels são tinta.

                    O campo é uma URL na Configuração, não um upload, então não
                    dá para limpar a imagem na origem: o conserto é na hora de
                    desenhar. Os números saíram de simular o filtro sobre os
                    pixels reais:

                      filtro                         fundo   tinta   meio-tom
                      nenhum ....................... 11,4%    0,1%     88,5%
                      brightness(1.1) contrast(3) .. 91,5%    2,4%      6,1%   ← come a assinatura
                      brightness(.78) contrast(7) .. 88,1%    8,0%      4,0%   ← escolhido

                    O `contrast(3)` mais "suave" derruba a tinta de 5,2% para
                    2,4%: clareia o traço junto com o papel. O escolhido leva o
                    fundo a branco puro, ENGROSSA o traço (5,2% → 8%) e deixa só
                    4% de meio-tom, que é a borda do traço — e borda de traço
                    tem de ser meio-tom mesmo.

                    Imagem já recortada (fundo transparente) não é prejudicada:
                    filtro de cor não mexe no canal alfa, e tinta cinza só fica
                    mais preta.
                  */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={config.assinaturaPresidenteUrl}
                    alt=""
                    className="mx-auto h-8 object-contain [filter:grayscale(1)_brightness(0.78)_contrast(7)]"
                  />
                ) : (
                  <div className="h-8" />
                )}
                <div className="w-40 border-t border-gray-500" />
                <p className="text-[8px] text-gray-500">Presidência — {recebedor}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé: texto de responsabilidade + menção à LGPD */}
        <p className="mt-2 border-t pt-1 text-[7.5px] leading-snug text-gray-500">{rodape}</p>
      </div>
    </div>
  );
}

/*
  PAPEL NÃO TEM RETICÊNCIAS (24/09/2026).

  `truncate` corta com "…" — o que faz sentido numa tabela, onde dá para abrir
  a linha, e nenhum num documento impresso: "MARA BIANCA AMORIM CAMP…" no
  canhoto é o campo mais importante do controle do sindicato virando adivinha,
  e ninguém pode "clicar para ver o resto" num papel.

  Nome grande quebra em duas linhas. Há espaço de sobra: o canhoto termina com
  um vão vazio, e o recibo cresce alguns milímetros no máximo.
*/
function MiniLinha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="leading-snug">
      <span className="text-gray-500">{rotulo}: </span>
      <span className="font-medium text-gray-800">{valor}</span>
    </p>
  );
}

function Campo({ rotulo, valor, destaque, className }: { rotulo: string; valor: string; destaque?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <p className="text-[8px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={`leading-snug ${destaque ? 'text-sm font-bold text-brand-800' : 'font-medium text-gray-800'}`}>{valor}</p>
    </div>
  );
}
