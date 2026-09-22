'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * PORTAL — a peça que tira o diálogo de dentro da gaveta.
 *
 * O DEFEITO, medido na tela em 22/09/2026: o modal "Recadastrar filiado" tem
 * `max-w-3xl` (768px) e aparecia com **512px de largura, em x=928, numa tela de
 * 1440** — encostado na direita, com os campos de três colunas espremidos em
 * 150px cada, rótulos quebrando em duas linhas e "Técnico(a)" cortado. Parecia
 * design ruim e não era: era o modal PRESO DENTRO DA GAVETA.
 *
 * A REGRA DE CSS QUE CAUSA ISSO, e ela pega todo mundo uma vez na vida: um
 * elemento com `transform`, `filter`, `perspective`, `backdrop-filter` ou
 * `will-change` vira o **bloco de contenção** dos descendentes `position:
 * fixed`. Deixa de ser a viewport. E o `Sheet` deste projeto anima abrindo e
 * fechando com `transition-transform` + `translate-x-0` — o que rende
 * `transform: matrix(1, 0, 0, 1, 0, 0)`. Identidade, não move nada, e mesmo
 * assim cria o bloco de contenção. Então todo `fixed inset-0` renderizado
 * DENTRO de uma gaveta passa a valer "inset-0 da gaveta".
 *
 * Não dá para consertar com classe de largura: `max-w-3xl` é um teto, e o piso
 * já era 512. Não dá para tirar a animação: ela é o comportamento da gaveta.
 * O que resolve é o diálogo não ser filho da gaveta no DOM — e é isso aqui.
 *
 * O contexto do React ATRAVESSA o portal (react-query, tema, auth continuam
 * valendo), e o evento também borbulha pela árvore do React, não pela do DOM.
 * Ou seja: só a posição no documento muda. Era o único problema.
 *
 * `montado` existe por causa do SSR: `document` não existe no servidor, e
 * chamar `createPortal` na primeira renderização quebraria a hidratação.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setMontado(true);
  }, []);

  if (!montado) return null;
  return createPortal(children, document.body);
}
