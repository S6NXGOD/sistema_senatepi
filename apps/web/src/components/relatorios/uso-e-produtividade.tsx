'use client';

import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarCheck, Gavel, Headset, Newspaper, UserPlus, type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { AvatarPessoa } from '@/components/ui/avatar-pessoa';
import { FalhaAoCarregar } from '@/components/falha-ao-carregar';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { PERFIL_LABEL, podeVer } from '@/lib/permissoes';
import { contar } from '@/lib/plural';
import {
  GRUPO_DO_PERFIL, O_QUE_NAO_MEDE, ausente, blocosDaPessoa, carregarProdutividade, conteudoDoBloco,
  faixaDeUso, fraseDoPerfil, gruposPorPerfil, hrefDaAuditoria, textoDoUltimoAcesso,
  type Bloco, type LinhaDeUso, type ResumoDoPerfil,
} from '@/lib/produtividade';

/**
 * USO E PRODUTIVIDADE — a aba de quem coordena.
 *
 * Grupos por perfil, pessoas em ordem alfabética, e nenhuma medalha: a ordem
 * vem da API e a tela não reordena. Cada pessoa é um cartão que responde, na
 * ordem em que a coordenação pergunta:
 *
 *  1. ESTÁ USANDO? — o último acesso e a faixa dos dias. Quem ignora atividade
 *     atrasada muitas vezes nem entra, e isso aparece antes de qualquer número.
 *  2. O QUE REGISTROU? — os blocos do perfil, com o que pede atenção em âmbar,
 *     no lugar em que está.
 *  3. ONDE CONFERIR? — "ver o que fez" abre a auditoria já filtrada.
 */
