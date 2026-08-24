'use client';

import { cn } from '@/lib/utils';

/**
 * O ROSTO DE UMA PESSOA — foto quando há, iniciais quando não.
 *
 * POR QUE VIROU COMPONENTE. Isto vivia dentro de `compromisso-card.tsx`, usado
 * só pela agenda. A listagem de processos precisava do mesmo rosto, e copiar
 * teria dado dois avatares com tamanhos e iniciais ligeiramente diferentes para
 * a MESMA pessoa em duas telas — que é o oposto do que um avatar serve.
 *
 * AS INICIAIS USAM DUAS LETRAS, e o prefixo é descartado. Com uma letra só,
 * "Dra. Morgana" e "Dr. Matheus" viravam ambos um "D": o avatar deixava de
 * distinguir exatamente onde precisava.
 *
 * A COR SAI DO NOME, e não é enfeite. Numa lista de trinta linhas com metade
 * das pessoas sem foto, um fundo único faria todas as iniciais parecerem a
 * mesma bolinha; com a cor derivada do nome, cada pessoa tem sempre a MESMA, e
 * o reconhecimento passa a funcionar antes da leitura. A paleta é fechada e
 * todas as combinações foram escolhidas com contraste suficiente para o texto.
 */
const CORES = [
  'bg-brand-200 text-brand-900',
  'bg-sky-200 text-sky-900',
  'bg-violet-200 text-violet-900',
  'bg-amber-200 text-amber-900',
  'bg-emerald-200 text-emerald-900',
  'bg-rose-200 text-rose-900',
  'bg-teal-200 text-teal-900',
] as const;

const TAMANHOS = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
} as const;

function iniciaisDe(nome: string): string {
  return nome
    .replace(/^(dra?\.?|sr[a]?\.?)\s+/i, '') // "Dr."/"Dra." não identificam ninguém
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
}

/** Índice estável: a mesma pessoa recebe sempre a mesma cor, em toda tela. */
function corDe(nome: string): string {
  let soma = 0;
  for (let i = 0; i < nome.length; i++) soma = (soma + nome.charCodeAt(i)) % 9973;
  return CORES[soma % CORES.length];
}

export function AvatarPessoa({
  nome,
  url,
  titulo,
  tamanho = 'sm',
  className,
}: {
  nome: string;
  url?: string | null;
  titulo?: string;
  tamanho?: keyof typeof TAMANHOS;
  className?: string;
}) {
  const base = cn('shrink-0 rounded-full', TAMANHOS[tamanho], className);

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" title={titulo ?? nome} className={cn(base, 'border object-cover')} />
    );
  }
  return (
    <span
      title={titulo ?? nome}
      className={cn(base, 'flex items-center justify-center font-bold', corDe(nome))}
    >
      {iniciaisDe(nome) || '?'}
    </span>
  );
}

/**
 * A EQUIPE DE UM PROCESSO OU ATIVIDADE, em um espaço de uma linha.
 *
 * Rostos sobrepostos com o responsável PRIMEIRO, e o excedente virando "+N".
 * Numa lista, o que se pergunta é "isto é meu?" — e para responder basta
 * reconhecer um rosto, não ler três nomes.
 *
 * O NOME DO RESPONSÁVEL FICA AO LADO quando há espaço (`mostrarNome`), porque
 * rosto sozinho não serve para quem ainda não decorou a equipe — e no primeiro
 * mês ninguém decorou.
 */
export function EquipeAvatares({
  pessoas,
  limite = 3,
  mostrarNome = false,
  tamanho = 'sm',
  className,
}: {
  /** Em ordem: o responsável primeiro. */
  pessoas: { id: string; nome: string; avatarUrl?: string | null }[];
  limite?: number;
  mostrarNome?: boolean;
  tamanho?: keyof typeof TAMANHOS;
  className?: string;
}) {
  if (!pessoas.length) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>
        sem responsável
      </span>
    );
  }

  const visiveis = pessoas.slice(0, limite);
  const resto = pessoas.length - visiveis.length;
  const principal = pessoas[0];

  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span className="flex -space-x-1.5">
        {visiveis.map((p) => (
          // O anel na cor do fundo é o que separa um rosto do outro na pilha.
          <span key={p.id} className="rounded-full ring-2 ring-background">
            <AvatarPessoa nome={p.nome} url={p.avatarUrl} tamanho={tamanho} />
          </span>
        ))}
      </span>
      {resto > 0 && (
        <span
          className="text-[11px] font-medium text-muted-foreground"
          title={pessoas.slice(limite).map((p) => p.nome).join(', ')}
        >
          +{resto}
        </span>
      )}
      {mostrarNome && (
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={principal.nome}>
          {primeiroNomeCurto(principal.nome)}
        </span>
      )}
    </span>
  );
}

/**
 * "Dra. Shérad Araújo" -> "Dra. Shérad".
 *
 * O tratamento FICA: numa lista de advogados é assim que a casa se refere às
 * pessoas, e cortá-lo deixaria o nome estranho para ganhar cinco pixels.
 */
function primeiroNomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (/^(dra?\.?|sr[a]?\.?)$/i.test(partes[0] ?? '')) return partes.slice(0, 2).join(' ');
  return partes[0] ?? nome;
}
