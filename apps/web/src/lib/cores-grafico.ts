'use client';

import { useEffect, useState } from 'react';
import { tenant } from '@/tenant.config';

/**
 * AS CORES QUE OS GRÁFICOS DESENHAM.
 *
 * Existe porque SVG não entende classe do Tailwind: `<Area stroke="...">` precisa
 * de uma cor de verdade. O resto da interface usa `bg-brand-800`, que resolve
 * para `rgb(var(--brand-800))` — e é aí que os dois se separavam.
 */

// ---------------------------------------------------------------------------
// Cor da marca, em tempo de execução
// ---------------------------------------------------------------------------

/**
 * A cor da marca COMO ELA ESTÁ NA TELA AGORA.
 *
 * O DEFEITO QUE ISTO CONSERTA. Os gráficos liam `tenant.paleta[800]` — o
 * hexadecimal COMPILADO NO BUILD. Só que a instalação pode trocar a cor por
 * Configurações → Identidade visual, e essa troca acontece em `--brand-*`, em
 * tempo de execução (ver `MarcaCss`). Resultado: num cliente que trocou a cor, a
 * interface inteira mudava e os gráficos continuavam na cor antiga — dois
 * "azuis" diferentes na mesma tela, um deles sem relação nenhuma com a marca.
 *
 * Lê a variável CSS de verdade, então segue qualquer troca sem deploy.
 *
 * O VALOR INICIAL É O DO BUILD, e não vazio: na primeira renderização (no
 * servidor, e no primeiro quadro do cliente) não existe `getComputedStyle`. Sem
 * esse valor o gráfico nasceria sem cor e piscaria.
 */
export function useCorDaMarca(tom: 400 | 500 | 600 | 700 | 800 | 900): string {
  const [cor, setCor] = useState(() => tenant.paleta[tom] ?? '#000000');

  useEffect(() => {
    const ler = () => {
      const canais = getComputedStyle(document.documentElement)
        .getPropertyValue(`--brand-${tom}`)
        .trim();
      // `paletaParaCanaisCss` grava "R G B" (sem vírgula) para o Tailwind poder
      // aplicar opacidade. Aqui vira uma cor que o SVG aceita.
      if (/^\d+\s+\d+\s+\d+$/.test(canais)) setCor(`rgb(${canais})`);
    };
    ler();

    // A tela de Identidade visual escreve direto no `style` do <html>; o tema
    // claro/escuro troca a classe. Os dois mudam a cor efetiva.
    const obs = new MutationObserver(ler);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => obs.disconnect();
  }, [tom]);

  return cor;
}

// ---------------------------------------------------------------------------
// Paleta categórica
// ---------------------------------------------------------------------------

/**
 * CORES DE CATEGORIA — canais de atendimento, e qualquer outra série em que a
 * cor diz QUEM É, não quanto vale.
 *
 * NÃO DERIVA DA MARCA, e isso é a correção principal. Antes eram
 * `[brand-800, brand-600, ...]`: os dois primeiros canais recebiam dois tons da
 * MESMA cor. Medido com o validador de paletas, o par ficava em ΔE 11,3 para
 * visão normal — abaixo do piso de 15, ou seja, indistinguível mesmo para quem
 * enxerga cores perfeitamente. Numa rosca de cinco fatias, duas eram "o verde".
 *
 * Identidade pede matizes DIFERENTES, e a marca não tem cinco. A marca continua
 * mandando onde ela significa alguma coisa: nas séries únicas, que usam
 * `useCorDaMarca`.
 *
 * COMO ESTAS CINCO FORAM ESCOLHIDAS (não foram no olho): cinco matizes a 72° uma
 * da outra no espaço OKLCH, todas com luminosidade 0,60 — que é a INTERSEÇÃO da
 * banda do tema claro (0,43–0,77) com a do escuro (0,48–0,67). É o que permite
 * UMA paleta servir aos dois temas, em vez de um espelho automático que sempre
 * erra num dos lados. A ordem foi escolhida por busca exaustiva, maximizando a
 * separação do pior par vizinho.
 *
 * Validação (ambos os temas): banda de luminosidade OK, piso de croma OK,
 * separação para daltonismo ΔE 14,3 (piso 8) e visão normal ΔE 15,3 (piso 15),
 * contraste contra o fundo ≥ 3:1.
 *
 * ORDEM FIXA, NUNCA RECICLADA. A cor acompanha a ENTIDADE: filtrar um canal não
 * pode repintar os que sobraram, senão a leitura de ontem não vale para a de
 * hoje. Um sexto canal não ganha cor gerada — entra em "Outros".
 */
export const PALETA_CATEGORICA = [
  '#C75A42', // terracota
  '#A85FB3', // roxo
  '#8B840C', // oliva
  '#2D84D3', // azul
  '#039580', // teal
] as const;

/**
 * Cores de POLARIDADE do quadro associativo — entrada, saída e saldo.
 *
 * Não são categóricas: significam bom, ruim e resultado. Por isso ficam fora da
 * paleta acima e não seguem a marca — "saída" pintada com a cor do sindicato
 * seria uma leitura errada de um dado ruim.
 */
export const COR_SAIDA = '#C0392B';
export const COR_SALDO = '#6B4FBB';
