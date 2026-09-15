'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, Copy, ExternalLink, Link2, Loader2, Mail, MessageCircle, PenLine, Share2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Carregando, Esqueleto } from '@/components/ui/esqueleto';
import { cn } from '@/lib/utils';
import { campoVisivel } from '@/tenant.config';
import { celularParaWhatsApp, linkWhatsApp } from '@/lib/whatsapp';
import {
  prepararEnvioRecadastro, listarLinksRecadastramento, consultaDaPreviaDoLink,
  type EnvioRecadastro, type Filiado, type LinkRecadastramento, type MeioEnvioRecadastro,
} from '@/lib/filiados';
import {
  assuntoDoEmail, avisoDoEnvio, emailUtilizavel, erroDoEnvio, estadoDoLink, linkEmail, mensagemDoLink,
  rotuloDaPorta,
  type AvisoDoEnvio, type ErroDoEnvio, type PortaDaFicha,
} from '@/lib/envio-recadastro';

type Feito = 'MENSAGEM' | 'LINK' | 'COMPARTILHADO' | null;

function linkVivo(l: LinkRecadastramento): boolean {
  return !l.usadoEm && !l.revogadoEm && new Date(l.expiraEm) > new Date();
}

/**
 * MANDAR O LINK DE RECADASTRAMENTO — WhatsApp, compartilhar, copiar ou e-mail.
 *
 * O sistema não envia nada: quem manda é o aparelho de quem está no balcão.
 * Cada botão chama a rota de envio PRIMEIRO (ela reaproveita o link vivo ou
 * gera um, e deixa "preparado para envio" na auditoria) e só depois abre o
 * destino.
 *
 * O BLOQUEADOR DE POP-UP. Janela aberta depois de um `await` não é mais "do
 * clique" e o navegador a barra. Por isso a aba do WhatsApp é aberta vazia NO
 * GESTO e recebe o endereço quando a resposta chega. Cópia e compartilhamento
 * têm a mesma exigência: a cópia entrega ao navegador uma PROMESSA de texto
 * (ClipboardItem), e quando mesmo assim o navegador recusa, a tela oferece o
 * texto para copiar à mão ou um segundo toque em "Compartilhar agora".
 *
 * UM TOQUE DE CADA VEZ. Dois pedidos simultâneos poderiam gerar dois links, e o
 * segundo cancelaria o primeiro — os botões ficam travados enquanto um roda.
 */
