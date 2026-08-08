'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { tenant } from '@/tenant.config';

type Orientacao = 'horizontal' | 'vertical';
type Variante = 'auto' | 'cor' | 'branco';
type Tom = 'cor' | 'branco';

/**
 * Logo da instalação.
 *
 * ONDE FICAM OS ARQUIVOS: em `apps/web/public/`, nomeados
 * `<id-do-cliente>-<horizontal|vertical>-<cor|branco>.png`. São QUATRO por
 * sindicato. Trocar a marca é soltar os arquivos e acertar o `id` no
 * `tenant.config` — nenhum componente muda.
 *
 * - variant="auto"   → colorida no tema claro, branca no escuro (troca via CSS)
 * - variant="cor"    → sempre colorida (fundos claros)
 * - variant="branco" → sempre branca (fundos escuros ou da cor da marca)
 *
 * O sufixo é `cor`, e não o nome de uma cor: a cor institucional é do cliente,
 * não do sistema. O SENATEPI é verde e o SINDSERM é azul — um sufixo que
 * nomeasse uma delas só confundiria quem prepara os arquivos do outro.
 *
 * A altura vem do className (ex.: `h-9`); a imagem ocupa a altura e mantém a proporção.
 */
export function Logo({
  className,
  variant = 'auto',
  orientation = 'horizontal',
}: {
  className?: string;
  variant?: Variante;
  orientation?: Orientacao;
}) {
  if (variant === 'auto') {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <Marca tom="cor" orientation={orientation} className="block dark:hidden" />
        <Marca tom="branco" orientation={orientation} className="hidden dark:block" />
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center', className)}>
      <Marca tom={variant === 'branco' ? 'branco' : 'cor'} orientation={orientation} />
    </span>
  );
}

/**
 * A imagem, com queda para a sigla escrita.
 *
 * POR QUE A QUEDA EXISTE: um cliente novo entra no ar antes de o designer
 * entregar os arquivos, e o caminho é montado por convenção de nome — basta um
 * `id` com typo para nenhuma das quatro imagens existir. Sem isto, o sistema
 * inteiro abriria com o ícone de imagem quebrada no topo de todas as telas, o
 * que parece defeito grave e é só um arquivo faltando.
 *
 * A sigla em texto usa a cor da marca da instalação, então o resultado é
 * apresentável enquanto os arquivos não chegam.
 */
function Marca({
  tom,
  orientation,
  className,
}: {
  tom: Tom;
  orientation: Orientacao;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);

  if (falhou) {
    return (
      <span
        className={cn('flex h-full items-center whitespace-nowrap font-bold tracking-tight', className)}
        style={{
          // No tom "branco" o fundo é escuro ou da cor da marca; ali a sigla
          // precisa ser branca, e não da cor institucional.
          color: tom === 'branco' ? '#fff' : tenant.paleta[800],
          fontSize: '1.05em',
        }}
      >
        {tenant.sigla}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/${tenant.id}-${orientation}-${tom}.png`}
      alt={tenant.sigla}
      onError={() => setFalhou(true)}
      className={cn('h-full w-auto object-contain', className)}
    />
  );
}
