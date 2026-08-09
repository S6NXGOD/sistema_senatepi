'use client';

import { useEffect, useState } from 'react';
import {
  Calculator, ChevronDown, ChevronUp, FileUp, Info, QrCode, ShieldCheck,
} from 'lucide-react';
import { tenant } from '@/tenant.config';
import { chaveLocal } from '@/lib/armazenamento';

/**
 * Percentual da contribuição patronal.
 *
 * Está aqui, num lugar só, porque é regra de negócio e não texto solto. Se um
 * dia variar por empresa ou por convenção, vira campo de configuração — hoje é
 * o mesmo para todas.
 */
const PERCENTUAL = '1%';

const CHAVE_RECOLHIDO = chaveLocal('empresa', 'guiaRecolhida');

const PASSOS = [
  {
    Icone: Calculator,
    titulo: 'Você calcula',
    texto: `O ${tenant.sigla} cobra ${PERCENTUAL} sobre a folha de vencimentos. O cálculo é feito pela própria empresa, que conhece os valores do mês.`,
  },
  {
    Icone: QrCode,
    titulo: 'Gere a guia e pague',
    texto: 'Confira se o valor bateu, clique em "Nova declaração", escolha o mês de referência e pague o PIX gerado.',
  },
  {
    Icone: FileUp,
    titulo: 'Anexe os documentos',
    texto: 'Envie o comprovante do PIX e a relação de trabalhadores. Não precisa ser os dois de uma vez — o que faltar pode vir depois.',
  },
  {
    Icone: ShieldCheck,
    titulo: 'O sindicato confere',
    texto: 'Analisamos os dados enviados. Se houver algum erro, entraremos em contato com a sua empresa.',
  },
];

/**
 * Guia de uso do portal, mostrado logo depois do login.
 *
 * Fica aberto por padrão: quem entra aqui usa o sistema uma vez por mês e
 * dificilmente lembra do fluxo. Quem já domina pode recolher, e a escolha é
 * lembrada no navegador.
 */
export function GuiaContribuicao() {
  const [aberto, setAberto] = useState(true);

  // Lido depois da montagem para não divergir do HTML renderizado no servidor.
  useEffect(() => {
    setAberto(localStorage.getItem(CHAVE_RECOLHIDO) !== '1');
  }, []);

  function alternar() {
    setAberto((a) => {
      localStorage.setItem(CHAVE_RECOLHIDO, a ? '1' : '0');
      return !a;
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-400/50 bg-brand-50/40 dark:bg-brand-900/10">
      <button
        type="button"
        onClick={alternar}
        className="flex w-full items-center justify-between gap-3 p-4 text-left sm:p-5"
      >
        <span className="flex items-center gap-2">
          <Info className="h-5 w-5 shrink-0 text-brand-800 dark:text-brand-400" />
          <span>
            <span className="block text-sm font-bold">Como funciona a contribuição patronal</span>
            <span className="block text-xs text-muted-foreground">
              {aberto ? 'Quatro passos, do cálculo à conferência.' : 'Toque para ver os passos.'}
            </span>
          </span>
        </span>
        {aberto
          ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {aberto && (
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 sm:px-5 sm:pb-5">
          {PASSOS.map(({ Icone, titulo, texto }, i) => (
            <div key={titulo} className="flex gap-3 rounded-xl bg-card p-3.5">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-900/40">
                <Icone className="h-4 w-4 text-brand-800 dark:text-brand-400" />
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-800 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{titulo}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{texto}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
