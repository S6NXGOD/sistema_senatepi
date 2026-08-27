'use client';

import { cn } from '@/lib/utils';

/**
 * QUEM LITIGA CONTRA QUEM — a versão completa, para o DETALHE.
 *
 * O cartão da lista tem espaço para uma linha e mostra o confronto resumido
 * ("Autor × Réu", com "+2" quando há mais). Aqui é o lugar da verdade inteira:
 * quem abre o detalhe de uma atividade automática quer saber exatamente de que
 * caso se trata, e em ação coletiva o polo passivo costuma ter três, quatro
 * partes. Mostrar só a principal esconderia metade de quem está no processo.
 *
 * O PAPEL APARECE SÓ QUANDO ACRESCENTA. Todo ATIVO num processo de conhecimento
 * é "Autor" e todo PASSIVO é "Réu" — repetir isso ao lado do nome, embaixo de
 * um título que já diz "Polo ativo", é ruído puro. Mas em execução ele vira
 * "Exequente", em recurso "Recorrente", e aí a palavra carrega informação que o
 * polo não dá. Só nesses casos ela é exibida.
 *
 * MOBILE-FIRST: nomes de parte são longos ("SOCIEDADE BRASILEIRA CAMINHO DE
 * DAMASCO", "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO
 * PIAUÍ") e aqui eles QUEBRAM em vez de truncar. É a diferença entre as duas
 * telas: na lista, truncar é certo porque a pessoa está varrendo dezenas de
 * linhas; no detalhe, ela parou nesta e quer ler o nome inteiro. Duas linhas de
 * texto custam menos que uma viagem à ficha do processo.
 */

/** O papel padrão de cada polo — quando o valor é este, a palavra não agrega. */
const PAPEL_OBVIO: Record<string, string> = {
  ATIVO: 'autor',
  PASSIVO: 'reu',
  TERCEIRO: 'terceiro interessado',
};

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/**
 * O papel desta parte acrescenta alguma coisa ao que o polo já diz?
 *
 * Exportada para poder ser testada de verdade: é a única decisão real deste
 * componente, e prendê-la dentro do JSX obrigaria a testar por leitura de
 * código — que passa feliz mesmo quando a lógica está errada.
 */
export function papelQueAcrescenta(
  polo: string,
  papel: string | null | undefined,
): string | null {
  const texto = papel?.trim();
  if (!texto) return null;
  return normalizar(texto) === PAPEL_OBVIO[polo] ? null : texto;
}

export interface ParteDoPolo {
  id: string;
  nome: string;
  polo: 'ATIVO' | 'PASSIVO' | 'TERCEIRO';
  papel?: string | null;
  principal?: boolean;
}

const GRUPOS = [
  { polo: 'ATIVO' as const, rotulo: 'Polo ativo', cor: 'text-emerald-700 dark:text-emerald-400' },
  { polo: 'PASSIVO' as const, rotulo: 'Polo passivo', cor: 'text-rose-700 dark:text-rose-400' },
  { polo: 'TERCEIRO' as const, rotulo: 'Terceiros', cor: 'text-muted-foreground' },
];

export function PolosDoProcesso({
  partes,
  className,
}: {
  partes: ParteDoPolo[] | undefined;
  className?: string;
}) {
  if (!partes?.length) return null;

  const grupos = GRUPOS.map((g) => ({
    ...g,
    lista: partes.filter((p) => p.polo === g.polo),
  })).filter((g) => g.lista.length > 0);

  if (!grupos.length) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {grupos.map((g) => (
        <div key={g.polo}>
          <p className={cn('text-[11px] font-semibold uppercase tracking-wider', g.cor)}>
            {g.rotulo}
            {/*
              A contagem só aparece quando há mais de um. "Polo ativo · 1" é
              informação que ninguém pediu; "Polo passivo · 4" avisa que vem
              lista, antes de a pessoa começar a ler.
            */}
            {g.lista.length > 1 && (
              <span className="font-normal normal-case text-muted-foreground"> · {g.lista.length}</span>
            )}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {g.lista.map((p) => {
              const papel = papelQueAcrescenta(p.polo, p.papel);
              return (
                <li key={p.id} className="flex gap-1.5 text-sm leading-snug">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  {/*
                    `break-words` e não `truncate`: no detalhe, o nome inteiro é
                    o ponto. `min-w-0` deixa a quebra acontecer dentro do flex.
                  */}
                  <span className="min-w-0 break-words">
                    {p.nome}
                    {papel && (
                      <span className="text-xs text-muted-foreground"> · {papel}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