export function UsoEProdutividade({ de, ate }: { de: string; ate: string }) {
  const { user } = useAuth();
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['produtividade', de, ate],
    queryFn: () => carregarProdutividade(de, ate),
    placeholderData: keepPreviousData,
  });
  const verAuditoria = podeVer(user?.role, user?.permissoes, 'auditoria');

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Somando o uso do período…</p>;
  }
  // Falha não vira cartão zerado: zero afirmaria que ninguém trabalhou.
  if (isError) {
    return (
      <Card className="p-2">
        <FalhaAoCarregar erro={error} oQue="o uso do sistema" onTentarDeNovo={() => refetch()} />
      </Card>
    );
  }
  if (!data) return null;

  // "Agora" é o instante em que a API somou — foi contra ele que ela contou as ausências.
  const agora = new Date(data.geradoEm);
  const pessoal = data.escopo === 'PESSOAL';

  return (
    <div className={cn('space-y-6 transition-opacity', isFetching && 'opacity-60')}>
      {pessoal ? (
        <p className="max-w-3xl text-sm text-muted-foreground">
          O seu uso do sistema no período — é o mesmo retrato que a coordenação vê de você.
        </p>
      ) : (
        <ResumoDosPerfis perfis={data.perfis} />
      )}

      {gruposPorPerfil(data.pessoas).map((g) => (
        <section key={g.perfil} id={`perfil-${g.perfil}`} className="scroll-mt-20 space-y-3">
          {!pessoal && (
            <h2 className="flex items-baseline gap-2 text-base font-semibold">
              {GRUPO_DO_PERFIL[g.perfil] ?? g.perfil}
              <span className="text-xs font-normal text-muted-foreground">
                {contar(g.pessoas.length, 'pessoa', 'pessoas')}
              </span>
            </h2>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {g.pessoas.map((p) => (
              <CartaoDaPessoa
                key={p.usuarioId}
                p={p}
                dias={data.dias}
                agora={agora}
                hrefAuditoria={verAuditoria ? hrefDaAuditoria(p.usuarioId, de, ate) : null}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="max-w-3xl border-t pt-3 text-[11px] leading-snug text-muted-foreground">
        {O_QUE_NAO_MEDE} “Dia com uso” é dia com login, sessão renovada ou alguma ação gravada.
      </p>
    </div>
  );
}

/**
 * UMA LINHA POR PERFIL, antes dos cartões: quantos usaram e quantos sumiram.
 * Responde "a equipe está usando?" sem rolar a página — e o toque desce até o
 * grupo.
 */
function ResumoDosPerfis({ perfis }: { perfis: ResumoDoPerfil[] }) {
  if (!perfis.length) return null;
  return (
    <nav
      aria-label="Resumo por perfil"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4"
    >
      {perfis.map((r) => {
        const sumiram = r.semAcessoRecente + r.nuncaEntraram > 0;
        return (
          <a
            key={r.perfil}
            href={`#perfil-${r.perfil}`}
            className="w-44 shrink-0 rounded-xl border bg-card p-3 transition hover:bg-muted/40 sm:w-auto"
          >
            <p className="text-xs text-muted-foreground">{GRUPO_DO_PERFIL[r.perfil] ?? r.perfil}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {r.usaram}
              <span className="ml-1 text-sm font-normal text-muted-foreground">de {r.pessoas} usaram</span>
            </p>
            <p
              className={cn(
                'mt-0.5 text-[11px] leading-snug',
                sumiram ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
              )}
            >
              {fraseDoPerfil(r)}
            </p>
          </a>
        );
      })}
    </nav>
  );
}

function CartaoDaPessoa({
  p, dias, agora, hrefAuditoria,
}: {
  p: LinhaDeUso;
  dias: string[];
  agora: Date;
  hrefAuditoria: string | null;
}) {
  const sumiu = ausente(p.ultimoAcesso, agora);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <AvatarPessoa nome={p.nome} url={p.avatarUrl} tamanho="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.nome}</p>
          <p className="truncate text-xs text-muted-foreground">
            {(PERFIL_LABEL as Record<string, string>)[p.perfil] ?? p.perfil}
            {' · '}
            <span className={cn(sumiu && 'font-medium text-amber-700 dark:text-amber-400')}>
              {p.ultimoAcesso
                ? `último acesso ${textoDoUltimoAcesso(p.ultimoAcesso, agora)}`
                : 'nunca entrou no sistema'}
            </span>
          </p>
        </div>
      </div>

      <FaixaDosDias dias={dias} ativos={p.diasAtivos} total={p.diasComUso} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {blocosDaPessoa(p).map((b) => (
          <QuadroDoBloco key={b} bloco={b} p={p} />
        ))}
      </div>

      {hrefAuditoria && (
        <Link
          href={hrefAuditoria}
          className="inline-flex items-center gap-1 self-start text-xs font-medium text-brand-800 hover:underline dark:text-brand-300"
        >
          Ver o que fez no período <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </Card>
  );
}

const diaMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function tomDaSemana(comUso: number, total: number): string {
  if (!comUso) return 'bg-muted';
  const proporcao = comUso / total;
  if (proporcao >= 0.7) return 'bg-brand-600 dark:bg-brand-400';
  if (proporcao >= 0.4) return 'bg-brand-400 dark:bg-brand-600';
  return 'bg-brand-200 dark:bg-brand-800';
}

/**
 * A FAIXA DOS DIAS — um traço por dia, cheio quando a pessoa usou o sistema.
 * Fim de semana é mais claro: ninguém deve nada ao sábado, e a faixa não pode
 * sugerir o contrário.
 */
function FaixaDosDias({ dias, ativos, total }: { dias: string[]; ativos: string[]; total: number }) {
  const faixa = faixaDeUso(dias, ativos);
  return (
    <div>
      <div
        role="img"
        aria-label={`${total} de ${dias.length} dias com uso`}
        className="flex h-4 items-stretch gap-[2px]"
      >
        {faixa.tipo === 'DIA'
          ? faixa.marcas.map((m) => (
              <span
                key={m.dia}
                title={`${diaMes(m.dia)}${m.usou ? ': usou o sistema' : ''}`}
                className={cn(
                  'min-w-[2px] max-w-3 flex-1 rounded-[2px]',
                  m.usou ? 'bg-brand-600 dark:bg-brand-400' : m.fimDeSemana ? 'bg-muted/40' : 'bg-muted',
                )}
              />
            ))
          : faixa.marcas.map((m) => (
              <span
                key={m.inicio}
                title={`Semana de ${diaMes(m.inicio)}: ${m.diasComUso} de ${m.diasNoTrecho} dias`}
                className={cn('min-w-[3px] max-w-4 flex-1 rounded-[2px]', tomDaSemana(m.diasComUso, m.diasNoTrecho))}
              />
            ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {total} de {contar(dias.length, 'dia', 'dias')} com uso
        {faixa.tipo === 'SEMANA' && ' · cada traço é uma semana'}
      </p>
    </div>
  );
}

const ICONE_DO_BLOCO: Record<Bloco, LucideIcon> = {
  agenda: CalendarCheck,
  publicacoes: Newspaper,
  processos: Gavel,
  filiados: UserPlus,
  atendimentos: Headset,
};

const TITULO_DO_BLOCO: Record<Bloco, string> = {
  agenda: 'Agenda',
  publicacoes: 'Publicações',
  processos: 'Processos',
  filiados: 'Filiados',
  atendimentos: 'Atendimento',
};

function QuadroDoBloco({ bloco, p }: { bloco: Bloco; p: LinhaDeUso }) {
  const Icone = ICONE_DO_BLOCO[bloco];
  const c = conteudoDoBloco(bloco, p);
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 p-2.5">
      <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {TITULO_DO_BLOCO[bloco]}
      </p>
      <p className="mt-1 text-xl font-bold leading-none tabular-nums">{c.numero}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{c.rotulo}</p>
      {c.linhas.map((l) => (
        <p
          key={l.texto}
          className={cn(
            'mt-0.5 text-[11px] leading-snug',
            l.alerta ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {l.texto}
        </p>
      ))}
    </div>
  );
}
