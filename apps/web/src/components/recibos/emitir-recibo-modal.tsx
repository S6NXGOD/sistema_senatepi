'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowUpRight, Loader2, PenLine, ReceiptText, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BuscaSelect, type ItemBusca } from '@/components/ui/busca-select';
import { useSobreposicao } from '@/components/ui/use-sobreposicao';
import { cn } from '@/lib/utils';
import { buscarFiliados } from '@/lib/colonia';
import { comoDistinguir, nomeComparavel, nomesRepetidos } from '@/lib/distinguir-filiado';
import {
  emitirRecibo, formatBRL, formatData, hojeEmTeresina, temAssinaturaDaPresidencia,
  FORMAS_DE_PAGAMENTO, DOCUMENTO, LADO, type PagamentoParaRecibo, type TipoRecibo,
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
  /** Avulso: nada lançado ainda. `lado` é o que a tela abre marcado. */
  | { tipo: 'AVULSO'; lado?: TipoRecibo }
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
  const [pagador, setPagador] = useState(doCaixa?.contraparteNome ?? '');
  const [documento, setDocumento] = useState(doCaixa?.contraparteDocumento ?? '');
  const [filiadoId, setFiliadoId] = useState<string | null>(doCaixa?.filiadoId ?? null);
  /*
    O LADO DO DOCUMENTO. Vindo de um lançamento já no caixa ele é FATO — o
    dinheiro já andou, e deixar escolher aqui só criaria o papel que contradiz
    o livro. No avulso é escolha, e o padrão é o caso comum (receber).
  */
  const [lado, setLado] = useState<TipoRecibo>(
    doCaixa ? doCaixa.tipo : origem.tipo === 'AVULSO' ? (origem.lado ?? 'ENTRADA') : 'ENTRADA',
  );
  const saida = lado === 'SAIDA';

  /*
    A CAIXA SÓ EXISTE SE HOUVER IMAGEM. Sem assinatura configurada, marcar não
    mudaria nada no papel — e caixa que promete o que o documento não cumpre é
    a mesma coisa que o botão de enviar anexo que terminava em 403.

    A imagem é a MESMA do carnê e da carteirinha; quem a troca é o
    Administrador, na configuração de Cobranças, uma vez por mandato.
  */
  const { data: assinatura } = useQuery({
    queryKey: ['assinatura-da-presidencia'],
    queryFn: temAssinaturaDaPresidencia,
    staleTime: 5 * 60_000,
  });
  const [assinar, setAssinar] = useState(false);
  /*
    SÓ NO RECIBO DE ENTRADA. No de saída a linha é do PRESTADOR ("Recebi do
    SENATEPI") — a assinatura do presidente ali seria o sindicato assinando a
    declaração de outra pessoa. O servidor recusa do mesmo jeito; a tela nem
    oferece, que é melhor do que oferecer e ignorar.
  */
  const podeAssinar = !saida && !!assinatura?.disponivel;
  /* O CPF real de cada candidato da busca — ver `onEscolher`. */
  const [cpfPorId] = useState(() => new Map<string, string | null>());

  const { fundo } = useSobreposicao(true, () => { if (!emitir.isPending) onClose(); });

  const emitir = useMutation({
    mutationFn: () =>
      emitirRecibo({
        tipo: lado,
        // Pela PARCELA quando existe: é a ligação mais específica, e é ela que
        // impede o segundo recibo da mesma mensalidade.
        parcelaId: doCaixa?.parcelaId ?? undefined,
        movimentacaoId: doCaixa && !doCaixa.parcelaId ? (doCaixa.movimentacaoId ?? undefined) : undefined,
        valor: doCaixa ? undefined : Number(valor),
        referente: referente.trim() || undefined,
        formaPagamento: forma.trim(),
        recebidoEm: doCaixa ? undefined : recebidoEm,
        contraparteNome: pagador.trim() || undefined,
        contraparteDocumento: documento.trim() || undefined,
        filiadoId: filiadoId ?? undefined,
        empresaId: doCaixa?.empresaId ?? undefined,
        assinaturaPresidencia: podeAssinar && assinar ? true : undefined,
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
      if (!(Number(valor) > 0))
        return toast.error(saida ? 'Informe o valor pago.' : 'Informe o valor recebido.');
      if (!referente.trim())
        return toast.error(
          saida ? 'Diga pelo que o sindicato pagou.' : 'Diga a que o recibo se refere.',
        );
      if (!pagador.trim())
        return toast.error(saida ? 'Informe quem recebeu.' : 'Informe quem pagou.');
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
              <h3 className="font-semibold leading-tight">Emitir {DOCUMENTO[lado].toLowerCase()}</h3>
              <p className="text-xs text-muted-foreground">
                {doCaixa
                  ? 'O número sai na hora de gravar e nunca muda.'
                  : saida
                    ? 'A saída do caixa é lançada junto, e quem recebeu assina o papel.'
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
          {/*
            A ESCOLHA DO LADO VEM PRIMEIRO, e muda tudo o que vem depois: os
            rótulos, o texto do papel e quem assina. Duas pastilhas e não um
            select — são duas, e a marcada precisa se ver sem abrir nada.

            Só aparece no AVULSO: quando o lançamento já existe no caixa, o
            lado é fato, e oferecer a troca seria oferecer um papel que
            contradiz o livro.
          */}
          {!doCaixa && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                O dinheiro
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(['ENTRADA', 'SAIDA'] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => setLado(op)}
                    aria-pressed={lado === op}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition',
                      lado === op
                        ? 'border-brand-800 bg-brand-50 dark:bg-brand-900/30'
                        : 'hover:bg-muted',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {op === 'ENTRADA' ? (
                        <ArrowDownLeft className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                      )}
                      {op === 'ENTRADA' ? 'Entrou' : 'Saiu'}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {op === 'ENTRADA'
                        ? 'O sindicato recebeu'
                        : 'O sindicato pagou alguém'}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {doCaixa ? (
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {saida ? 'Pagamento já lançado no caixa (saída)' : 'Pagamento já lançado no caixa'}
              </p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{formatBRL(doCaixa.valor)}</p>
              <p className="text-xs text-muted-foreground">
                Recebido em {formatData(doCaixa.data)}
                {doCaixa.conta ? ` · ${doCaixa.conta}` : ''}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo={saida ? 'Valor pago *' : 'Valor recebido *'}>
                <Input
                  type="number" inputMode="decimal" step="0.01" min="0"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                />
              </Campo>
              <Campo rotulo={saida ? 'Data do pagamento *' : 'Data do recebimento *'}>
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
                  : saida
                    ? 'Ex.: conserto da fiação elétrica da sede'
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

          <Campo rotulo={saida ? 'Como o sindicato pagou *' : 'Como foi pago *'}>
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
              <UserRound className="h-3.5 w-3.5" /> {LADO[lado].contraparte}
            </p>

            {/*
              PROCURAR NO CADASTRO É ATALHO, não obrigação. Quem paga pode não
              ser filiado — o acompanhante no evento, a empresa, o terceiro que
              quitou o acordo. O nome digitado vale sozinho.
            */}
            {/*
              A BUSCA NO CADASTRO SÓ APARECE NO RECEBIMENTO. Quem o sindicato
              paga — eletricista, gráfica — quase nunca é filiado, e um campo
              que devolve "nenhum resultado" em todas as buscas ensina a
              ignorá-lo. O nome digitado sempre valeu sozinho.
            */}
            {!doCaixa && !saida && (
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
                placeholder={
                  saida ? 'Nome de quem prestou o serviço' : 'Nome de quem entregou o valor'
                }
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
            ASSINAR PELA PRESIDÊNCIA — opcional, e desmarcado por padrão.

            O recibo sempre saiu com a linha em branco para assinar à mão, e
            continuar assim tem de ser o caminho de quem não decidiu nada.
            Marcar é uma escolha consciente: a assinatura entra IMPRESSA, e
            isso fica gravado no documento — reimprimir anos depois mostra o
            mesmo papel que foi arquivado.
          */}
          {podeAssinar && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40">
              <input
                type="checkbox"
                checked={assinar}
                onChange={(e) => setAssinar(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <PenLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  Sair com a assinatura da presidência
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {assinar
                    ? 'A assinatura vem impressa nas duas vias — ainda cabe carimbo por cima.'
                    : 'Sem marcar, o recibo sai com a linha em branco para assinar à mão.'}
                </span>
              </span>
            </label>
          )}

          {/*
            O AVISO DO QUE NÃO TEM VOLTA. Emitir grava um número que não se
            reaproveita: errar aqui significa cancelar e reemitir, e o
            cancelado continua aparecendo no acervo. Melhor dizer antes.
          */}
          <p className="text-xs text-muted-foreground">
            O número é gravado na hora e não se repete. Se sair errado, o recibo
            pode ser cancelado — mas o número fica queimado, com o motivo e o
            seu nome.
            {saida && (
              <>
                {' '}
                <strong>Imprima e peça a assinatura de quem recebeu</strong> — é
                ela que o sindicato guarda na prestação de contas.
              </>
            )}
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
