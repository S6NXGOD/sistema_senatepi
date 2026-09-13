'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, Copy, ExternalLink, Link2, Loader2, Mail, MessageCircle, Share2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { campoVisivel } from '@/tenant.config';
import { celularParaWhatsApp, linkWhatsApp } from '@/lib/whatsapp';
import {
  prepararEnvioRecadastro, listarLinksRecadastramento,
  type EnvioRecadastro, type Filiado, type LinkRecadastramento, type MeioEnvioRecadastro,
} from '@/lib/filiados';
import {
  assuntoDoEmail, desafioPrevisto, emailUtilizavel, estadoDoLink, linkEmail, mensagemDoLink,
} from '@/lib/envio-recadastro';

type Feito = 'MENSAGEM' | 'LINK' | 'COMPARTILHADO' | null;

function linkVivo(l: LinkRecadastramento): boolean {
  return !l.usadoEm && !l.revogadoEm && new Date(l.expiraEm) > new Date();
}

function mensagemDeErro(e: unknown): string {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  if (typeof msg === 'string' && msg.trim()) return msg;
  return 'Não foi possível preparar o link. Tente de novo.';
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
}: {
  filiadoId: string;
  className?: string;
  onPreparado?: (envio: EnvioRecadastro) => void;
}) {
  const qc = useQueryClient();
  const corenVisivel = campoVisivel('numeroCoren');

  // O mesmo cache da ficha: o contato decide o botão antes do primeiro toque.
  const { data: filiado, isLoading: carregandoFiliado } = useQuery({
    queryKey: ['filiado', filiadoId],
    queryFn: async () => (await api.get(`/filiados/${filiadoId}`)).data as Filiado,
  });
  const { data: links } = useQuery({
    queryKey: ['links-recadastramento', filiadoId],
    queryFn: () => listarLinksRecadastramento(filiadoId),
  });

  const [resultado, setResultado] = useState<EnvioRecadastro | null>(null);
  const [haviaAtivo, setHaviaAtivo] = useState(false);
  const [ocupado, setOcupado] = useState<MeioEnvioRecadastro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
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
  const desafio = resultado?.desafio ?? (filiado ? desafioPrevisto(filiado, corenVisivel) : null);
  // Sem a ficha (erro ao ler), deixa tentar: a rota diz se há celular.
  const celularDesconhecido = !resultado && !filiado && !carregandoFiliado;
  const whatsappDisponivel = !!celular || celularDesconhecido;

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
      setErro(mensagemDeErro(e));
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
      setErro(
        'O cadastro não tem celular (nem no telefone principal, nem no secundário). ' +
          'Copie a mensagem e mande por onde conseguir falar com o filiado.',
      );
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
      setErro('O e-mail do cadastro não parece válido. Corrija o cadastro ou copie a mensagem.');
      return;
    }
    window.location.href = linkEmail(r.email, assuntoDoEmail(), mensagemDoLink(r));
  }

  const travado = ocupado !== null;
  const icone = (meio: MeioEnvioRecadastro, Icone: typeof Copy) =>
    ocupado === meio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icone className="h-4 w-4" />;
  const alvo = 'h-11 md:h-11';

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

      {desafio === 'NENHUM' && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Este cadastro não tem CPF e data de nascimento{corenVisivel ? ' nem COREN' : ''}, então o
            link abre sem pedir confirmação. Ele é pessoal: mande só para o próprio filiado, e a
            mensagem pede que ele não encaminhe.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          className={cn(alvo, 'col-span-2')}
          disabled={travado || carregandoFiliado || !whatsappDisponivel}
          aria-describedby={!whatsappDisponivel && !carregandoFiliado ? `sem-celular-${filiadoId}` : undefined}
          onClick={porWhatsApp}
        >
          {carregandoFiliado ? <Loader2 className="h-4 w-4 animate-spin" /> : icone('WHATSAPP', MessageCircle)}
          WhatsApp
        </Button>
        {!carregandoFiliado && !whatsappDisponivel && (
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

      <div aria-live="polite" className="space-y-2">
        {erro && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {erro}
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
