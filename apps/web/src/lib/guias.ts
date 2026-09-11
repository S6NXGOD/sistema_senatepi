'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * O GUIA DE PRIMEIRO ACESSO — aparece uma vez, sozinho, e depois só quando a
 * pessoa pede.
 *
 * ONDE FICA O "JÁ VI": no servidor (`users.preferencias`), não no navegador.
 * Com `localStorage`, quem viu o guia no computador do escritório o veria de
 * novo no celular, e de novo depois de limpar o navegador — e guia que volta
 * sem ser chamado ensina a fechar sem ler.
 *
 * QUANDO DECIDE: só depois que o servidor respondeu quem é a pessoa. O usuário
 * guardado no navegador pode estar velho (viu o guia no celular ontem); decidir
 * por ele abriria o guia de novo. Por isso `guiasVistos` nunca é guardado no
 * navegador — ver `auth.tsx` — e, enquanto ele não chega, o guia espera.
 */

/** Regra pura: abre sozinho só quem SABIDAMENTE ainda não viu. */
export function deveAbrirSozinho(guiasVistos: string[] | null | undefined, chave: string): boolean {
  return Array.isArray(guiasVistos) && !guiasVistos.includes(chave);
}

export function useGuiaDePrimeiroAcesso(chave: string) {
  const { user, atualizarUsuario } = useAuth();
  const [aberto, setAberto] = useState(false);
  /* Decide UMA vez por montagem: fechar e mudar de filtro não reabre. */
  const decidiu = useRef(false);

  useEffect(() => {
    if (decidiu.current || !user || !Array.isArray(user.guiasVistos)) return;
    decidiu.current = true;
    if (deveAbrirSozinho(user.guiasVistos, chave)) setAberto(true);
  }, [user, chave]);

  const fechar = useCallback(() => {
    setAberto(false);
    if (!user || !deveAbrirSozinho(user.guiasVistos, chave)) return;
    atualizarUsuario({ guiasVistos: [...(user.guiasVistos ?? []), chave] });
    /*
      Falhar aqui não merece aviso na tela: o pior caso é o guia aparecer mais
      uma vez. Um toast de erro por causa de uma explicação fechada seria ruído.
    */
    api.post(`/profile/guias/${chave}`).catch(() => undefined);
  }, [user, chave, atualizarUsuario]);

  const abrir = useCallback(() => setAberto(true), []);

  return { aberto, abrir, fechar };
}
