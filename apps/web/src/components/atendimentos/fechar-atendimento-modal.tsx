'use client';

import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, RotateCw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { Carregando, Esqueleto } from '@/components/ui/esqueleto';
import { WhatsAppIcon } from '@/components/whatsapp-icon';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { celularParaWhatsApp, linkWhatsApp } from '@/lib/whatsapp';
import { V } from '@/lib/vocabulario';
import {
  getAtendimento, concluirAtendimento, cancelarAtendimento, reabrirAtendimento,
  CATEGORIAS_CANCELAMENTO_ATENDIMENTO, MOTIVO_MAXIMO, NOTA_MAXIMA, NOTA_MINIMA,
  casoDoConcluir, conferirFechamento, corpoDoCancelar, corpoDoConcluir, deQuem, escolhaInicialDaConsulta,
  fechamentoSujo, fraseDaConsultaCancelada, mensagemDaConsultaCancelada, mensagemDaFalha,
  mostrarConfirmacaoDoFechamento, nomeDeQuemAtende, notaObrigatoria, resumoDoConcluir, textoDoReabrir,
  textosDaConsultaNoCancelar,
  type AcaoDeFechar, type AtendimentoDossie, type CasoDoConcluir, type CategoriaCancelamentoAtendimento,
  type EscolhaDaConsulta, type RespostaDoFechamento, type StatusAtendimento, type TomDoEstado,
} from '@/lib/atendimentos';

/*
  O que muda depois de fechar: a lista, a gaveta, o painel e, quando a consulta
  é cancelada junto, a agenda de quem ia atender. Todas são chaves declaradas
  (lib/chaves-de-consulta.spec.ts cobra isso). `minhas-pendencias` entrou na
  integração da rodada 3 (14/09/2026): a gaveta da agenda já a invalida ao
  cancelar uma atividade, e a consulta cancelada por aqui é a mesma atividade.

  EXPORTADA EM 14/09/2026: mudar a modalidade pela gaveta e registrar o desfecho
  (que pode marcar consulta) também mexem numa atividade da agenda, e cada um
  invalidava só o atendimento. Aberta pela agenda, a gaveta deixava o cartão
  dizendo "Na sede" depois de salvar "Por vídeo". Uma lista só, para as três
  portas não divergirem de novo.
*/
export function useInvalidarAtendimentoEAgenda() {
  const qc = useQueryClient();
  return (id: string) => {
    for (const k of [['atendimentos'], ['atendimento', id], ['dashboard-resumo'], ['compromissos'], ['compromisso'], ['minhas-pendencias']]) {
      qc.invalidateQueries({ queryKey: k });
    }
  };
}

const TOM_DO_BLOCO: Record<TomDoEstado, string> = {
  verde: 'border-emerald-300 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-200',
  ambar: 'border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200',
  neutro: 'border-border bg-muted/40 text-foreground',
};

const textareaCls = 'min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm';

/**
 * FECHAR O ATENDIMENTO — concluir ou cancelar, num modal só (D11, 14/09/2026).
 *
 * Não é um "Tem certeza?": confirmação que só repete a pergunta treina o dedo a
 * apertar sim. O #9 alternou cancelado e concluído seis vezes em quatro minutos
 * (02/09) com toque único, e fechar não decidia nada sobre a consulta, que
 * ficava viva na agenda do advogado.
 *
 * O servidor manda o PLANO (`atendimento.fechamento`): em que pé está a consulta
 * e o que falta decidir. Este modal só mostra o efeito e pergunta o que o plano
 * pede. Ele busca o detalhe pela chave ['atendimento', id], a mesma da gaveta,
 * e a lista e a gaveta abrem o MESMO componente.
 *
 * Contra a API antiga (sem o plano), o botão fica desabilitado com a frase de
 * que ainda não chegou. Nunca cai no `/status` como atalho: isso reabriria a
 * porta sem motivo.
 */
