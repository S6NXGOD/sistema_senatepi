'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ReceiptText, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BuscaSelect, type ItemBusca } from '@/components/ui/busca-select';
import { useSobreposicao } from '@/components/ui/use-sobreposicao';
import { cn } from '@/lib/utils';
import { buscarFiliados } from '@/lib/colonia';
import { comoDistinguir, nomeComparavel, nomesRepetidos } from '@/lib/distinguir-filiado';
import {
  emitirRecibo, formatBRL, formatData, hojeEmTeresina,
  FORMAS_DE_PAGAMENTO, type PagamentoParaRecibo,
} from '@/lib/recibos';
import { V } from '@/lib/vocabulario';

/**
 * DE ONDE O RECIBO NASCE.
 *
 *  · `PAGAMENTO` — um valor que JÁ está no caixa (baixa de parcela, repasse
 *    patronal). Valor e data vêm de lá e não se digitam: digitar de novo é a
 *    chance de o papel divergir do livro.
 *  · `AVULSO` — dinheiro recebido no balcão sem lançamento prévio. Aqui o
 *    lançamento de ENTRADA nasce junto com o recibo, na mesma transação.
 */
export type OrigemDaEmissao =
  | { tipo: 'AVULSO' }
  | { tipo: 'PAGAMENTO'; pagamento: PagamentoParaRecibo };