export function EnviarLinkRecadastro({
  filiadoId,
  className,
  onPreparado,
  onCompletarFicha,
}: {
  filiadoId: string;
  className?: string;
  onPreparado?: (envio: EnvioRecadastro) => void;
  /**
   * A porta para gravar ou corrigir CPF e data de nascimento, quando o link não
   * teria como confirmar a identidade. Recebe QUAL porta (15/09/2026): dado
   * gravado errado se corrige na edição da ficha; dado que falta se completa
   * no presencial. Sem ela, a caixa só explica.
   */
  onCompletarFicha?: (porta: PortaDaFicha) => void;
}) {
  const qc = useQueryClient();
  const corenVisivel = campoVisivel('numeroCoren');

  // O mesmo cache da ficha: o contato decide o botão antes do primeiro toque.
  const { data: filiado, isLoading: carregandoFiliado } = useQuery({
    queryKey: ['filiado', filiadoId],
    queryFn: async () => (await api.get(`/filiados/${filiadoId}`)).data as Filiado,
  });
  /*
    O QUE O LINK VAI PEDIR, perguntado à API (14/09/2026), pela consulta única
    de lib/filiados.ts (a mesma do modal). Erro aqui não trava nada: os botões
    ficam habilitados e a API decide no toque.
  */
  const {
    data: previa, isLoading: carregandoPrevia, isError: previaFalhou,
  } = useQuery(consultaDaPreviaDoLink(filiadoId));
  const { data: links } = useQuery({
    queryKey: ['links-recadastramento', filiadoId],
    queryFn: () => listarLinksRecadastramento(filiadoId),
  });

  const [resultado, setResultado] = useState<EnvioRecadastro | null>(null);
  const [haviaAtivo, setHaviaAtivo] = useState(false);
  const [ocupado, setOcupado] = useState<MeioEnvioRecadastro | null>(null);
  const [erro, setErro] = useState<ErroDoEnvio | null>(null);
  const [feito, setFeito] = useState<Feito>(null);
  const [copiarAMao, setCopiarAMao] = useState<string | null>(null);
  const [abrirAMao, setAbrirAMao] = useState<string | null>(null);
  const [compartilharPendente, setCompartilharPendente] = useState<EnvioRecadastro | null>(null);
  const [podeCompartilhar, setPodeCompartilhar] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `navigator.share` só existe no navegador (e quase só no celular): decidir no
  // efeito evita um botão que aparece e some na hidratação.
  useEffect(() => {
    setPodeCompartilhar(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    };
  }, []);

  // Depois do primeiro toque, vale o que a API conferiu; antes, a mesma régua aqui.
  const celular = resultado
    ? resultado.celularWhatsApp
    : filiado
      ? celularParaWhatsApp(filiado.telefonePrincipal, filiado.telefoneSecundario)
      : null;
  const email = resultado ? resultado.email : emailUtilizavel(filiado?.email);
  // Depois do toque vale o desafio que a rota devolveu (ela só devolve link que
  // pôde gerar); antes, a prévia. Sem prévia (carregando ou erro), nada a avisar.
  const aviso: AvisoDoEnvio = resultado
    ? avisoDoEnvio({ desafio: resultado.desafio, podeGerar: true }, corenVisivel)
    : previa
      ? avisoDoEnvio(previa, corenVisivel)
      : { tipo: 'NADA' };
  const semConfirmacao = aviso.tipo === 'SEM_CONFIRMACAO';
  const porta = aviso.tipo === 'SEM_CONFIRMACAO' ? aviso.porta : null;
  // Sem a ficha (erro ao ler), deixa tentar: a rota diz se há celular.
  const celularDesconhecido = !resultado && !filiado && !carregandoFiliado;
  const whatsappDisponivel = !!celular || celularDesconhecido;
  /*
    15/09/2026: enquanto a ficha ou a prévia carregam, a grade vira esqueleto.
    Antes, Compartilhar, Copiar e E-mail ficavam ATIVOS nesse meio-tempo, e o
    toque podia chegar antes da caixa que diz que o link não pode ser gerado.
  */
  const carregando = !resultado && (carregandoFiliado || carregandoPrevia);

  function marcarFeito(qual: Feito) {
    setFeito(qual);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setFeito(null), 2500);
  }

  async function preparar(meio: MeioEnvioRecadastro): Promise<EnvioRecadastro | null> {
    const antes = (links ?? []).some(linkVivo);
    setErro(null);
    setCopiarAMao(null);
    setAbrirAMao(null);
    setCompartilharPendente(null);
    setOcupado(meio);
    try {
      const r = await prepararEnvioRecadastro(filiadoId, meio);
      setHaviaAtivo(antes);
      setResultado(r);
      onPreparado?.(r);
      void qc.invalidateQueries({ queryKey: ['links-recadastramento', filiadoId] });
      // O cartão "Cadastros a completar" mostra "link ativo até…": muda com isto.
      void qc.invalidateQueries({ queryKey: ['dashboard-resumo'] });
      return r;
    } catch (e) {
      setErro(erroDoEnvio(e));
      // A recusa pode ser justamente "sem como confirmar a identidade" (a prévia
      // tinha falhado ou a ficha mudou): perguntar de novo troca os botões pela
      // caixa que explica o que fazer.
      void qc.invalidateQueries({ queryKey: consultaDaPreviaDoLink(filiadoId).queryKey });
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function porWhatsApp() {
    // No gesto, antes de qualquer await.
    const aba = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (aba) aba.opener = null;
    const r = await preparar('WHATSAPP');
    if (!r) {
      aba?.close();
      return;
    }
    if (!r.celularWhatsApp) {
      aba?.close();
      setErro({
        tom: 'AVISO',
        texto:
          'O cadastro não tem celular (nem no telefone principal, nem no secundário). ' +
          'Copie a mensagem e mande por onde conseguir falar com o filiado.',
      });
      return;
    }
    const destino = linkWhatsApp(r.celularWhatsApp, mensagemDoLink(r));
    if (aba && !aba.closed) aba.location.href = destino;
    else setAbrirAMao(destino);
  }

  async function copiar(meio: 'COPIAR', qual: 'MENSAGEM' | 'LINK') {
    const texto = preparar(meio).then((r) => (r ? (qual === 'MENSAGEM' ? mensagemDoLink(r) : r.url) : null));
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        // A promessa vai junto do gesto: o navegador espera a resposta da API.
        const blob = texto.then((t) => {
          if (t === null) throw new Error('sem texto');
          return new Blob([t], { type: 'text/plain' });
        });
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      } else {
        const t = await texto;
        if (t === null) return;
        await navigator.clipboard.writeText(t);
      }
      marcarFeito(qual);
    } catch {
      const t = await texto;
      if (t === null) return; // o erro da rota já está na tela
      try {
        await navigator.clipboard.writeText(t);
        marcarFeito(qual);
      } catch {
        setCopiarAMao(t);
      }
    }
  }

  async function compartilharAgora(r: EnvioRecadastro) {
    try {
      await navigator.share({ text: mensagemDoLink(r) });
      setCompartilharPendente(null);
      marcarFeito('COMPARTILHADO');
    } catch (e) {
      const nome = (e as { name?: string })?.name;
      if (nome === 'AbortError') {
        setCompartilharPendente(null);
        return; // a pessoa desistiu na folha do aparelho
      }
      // Passou tempo demais desde o toque: pede um segundo, já com tudo pronto.
      if (nome === 'NotAllowedError') setCompartilharPendente(r);
      else setCopiarAMao(mensagemDoLink(r));
    }
  }

  async function compartilhar() {
    const r = await preparar('COMPARTILHAR');
    if (r) await compartilharAgora(r);
  }

  async function porEmail() {
    const r = await preparar('EMAIL');
    if (!r) return;
    if (!r.email) {
      setErro({ tom: 'AVISO', texto: 'O e-mail do cadastro não parece válido. Corrija o cadastro ou copie a mensagem.' });
      return;
    }
    window.location.href = linkEmail(r.email, assuntoDoEmail(), mensagemDoLink(r));
  }

  const travado = ocupado !== null;
  const icone = (meio: MeioEnvioRecadastro, Icone: typeof Copy) =>
    ocupado === meio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icone className="h-4 w-4" />;
  const alvo = 'h-11 md:h-11';
  /*
    A recusa em âmbar some quando a caixa âmbar já está na tela: as duas diriam
    a mesma coisa, uma embaixo da outra.
  */
  const erroVisivel = erro && !(semConfirmacao && erro.tom === 'AVISO') ? erro : null;

  return (
    <section className={cn('space-y-3', className)} aria-labelledby={`enviar-link-${filiadoId}`}>
      <div>
        <h4 id={`enviar-link-${filiadoId}`} className="text-sm font-semibold">
          Mandar o link para o filiado preencher
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Ele atualiza os próprios dados pelo celular. O link vale 24 horas e só pode ser usado uma
          vez. Enquanto houver um link ativo, os botões mandam o mesmo.
        </p>
      </div>

      {aviso.tipo === 'UM_FATOR' && (
        <p className="flex animate-surgir items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{aviso.texto}</span>
        </p>
      )}

      {/*
        A prévia falhou (rede, ou a API antiga na janela de troca): a tela não
        afirma nada sobre a confirmação, mas também não fica muda. Neutro: os
        botões continuam valendo e a API decide no toque.
      */}
      {previaFalhou && !previa && !resultado && (
        <p className="text-xs text-muted-foreground">
          Não deu para ver o que o link vai pedir; a confirmação é decidida ao enviar.
        </p>
      )}

      {/*
        SEM COMO CONFIRMAR A IDENTIDADE: a API recusa o link (14/09/2026), então
        os botões somem. Âmbar, não vermelho: é um passo que falta na ficha, não
        um erro.
      */}
      {aviso.tipo === 'SEM_CONFIRMACAO' ? (
        <div role="status" className="animate-surgir space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="flex items-start gap-2 text-sm font-semibold text-amber-950 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            {aviso.titulo}
          </p>
          <p className="text-xs text-amber-900 dark:text-amber-200">{aviso.texto}</p>
          {onCompletarFicha && porta && (
            <Button type="button" variant="outline" className="h-11 w-full sm:w-auto md:h-11" onClick={() => onCompletarFicha(porta)}>
              <PenLine className="h-4 w-4" /> {rotuloDaPorta(porta)}
            </Button>
          )}
        </div>
      ) : carregando ? (
        <Carregando texto="Vendo o que o link vai pedir…">
          <div className="grid grid-cols-2 gap-2">
            <Esqueleto className="col-span-2 h-11" />
            <Esqueleto className="h-11" />
            <Esqueleto className="h-11" />
          </div>
        </Carregando>
      ) : (
      <div className="grid animate-surgir grid-cols-2 gap-2">
        <Button
          type="button"
          className={cn(alvo, 'col-span-2')}
          disabled={travado || !whatsappDisponivel}
          aria-describedby={!whatsappDisponivel ? `sem-celular-${filiadoId}` : undefined}
          onClick={porWhatsApp}
        >
          {icone('WHATSAPP', MessageCircle)}
          WhatsApp
        </Button>
        {!whatsappDisponivel && (
          <p id={`sem-celular-${filiadoId}`} className="col-span-2 -mt-1 text-xs text-muted-foreground">
            Sem celular no cadastro (nem no telefone principal, nem no secundário). Copie a mensagem
            e mande por onde conseguir falar com o filiado.
          </p>
        )}

        {podeCompartilhar && (
          <Button type="button" variant="outline" className={alvo} disabled={travado} onClick={compartilhar}>
            {feito === 'COMPARTILHADO' ? <Check className="h-4 w-4" /> : icone('COMPARTILHAR', Share2)}
            Compartilhar
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className={alvo}
          disabled={travado}
          onClick={() => copiar('COPIAR', 'MENSAGEM')}
        >
          {feito === 'MENSAGEM' ? <Check className="h-4 w-4" /> : icone('COPIAR', Copy)}
          {feito === 'MENSAGEM' ? 'Copiada' : 'Copiar mensagem'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={alvo}
          disabled={travado}
          onClick={() => copiar('COPIAR', 'LINK')}
        >
          {feito === 'LINK' ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
          {feito === 'LINK' ? 'Copiado' : 'Copiar só o link'}
        </Button>
        {email && (
          <Button type="button" variant="outline" className={alvo} disabled={travado} onClick={porEmail}>
            {icone('EMAIL', Mail)}
            E-mail
          </Button>
        )}
      </div>
      )}

      <div aria-live="polite" className="space-y-2">
        {erroVisivel && (
          <p
            role={erroVisivel.tom === 'ERRO' ? 'alert' : 'status'}
            className={cn(
              'rounded-lg border px-3 py-2 text-xs',
              erroVisivel.tom === 'ERRO'
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
            )}
          >
            {erroVisivel.texto}
          </p>
        )}

        {resultado && !erro && (
          <p className="text-xs text-muted-foreground">
            {estadoDoLink({
              expiraEm: resultado.expiraEm,
              reaproveitado: resultado.reaproveitado,
              haviaLinkAtivo: haviaAtivo,
            })}
          </p>
        )}

        {abrirAMao && (
          <a
            href={abrirAMao}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-brand-400 px-4 text-sm font-medium text-brand-800 hover:bg-muted dark:text-brand-400"
          >
            <ExternalLink className="h-4 w-4" /> O navegador segurou a janela. Abrir o WhatsApp
          </a>
        )}

        {compartilharPendente && (
          <Button
            type="button"
            className={cn(alvo, 'w-full')}
            onClick={() => compartilharAgora(compartilharPendente)}
          >
            <Share2 className="h-4 w-4" /> Pronto. Compartilhar agora
          </Button>
        )}

        {copiarAMao && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              O navegador não deixou copiar. Selecione o texto abaixo e copie:
            </p>
            <textarea
              readOnly
              value={copiarAMao}
              rows={copiarAMao.includes('\n') ? 6 : 2}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-none rounded-md border bg-background p-2 text-xs"
            />
          </div>
        )}

        {resultado && (
          <details className="group rounded-lg border bg-muted/30 text-xs">
            <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 font-medium text-muted-foreground hover:text-foreground">
              Ver a mensagem
            </summary>
            <p className="whitespace-pre-wrap break-words border-t px-3 py-2 text-foreground">
              {mensagemDoLink(resultado)}
            </p>
          </details>
        )}
      </div>
    </section>
  );
}