export function FecharAtendimentoModal({
  atendimentoId, acao, onClose, onFechado,
}: {
  atendimentoId: string | null;
  acao: AcaoDeFechar | null;
  onClose: () => void;
  onFechado?: () => void;
}) {
  if (!atendimentoId || !acao) return null;
  // A chave remonta o conteúdo a cada abertura: nenhuma escolha sobra da vez anterior.
  return (
    <ConteudoDoFechamento
      key={`${atendimentoId}-${acao}`}
      atendimentoId={atendimentoId}
      acaoInicial={acao}
      onClose={onClose}
      onFechado={onFechado}
    />
  );
}

function ConteudoDoFechamento({
  atendimentoId, acaoInicial, onClose, onFechado,
}: {
  atendimentoId: string;
  acaoInicial: AcaoDeFechar;
  onClose: () => void;
  onFechado?: () => void;
}) {
  const tituloId = useId();
  const { user } = useAuth();
  const invalidar = useInvalidarAtendimentoEAgenda();

  const [acao, setAcao] = useState<AcaoDeFechar>(acaoInicial);
  /** `undefined` = ninguém tocou: vale a escolha inicial do plano (que só chega com o detalhe). */
  const [consultaTocada, setConsultaTocada] = useState<EscolhaDaConsulta | null | undefined>(undefined);
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState<CategoriaCancelamentoAtendimento | ''>('');
  const [confirmado, setConfirmado] = useState<{ resposta: RespostaDoFechamento; acao: AcaoDeFechar } | null>(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['atendimento', atendimentoId],
    queryFn: () => getAtendimento(atendimentoId),
  });
  const at = data?.atendimento;
  const f = at?.fechamento ?? null;

  const escolhas = {
    consulta: consultaTocada === undefined ? escolhaInicialDaConsulta(acao, f) : consultaTocada,
    texto,
    categoria,
  };
  const conferido = conferirFechamento(acao, f, escolhas);
  const sujo = fechamentoSujo(acao, f, escolhas);
  const recusa = f ? (acao === 'CONCLUIR' ? (f.concluir.permitido ? null : f.concluir.recusa) : (f.cancelar.permitido ? null : f.cancelar.recusa)) : null;

  const salvar = useMutation({
    mutationFn: () =>
      acao === 'CONCLUIR'
        ? concluirAtendimento(atendimentoId, corpoDoConcluir(f, escolhas))
        : cancelarAtendimento(atendimentoId, corpoDoCancelar(f, escolhas)),
    onSuccess: (resposta) => {
      invalidar(atendimentoId);
      onFechado?.();
      if (mostrarConfirmacaoDoFechamento(acao, categoria, resposta?.efeitos)) {
        setConfirmado({ resposta, acao });
        return;
      }
      toast.success(acao === 'CONCLUIR' ? 'Atendimento concluído.' : 'Atendimento cancelado.');
      onClose();
    },
    onError: (e: any) => {
      toast.error(mensagemDaFalha(e, acao === 'CONCLUIR' ? 'Não foi possível concluir.' : 'Não foi possível cancelar.'));
      // O plano pode ter mudado: o advogado concluiu a consulta, ou deu a hora dela.
      refetch();
    },
  });

  const salvando = salvar.isPending;
  /** Toque fora e Esc só fecham com o formulário limpo; X e Voltar fecham sempre (menos gravando). */
  const fecharPorFora = !salvando && (!sujo || !!confirmado);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // A gaveta embaixo também ouve o Esc: sem isto, ela fecharia junto.
      ev.stopPropagation();
      if (fecharPorFora) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fecharPorFora, onClose]);

  const titulo = confirmado
    ? confirmado.acao === 'CONCLUIR' ? 'Atendimento concluído' : 'Atendimento cancelado'
    : `${acao === 'CONCLUIR' ? 'Concluir' : 'Cancelar'} atendimento${at ? ` #${at.numero}` : ''}`;

  function trocarAcao(nova: AcaoDeFechar) {
    setAcao(nova);
    setConsultaTocada(undefined);
  }

  const caso = at ? casoDoConcluir(at) : null;
  const primario = acao === 'CONCLUIR'
    ? caso === 'FUTURA' ? 'Cancelar a consulta e concluir' : 'Concluir atendimento'
    : 'Cancelar atendimento';
  const voltar = acao === 'CONCLUIR' && caso === 'FUTURA' ? 'Deixar pendente' : 'Voltar';

  return (
    <div
      className="fixed inset-0 z-50 flex animate-overlay-entrar items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={fecharPorFora ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="flex max-h-[92vh] w-full max-w-lg animate-dialogo-entrar flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl sm:rounded-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b py-3 pl-4 pr-2">
          <div className="min-w-0 pt-1">
            <h3 id={tituloId} className="text-lg font-bold leading-tight">{titulo}</h3>
            {at && <p className="truncate text-sm text-muted-foreground">{at.filiado.nomeCompleto}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            aria-label="Fechar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {confirmado ? (
          <ConfirmacaoDoFechamento resposta={confirmado.resposta} onFechar={onClose} />
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {isLoading || (!data && !isError) ? (
                <Carregando texto="Conferindo o que fechar vai causar" className="space-y-3">
                  <Esqueleto className="h-20 w-full rounded-lg" />
                  <Esqueleto className="h-5 w-2/3" />
                  <Esqueleto className="h-24 w-full rounded-md" />
                </Carregando>
              ) : !at ? (
                <FalhaComNovaTentativa
                  texto="Não deu para abrir este atendimento."
                  carregando={isFetching}
                  onTentar={() => refetch()}
                />
              ) : !f ? (
                <FalhaComNovaTentativa
                  texto="Esta tela ainda não chegou ao servidor, e sem ela não dá para saber o que fechar causa na consulta. Tente de novo daqui a alguns minutos."
                  carregando={isFetching}
                  onTentar={() => refetch()}
                />
              ) : recusa ? (
                /* Recusado pelo plano (já fechado por outra pessoa, sem desfecho…): a frase é do servidor. */
                <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <span>{recusa}</span>
                </p>
              ) : acao === 'CONCLUIR' ? (
                <CorpoDoConcluir
                  at={at}
                  caso={caso!}
                  consulta={escolhas.consulta}
                  onConsulta={setConsultaTocada}
                  texto={texto}
                  onTexto={setTexto}
                  obrigatoria={notaObrigatoria(f, escolhas)}
                  desabilitado={salvando}
                  tituloId={tituloId}
                />
              ) : (
                <CorpoDoCancelar
                  at={at}
                  usuarioId={user?.id ?? null}
                  categoria={categoria}
                  onCategoria={setCategoria}
                  consulta={escolhas.consulta}
                  onConsulta={setConsultaTocada}
                  texto={texto}
                  onTexto={setTexto}
                  onConcluirEmVez={() => trocarAcao('CONCLUIR')}
                  desabilitado={salvando}
                  tituloId={tituloId}
                />
              )}

              {/*
                O que ainda falta para o botão acender. Antes de escolher a
                categoria, o rótulo com * já diz; e a nota curta tem aviso
                próprio embaixo do campo.
              */}
              {f && !recusa && !conferido.pronto && conferido.falta
                && (acao === 'CONCLUIR' || !!categoria)
                && !conferido.falta.startsWith('Conte em poucas palavras') && (
                <p className="text-xs text-muted-foreground" aria-live="polite">{conferido.falta}</p>
              )}
            </div>

            {/* No DOM, Voltar vem antes: no celular o principal fica em cima, em largura total. */}
            <div
              className="flex flex-col-reverse gap-2 border-t bg-muted/30 px-4 pt-3 sm:flex-row sm:justify-end"
              style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
            >
              <Button variant="outline" className="h-12 w-full sm:h-10 sm:w-auto" onClick={onClose} disabled={salvando}>
                {voltar}
              </Button>
              <Button
                className={cn(
                  'h-12 w-full sm:h-10 sm:w-auto',
                  // Cancelar é reversível: âmbar escuro. O vermelho é só do Excluir.
                  acao === 'CANCELAR' && 'bg-amber-700 text-white hover:bg-amber-800',
                )}
                onClick={() => salvar.mutate()}
                disabled={salvando || !conferido.pronto}
              >
                {salvando
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : acao === 'CONCLUIR' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {primario}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FalhaComNovaTentativa({ texto, carregando, onTentar }: { texto: string; carregando: boolean; onTentar: () => void }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <span>{texto}</span>
      </p>
      <Button variant="outline" className="w-full sm:w-auto" onClick={onTentar} disabled={carregando}>
        {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />} Tentar de novo
      </Button>
    </div>
  );
}

/** Contador só a partir de 80% do limite: antes disso, ele é ruído. */
function Contador({ texto, limite }: { texto: string; limite: number }) {
  if (texto.length < limite * 0.8) return null;
  return (
    <p className={cn('text-right text-xs tabular-nums', texto.length > limite ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}>
      {texto.length} de {limite}
    </p>
  );
}

function CartaoDeEscolha({
  marcado, onEscolher, titulo, apoio, desabilitado,
}: {
  marcado: boolean;
  onEscolher: () => void;
  titulo: string;
  apoio: string;
  desabilitado: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcado}
      disabled={desabilitado}
      onClick={onEscolher}
      className={cn(
        'flex min-h-14 w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
        marcado
          ? 'border-brand-700 bg-brand-50 ring-1 ring-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:ring-brand-400'
          : 'border-input hover:bg-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          marcado ? 'border-brand-700 dark:border-brand-400' : 'border-muted-foreground/50',
        )}
      >
        {marcado && <span className="h-2 w-2 rounded-full bg-brand-700 dark:bg-brand-400" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{apoio}</span>
      </span>
    </button>
  );
}

type AtendimentoDoDetalhe = AtendimentoDossie['atendimento'];

function CorpoDoConcluir({
  at, caso, consulta, onConsulta, texto, onTexto, obrigatoria, desabilitado, tituloId,
}: {
  at: AtendimentoDoDetalhe;
  caso: CasoDoConcluir;
  consulta: EscolhaDaConsulta | null;
  onConsulta: (e: EscolhaDaConsulta) => void;
  texto: string;
  onTexto: (t: string) => void;
  obrigatoria: boolean;
  desabilitado: boolean;
  tituloId: string;
}) {
  const f = at.fechamento!;
  const resumo = resumoDoConcluir(caso, at);
  const responsavel = f.consulta?.responsavel ?? null;
  const quem = nomeDeQuemAtende(responsavel);
  const semDecisaoSobreConsulta = caso === 'ATENDIDA' || caso === 'RESOLVIDO_NO_ATO' || caso === 'SEM_CONSULTA' || caso === 'EM_ANDAMENTO';

  /*
    A NOTA SÓ É OBRIGATÓRIA quando nenhum outro registro diz como a demanda
    terminou: sem consulta atendida, ou cancelando a consulta. Obrigar nos demais
    produz eco ("consulta realizada"), a mesma lição do cancelamento da agenda.
  */
  const rotulo = caso === 'FUTURA'
    ? 'Como se resolveu antes da consulta?'
    : caso === 'SEM_CONSULTA' || (caso === 'COMECOU' && consulta === 'CANCELAR')
      ? 'Como a demanda terminou?'
      : caso === 'RESOLVIDO_NO_ATO' ? 'Quer acrescentar algo?' : 'Quer registrar algo?';
  const placeholder = caso === 'FUTURA'
    ? `Ex.: o ${V.filiado} ligou e a dúvida foi esclarecida por telefone`
    : caso === 'SEM_CONSULTA' || (caso === 'COMECOU' && consulta === 'CANCELAR')
      ? `Ex.: o ${V.filiado} resolveu direto no RH da prefeitura`
      : caso === 'RESOLVIDO_NO_ATO' ? 'Algo que a resolução não diz' : 'Algo que a consulta não registrou';
  const curta = obrigatoria && texto.trim().length > 0 && texto.trim().length < NOTA_MINIMA;

  return (
    <>
      <div className={cn('flex items-start gap-2.5 rounded-lg border p-3 text-sm', TOM_DO_BLOCO[resumo.tom])}>
        {resumo.tom === 'ambar' && quem ? (
          <AvatarPessoa nome={quem} url={responsavel?.avatarUrl} tamanho="md" />
        ) : resumo.tom === 'verde' ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        ) : null}
        <div className="min-w-0 space-y-1.5">
          <p className="font-medium leading-snug">{resumo.texto}</p>
          {resumo.apoio && <p className="leading-relaxed">{resumo.apoio}</p>}
          {caso === 'RESOLVIDO_NO_ATO' && at.desfechoObs && (
            <p className="line-clamp-3 whitespace-pre-wrap text-foreground/80">Resolução: {at.desfechoObs}</p>
          )}
        </div>
      </div>

      {semDecisaoSobreConsulta && (
        <p className="text-sm text-muted-foreground">O atendimento sai dos pendentes. Dá para reabrir depois, se precisar.</p>
      )}

      {caso === 'COMECOU' && f.concluir.consulta === 'ESCOLHER' && (
        <div role="radiogroup" aria-labelledby={`${tituloId}-houve`} className="space-y-2">
          <p id={`${tituloId}-houve`} className="text-sm font-medium">O que houve com a consulta? *</p>
          <CartaoDeEscolha
            marcado={consulta === 'MANTER'}
            onEscolher={() => onConsulta('MANTER')}
            titulo="A consulta aconteceu"
            apoio={`Ela fica na agenda${quem ? ` ${deQuem(quem)}` : ''} para ser registrada como foi.`}
            desabilitado={desabilitado}
          />
          <CartaoDeEscolha
            marcado={consulta === 'CANCELAR'}
            onEscolher={() => onConsulta('CANCELAR')}
            titulo="A consulta não aconteceu"
            apoio="Ela é cancelada como Perdeu o objeto, com a sua nota."
            desabilitado={desabilitado}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${tituloId}-nota`}>
          {rotulo}{' '}
          {obrigatoria ? '*' : <span className="font-normal text-muted-foreground">(opcional)</span>}
        </label>
        <textarea
          id={`${tituloId}-nota`}
          className={textareaCls}
          placeholder={placeholder}
          value={texto}
          disabled={desabilitado}
          maxLength={NOTA_MAXIMA + 200}
          aria-invalid={curta}
          onChange={(ev) => onTexto(ev.target.value)}
        />
        {curta && (
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Conte em poucas palavras como a demanda terminou (pelo menos {NOTA_MINIMA} caracteres).
          </p>
        )}
        <Contador texto={texto} limite={NOTA_MAXIMA} />
      </div>
    </>
  );
}

function CorpoDoCancelar({
  at, usuarioId, categoria, onCategoria, consulta, onConsulta, texto, onTexto, onConcluirEmVez, desabilitado, tituloId,
}: {
  at: AtendimentoDoDetalhe;
  usuarioId: string | null;
  categoria: CategoriaCancelamentoAtendimento | '';
  onCategoria: (c: CategoriaCancelamentoAtendimento) => void;
  consulta: EscolhaDaConsulta | null;
  onConsulta: (e: EscolhaDaConsulta) => void;
  texto: string;
  onTexto: (t: string) => void;
  onConcluirEmVez: () => void;
  desabilitado: boolean;
  tituloId: string;
}) {
  const f = at.fechamento!;
  const textos = textosDaConsultaNoCancelar(f);
  const escolhida = CATEGORIAS_CANCELAMENTO_ATENDIMENTO.find((c) => c.slug === categoria);
  const responsavel = f.consulta?.responsavel ?? null;
  const quem = nomeDeQuemAtende(responsavel);
  const deOutro = !!responsavel && !!usuarioId && responsavel.id !== usuarioId;
  const cancelarJunto = consulta === 'CANCELAR';

  return (
    <>
      <p className="text-sm text-muted-foreground">O atendimento sai dos pendentes, mas não é apagado. Dá para reabrir depois.</p>

      {/* O motivo obrigatório é a CATEGORIA: é ela que responde e vira estatística. */}
      <div role="radiogroup" aria-labelledby={`${tituloId}-porque`} className="space-y-2">
        <p id={`${tituloId}-porque`} className="text-sm font-medium">Por que vai ser cancelado? *</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORIAS_CANCELAMENTO_ATENDIMENTO.map((c) => (
            <CartaoDeEscolha
              key={c.slug}
              marcado={categoria === c.slug}
              onEscolher={() => onCategoria(c.slug)}
              titulo={c.rotulo}
              apoio={c.apoio}
              desabilitado={desabilitado}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`${tituloId}-motivo`}>
          Quer detalhar? <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id={`${tituloId}-motivo`}
          className={textareaCls}
          placeholder={escolhida ? `"${escolhida.rotulo}" já fica registrado. Escreva só se houver algo a acrescentar.` : 'Algo a acrescentar'}
          value={texto}
          disabled={desabilitado}
          maxLength={MOTIVO_MAXIMO + 200}
          onChange={(ev) => onTexto(ev.target.value)}
        />
        <Contador texto={texto} limite={MOTIVO_MAXIMO} />
      </div>

      {textos && f.cancelar.consulta === 'ESCOLHER' && (
        <div className="space-y-2">
          {/* A caixa ocupa o cartão inteiro: o toque em qualquer ponto marca. */}
          <label
            className={cn(
              'flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3',
              cancelarJunto ? 'border-brand-700 ring-1 ring-brand-700 dark:border-brand-400 dark:ring-brand-400' : 'border-input',
              desabilitado && 'cursor-default opacity-60',
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand-800"
              checked={cancelarJunto}
              disabled={desabilitado}
              onChange={(ev) => onConsulta(ev.target.checked ? 'CANCELAR' : 'MANTER')}
            />
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-medium">{textos.titulo}</span>
              <span className="flex items-start gap-2 text-xs text-muted-foreground">
                {deOutro && quem && <AvatarPessoa nome={quem} url={responsavel?.avatarUrl} tamanho="xs" />}
                <span>{textos.apoio}</span>
              </span>
            </span>
          </label>
          {!cancelarJunto && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{textos.aviso}</span>
            </p>
          )}
          {categoria === 'DUPLICIDADE' && cancelarJunto && (
            <p className="text-xs text-muted-foreground">Se esta consulta vale para o outro atendimento, desmarque para mantê-la.</p>
          )}
        </div>
      )}

      {textos && f.cancelar.consulta === 'ATENDIDA' && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <p>{textos.titulo}</p>
          <p className="text-muted-foreground">{textos.apoio}</p>
          {f.concluir.permitido && (
            <Button variant="ghost" className="w-full sm:w-auto" onClick={onConcluirEmVez} disabled={desabilitado}>
              <CheckCircle2 className="h-4 w-4" /> Concluir em vez de cancelar
            </Button>
          )}
        </div>
      )}

      {textos && f.cancelar.consulta === 'SO_MANTER' && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">{textos.titulo}</p>
      )}
    </>
  );
}

/**
 * DEPOIS DE GRAVAR, quando o servidor cancelou consulta no gesto.
 *
 * Lido da RESPOSTA (`efeitos.consultasCanceladas`), nunca do que foi escolhido:
 * se o advogado fechou a consulta antes, nada foi cancelado e esta tela nem
 * aparece. O WhatsApp só monta o link; não há canal que envie sozinho.
 */
function ConfirmacaoDoFechamento({ resposta, onFechar }: { resposta: RespostaDoFechamento; onFechar: () => void }) {
  const canceladas = resposta.efeitos?.consultasCanceladas ?? [];
  const filiado = resposta.atendimento.filiado;
  const celular = celularParaWhatsApp(filiado.telefonePrincipal, filiado.telefoneSecundario);
  const primeira = canceladas[0];

  function avisar() {
    if (!celular || !primeira) return;
    const texto = mensagemDaConsultaCancelada({ nomeFiliado: filiado.nomeCompleto, inicio: primeira.inicio });
    window.open(linkWhatsApp(celular, texto), '_blank', 'noopener,noreferrer');
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-xl bg-muted p-2 text-foreground/80">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1 pt-1">
            {canceladas.map((c) => (
              <p key={c.id} className="font-medium leading-snug">{fraseDaConsultaCancelada(c)}</p>
            ))}
            <p className="text-sm text-muted-foreground">Ninguém recebe aviso fora do sistema.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Button
            type="button"
            className="h-12 w-full bg-[#25D366] text-white hover:bg-[#20bd5a]"
            disabled={!celular}
            onClick={avisar}
          >
            <WhatsAppIcon className="h-4 w-4" /> Avisar pelo WhatsApp
          </Button>
          {!celular && (
            <p className="text-xs text-muted-foreground">
              O cadastro não tem celular, nem no telefone principal nem no secundário. Avise por outro meio.
            </p>
          )}
        </div>
      </div>
      <div
        className="flex flex-col-reverse gap-2 border-t bg-muted/30 px-4 pt-3 sm:flex-row sm:justify-end"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        <Button variant="outline" className="h-12 w-full sm:h-10 sm:w-auto" onClick={onFechar}>Fechar</Button>
      </div>
    </>
  );
}

/**
 * REABRIR, com `ConfirmDialog` âmbar.
 *
 * Aqui não há o que decidir; a confirmação existe porque reabrir tira da ficha
 * o motivo ou a nota do fechamento. Busca o detalhe para dizer, quando há, que
 * a consulta cancelada não volta. Reabrir não mexe em consulta nenhuma.
 */
export function ReabrirAtendimentoDialog({
  alvo, onClose, onReaberto,
}: {
  alvo: { id: string; numero: number; status: StatusAtendimento } | null;
  onClose: () => void;
  onReaberto?: () => void;
}) {
  const invalidar = useInvalidarAtendimentoEAgenda();
  const detalhe = useQuery({
    queryKey: ['atendimento', alvo?.id ?? null],
    queryFn: () => getAtendimento(alvo!.id),
    enabled: !!alvo,
  });

  const reabrir = useMutation({
    mutationFn: (id: string) => reabrirAtendimento(id),
    onSuccess: (_r, id) => {
      toast.success('Atendimento reaberto.');
      invalidar(id);
      onReaberto?.();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemDaFalha(e, 'Não foi possível reabrir.')),
  });

  const d = detalhe.data?.atendimento;
  const texto = alvo
    ? textoDoReabrir({ numero: alvo.numero, status: alvo.status, consultas: d?.consultas, compromissos: d?.compromissos })
    : null;

  return (
    <ConfirmDialog
      open={!!alvo}
      title={texto?.titulo ?? ''}
      icon={<RotateCcw className="h-6 w-6" />}
      description={texto?.descricao ?? ''}
      confirmLabel="Reabrir"
      cancelLabel="Voltar"
      loading={reabrir.isPending}
      onConfirm={() => alvo && reabrir.mutate(alvo.id)}
      onClose={onClose}
    />
  );
}
