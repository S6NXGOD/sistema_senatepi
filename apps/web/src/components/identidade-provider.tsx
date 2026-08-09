'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CHAVE_MARCA, obterIdentidade, type IdentidadeVisual,
} from '@/lib/identidade-visual';
import { derivarPaleta, hexParaHslCss, paletaParaCanaisCss } from '@/lib/paleta';

/**
 * APLICA A IDENTIDADE VISUAL GRAVADA PELA INSTALAÇÃO.
 *
 * É a terceira camada do mecanismo (ver `marca-css.tsx` para as duas
 * primeiras): busca a cor no servidor, escreve as variáveis no `<html>` e
 * guarda no `localStorage` para o próximo carregamento não piscar.
 *
 * FALHA EM SILÊNCIO, de propósito. Se a API não responder, a instalação
 * continua com a marca compilada — que é a correta em todo sindicato que nunca
 * mexeu na cor. Um erro aqui não pode impedir ninguém de usar o sistema.
 */

const Ctx = createContext<IdentidadeVisual | null>(null);

/** Os logos enviados pela tela; nulo onde ainda vale o arquivo de `/public`. */
export function useIdentidade() {
  return useContext(Ctx);
}

export function IdentidadeProvider({ children }: { children: React.ReactNode }) {
  const [aplicada, setAplicada] = useState(false);

  const { data } = useQuery({
    queryKey: ['identidade-visual'],
    queryFn: obterIdentidade,
    // A marca não muda durante o uso; refazer a consulta a cada foco de janela
    // seria uma chamada por troca de aba, para um dado que muda uma vez por ano.
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  /**
   * O ÍCONE DA ABA, trocado em tempo de execução.
   *
   * O `<link rel="icon">` sai do `metadata` do layout, que é renderizado no
   * servidor com o arquivo padrão da instalação. Enviar um ícone pela tela não
   * teria efeito nenhum sem reescrever o link aqui — e "enviei e não mudou
   * nada" é pior do que não ter o campo.
   */
  useEffect(() => {
    const enviado = data?.logos?.icone;
    if (!enviado) return;
    for (const rel of ['icon', 'shortcut icon', 'apple-touch-icon']) {
      document.head
        .querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`)
        .forEach((link) => { link.href = enviado; });
    }
  }, [data]);

  useEffect(() => {
    if (!data) return;

    const raiz = document.documentElement;

    if (!data.corPrimaria) {
      /**
       * Voltou ao padrão: as variáveis inline precisam SAIR, senão a cor antiga
       * continuaria sobrescrevendo o `<style>` do layout — "restaurar o padrão"
       * não restauraria nada até o próximo Ctrl+F5.
       */
      for (const tom of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
        raiz.style.removeProperty(`--brand-${tom}`);
      }
      raiz.style.removeProperty('--primary');
      raiz.style.removeProperty('--ring');
      try { localStorage.removeItem(CHAVE_MARCA); } catch { /* modo privado */ }
      setAplicada(true);
      return;
    }

    const paleta = derivarPaleta(data.corPrimaria);
    if (!paleta) return;

    const canais: Record<string, string> = paletaParaCanaisCss(paleta);
    const primaria = hexParaHslCss(paleta['800']);
    const anel = hexParaHslCss(paleta['600']);
    if (primaria) canais['--primary'] = primaria;
    if (anel) canais['--ring'] = anel;

    for (const [nome, valor] of Object.entries(canais)) raiz.style.setProperty(nome, valor);
    try { localStorage.setItem(CHAVE_MARCA, JSON.stringify(canais)); } catch { /* modo privado */ }
    setAplicada(true);
  }, [data]);

  // `aplicada` não gateia a renderização: segurar a tela até a cor chegar
  // trocaria um lampejo de cor por um lampejo de página em branco.
  void aplicada;

  return <Ctx.Provider value={data ?? null}>{children}</Ctx.Provider>;
}
