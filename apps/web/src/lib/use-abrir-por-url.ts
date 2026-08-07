'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Abre um item a partir da URL — `?compromisso=<id>`, `?processo=<id>`…
 *
 * O PROBLEMA QUE RESOLVE
 * Metade das telas do sistema é uma LISTA com um painel que abre por cima. Todo
 * atalho vindo de fora (painel, alerta, notificação) sabia levar para a lista
 * certa e parava aí: quem clicava em "Audiência às 14h" no painel caía na
 * agenda inteira e tinha de procurar a atividade na mão — exatamente o que o
 * atalho deveria evitar. Só a tela de Processos tratava isso, e sozinha.
 *
 * O parâmetro é REMOVIDO da URL assim que o painel abre. Sem isso, fechar o
 * painel deixaria a URL afirmando que algo está aberto; recarregar reabriria o
 * item que a pessoa acabou de fechar, e voltar no navegador ficaria preso.
 *
 * `replace` e não `push`: o atalho não é um passo de navegação próprio — voltar
 * deve levar de volta ao painel, não à mesma lista sem o parâmetro.
 */
export function useAbrirPorUrl(
  parametro: string,
  abrir: (id: string) => void,
  rotaLimpa: string,
) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = searchParams.get(parametro);
    if (!id) return;
    abrir(id);
    router.replace(rotaLimpa, { scroll: false });
    // `abrir` costuma ser um `setState` recriado a cada render; incluí-lo nas
    // dependências reabriria o item a cada renderização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, parametro, rotaLimpa, router]);
}

/**
 * Lê um filtro rápido da URL — `?rascunhos=1`, `?atrasados=1`.
 *
 * Existe pelo mesmo motivo: o sistema JÁ gerava links assim (o aviso "rascunho
 * criado" mandava para `/processos?rascunhos=1`) e a tela simplesmente ignorava
 * o parâmetro, mostrando a lista completa. O atalho parecia funcionar e não
 * fazia nada — pior que não existir, porque ninguém desconfia.
 */
export function useFiltroPorUrl(
  parametro: string,
  aplicar: (valor: string) => void,
  rotaLimpa: string,
) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const valor = searchParams.get(parametro);
    if (!valor) return;
    aplicar(valor);
    router.replace(rotaLimpa, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, parametro, rotaLimpa, router]);
}