export function EmitirReciboModal({
  origem,
  onClose,
  onEmitido,
}: {
  origem: OrigemDaEmissao;
  onClose: () => void;
  /** Recebe o id do recibo gravado — a tela abre a impressão em seguida. */
  onEmitido: (id: string) => void;
}) {
  const qc = useQueryClient();
  const doCaixa = origem.tipo === 'PAGAMENTO' ? origem.pagamento : null;

  const [valor, setValor] = useState(doCaixa ? String(doCaixa.valor.toFixed(2)) : '');
  const [referente, setReferente] = useState(doCaixa?.referenteSugerido ?? '');
  const [forma, setForma] = useState('PIX');
  const [recebidoEm, setRecebidoEm] = useState(
    doCaixa ? doCaixa.data.slice(0, 10) : hojeEmTeresina(),
  );
  const [pagador, setPagador] = useState(doCaixa?.pagadorNome ?? '');
  const [documento, setDocumento] = useState(doCaixa?.pagadorDocumento ?? '');
  const [filiadoId, setFiliadoId] = useState<string | null>(doCaixa?.filiadoId ?? null);
  /* O CPF real de cada candidato da busca — ver `onEscolher`. */
  const [cpfPorId] = useState(() => new Map<string, string | null>());

  const { fundo } = useSobreposicao(true, () => { if (!emitir.isPending) onClose(); });

  const emitir = useMutation({
    mutationFn: () =>
      emitirRecibo({
        // Pela PARCELA quando existe: é a ligação mais específica, e é ela que
        // impede o segundo recibo da mesma mensalidade.
        parcelaId: doCaixa?.parcelaId ?? undefined,
        movimentacaoId: doCaixa && !doCaixa.parcelaId ? (doCaixa.movimentacaoId ?? undefined) : undefined,
        valor: doCaixa ? undefined : Number(valor),
        referente: referente.trim() || undefined,
        formaPagamento: forma.trim(),
        recebidoEm: doCaixa ? undefined : recebidoEm,
        pagadorNome: pagador.trim() || undefined,
        pagadorDocumento: documento.trim() || undefined,
        filiadoId: filiadoId ?? undefined,
        empresaId: doCaixa?.empresaId ?? undefined,
      }),
    onSuccess: async (r) => {
      toast.success(`Recibo ${r.codigo} emitido.`);
      /*
        AS CHAVES QUE EXISTEM DE VERDADE. `['cobrancas']` não é chave de
        consulta nenhuma — `chaves-de-consulta.spec` pegou isto: invalidar
        um prefixo que ninguém declara não erra, não faz nada, e a
        parcela continuaria mostrando "emitir recibo" depois de emitido.
      */
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['recibos'] }),
        qc.invalidateQueries({ queryKey: ['cobrancas-filiado'] }),
        qc.invalidateQueries({ queryKey: ['cobrancas-por-filiado'] }),
      ]);
      onEmitido(r.id);
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? 'Não foi possível emitir o recibo.'),
  });

  function confirmar() {
    if (!forma.trim()) return toast.error('Diga como o valor foi recebido.');
    if (!doCaixa) {
      if (!(Number(valor) > 0)) return toast.error('Informe o valor recebido.');
      if (!referente.trim()) return toast.error('Diga a que o recibo se refere.');
      if (!pagador.trim()) return toast.error('Informe quem pagou.');
    }
    emitir.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      {...fundo}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg animate-dialogo-entrar overflow-y-auto rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-brand-50 p-2 dark:bg-brand-900/30">
              <ReceiptText className="h-6 w-6 text-brand-700 dark:text-brand-400" />
            </div>
            <div>
              <h3 className="font-semibold leading-tight">Emitir recibo</h3>
              <p className="text-xs text-muted-foreground">
                {doCaixa
                  ? 'O número sai na hora de gravar e nunca muda.'
                  : 'A entrada no caixa é lançada junto com o recibo.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={emitir.isPending}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/*
            O QUE VEM DO CAIXA NÃO SE DIGITA. Valor e data já estão lançados;
            reescrevê-los aqui abriria caminho para o papel dizer um número e o
            livro outro. O que se edita é a FRASE do recibo e a forma.
          */}
          {doCaixa ? (
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Pagamento já lançado no caixa
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{formatBRL(doCaixa.valor)}</p>
              <p className="text-xs text-muted-foreground">
                Recebido em {formatData(doCaixa.data)}
                {doCaixa.conta ? ` · ${doCaixa.conta}` : ''}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Valor recebido *">
                <Input
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                />
              </Campo>
              <Campo rotulo="Data do recebimento *">
                <Input
                  type="date"
                  value={recebidoEm}
                  onChange={(e) => setRecebidoEm(e.target.value)}
                />
              </Campo>
            </div>
          )}

          {/*
            O ASTERISCO SÓ ONDE O CAMPO É OBRIGATÓRIO. No recibo de uma
            parcela o servidor monta a frase a partir da competência e da
            posição no carnê — ele sabe, a tela não. Marcar como
            obrigatório um campo que o servidor preenche é pedir que a
            pessoa escreva de novo, pior.
          */}
          <Campo rotulo={doCaixa ? 'Referente a' : 'Referente a *'}>
            <Input
              value={referente}
              onChange={(e) => setReferente(e.target.value)}
              placeholder={
                doCaixa
                  ? 'Em branco, usa a descrição do pagamento'
                  : 'Ex.: 2ª via da carteirinha'
              }
              maxLength={180}
            />
            {/*
              O PLACEHOLDER TRAZ O EXEMPLO, e o campo abre VAZIO
              (`senatepi-encaminhamento-precisa-de-nome`): título padrão é
              título que ninguém troca, e o recibo sai dizendo o que o sistema
              achou em vez do que aconteceu.
            */}
          </Campo>

          <Campo rotulo="Como foi pago *">
            <div className="flex flex-wrap gap-1.5">
              {FORMAS_DE_PAGAMENTO.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setForma(f)}
                  aria-pressed={forma === f}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    forma === f
                      ? 'border-brand-800 bg-brand-800 text-white'
                      : 'hover:bg-muted',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            {!FORMAS_DE_PAGAMENTO.includes(forma) && (
              <Input
                value={forma}
                onChange={(e) => setForma(e.target.value)}
                placeholder="Como foi pago"
                maxLength={40}
                className="mt-2"
              />
            )}
            <button
              type="button"
              onClick={() => setForma(FORMAS_DE_PAGAMENTO.includes(forma) ? '' : 'PIX')}
              className="mt-1.5 text-xs text-muted-foreground underline underline-offset-2"
            >
              {FORMAS_DE_PAGAMENTO.includes(forma) ? 'Foi de outro jeito' : 'Voltar às formas usuais'}
            </button>
          </Campo>

          <div className="space-y-3 rounded-xl border p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <UserRound className="h-3.5 w-3.5" /> Quem pagou
            </p>

            {/*
              PROCURAR NO CADASTRO É ATALHO, não obrigação. Quem paga pode não
              ser filiado — o acompanhante no evento, a empresa, o terceiro que
              quitou o acordo. O nome digitado vale sozinho.
            */}
            {!doCaixa && (
              <BuscaSelect
                placeholder={`Procurar no cadastro de ${V.filiados.toLowerCase()}`}
                minimo={2}
                onBuscar={async (termo) => {
                  const achados = await buscarFiliados(termo);
                  /*
                    HOMÔNIMO É O CASO COMUM NESTA BASE — 145 grupos de nome
                    idêntico (`senatepi-homonimo-nao-e-duplicata`). A linha de
                    apoio sai da regra única do projeto, que acrescenta a
                    matrícula SÓ quando o nome se repete na lista.
                  */
                  const repetidos = nomesRepetidos(achados);
                  cpfPorId.clear();
                  return achados.map((f) => {
                    cpfPorId.set(f.id, f.cpf ?? null);
                    return {
                      id: f.id,
                      rotulo: f.nome,
                      detalhe: comoDistinguir(f, repetidos.has(nomeComparavel(f.nome))),
                    } satisfies ItemBusca;
                  });
                }}
                onEscolher={(item) => {
                  setPagador(item.rotulo);
                  setFiliadoId(item.id);
                  /* O CPF vem do cadastro, não da linha de apoio — ela traz o
                     CPF MASCARADO, e mascarado não é documento. */
                  const cpf = cpfPorId.get(item.id);
                  if (cpf) setDocumento(cpf);
                }}
                rodape="Opcional — serve para o recibo aparecer na ficha da pessoa."
              />
            )}

            <Campo rotulo={doCaixa ? 'Nome' : 'Nome *'}>
              <Input
                value={pagador}
                onChange={(e) => { setPagador(e.target.value); setFiliadoId(null); }}
                placeholder="Nome de quem entregou o valor"
                maxLength={120}
              />
            </Campo>
            <Campo rotulo="CPF ou CNPJ">
              <Input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="Opcional"
                inputMode="numeric"
                maxLength={20}
              />
            </Campo>
          </div>

          {/*
            O AVISO DO QUE NÃO TEM VOLTA. Emitir grava um número que não se
            reaproveita: errar aqui significa cancelar e reemitir, e o
            cancelado continua aparecendo no acervo. Melhor dizer antes.
          */}
          <p className="text-xs text-muted-foreground">
            O número é gravado na hora e não se repete. Se sair errado, o recibo
            pode ser cancelado — mas o número fica queimado, com o motivo e o
            seu nome.
          </p>
        </div>

        <div className="flex gap-2 border-t p-4">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={emitir.isPending}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={confirmar} disabled={emitir.isPending}>
            {emitir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
            Emitir e imprimir
          </Button>
        </div>
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      {children}
    </label>
  );
}
