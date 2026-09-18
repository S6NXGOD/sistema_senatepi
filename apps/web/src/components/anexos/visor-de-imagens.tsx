'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { formatTamanho, type Anexo } from '@/lib/anexos';

/**
 * VER O QUE É O ARQUIVO SEM BAIXAR CADA UM.
 *
 * A lista de anexos mostrava um ícone genérico e o nome do arquivo. Num
 * atendimento com 17 fotos de celular — `IMG-20250818-WA0027.jpg`,
 * `…WA0024.jpg`, `…WA0023.jpg` — o nome não diz nada: para saber qual é a
 * carteira de trabalho e qual é o contracheque era preciso baixar os 17.
 *
 * Aqui a imagem é a própria identificação. A miniatura na lista responde
 * "o que é isto?" de relance, e o visor abre em tamanho grande com seta para
 * folhear — porque quem manda 17 fotos manda um documento fotografado em 17
 * pedaços, e fechar e reabrir a cada página é o que faz ninguém olhar.
 *
 * SÓ IMAGENS, de propósito. PDF o navegador já exibe na aba (o servidor manda
 * `Content-Disposition: inline`), e desenhar a primeira página de um PDF aqui
 * exigiria carregar um motor inteiro para um caso que já funciona.
 */
export function VisorDeImagens({
  imagens,
  indice,
  onFechar,
  onIr,
}: {
  imagens: Anexo[];
  /** Índice dentro de `imagens`; nulo mantém o visor fechado. */
  indice: number | null;
  onFechar: () => void;
  onIr: (i: number) => void;
}) {
  const [falhou, setFalhou] = useState(false);
  const atual = indice === null ? null : imagens[indice];

  const anterior = useCallback(() => {
    if (indice === null || !imagens.length) return;
    onIr((indice - 1 + imagens.length) % imagens.length);
  }, [indice, imagens.length, onIr]);

  const proxima = useCallback(() => {
    if (indice === null || !imagens.length) return;
    onIr((indice + 1) % imagens.length);
  }, [indice, imagens.length, onIr]);

  /*
    O TECLADO É O JEITO DE FOLHEAR NO COMPUTADOR. Sem ele, ver 17 fotos são 34
    cliques mirando um alvo pequeno. Esc fecha porque é o que todo mundo tenta.
  */
  useEffect(() => {
    if (indice === null) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar();
      else if (e.key === 'ArrowLeft') anterior();
      else if (e.key === 'ArrowRight') proxima();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [indice, onFechar, anterior, proxima]);

  // Trocar de foto tem de limpar a marca de falha da anterior.
  useEffect(() => setFalhou(false), [indice]);

  // A rolagem do fundo atrás de um visor de tela cheia é desorientadora.
  useEffect(() => {
    if (indice === null) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, [indice]);

  if (!atual) return null;
  const varias = imagens.length > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizando ${atual.nomeArquivo}`}
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onFechar}
    >
      <div className="flex items-start gap-2 p-3 text-white sm:p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={atual.nomeArquivo}>
            {atual.nomeArquivo}
          </p>
          <p className="text-xs text-white/70">
            {varias && `${indice! + 1} de ${imagens.length} · `}
            {formatTamanho(atual.tamanhoBytes)}
            {atual.tamanhoBytes ? ' · ' : ''}
            {new Date(atual.createdAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <a
          href={atual.url}
          download={atual.nomeArquivo}
          onClick={(e) => e.stopPropagation()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          title="Baixar este arquivo"
        >
          <Download className="h-5 w-5" />
        </a>
        <button
          type="button"
          onClick={onFechar}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          title="Fechar (Esc)"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-1 px-1 pb-3 sm:gap-3 sm:px-3">
        {varias && (
          <Seta lado="anterior" onClick={(e) => { e.stopPropagation(); anterior(); }} />
        )}
        {falhou ? (
          <p className="max-w-xs text-center text-sm text-white/80">
            Não foi possível abrir esta imagem agora. O link de acesso vale por uma hora —
            recarregue a página e tente de novo.
          </p>
        ) : (
          /*
            `<img>` cru, e não `next/image`: a URL é ASSINADA e temporária, com
            domínio que varia por ambiente. O otimizador exigiria liberar o host
            e ainda assim não poderia cachear um endereço que expira em uma hora.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={atual.id}
            src={atual.url}
            alt={atual.nomeArquivo}
            onClick={(e) => e.stopPropagation()}
            onError={() => setFalhou(true)}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        )}
        {varias && (
          <Seta lado="proxima" onClick={(e) => { e.stopPropagation(); proxima(); }} />
        )}
      </div>
    </div>
  );
}

function Seta({
  lado,
  onClick,
}: {
  lado: 'anterior' | 'proxima';
  onClick: (e: React.MouseEvent) => void;
}) {
  const Icone = lado === 'anterior' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      // 44 px de alvo: a tela é usada no celular, e a seta fica sobre a foto.
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      title={lado === 'anterior' ? 'Anterior (←)' : 'Próxima (→)'}
      aria-label={lado === 'anterior' ? 'Imagem anterior' : 'Próxima imagem'}
    >
      <Icone className="h-6 w-6" />
    </button>
  );
}
